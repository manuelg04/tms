import express from "express";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildFailureResponse,
  generateLoadingOrderDocument,
  generateManifestDocument,
  generateManifestFulfillmentDocument,
  manifestRadicationStamp,
  generateRemesaDocument,
  RndcClient
} from "@tms/rndc-core";
import type {
  DemoScenario,
  GeneratedDocument,
  RndcConfig,
  RndcFlowResult,
  RndcFlowStep,
  RndcMessageRequest,
  RndcMessageResponse
} from "@tms/rndc-core";
import { syncOperationToConvex } from "./convexSync.js";
import type { ConvexSyncStatus } from "./convexSync.js";
import { assessFormFopat } from "./phaseOneRoutes.js";
import type { FormFopatAssessment } from "./phaseOneRoutes.js";
import { getRequestContext } from "./runtimeSecurity.js";
import { readDurableEvidenceContext } from "./durableEvidence.js";
import type { DurableEvidenceReport, DurableEvidenceStore } from "./durableEvidence.js";
import { buildScenarioFromForm, child, readString, readNumber, isRecord } from "./formScenario.js";

export type FormOperation = "loading-order" | "remesa" | "trip" | "manifest" | "manifest-issue" | "driver-vehicle" | "driver" | "vehicle" | "party" | "fulfill-remesa" | "fulfill-manifest";

export type FormMessage = {
  name: string;
  title: string;
  request: RndcMessageRequest;
};

export type SavedFormStep = {
  name: string;
  title: string;
  tipo: number;
  procesoId: number;
  accepted: boolean;
  status: number;
  radicado?: string;
  seguridadQr?: string;
  observacionesQr?: string;
  errorText?: string;
  requestPath: string;
  responsePath: string;
};

export type FormResult = {
  ok: boolean;
  operation: FormOperation;
  mode: RndcConfig["mode"];
  transport: RndcConfig["transport"];
  environment: RndcConfig["environment"];
  endpointUrl: string;
  startedAt: string;
  finishedAt: string;
  runDirectory: string;
  evidencePath: string;
  numbers: {
    loadingOrder: string;
    trip: string;
    remesa: string;
    manifest: string;
    plate: string;
    driverId: string;
    ownerId: string;
    holderId: string;
  };
  documents: GeneratedDocument[];
  steps: SavedFormStep[];
  fopat?: FormFopatAssessment;
  convexSync?: ConvexSyncStatus;
  durableEvidence?: DurableEvidenceReport;
};

export const inFlightOperations = new Set<string>();

export async function submitForm(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
  readConfig: () => RndcConfig,
  operation: FormOperation,
  buildMessages: (scenario: DemoScenario) => FormMessage[],
  evidenceStore: DurableEvidenceStore
): Promise<void> {
  let operationKey: string | undefined;

  try {
    const config = readConfig();

    if (config.mode === "live" || req.header("X-TMS-Durable-Operation") === "true") {
      const missingFields = collectMissingFormFields(operation, req.body);

      if (missingFields.length > 0) {
        res.status(400).json({
          ok: false,
          error: `Missing required fields for ${operation}: ${missingFields.join(", ")}`,
          missingFields
        });
        return;
      }
    }

    const allowReferenceDefaults = config.mode === "dry-run" && req.header("X-TMS-Durable-Operation") !== "true";
    const scenario = buildScenarioFromForm(config, req.body, allowReferenceDefaults);
    const fopat = assessFormFopat(operation, req.body, scenario, config.mode);

    if (fopat?.blocked) {
      const context = getRequestContext(req);
      res.status(422).json({
        ok: false,
        error: {
          code: "FOPAT_REVIEW_REQUIRED",
          message: "FOPAT applicability must be resolved before a live RNDC submission"
        },
        fopat: fopat.assessment,
        requestId: context.requestId,
        correlationId: context.correlationId
      });
      return;
    }

    if (fopat) {
      scenario.money.fopatRetention = fopat.amountToUse;
    }

    operationKey = `${operation}:${operationDocumentNumber(operation, scenario)}`;

    if (inFlightOperations.has(operationKey)) {
      operationKey = undefined;
      res.status(409).json({
        ok: false,
        error: `A ${operation} submission for the same document number is already in progress`
      });
      return;
    }

    inFlightOperations.add(operationKey);
    const result = await runFormOperation(config, scenario, operation, buildMessages(scenario), fopat?.assessment);
    result.convexSync = req.header("X-TMS-Durable-Operation") === "true"
      ? { synced: false, reason: "Durable gateway owns persistence for this operation" }
      : await syncOperationToConvex(result, scenario);
    const durableContext = readDurableEvidenceContext((name) => req.header(name));

    if (durableContext.requested && "context" in durableContext) {
      result.durableEvidence = await evidenceStore(result, durableContext.context, {
        outputDir: config.outputDir,
        pdfDir: config.pdfDir
      });
    }

    res.status(result.ok ? 200 : result.steps.some((step) => step.status === 0) ? 502 : 422).json(result);
  } catch (error) {
    next(error);
  } finally {
    if (operationKey) {
      inFlightOperations.delete(operationKey);
    }
  }
}

export function operationDocumentNumber(operation: FormOperation, scenario: DemoScenario): string {
  if (operation === "loading-order") {
    return scenario.cargoNumber;
  }

  if (operation === "remesa") {
    return scenario.remesaNumber;
  }

  if (operation === "trip") {
    return scenario.tripNumber;
  }

  if (operation === "manifest" || operation === "manifest-issue") {
    return scenario.manifestNumber;
  }

  if (operation === "fulfill-remesa") {
    return scenario.remesaNumber;
  }

  if (operation === "fulfill-manifest") {
    return scenario.manifestNumber;
  }

  if (operation === "driver") {
    return scenario.driver.id;
  }

  if (operation === "vehicle") {
    return scenario.vehicle.plate;
  }

  if (operation === "party") {
    return `${scenario.sender.id}-${scenario.sender.siteCode}`;
  }

  return `${scenario.driver.id}-${scenario.vehicle.plate}`;
}

export const requiredFormFields: Record<FormOperation, string[]> = {
  "loading-order": [
    "cargoNumber",
    "loadingAppointmentDate",
    "unloadingAppointmentDate",
    "sender.id",
    "recipient.id",
    "cargo.shortDescription",
    "cargo.quantityKg"
  ],
  remesa: [
    "remesaNumber",
    "loadingAppointmentDate",
    "loadingAppointmentTime",
    "unloadingAppointmentDate",
    "unloadingAppointmentTime",
    "sender.idType",
    "sender.id",
    "sender.siteCode",
    "recipient.idType",
    "recipient.id",
    "recipient.siteCode",
    "cargo.shortDescription",
    "cargo.merchandiseCode",
    "cargo.packageCode",
    "cargo.natureCode",
    "cargo.quantityKg",
    "cargoPolicy.number",
    "cargoPolicy.expirationDate",
    "cargoPolicy.insurerNit"
  ],
  trip: [
    "tripNumber",
    "driver.idType",
    "driver.id",
    "vehicle.plate",
    "sender.cityCode",
    "recipient.cityCode",
    "money.freightValue"
  ],
  manifest: [
    "manifestNumber",
    "remesaNumber",
    "expeditionDate",
    "balancePaymentDate",
    "driver.idType",
    "driver.id",
    "vehicle.plate",
    "vehicleHolder.idType",
    "vehicleHolder.id",
    "sender.cityCode",
    "recipient.cityCode",
    "money.freightValue",
    "money.advanceValue",
    "money.icaRetentionPerMille"
  ],
  "manifest-issue": [
    "manifestNumber",
    "remesaNumber",
    "expeditionDate",
    "balancePaymentDate",
    "driver.idType",
    "driver.id",
    "vehicle.plate",
    "vehicleHolder.idType",
    "vehicleHolder.id",
    "sender.cityCode",
    "recipient.cityCode",
    "money.freightValue",
    "money.advanceValue",
    "money.icaRetentionPerMille"
  ],
  "fulfill-remesa": [
    "remesaNumber",
    "manifestNumber",
    "compliance.remesaType",
    "compliance.loadedQuantityKg",
    "compliance.unitCode",
    "compliance.loadingEntryDate",
    "compliance.loadingEntryTime"
  ],
  "fulfill-manifest": [
    "manifestNumber",
    "compliance.manifestType",
    "compliance.documentsDeliveryDate",
    "money.freightValue",
    "compliance.additionalLoadHoursValue",
    "compliance.additionalUnloadHoursValue",
    "compliance.additionalFreightValue",
    "compliance.freightDiscountValue",
    "compliance.overAdvanceValue"
  ],
  "driver-vehicle": [
    "driver.idType",
    "driver.id",
    "driver.firstName",
    "driver.firstLastName",
    "driver.phone",
    "driver.address",
    "driver.cityCode",
    "driver.licenseCategory",
    "driver.licenseNumber",
    "driver.licenseExpirationDate",
    "vehicleOwner.idType",
    "vehicleOwner.id",
    "vehicleOwner.firstName",
    "vehicleOwner.firstLastName",
    "vehicleOwner.phone",
    "vehicleOwner.address",
    "vehicleOwner.cityCode",
    "vehicleHolder.idType",
    "vehicleHolder.id",
    "vehicleHolder.firstName",
    "vehicleHolder.firstLastName",
    "vehicleHolder.phone",
    "vehicleHolder.address",
    "vehicleHolder.cityCode",
    "vehicle.plate",
    "vehicle.rndcConfigurationCode",
    "vehicle.rndcMakeCode",
    "vehicle.rndcFuelCode",
    "vehicle.rndcBodyTypeCode",
    "vehicle.lineCode",
    "vehicle.modelYear",
    "vehicle.emptyWeightKg",
    "vehicle.capacityKg",
    "vehicle.colorCode",
    "vehicle.soatNumber",
    "vehicle.soatExpirationDate",
    "vehicle.insurerNit"
  ],
  driver: [
    "driver.idType",
    "driver.id",
    "driver.firstName",
    "driver.firstLastName",
    "driver.phone",
    "driver.address",
    "driver.cityCode",
    "driver.licenseCategory",
    "driver.licenseNumber",
    "driver.licenseExpirationDate"
  ],
  vehicle: [
    "vehicleOwner.idType",
    "vehicleOwner.id",
    "vehicleOwner.firstName",
    "vehicleOwner.firstLastName",
    "vehicleOwner.phone",
    "vehicleOwner.address",
    "vehicleOwner.cityCode",
    "vehicleHolder.idType",
    "vehicleHolder.id",
    "vehicleHolder.firstName",
    "vehicleHolder.firstLastName",
    "vehicleHolder.phone",
    "vehicleHolder.address",
    "vehicleHolder.cityCode",
    "vehicle.plate",
    "vehicle.rndcConfigurationCode",
    "vehicle.rndcMakeCode",
    "vehicle.rndcFuelCode",
    "vehicle.rndcBodyTypeCode",
    "vehicle.lineCode",
    "vehicle.modelYear",
    "vehicle.emptyWeightKg",
    "vehicle.capacityKg",
    "vehicle.colorCode",
    "vehicle.soatNumber",
    "vehicle.soatExpirationDate",
    "vehicle.insurerNit"
  ],
  party: [
    "sender.idType",
    "sender.id",
    "sender.name",
    "sender.address",
    "sender.cityCode"
  ]
};

export const requiredNumericFormFields: Record<FormOperation, string[]> = {
  "loading-order": ["cargo.quantityKg"],
  remesa: ["cargo.quantityKg"],
  trip: ["money.freightValue"],
  manifest: ["money.freightValue", "money.advanceValue", "money.icaRetentionPerMille"],
  "manifest-issue": ["money.freightValue", "money.advanceValue", "money.icaRetentionPerMille"],
  "fulfill-remesa": ["compliance.loadedQuantityKg", "compliance.unitCode"],
  "fulfill-manifest": [
    "money.freightValue",
    "compliance.additionalLoadHoursValue",
    "compliance.additionalUnloadHoursValue",
    "compliance.additionalFreightValue",
    "compliance.freightDiscountValue",
    "compliance.overAdvanceValue"
  ],
  "driver-vehicle": ["vehicle.emptyWeightKg", "vehicle.capacityKg"],
  driver: [],
  vehicle: ["vehicle.emptyWeightKg", "vehicle.capacityKg"],
  party: []
};

export function collectMissingFormFields(operation: FormOperation, payload: unknown): string[] {
  const record = isRecord(payload) ? payload : {};
  const workflowVariant = readString(record, "workflowVariant", "");
  const optional = new Set<string>();
  if (operation === "remesa" && workflowVariant === "remesa_without_order") optional.add("cargoNumber");
  if ((operation === "manifest" || operation === "manifest-issue") && workflowVariant === "remesa_without_order") {
    optional.add("tripNumber");
    optional.add("cargoNumber");
  }
  if ((operation === "manifest" || operation === "manifest-issue") && workflowVariant === "empty_manifest") {
    optional.add("tripNumber");
    optional.add("remesaNumber");
    optional.add("cargoNumber");
  }
  const missing = requiredFormFields[operation].filter((path) => !optional.has(path) && !hasFormValue(record, path));
  const compliance = child(record, "compliance");

  if (operation === "fulfill-remesa") {
    const remesaType = readString(compliance, "remesaType", "");

    if (remesaType !== "C" && remesaType !== "S" && !missing.includes("compliance.remesaType")) {
      missing.push("compliance.remesaType");
    }

    if (remesaType === "C") {
      pushMissing(record, missing, [
        "compliance.deliveredQuantityKg",
        "compliance.unloadingEntryDate",
        "compliance.unloadingEntryTime"
      ]);

      if (!hasFiniteNumericFormValue(record, "compliance.deliveredQuantityKg") && !missing.includes("compliance.deliveredQuantityKg")) {
        missing.push("compliance.deliveredQuantityKg");
      }
    }

    if (remesaType === "S") {
      pushMissing(record, missing, ["compliance.remesaSuspensionReason"]);
    }
  }

  if (operation === "fulfill-manifest") {
    const manifestType = readString(compliance, "manifestType", "");

    if (manifestType !== "C" && manifestType !== "S" && !missing.includes("compliance.manifestType")) {
      missing.push("compliance.manifestType");
    }

    if (manifestType === "S") {
      pushMissing(record, missing, ["compliance.manifestSuspensionReason", "compliance.suspensionConsequence"]);
    }

    if (readNumber(compliance, "additionalFreightValue", 0) > 0) {
      pushMissing(record, missing, ["compliance.additionalValueReason"]);
    }

    if (readNumber(compliance, "freightDiscountValue", 0) > 0) {
      pushMissing(record, missing, ["compliance.discountReason"]);
    }
  }

  for (const path of requiredNumericFormFields[operation]) {
    if (!hasFiniteNumericFormValue(record, path) && !missing.includes(path)) {
      missing.push(path);
    }
  }

  return missing;
}

export function pushMissing(record: Record<string, unknown>, missing: string[], paths: string[]): void {
  for (const path of paths) {
    if (!hasFormValue(record, path) && !missing.includes(path)) {
      missing.push(path);
    }
  }
}

export function hasFormValue(record: Record<string, unknown>, path: string): boolean {
  let current: unknown = record;

  for (const part of path.split(".")) {
    if (!isRecord(current)) {
      return false;
    }

    current = current[part];
  }

  if (typeof current === "number") {
    return Number.isFinite(current);
  }

  return typeof current === "string" && current.trim() !== "";
}

export function hasFiniteNumericFormValue(record: Record<string, unknown>, path: string): boolean {
  let current: unknown = record;

  for (const part of path.split(".")) {
    if (!isRecord(current)) {
      return false;
    }

    current = current[part];
  }

  if (typeof current === "number") {
    return Number.isFinite(current);
  }

  if (typeof current !== "string" || current.trim() === "") {
    return false;
  }

  return Number.isFinite(Number(current.replaceAll(",", "").trim()));
}

export async function runFormOperation(
  config: RndcConfig,
  scenario: DemoScenario,
  operation: FormOperation,
  messages: FormMessage[],
  fopat?: FormFopatAssessment
): Promise<FormResult> {
  const client = new RndcClient(config);
  const startedAt = new Date().toISOString();
  const runDirectory = join(config.outputDir, `${startedAt.replaceAll(":", "-")}-${scenario.seed}-${operation}`);
  const requestDirectory = join(runDirectory, "requests");
  const responseDirectory = join(runDirectory, "responses");
  const steps: SavedFormStep[] = [];

  await mkdir(requestDirectory, { recursive: true });
  await mkdir(responseDirectory, { recursive: true });

  for (const message of messages) {
    const response = await sendFormMessage(client, config, message.request);
    const safeName = `${String(message.request.procesoId).padStart(2, "0")}-${message.name}`;
    const requestPath = join(requestDirectory, `${safeName}.xml`);
    const responsePath = join(responseDirectory, `${safeName}.xml`);
    await writeFile(requestPath, `${response.requestXml}\n`, "utf8");
    await writeFile(responsePath, `${response.rndcResponseXml}\n`, "utf8");
    steps.push({
      name: message.name,
      title: message.title,
      tipo: Number(message.request.tipo),
      procesoId: Number(message.request.procesoId),
      accepted: response.ok,
      status: response.status,
      radicado: response.radicado,
      seguridadQr: response.seguridadQr,
      observacionesQr: response.observacionesQr,
      errorText: response.errorText,
      requestPath,
      responsePath
    });

    if (!response.ok) {
      break;
    }
  }

  const ok = steps.length === messages.length && steps.every((step) => step.accepted);
  const documents = ok ? await buildOperationDocuments(operation, scenario, steps, config) : [];
  const evidencePath = join(runDirectory, "result.json");
  const result: FormResult = {
    ok,
    operation,
    mode: config.mode,
    transport: config.transport,
    environment: config.environment,
    endpointUrl: config.endpointUrl,
    startedAt,
    finishedAt: new Date().toISOString(),
    runDirectory,
    evidencePath,
    numbers: {
      loadingOrder: scenario.cargoNumber,
      trip: scenario.tripNumber,
      remesa: scenario.remesaNumber,
      manifest: scenario.manifestNumber,
      plate: scenario.vehicle.plate,
      driverId: scenario.driver.id,
      ownerId: scenario.vehicleOwner.id,
      holderId: scenario.vehicleHolder.id
    },
    documents,
    steps,
    fopat
  };

  await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

export async function sendFormMessage(client: RndcClient, config: RndcConfig, request: RndcMessageRequest): Promise<RndcMessageResponse> {
  try {
    return await client.sendMessage(request);
  } catch (error) {
    return buildFailureResponse(config, request, error);
  }
}

export async function buildOperationDocuments(operation: FormOperation, scenario: DemoScenario, steps: SavedFormStep[], config: RndcConfig): Promise<GeneratedDocument[]> {
  if (operation === "fulfill-remesa") {
    return [];
  }

  if (operation === "fulfill-manifest") {
    return [await generateManifestFulfillmentDocument(scenario, config.pdfDir, config.mode)];
  }

  if (operation === "loading-order") {
    return [await generateLoadingOrderDocument(scenario, steps[0]?.radicado ?? "PENDIENTE", config.pdfDir, config.mode)];
  }

  if (operation === "remesa") {
    return [await generateRemesaDocument(scenario, { remesaAuthorization: steps[0]?.radicado }, config.pdfDir, config.mode)];
  }

  if (operation === "trip") {
    return [];
  }

  if (operation === "manifest" || operation === "manifest-issue") {
    const manifest = steps.find((step) => step.name === "issue-manifest");
    return [await generateManifestDocument(scenario, {
      manifestAuthorization: manifest?.radicado,
      seguridadQr: manifest?.seguridadQr,
      observacionesQr: manifest?.observacionesQr,
      radicatedAt: manifestRadicationStamp(new Date())
    }, config.pdfDir, config.mode)];
  }

  return [];
}

export function summarizeFlow(result: RndcFlowResult) {
  return {
    ok: result.ok,
    mode: result.mode,
    transport: result.transport,
    environment: result.environment,
    endpointUrl: result.endpointUrl,
    companyNit: result.companyNit,
    companyDv: result.companyDv,
    companyRndcNit: result.companyRndcNit,
    cargoNumber: result.cargoNumber,
    tripNumber: result.tripNumber,
    remesaNumber: result.remesaNumber,
    manifestNumber: result.manifestNumber,
    remesaAuthorization: result.remesaAuthorization,
    manifestAuthorization: result.manifestAuthorization,
    seguridadQr: result.seguridadQr,
    observacionesQr: result.observacionesQr,
    evidencePath: result.evidencePath,
    documents: result.documents,
    steps: result.steps.map(summarizeStep)
  };
}

export function summarizeStep(step: RndcFlowStep) {
  return {
    name: step.name,
    title: step.title,
    accepted: step.accepted,
    status: step.response.status,
    radicado: step.response.radicado,
    errorText: step.response.errorText,
    requestPath: step.requestPath,
    responsePath: step.responsePath
  };
}

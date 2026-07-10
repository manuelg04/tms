import express from "express";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDriverVehicleMessages, buildFailureResponse, buildFulfillManifestMessages, buildFulfillRemesaMessages, buildLoadingOrderMessages, buildManifestMessages, buildMtmReferenceScenario, buildRemesaMessages, generateLoadingOrderDocument, generateManifestDocument, generateRemesaDocument, loadConfig, RndcClient, runDemoFlow } from "@tms/rndc-core";
import type { CargoData, CompanyParty, ComplianceData, DemoScenario, GeneratedDocument, MoneyData, PersonData, RndcConfig, RndcFlowResult, RndcFlowStep, RndcMessageRequest, RndcMessageResponse, VehicleData } from "@tms/rndc-core";
import { syncOperationToConvex } from "./convexSync.js";
import type { ConvexSyncStatus } from "./convexSync.js";
import { assessFormFopat, registerPhaseOneRoutes } from "./phaseOneRoutes.js";
import type { FormFopatAssessment } from "./phaseOneRoutes.js";
import { assertRuntimeCanStart, assessRuntimeSafety, authenticateServiceRequest, createJsonLogger, getRequestContext, isLegacyMessageAllowed, readRndcRuntimeSettings, requestContextMiddleware, sendApiError } from "./runtimeSecurity.js";
import type { RndcAppHooks, RndcLogger, RndcRuntimeSettings } from "./runtimeSecurity.js";
import { readDurableEvidenceContext, storeDurableEvidenceToConvex } from "./durableEvidence.js";
import type { DurableEvidenceReport, DurableEvidenceStore } from "./durableEvidence.js";

export type FormOperation = "loading-order" | "remesa" | "manifest" | "driver-vehicle" | "fulfill-remesa" | "fulfill-manifest";

type FormMessage = {
  name: string;
  title: string;
  request: RndcMessageRequest;
};

type SavedFormStep = {
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

type FormResult = {
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

type RndcAppRuntimeHooks = RndcAppHooks & {
  evidenceStore?: DurableEvidenceStore;
};

export function createRndcApp(overrides: Partial<RndcConfig> = {}, hooks: RndcAppRuntimeHooks = {}): express.Express {
  const app = express();
  const readConfig = () => loadConfig(overrides);
  const initialConfig = readConfig();
  const runtimeSettings = readRndcRuntimeSettings();
  const evidenceStore = hooks.evidenceStore ?? storeDurableEvidenceToConvex;
  const requireServiceAuthentication = createServiceAuthenticationMiddleware(readConfig, runtimeSettings);
  const requireOperationalReadiness = createOperationalReadinessMiddleware(readConfig, runtimeSettings);

  app.disable("x-powered-by");
  app.use(requestContextMiddleware);
  app.use(securityHeaders);
  app.use(createRequestLoggingMiddleware(hooks.logger));
  app.use(createLegacyCorsMiddleware(initialConfig, runtimeSettings));
  app.use(express.json({ limit: "1mb" }));
  app.get(["/healthz", "/health"], (_req, res) => {
    res.json({ ok: true, status: "alive" });
  });

  app.get("/readyz", (_req, res) => {
    const report = assessRuntimeSafety(readConfig(), runtimeSettings);

    if (report.ready) {
      res.json({ ok: true, status: "ready", mode: report.mode });
      return;
    }

    res.status(503).json({
      ok: false,
      status: "not_ready",
      mode: report.mode,
      issues: report.issues
    });
  });

  app.use("/rndc", requireServiceAuthentication);
  app.use("/rndc", createDurableEvidenceMiddleware(runtimeSettings));
  app.use("/pdf", requireServiceAuthentication, express.static(initialConfig.pdfDir, {
    dotfiles: "deny",
    fallthrough: true,
    index: false,
    setHeaders: (res) => {
      res.setHeader("Content-Disposition", "attachment");
    }
  }));

  app.get("/rndc/forms/reference", requireOperationalReadiness, (_req, res) => {
    const config = readConfig();
    const scenario = buildMtmReferenceScenario(config);
    res.json({
      ok: true,
      mode: config.mode,
      transport: config.transport,
      environment: config.environment,
      company: scenario.company,
      form: scenarioToForm(scenario),
      codes: {
        idTypes: [
          { value: "C", label: "Cedula de ciudadania" },
          { value: "N", label: "NIT" },
          { value: "E", label: "Cedula de extranjeria" },
          { value: "P", label: "Pasaporte" }
        ],
        operation: "G",
        capacityUnit: 1,
        packageCode: scenario.cargo.packageCode,
        natureCode: scenario.cargo.natureCode,
        vehicleConfigurationCode: scenario.vehicle.rndcConfigurationCode
      }
    });
  });

  app.post("/rndc/forms/loading-order", requireOperationalReadiness, (req, res, next) => {
    void submitForm(req, res, next, readConfig, "loading-order", buildLoadingOrderMessages, evidenceStore);
  });

  app.post("/rndc/forms/remesa", requireOperationalReadiness, (req, res, next) => {
    void submitForm(req, res, next, readConfig, "remesa", buildRemesaMessages, evidenceStore);
  });

  app.post("/rndc/forms/manifest", requireOperationalReadiness, (req, res, next) => {
    void submitForm(req, res, next, readConfig, "manifest", buildManifestMessages, evidenceStore);
  });

  app.post("/rndc/forms/fulfill-remesa", requireOperationalReadiness, (req, res, next) => {
    void submitForm(req, res, next, readConfig, "fulfill-remesa", buildFulfillRemesaMessages, evidenceStore);
  });

  app.post("/rndc/forms/fulfill-manifest", requireOperationalReadiness, (req, res, next) => {
    void submitForm(req, res, next, readConfig, "fulfill-manifest", buildFulfillManifestMessages, evidenceStore);
  });

  app.post("/rndc/forms/driver-vehicle", requireOperationalReadiness, (req, res, next) => {
    void submitForm(req, res, next, readConfig, "driver-vehicle", buildDriverVehicleMessages, evidenceStore);
  });

  registerPhaseOneRoutes(app, readConfig, requireOperationalReadiness, evidenceStore);

  app.post("/rndc/message", createLegacyMessageMiddleware(readConfig, runtimeSettings), requireOperationalReadiness, async (req, res, next) => {
    try {
      const config = readConfig();
      const client = new RndcClient(config);
      const response = await client.sendMessage({
        tipo: req.body.tipo,
        procesoId: req.body.procesoId,
        variables: req.body.variables,
        documento: req.body.documento,
        documentorango: req.body.documentorango
      });
      res.status(response.ok ? 200 : 422).json(response);
    } catch (error) {
      next(error);
    }
  });

  app.post("/rndc/flows/demo", createDryRunOnlyMiddleware(readConfig), requireOperationalReadiness, async (_req, res, next) => {
    try {
      const config = readConfig();
      const result = await runDemoFlow(config);
      res.status(result.ok ? 200 : 422).json(summarizeFlow(result));
    } catch (error) {
      next(error);
    }
  });

  app.use((req, res) => {
    sendApiError(req, res, 404, "NOT_FOUND", "Route not found");
  });

  app.use((_error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    sendApiError(req, res, 500, "INTERNAL_ERROR", "Unexpected server error");
  });

  return app;
}

const inFlightOperations = new Set<string>();

async function submitForm(
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

    if (config.mode === "live") {
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

    const scenario = buildScenarioFromForm(config, req.body);
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

    res.status(result.ok ? 200 : 422).json(result);
  } catch (error) {
    next(error);
  } finally {
    if (operationKey) {
      inFlightOperations.delete(operationKey);
    }
  }
}

function operationDocumentNumber(operation: FormOperation, scenario: DemoScenario): string {
  if (operation === "loading-order") {
    return scenario.cargoNumber;
  }

  if (operation === "remesa") {
    return scenario.remesaNumber;
  }

  if (operation === "manifest") {
    return scenario.manifestNumber;
  }

  if (operation === "fulfill-remesa") {
    return scenario.remesaNumber;
  }

  if (operation === "fulfill-manifest") {
    return scenario.manifestNumber;
  }

  return `${scenario.driver.id}-${scenario.vehicle.plate}`;
}

const requiredFormFields: Record<FormOperation, string[]> = {
  "loading-order": [
    "cargoNumber",
    "loadingAppointmentDate",
    "loadingAppointmentTime",
    "unloadingAppointmentDate",
    "unloadingAppointmentTime",
    "sender.idType",
    "sender.id",
    "sender.siteCode",
    "sender.cityCode",
    "recipient.idType",
    "recipient.id",
    "recipient.siteCode",
    "recipient.cityCode",
    "cargo.shortDescription",
    "cargo.merchandiseCode",
    "cargo.packageCode",
    "cargo.natureCode",
    "cargo.quantityKg"
  ],
  remesa: [
    "remesaNumber",
    "cargoNumber",
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
    "vehicle.soatExpirationDate",
    "vehicle.insurerNit"
  ],
  manifest: [
    "manifestNumber",
    "tripNumber",
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
    "money.advanceValue"
  ],
  "fulfill-remesa": [
    "remesaNumber",
    "manifestNumber",
    "compliance.remesaType",
    "compliance.loadedQuantityKg"
  ],
  "fulfill-manifest": [
    "manifestNumber",
    "compliance.manifestType",
    "compliance.documentsDeliveryDate"
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
    "vehicle.plate",
    "vehicle.rndcConfigurationCode",
    "vehicle.lineCode",
    "vehicle.modelYear",
    "vehicle.emptyWeightKg",
    "vehicle.capacityKg",
    "vehicle.colorCode",
    "vehicle.soatNumber",
    "vehicle.soatExpirationDate",
    "vehicle.insurerNit"
  ]
};

function collectMissingFormFields(operation: FormOperation, payload: unknown): string[] {
  const record = isRecord(payload) ? payload : {};
  const missing = requiredFormFields[operation].filter((path) => !hasFormValue(record, path));
  const compliance = child(record, "compliance");

  if (operation === "fulfill-remesa") {
    if (readString(compliance, "remesaType", "") === "C") {
      pushMissing(record, missing, [
        "compliance.deliveredQuantityKg",
        "compliance.unloadingArrivalDate",
        "compliance.unloadingArrivalTime",
        "compliance.unloadingEntryDate",
        "compliance.unloadingEntryTime",
        "compliance.unloadingExitDate",
        "compliance.unloadingExitTime"
      ]);
    }

    if (readString(compliance, "remesaType", "") === "S") {
      pushMissing(record, missing, ["compliance.remesaSuspensionReason"]);
    }
  }

  if (operation === "fulfill-manifest") {
    if (readString(compliance, "manifestType", "") === "S") {
      pushMissing(record, missing, ["compliance.manifestSuspensionReason", "compliance.suspensionConsequence"]);
    }

    if (readNumber(compliance, "additionalFreightValue", 0) > 0) {
      pushMissing(record, missing, ["compliance.additionalValueReason"]);
    }

    if (readNumber(compliance, "freightDiscountValue", 0) > 0) {
      pushMissing(record, missing, ["compliance.discountReason"]);
    }
  }

  return missing;
}

function pushMissing(record: Record<string, unknown>, missing: string[], paths: string[]): void {
  for (const path of paths) {
    if (!hasFormValue(record, path) && !missing.includes(path)) {
      missing.push(path);
    }
  }
}

function hasFormValue(record: Record<string, unknown>, path: string): boolean {
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

async function runFormOperation(
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

async function sendFormMessage(client: RndcClient, config: RndcConfig, request: RndcMessageRequest): Promise<RndcMessageResponse> {
  try {
    return await client.sendMessage(request);
  } catch (error) {
    return buildFailureResponse(config, request, error);
  }
}

async function buildOperationDocuments(operation: FormOperation, scenario: DemoScenario, steps: SavedFormStep[], config: RndcConfig): Promise<GeneratedDocument[]> {
  if (operation === "fulfill-remesa" || operation === "fulfill-manifest") {
    return [];
  }

  if (operation === "loading-order") {
    return [await generateLoadingOrderDocument(scenario, steps[0]?.radicado ?? "PENDIENTE", config.pdfDir)];
  }

  if (operation === "remesa") {
    return [await generateRemesaDocument(scenario, { remesaAuthorization: steps[0]?.radicado }, config.pdfDir, config.mode)];
  }

  if (operation === "manifest") {
    const manifest = steps.find((step) => step.name === "issue-manifest");
    return [await generateManifestDocument(scenario, {
      manifestAuthorization: manifest?.radicado,
      seguridadQr: manifest?.seguridadQr,
      observacionesQr: manifest?.observacionesQr
    }, config.pdfDir, config.mode)];
  }

  return [];
}

function buildScenarioFromForm(config: RndcConfig, payload: unknown): DemoScenario {
  const scenario = buildMtmReferenceScenario(config);
  const record = isRecord(payload) ? payload : {};

  scenario.seed = readString(record, "seed", scenario.seed);
  scenario.cargoNumber = readString(record, "cargoNumber", scenario.cargoNumber);
  scenario.tripNumber = readString(record, "tripNumber", scenario.tripNumber);
  scenario.remesaNumber = readString(record, "remesaNumber", scenario.remesaNumber);
  scenario.manifestNumber = readString(record, "manifestNumber", scenario.manifestNumber);
  scenario.expeditionDate = readDate(record, "expeditionDate", scenario.expeditionDate);
  scenario.loadingAppointmentDate = readDate(record, "loadingAppointmentDate", scenario.loadingAppointmentDate);
  scenario.loadingAppointmentTime = readString(record, "loadingAppointmentTime", scenario.loadingAppointmentTime);
  scenario.unloadingAppointmentDate = readDate(record, "unloadingAppointmentDate", scenario.unloadingAppointmentDate);
  scenario.unloadingAppointmentTime = readString(record, "unloadingAppointmentTime", scenario.unloadingAppointmentTime);
  scenario.balancePaymentDate = readDate(record, "balancePaymentDate", scenario.balancePaymentDate);
  scenario.loadingAppointment = appointment(scenario.loadingAppointmentDate, scenario.loadingAppointmentTime);
  scenario.unloadingAppointment = appointment(scenario.unloadingAppointmentDate, scenario.unloadingAppointmentTime);
  scenario.observations = readString(record, "observations", scenario.observations);

  applyPerson(scenario.driver, child(record, "driver"));
  applyPerson(scenario.vehicleOwner, child(record, "vehicleOwner"));
  applyPerson(scenario.vehicleHolder, child(record, "vehicleHolder"));
  applyParty(scenario.sender, child(record, "sender"));
  applyParty(scenario.recipient, child(record, "recipient"));
  applyVehicle(scenario.vehicle, child(record, "vehicle"));
  applyCargo(scenario.cargo, child(record, "cargo"));
  applyMoney(scenario.money, child(record, "money"));
  applyCompliance(scenario.compliance, child(record, "compliance"));
  applyManifestRemesas(scenario, record);

  return scenario;
}

function scenarioToForm(scenario: DemoScenario): Record<string, unknown> {
  return {
    seed: scenario.seed,
    cargoNumber: scenario.cargoNumber,
    tripNumber: scenario.tripNumber,
    remesaNumber: scenario.remesaNumber,
    manifestNumber: scenario.manifestNumber,
    expeditionDate: scenario.expeditionDate,
    loadingAppointmentDate: scenario.loadingAppointmentDate,
    loadingAppointmentTime: scenario.loadingAppointmentTime,
    unloadingAppointmentDate: scenario.unloadingAppointmentDate,
    unloadingAppointmentTime: scenario.unloadingAppointmentTime,
    balancePaymentDate: scenario.balancePaymentDate,
    observations: scenario.observations,
    driver: scenario.driver,
    vehicleOwner: scenario.vehicleOwner,
    vehicleHolder: scenario.vehicleHolder,
    sender: scenario.sender,
    recipient: scenario.recipient,
    vehicle: scenario.vehicle,
    cargo: scenario.cargo,
    money: scenario.money,
    compliance: scenario.compliance
  };
}

function applyPerson(target: PersonData, record: Record<string, unknown>): void {
  target.idType = readString(record, "idType", target.idType);
  target.id = readString(record, "id", target.id);
  target.firstName = readString(record, "firstName", target.firstName);
  target.firstLastName = readString(record, "firstLastName", target.firstLastName);
  target.secondLastName = readString(record, "secondLastName", target.secondLastName);
  target.fullName = readString(record, "fullName", target.fullName);
  target.phone = readString(record, "phone", target.phone);
  target.address = readString(record, "address", target.address);
  target.cityName = readString(record, "cityName", target.cityName);
  target.cityCode = readString(record, "cityCode", target.cityCode);
  target.licenseCategory = readOptionalString(record, "licenseCategory", target.licenseCategory);
  target.licenseNumber = readOptionalString(record, "licenseNumber", target.licenseNumber);
  target.licenseExpirationDate = readOptionalDate(record, "licenseExpirationDate", target.licenseExpirationDate);
}

function applyParty(target: CompanyParty, record: Record<string, unknown>): void {
  target.idType = readString(record, "idType", target.idType);
  target.id = readString(record, "id", target.id);
  target.siteCode = readString(record, "siteCode", target.siteCode);
  target.siteName = readString(record, "siteName", target.siteName);
  target.name = readString(record, "name", target.name);
  target.address = readString(record, "address", target.address);
  target.cityName = readString(record, "cityName", target.cityName);
  target.cityCode = readString(record, "cityCode", target.cityCode);
  target.latitude = readString(record, "latitude", target.latitude);
  target.longitude = readString(record, "longitude", target.longitude);
}

function applyVehicle(target: VehicleData, record: Record<string, unknown>): void {
  target.plate = readString(record, "plate", target.plate).toUpperCase();
  target.trailerPlate = readString(record, "trailerPlate", target.trailerPlate).toUpperCase();
  target.brand = readString(record, "brand", target.brand);
  target.configuration = readString(record, "configuration", target.configuration);
  target.rndcConfigurationCode = readString(record, "rndcConfigurationCode", target.rndcConfigurationCode);
  target.lineCode = readString(record, "lineCode", target.lineCode);
  target.colorCode = readString(record, "colorCode", target.colorCode);
  target.modelYear = readString(record, "modelYear", target.modelYear);
  target.emptyWeightKg = readNumber(record, "emptyWeightKg", target.emptyWeightKg);
  target.capacityKg = readNumber(record, "capacityKg", target.capacityKg);
  target.soatNumber = readString(record, "soatNumber", target.soatNumber);
  target.soatExpirationDate = readDate(record, "soatExpirationDate", target.soatExpirationDate);
  target.insurerNit = readString(record, "insurerNit", target.insurerNit);
}

function applyCargo(target: CargoData, record: Record<string, unknown>): void {
  target.productName = readString(record, "productName", target.productName);
  target.shortDescription = readString(record, "shortDescription", target.shortDescription);
  target.merchandiseCode = readString(record, "merchandiseCode", target.merchandiseCode);
  target.packageName = readString(record, "packageName", target.packageName);
  target.packageCode = readString(record, "packageCode", target.packageCode);
  target.nature = readString(record, "nature", target.nature);
  target.natureCode = readString(record, "natureCode", target.natureCode);
  target.quantityKg = readNumber(record, "quantityKg", target.quantityKg);
  target.declaredValue = readNumber(record, "declaredValue", target.declaredValue);
}

function applyMoney(target: MoneyData, record: Record<string, unknown>): void {
  target.freightValue = readNumber(record, "freightValue", target.freightValue);
  target.advanceValue = readNumber(record, "advanceValue", target.advanceValue);
  target.sourceRetention = readNumber(record, "sourceRetention", target.sourceRetention);
  target.icaRetention = readNumber(record, "icaRetention", target.icaRetention);
  target.icaRetentionPerMille = readNumber(record, "icaRetentionPerMille", target.icaRetentionPerMille);
  target.fopatRetention = readNumber(record, "fopatRetention", target.fopatRetention);
}

function applyCompliance(target: ComplianceData, record: Record<string, unknown>): void {
  target.remesaType = readString(record, "remesaType", target.remesaType);
  target.manifestType = readString(record, "manifestType", target.manifestType);
  target.remesaSuspensionReason = readOptionalString(record, "remesaSuspensionReason", target.remesaSuspensionReason);
  target.manifestSuspensionReason = readOptionalString(record, "manifestSuspensionReason", target.manifestSuspensionReason);
  target.suspensionConsequence = readOptionalString(record, "suspensionConsequence", target.suspensionConsequence);
  target.loadedQuantityKg = readNumber(record, "loadedQuantityKg", target.loadedQuantityKg);
  target.deliveredQuantityKg = readNumber(record, "deliveredQuantityKg", target.deliveredQuantityKg);
  target.unitCode = readNumber(record, "unitCode", target.unitCode);
  target.loadingArrivalDate = readDate(record, "loadingArrivalDate", target.loadingArrivalDate);
  target.loadingArrivalTime = readString(record, "loadingArrivalTime", target.loadingArrivalTime);
  target.loadingEntryDate = readDate(record, "loadingEntryDate", target.loadingEntryDate);
  target.loadingEntryTime = readString(record, "loadingEntryTime", target.loadingEntryTime);
  target.loadingExitDate = readDate(record, "loadingExitDate", target.loadingExitDate);
  target.loadingExitTime = readString(record, "loadingExitTime", target.loadingExitTime);
  target.unloadingArrivalDate = readDate(record, "unloadingArrivalDate", target.unloadingArrivalDate);
  target.unloadingArrivalTime = readString(record, "unloadingArrivalTime", target.unloadingArrivalTime);
  target.unloadingEntryDate = readDate(record, "unloadingEntryDate", target.unloadingEntryDate);
  target.unloadingEntryTime = readString(record, "unloadingEntryTime", target.unloadingEntryTime);
  target.unloadingExitDate = readDate(record, "unloadingExitDate", target.unloadingExitDate);
  target.unloadingExitTime = readString(record, "unloadingExitTime", target.unloadingExitTime);
  target.documentsDeliveryDate = readDate(record, "documentsDeliveryDate", target.documentsDeliveryDate);
  target.additionalLoadHoursValue = readNumber(record, "additionalLoadHoursValue", target.additionalLoadHoursValue);
  target.additionalUnloadHoursValue = readNumber(record, "additionalUnloadHoursValue", target.additionalUnloadHoursValue);
  target.additionalFreightValue = readNumber(record, "additionalFreightValue", target.additionalFreightValue);
  target.additionalValueReason = readOptionalString(record, "additionalValueReason", target.additionalValueReason);
  target.freightDiscountValue = readNumber(record, "freightDiscountValue", target.freightDiscountValue);
  target.discountReason = readOptionalString(record, "discountReason", target.discountReason);
  target.overAdvanceValue = readNumber(record, "overAdvanceValue", target.overAdvanceValue);
  target.observations = readString(record, "observations", target.observations);
}

function applyManifestRemesas(scenario: DemoScenario, record: Record<string, unknown>): void {
  const value = record.manifestRemesas;

  if (!Array.isArray(value)) {
    return;
  }

  const remesas = value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const number = readOptionalString(item, "number", undefined);
    if (!number) {
      return [];
    }

    return [{
      number,
      quantityKg: optionalNumberValue(item, "quantityKg"),
      nature: readOptionalString(item, "nature", undefined),
      productName: readOptionalString(item, "productName", undefined),
      packageName: readOptionalString(item, "packageName", undefined),
      senderName: readOptionalString(item, "senderName", undefined),
      recipientName: readOptionalString(item, "recipientName", undefined)
    }];
  });

  if (remesas.length > 0) {
    scenario.manifestRemesas = remesas;
  }
}

function optionalNumberValue(record: Record<string, unknown>, name: string): number | undefined {
  const value = record[name];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function summarizeFlow(result: RndcFlowResult) {
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

function summarizeStep(step: RndcFlowStep) {
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

function securityHeaders(_req: express.Request, res: express.Response, next: express.NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
}

function createRequestLoggingMiddleware(logger: RndcLogger | undefined): express.RequestHandler {
  return (req, res, next) => {
    if (logger) {
      const context = getRequestContext(req);
      const path = req.path;
      res.on("finish", () => {
        logger({
          level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
          event: "request.completed",
          timestamp: new Date().toISOString(),
          requestId: context.requestId,
          correlationId: context.correlationId,
          method: req.method,
          path,
          status: res.statusCode,
          durationMs: Date.now() - context.startedAt
        });
      });
    }

    next();
  };
}

function createDurableEvidenceMiddleware(settings: RndcRuntimeSettings): express.RequestHandler {
  return (req, res, next) => {
    const durableContext = readDurableEvidenceContext((name) => req.header(name));

    if (!durableContext.requested) {
      next();
      return;
    }

    const requestContext = getRequestContext(req);

    if ("error" in durableContext) {
      res.status(400).json({
        ok: false,
        error: {
          code: "INVALID_DURABLE_EVIDENCE_CONTEXT",
          message: durableContext.error
        },
        requestId: requestContext.requestId,
        correlationId: requestContext.correlationId
      });
      return;
    }

    if (!settings.convexUrl || !settings.convexIngestKey) {
      res.status(503).json({
        ok: false,
        error: {
          code: "DURABLE_STORAGE_NOT_CONFIGURED",
          message: "Durable evidence storage is not configured"
        },
        requestId: requestContext.requestId,
        correlationId: requestContext.correlationId
      });
      return;
    }

    next();
  };
}

function createLegacyCorsMiddleware(config: RndcConfig, settings: RndcRuntimeSettings): express.RequestHandler {
  const enabled = config.mode === "dry-run"
    && settings.nodeEnvironment !== "production"
    && settings.legacyApiKeyEnabled
    && settings.allowedOrigins.length > 0;

  return (req, res, next) => {
    const origin = req.headers.origin;

    if (!enabled || !origin || !settings.allowedOrigins.includes(origin)) {
      next();
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Api-Key, X-Request-Id, X-Correlation-Id");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Vary", "Origin");

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
}

function createServiceAuthenticationMiddleware(
  readConfig: () => RndcConfig,
  settings: RndcRuntimeSettings
): express.RequestHandler {
  return (req, res, next) => {
    if (authenticateServiceRequest(req, readConfig(), settings)) {
      next();
      return;
    }

    res.setHeader("WWW-Authenticate", "Bearer");
    sendApiError(req, res, 401, "SERVICE_AUTH_REQUIRED", "Service authentication required");
  };
}

function createOperationalReadinessMiddleware(
  readConfig: () => RndcConfig,
  settings: RndcRuntimeSettings
): express.RequestHandler {
  return (req, res, next) => {
    const report = assessRuntimeSafety(readConfig(), settings);

    if (report.ready) {
      next();
      return;
    }

    sendApiError(req, res, 503, "LIVE_MODE_NOT_READY", report.mode === "live"
      ? "Live RNDC operations are not ready"
      : "RNDC operations are not ready");
  };
}

function createLegacyMessageMiddleware(
  readConfig: () => RndcConfig,
  settings: RndcRuntimeSettings
): express.RequestHandler {
  return (req, res, next) => {
    if (isLegacyMessageAllowed(readConfig(), settings)) {
      next();
      return;
    }

    sendApiError(req, res, 404, "LEGACY_ENDPOINT_DISABLED", "Legacy endpoint is disabled");
  };
}

function createDryRunOnlyMiddleware(readConfig: () => RndcConfig): express.RequestHandler {
  return (req, res, next) => {
    if (readConfig().mode === "dry-run") {
      next();
      return;
    }

    sendApiError(req, res, 404, "LEGACY_ENDPOINT_DISABLED", "Legacy endpoint is disabled");
  };
}

function child(record: Record<string, unknown>, name: string): Record<string, unknown> {
  const value = record[name];
  return isRecord(value) ? value : {};
}

function readString(record: Record<string, unknown>, name: string, fallback: string): string {
  const value = record[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function readOptionalString(record: Record<string, unknown>, name: string, fallback: string | undefined): string | undefined {
  const value = record[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function readNumber(record: Record<string, unknown>, name: string, fallback: number): number {
  const value = record[name];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value.replaceAll(",", "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readDate(record: Record<string, unknown>, name: string, fallback: string): string {
  return normalizeDate(readString(record, name, fallback));
}

function readOptionalDate(record: Record<string, unknown>, name: string, fallback: string | undefined): string | undefined {
  const value = readOptionalString(record, name, fallback);
  return value ? normalizeDate(value) : value;
}

function normalizeDate(value: string): string {
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (iso) {
    return `${iso[3]}/${iso[2]}/${iso[1]}`;
  }

  return trimmed;
}

function appointment(date: string, time: string): string {
  const parts = date.split("/");

  if (parts.length !== 3) {
    return `${date} ${time}`;
  }

  return `${parts[2]}-${parts[1]}-${parts[0]} ${time}:00`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const currentFile = fileURLToPath(import.meta.url);

if (process.argv[1] === currentFile) {
  const port = Number(process.env.PORT ?? 3017);
  const config = loadConfig();
  const runtimeSettings = readRndcRuntimeSettings();
  const logger = createJsonLogger();
  assertRuntimeCanStart(config, runtimeSettings);
  createRndcApp(config, { logger }).listen(port, () => {
    logger({
      level: "info",
      event: "server.started",
      timestamp: new Date().toISOString(),
      port
    });
  });
}

export { assertRuntimeCanStart, assessRuntimeSafety, createJsonLogger, readRndcRuntimeSettings } from "./runtimeSecurity.js";
export type { RndcAppHooks, RndcAuthMode, RndcLogEntry, RndcLogger, RndcRequestContext, RndcRuntimeSettings, RuntimeSafetyIssue, RuntimeSafetyReport } from "./runtimeSecurity.js";

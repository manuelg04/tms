import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import express from "express";
import {
  buildAcceptanceQuery,
  buildFailureResponse,
  buildRemesaCorrectionMessage,
  buildRndcDocumentQuery,
  buildRndcXml,
  buildTargetedAnnulmentMessage,
  calculateFopat,
  classifyRndcError,
  maskSecrets,
  normalizeManifestAcceptances,
  normalizeRndcQueryRecords,
  RndcClient
} from "@tms/rndc-core";
import type {
  DemoScenario,
  FopatResult,
  RemesaCorrectionInput,
  RndcConfig,
  RndcMessageRequest,
  RndcMessageResponse,
  TargetedAnnulmentInput
} from "@tms/rndc-core";
import { getRequestContext } from "./runtimeSecurity.js";
import { readDurableEvidenceContext } from "./durableEvidence.js";
import type { DurableEvidenceReport, DurableEvidenceStore } from "./durableEvidence.js";

export type PhaseOneOperation = "remesa-correction" | "targeted-annulment" | "reconciliation" | "acceptance-query";

export type PhaseOneOperationResult = {
  ok: boolean;
  operation: PhaseOneOperation;
  mode: RndcConfig["mode"];
  startedAt: string;
  finishedAt: string;
  runDirectory: string;
  evidencePath: string;
  requestId: string;
  correlationId: string;
  request: {
    tipo: number;
    procesoId: number;
    path: string;
  };
  response: {
    accepted: boolean;
    status: number;
    path: string;
    radicado?: string;
    errorText?: string;
  };
  records?: Record<string, string>[] | ReturnType<typeof normalizeManifestAcceptances>;
  classification?: ReturnType<typeof classifyRndcError>;
  convexSync: {
    synced: false;
    reason: string;
  };
  durableEvidence?: DurableEvidenceReport;
};

export type FormFopatAssessment = {
  stage: "manifest" | "fulfill-manifest";
  basis: number;
  submittedAmount: number;
  result: FopatResult;
  warning?: string;
};

export type FormFopatDecision = {
  assessment: FormFopatAssessment;
  amountToUse: number;
  blocked: boolean;
};

type ReconciliationDocumentType = keyof typeof reconciliationPlans;

const reconciliationPlans = {
  cargo: {
    processId: 1,
    numberField: "CONSECUTIVOINFORMACIONCARGA",
    variables: ["INGRESOID", "FECHAING", "CONSECUTIVOINFORMACIONCARGA"]
  },
  trip: {
    processId: 2,
    numberField: "CONSECUTIVOINFORMACIONVIAJE",
    variables: ["INGRESOID", "FECHAING", "CONSECUTIVOINFORMACIONVIAJE"]
  },
  remesa: {
    processId: 3,
    numberField: "CONSECUTIVOREMESA",
    variables: ["INGRESOID", "FECHAING", "CONSECUTIVOREMESA"]
  },
  manifest: {
    processId: 4,
    numberField: "NUMMANIFIESTOCARGA",
    variables: ["INGRESOID", "FECHAING", "NUMMANIFIESTOCARGA"]
  },
  "remesa-fulfillment": {
    processId: 5,
    numberField: "CONSECUTIVOREMESA",
    variables: ["INGRESOID", "FECHAING", "CONSECUTIVOREMESA", "NUMMANIFIESTOCARGA"]
  },
  "manifest-fulfillment": {
    processId: 6,
    numberField: "NUMMANIFIESTOCARGA",
    variables: ["INGRESOID", "FECHAING", "NUMMANIFIESTOCARGA"]
  },
  "remesa-correction": {
    processId: 38,
    numberField: "CONSECUTIVOREMESA",
    variables: ["INGRESOID", "FECHAING", "CONSECUTIVOREMESA", "MOTIVOCAMBIO", "CODIGOCAMBIO"]
  }
} as const;

export function registerPhaseOneRoutes(
  app: express.Express,
  readConfig: () => RndcConfig,
  requireOperationalReadiness: express.RequestHandler,
  evidenceStore: DurableEvidenceStore
): void {
  app.post("/rndc/corrections/remesa", requireOperationalReadiness, async (req, res, next) => {
    try {
      const parsed = parseCorrection(req.body);

      if (!parsed.ok) {
        sendValidationError(req, res, parsed.fields);
        return;
      }

      const message = buildRemesaCorrectionMessage(parsed.value);
      const result = await executePhaseOneOperation(
        readConfig(),
        "remesa-correction",
        parsed.value.remesaNumber,
        message.request,
        req,
        evidenceStore
      );
      res.status(resultStatus(result)).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/rndc/annulments/targeted", requireOperationalReadiness, async (req, res, next) => {
    try {
      const config = readConfig();
      const parsed = parseTargetedAnnulment(req.body, config.companyRndcNit);

      if (!parsed.ok) {
        sendValidationError(req, res, parsed.fields);
        return;
      }

      const message = buildTargetedAnnulmentMessage(parsed.value);
      const result = await executePhaseOneOperation(
        config,
        "targeted-annulment",
        targetedIdentifier(parsed.value),
        message.request,
        req,
        evidenceStore
      );
      res.status(resultStatus(result)).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/rndc/reconciliation", requireOperationalReadiness, async (req, res, next) => {
    try {
      const config = readConfig();
      const parsed = parseReconciliation(req.body);

      if (!parsed.ok) {
        sendValidationError(req, res, parsed.fields);
        return;
      }

      const plan = reconciliationPlans[parsed.documentType];
      const request = buildRndcDocumentQuery({
        companyRndcNit: config.companyRndcNit,
        processId: plan.processId,
        variables: [...plan.variables],
        filters: { [plan.numberField]: parsed.documentNumber }
      });
      const result = await executePhaseOneOperation(
        config,
        "reconciliation",
        parsed.documentNumber,
        request,
        req,
        evidenceStore,
        normalizeRndcQueryRecords
      );
      res.status(resultStatus(result)).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/rndc/acceptances/query", requireOperationalReadiness, async (req, res, next) => {
    try {
      const config = readConfig();
      const parsed = parseAcceptanceQuery(req.body);

      if (!parsed.ok) {
        sendValidationError(req, res, parsed.fields);
        return;
      }

      const request = buildAcceptanceQuery({
        companyRndcNit: config.companyRndcNit,
        manifestRadicado: parsed.manifestRadicado,
        from: parsed.from,
        to: parsed.to
      });
      const result = await executePhaseOneOperation(
        config,
        "acceptance-query",
        parsed.manifestRadicado ?? `${parsed.from}-${parsed.to}`,
        request,
        req,
        evidenceStore,
        normalizeManifestAcceptances
      );
      res.status(resultStatus(result)).json(result);
    } catch (error) {
      next(error);
    }
  });
}

export function assessFormFopat(
  operation: string,
  payload: unknown,
  scenario: DemoScenario,
  mode: RndcConfig["mode"]
): FormFopatDecision | undefined {
  if (operation !== "manifest" && operation !== "fulfill-manifest") {
    return undefined;
  }

  const fopat = child(isRecord(payload) ? payload : {}, "fopat");
  const basis = operation === "manifest"
    ? scenario.money.freightValue
    : scenario.money.freightValue
      + scenario.compliance.additionalLoadHoursValue
      + scenario.compliance.additionalUnloadHoursValue
      + scenario.compliance.additionalFreightValue
      - scenario.compliance.freightDiscountValue;
  const result = calculateFopat({
    valueToPay: basis,
    operationType: optionalString(fopat, "operationType"),
    isOwnFleet: optionalBoolean(fopat, "isOwnFleet"),
    grossVehicleWeightKg: optionalNumber(fopat, "grossVehicleWeightKg"),
    vehicleConfigurationEligible: optionalBoolean(fopat, "vehicleConfigurationEligible")
  });
  const reviewRequired = result.status === "review-required";
  const warning = reviewRequired && mode === "dry-run"
    ? "FOPAT applicability is incomplete; dry-run used 0 and live submission would be blocked"
    : undefined;

  return {
    assessment: {
      stage: operation,
      basis,
      submittedAmount: scenario.money.fopatRetention,
      result,
      warning
    },
    amountToUse: result.status === "review-required" ? 0 : result.amount,
    blocked: reviewRequired && mode === "live"
  };
}

async function executePhaseOneOperation(
  config: RndcConfig,
  operation: PhaseOneOperation,
  identifier: string,
  request: RndcMessageRequest,
  httpRequest: express.Request,
  evidenceStore: DurableEvidenceStore,
  normalize?: (parsed: unknown) => PhaseOneOperationResult["records"]
): Promise<PhaseOneOperationResult> {
  const startedAt = new Date().toISOString();
  const context = getRequestContext(httpRequest);
  const durableContext = readDurableEvidenceContext((name) => httpRequest.header(name));
  const runDirectory = join(
    config.outputDir,
    `${startedAt.replaceAll(":", "-")}-${operation}-${safeFileName(identifier)}-${randomUUID().slice(0, 8)}`
  );
  const requestDirectory = join(runDirectory, "requests");
  const responseDirectory = join(runDirectory, "responses");
  const requestPath = join(requestDirectory, `${String(request.procesoId).padStart(2, "0")}-${operation}.xml`);
  const responsePath = join(responseDirectory, `${String(request.procesoId).padStart(2, "0")}-${operation}.xml`);
  const evidencePath = join(runDirectory, "result.json");

  await mkdir(requestDirectory, { recursive: true });
  await mkdir(responseDirectory, { recursive: true });

  const preparedRequestXml = maskSecrets(buildRndcXml(config, request));
  const response = await sendMessage(config, request);
  await writeFile(requestPath, `${maskSecrets(response.requestXml || preparedRequestXml)}\n`, "utf8");
  await writeFile(responsePath, `${response.rndcResponseXml}\n`, "utf8");

  const result: PhaseOneOperationResult = {
    ok: response.ok,
    operation,
    mode: config.mode,
    startedAt,
    finishedAt: new Date().toISOString(),
    runDirectory,
    evidencePath,
    requestId: context.requestId,
    correlationId: context.correlationId,
    request: {
      tipo: Number(request.tipo),
      procesoId: Number(request.procesoId),
      path: requestPath
    },
    response: {
      accepted: response.ok,
      status: response.status,
      path: responsePath,
      radicado: response.radicado,
      errorText: response.errorText
    },
    records: normalize ? normalize(response.parsed) : undefined,
    classification: response.errorText ? classifyRndcError(response.errorText) : undefined,
    convexSync: {
      synced: false,
      reason: durableContext.requested && "context" in durableContext
        ? "Durable gateway owns the Phase 1 operation lifecycle"
        : "Direct Phase 1 backend calls do not create Convex operation records"
    }
  };

  await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  if (durableContext.requested && "context" in durableContext) {
    result.durableEvidence = await evidenceStore(result, durableContext.context, {
      outputDir: config.outputDir,
      pdfDir: config.pdfDir
    });
  }

  return result;
}

async function sendMessage(config: RndcConfig, request: RndcMessageRequest): Promise<RndcMessageResponse> {
  try {
    return await new RndcClient(config).sendMessage(request);
  } catch (error) {
    return buildFailureResponse(config, request, error);
  }
}

function resultStatus(result: PhaseOneOperationResult): number {
  if (result.ok) {
    return 200;
  }

  return result.response.status === 0 ? 502 : 422;
}

function sendValidationError(req: express.Request, res: express.Response, fields: string[]): void {
  const context = getRequestContext(req);
  res.status(400).json({
    ok: false,
    error: {
      code: "VALIDATION_ERROR",
      message: "Request validation failed"
    },
    fields,
    requestId: context.requestId,
    correlationId: context.correlationId
  });
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; fields: string[] };

function parseCorrection(payload: unknown): ParseResult<RemesaCorrectionInput> {
  const body = isRecord(payload) ? payload : {};
  const change = child(body, "change");
  const remesaNumber = requiredString(body, "remesaNumber", 15);
  const reasonCode = integer(body.reasonCode, 1, 3);
  const code = integer(change.code, 1, 4);
  const fields: string[] = [];

  pushInvalid(fields, "remesaNumber", remesaNumber === undefined);
  pushInvalid(fields, "reasonCode", reasonCode === undefined);
  pushInvalid(fields, "change.code", code === undefined);

  if (!remesaNumber || !reasonCode || !code) {
    return { ok: false, fields };
  }

  if (code === 1 || code === 2) {
    const appointmentDate = requiredString(change, "appointmentDate", 10);
    const appointmentTime = requiredString(change, "appointmentTime", 5);
    pushInvalid(fields, "change.appointmentDate", !appointmentDate || !isDate(appointmentDate, "slash"));
    pushInvalid(fields, "change.appointmentTime", !appointmentTime || !isTime(appointmentTime));

    if (fields.length > 0 || !appointmentDate || !appointmentTime) {
      return { ok: false, fields };
    }

    return {
      ok: true,
      value: { remesaNumber, reasonCode: reasonCode as RemesaCorrectionInput["reasonCode"], change: { code, appointmentDate, appointmentTime } }
    };
  }

  const idType = requiredString(change, "idType", 1)?.toUpperCase();
  const id = requiredString(change, "id", 15);
  const siteCode = requiredString(change, "siteCode", 4);
  pushInvalid(fields, "change.idType", !idType || !["C", "N", "P", "E", "T", "U"].includes(idType));
  pushInvalid(fields, "change.id", !id);
  pushInvalid(fields, "change.siteCode", !siteCode);

  if (fields.length > 0 || !idType || !id || !siteCode) {
    return { ok: false, fields };
  }

  if (code === 3 || code === 4) {
    return {
      ok: true,
      value: {
        remesaNumber,
        reasonCode: reasonCode as RemesaCorrectionInput["reasonCode"],
        change: { code, idType, id, siteCode }
      }
    };
  }

  return { ok: false, fields: ["change.code"] };
}

function parseTargetedAnnulment(payload: unknown, companyRndcNit: string): ParseResult<TargetedAnnulmentInput> {
  const body = isRecord(payload) ? payload : {};
  const target = optionalString(body, "target");
  const reasonCode = optionalCode(body, "reasonCode");
  const reverseReasonCode = optionalCode(body, "reverseReasonCode");
  const observations = optionalString(body, "observations");
  const fields: string[] = [];
  const targets = ["manifest-compliance", "remesa-compliance", "manifest", "remesa", "trip-information", "cargo-information"];

  pushInvalid(fields, "target", !target || !targets.includes(target));
  pushInvalid(fields, "reasonCode", body.reasonCode !== undefined && !reasonCode);
  pushInvalid(fields, "reverseReasonCode", body.reverseReasonCode !== undefined && !reverseReasonCode);
  pushInvalid(fields, "observations", observations !== undefined && observations.length > 200);

  if (fields.length > 0 || !target) {
    return { ok: false, fields };
  }

  if (target === "manifest-compliance" || target === "manifest") {
    const manifestNumber = requiredString(body, "manifestNumber", 15);
    if (!manifestNumber) {
      return { ok: false, fields: ["manifestNumber"] };
    }

    return { ok: true, value: { target, companyRndcNit, manifestNumber, reasonCode, observations } };
  }

  if (target === "remesa-compliance") {
    const remesaNumber = requiredString(body, "remesaNumber", 15);
    if (!remesaNumber) {
      return { ok: false, fields: ["remesaNumber"] };
    }

    return { ok: true, value: { target, companyRndcNit, remesaNumber, reasonCode, observations } };
  }

  if (target === "remesa") {
    const remesaNumber = requiredString(body, "remesaNumber", 15);
    if (!remesaNumber) {
      return { ok: false, fields: ["remesaNumber"] };
    }

    return { ok: true, value: { target, companyRndcNit, remesaNumber, reasonCode, reverseReasonCode, observations } };
  }

  if (target === "trip-information") {
    const tripNumber = requiredString(body, "tripNumber", 15);
    if (!tripNumber) {
      return { ok: false, fields: ["tripNumber"] };
    }

    return { ok: true, value: { target, companyRndcNit, tripNumber, reasonCode } };
  }

  const cargoNumber = requiredString(body, "cargoNumber", 15);
  if (!cargoNumber) {
    return { ok: false, fields: ["cargoNumber"] };
  }

  return { ok: true, value: { target: "cargo-information", companyRndcNit, cargoNumber, reasonCode } };
}

function parseReconciliation(payload: unknown):
  | { ok: true; documentType: ReconciliationDocumentType; documentNumber: string }
  | { ok: false; fields: string[] } {
  const body = isRecord(payload) ? payload : {};
  const documentType = optionalString(body, "documentType");
  const documentNumber = requiredString(body, "documentNumber", 30);
  const fields: string[] = [];
  pushInvalid(fields, "documentType", !documentType || !(documentType in reconciliationPlans));
  pushInvalid(fields, "documentNumber", !documentNumber);

  if (fields.length > 0 || !documentType || !documentNumber) {
    return { ok: false, fields };
  }

  return { ok: true, documentType: documentType as ReconciliationDocumentType, documentNumber };
}

function parseAcceptanceQuery(payload: unknown):
  | { ok: true; manifestRadicado?: string; from?: string; to?: string }
  | { ok: false; fields: string[] } {
  const body = isRecord(payload) ? payload : {};
  const manifestRadicado = optionalString(body, "manifestRadicado");
  const from = optionalString(body, "from");
  const to = optionalString(body, "to");
  const fields: string[] = [];
  pushInvalid(fields, "manifestRadicado", manifestRadicado !== undefined && !/^\d{1,20}$/.test(manifestRadicado));
  pushInvalid(fields, "from", from !== undefined && !isDate(from, "year-first"));
  pushInvalid(fields, "to", to !== undefined && !isDate(to, "year-first"));
  pushInvalid(fields, "range", Boolean(from) !== Boolean(to));
  pushInvalid(fields, "manifestRadicado", !manifestRadicado && !from && !to);

  if (fields.length > 0) {
    return { ok: false, fields: [...new Set(fields)] };
  }

  return { ok: true, manifestRadicado, from, to };
}

function targetedIdentifier(input: TargetedAnnulmentInput): string {
  if (input.target === "manifest" || input.target === "manifest-compliance") {
    return input.manifestNumber;
  }

  if (input.target === "remesa" || input.target === "remesa-compliance") {
    return input.remesaNumber;
  }

  return input.target === "trip-information" ? input.tripNumber : input.cargoNumber;
}

function isDate(value: string, format: "slash" | "year-first"): boolean {
  const pattern = format === "slash" ? /^(\d{2})\/(\d{2})\/(\d{4})$/ : /^(\d{4})\/(\d{2})\/(\d{2})$/;
  const match = pattern.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(format === "slash" ? match[3] : match[1]);
  const month = Number(match[2]);
  const day = Number(format === "slash" ? match[1] : match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function isTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function optionalCode(record: Record<string, unknown>, name: string): string | undefined {
  const value = optionalString(record, name)?.toUpperCase();
  return value && /^[A-Z0-9]$/.test(value) ? value : undefined;
}

function requiredString(record: Record<string, unknown>, name: string, maxLength: number): string | undefined {
  const value = optionalString(record, name);
  return value && value.length <= maxLength ? value : undefined;
}

function optionalString(record: Record<string, unknown>, name: string): string | undefined {
  const value = record[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function optionalNumber(record: Record<string, unknown>, name: string): number | undefined {
  const value = record[name];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(record: Record<string, unknown>, name: string): boolean | undefined {
  return typeof record[name] === "boolean" ? record[name] : undefined;
}

function integer(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum ? value : undefined;
}

function child(record: Record<string, unknown>, name: string): Record<string, unknown> {
  return isRecord(record[name]) ? record[name] as Record<string, unknown> : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pushInvalid(fields: string[], name: string, invalid: boolean): void {
  if (invalid && !fields.includes(name)) {
    fields.push(name);
  }
}

function safeFileName(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "record";
}

import type { DocumentEvent } from "./documentLifecycle";

export type ReconciliationDocumentKind =
  | "cargo"
  | "trip"
  | "remesa"
  | "manifest"
  | "remesa-fulfillment"
  | "manifest-fulfillment"
  | "remesa-correction";

export type ReconciliationStatus = "accepted" | "rejected" | "pending" | "uncertain";

export type ReconciliationIdentity = {
  kind: ReconciliationDocumentKind;
  number: string;
  correctionCode?: string;
  correctionReason?: string;
};

export type ReconciliationOutcomeReason =
  | "matched"
  | "document_not_found"
  | "document_kind_mismatch"
  | "document_number_mismatch"
  | "correction_identity_mismatch"
  | "missing_radicado"
  | "reported_rejected"
  | "reported_pending"
  | "reported_uncertain";

export type ReconciliationOutcomeInput = {
  expected: ReconciliationIdentity;
  reportedStatus: ReconciliationStatus;
  returned?: ReconciliationIdentity;
  radicado?: string;
  errorText?: string;
};

export type ReconciliationOutcome = {
  status: ReconciliationStatus;
  identityMatched: boolean;
  reason: ReconciliationOutcomeReason;
  errorText?: string;
};

const identityFields: Partial<Record<number, { kind: ReconciliationDocumentKind; field: string }>> = {
  1: { kind: "cargo", field: "CONSECUTIVOINFORMACIONCARGA" },
  2: { kind: "trip", field: "CONSECUTIVOINFORMACIONVIAJE" },
  3: { kind: "remesa", field: "CONSECUTIVOREMESA" },
  4: { kind: "manifest", field: "NUMMANIFIESTOCARGA" },
  5: { kind: "remesa-fulfillment", field: "CONSECUTIVOREMESA" },
  6: { kind: "manifest-fulfillment", field: "NUMMANIFIESTOCARGA" },
  38: { kind: "remesa-correction", field: "CONSECUTIVOREMESA" }
};
const supportedKinds = new Set<ReconciliationDocumentKind>(
  Object.values(identityFields).flatMap((entry) => entry ? [entry.kind] : [])
);
const operationPlans: Record<string, {
  kind: ReconciliationDocumentKind;
  lifecycleStartedEvent: DocumentEvent;
  lifecycleEvent: DocumentEvent;
}> = {
  emit_cargo: { kind: "cargo", lifecycleStartedEvent: "submission_started", lifecycleEvent: "submission_succeeded" },
  emit_remesa: { kind: "remesa", lifecycleStartedEvent: "submission_started", lifecycleEvent: "submission_succeeded" },
  emit_manifest: { kind: "manifest", lifecycleStartedEvent: "submission_started", lifecycleEvent: "submission_succeeded" },
  fulfill_remesa: { kind: "remesa-fulfillment", lifecycleStartedEvent: "fulfillment_started", lifecycleEvent: "fulfillment_succeeded" },
  fulfill_manifest: { kind: "manifest-fulfillment", lifecycleStartedEvent: "fulfillment_started", lifecycleEvent: "fulfillment_succeeded" }
};

export function resolveReconciliationOutcome(input: ReconciliationOutcomeInput): ReconciliationOutcome {
  if (input.reportedStatus !== "accepted") {
    return outcome(
      input.reportedStatus,
      `reported_${input.reportedStatus}` as ReconciliationOutcomeReason,
      false,
      input.errorText
    );
  }

  if (!input.returned) {
    return outcome("pending", "document_not_found", false, input.errorText);
  }

  if (input.returned.kind !== input.expected.kind) {
    return outcome("uncertain", "document_kind_mismatch", false, input.errorText);
  }

  if (input.returned.number.trim() !== input.expected.number.trim()) {
    return outcome("uncertain", "document_number_mismatch", false, input.errorText);
  }

  if (
    input.expected.kind === "remesa-correction"
    && (
      input.expected.correctionCode?.trim() !== input.returned.correctionCode?.trim()
      || input.expected.correctionReason?.trim() !== input.returned.correctionReason?.trim()
    )
  ) {
    return outcome("uncertain", "correction_identity_mismatch", false, input.errorText);
  }

  if (!input.radicado?.trim()) {
    return outcome("uncertain", "missing_radicado", false, input.errorText);
  }

  return outcome("accepted", "matched", true);
}

export function readReconciliationIdentity(result: unknown): ReconciliationIdentity | undefined {
  if (!isRecord(result) || !isRecord(result.request) || !Array.isArray(result.records)) {
    return undefined;
  }

  const processId = result.request.procesoId;
  const plan = typeof processId === "number" ? identityFields[processId] : undefined;
  const record = result.records[0];
  const value = plan && isRecord(record) ? record[plan.field] : undefined;

  if (!plan || typeof value !== "string") {
    return undefined;
  }

  const number = value.trim();
  if (!number) {
    return undefined;
  }

  if (plan.kind === "remesa-correction") {
    const correctionCode = stringValue(record, "CODIGOCAMBIO");
    const correctionReason = stringValue(record, "MOTIVOCAMBIO");
    return correctionCode && correctionReason
      ? { kind: plan.kind, number, correctionCode, correctionReason }
      : undefined;
  }

  return { kind: plan.kind, number };
}

export function readExpectedReconciliationIdentity(payload: unknown): ReconciliationIdentity | undefined {
  if (!isRecord(payload) || typeof payload.documentType !== "string" || typeof payload.documentNumber !== "string") {
    return undefined;
  }

  const kind = payload.documentType as ReconciliationDocumentKind;
  const number = payload.documentNumber.trim();
  if (!supportedKinds.has(kind) || !number) {
    return undefined;
  }

  if (kind === "remesa-correction") {
    const correctionCode = stringValue(payload, "correctionCode");
    const correctionReason = stringValue(payload, "correctionReason");
    return correctionCode && correctionReason
      ? { kind, number, correctionCode, correctionReason }
      : undefined;
  }

  return { kind, number };
}

export function readReconciliationRadicado(result: unknown): string | undefined {
  if (!isRecord(result) || !Array.isArray(result.records) || !isRecord(result.records[0])) {
    return undefined;
  }

  const value = result.records[0].INGRESOID;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function reconciliationPlanForOperation(operationType: string): {
  kind: ReconciliationDocumentKind;
  lifecycleStartedEvent: DocumentEvent;
  lifecycleEvent: DocumentEvent;
} | undefined {
  return operationPlans[operationType];
}

export function preparePersistedReconciliationTarget(input: {
  operationType: string;
  operationStatus: string;
  operationOrganizationId: string;
  operationExpedienteId?: string;
  operationDocumentId?: string;
  documentId: string;
  documentOrganizationId?: string;
  documentExpedienteId?: string;
  documentKind: string;
  documentNumber?: string;
  operationPayload?: unknown;
}): {
  identity: ReconciliationIdentity;
  lifecycleStartedEvent: DocumentEvent;
  lifecycleEvent: DocumentEvent;
} | undefined {
  const plan = reconciliationPlanForOperation(input.operationType);
  const number = input.documentNumber?.trim();

  if (
    !plan
    || input.operationStatus !== "uncertain"
    || !number
    || input.operationDocumentId !== input.documentId
    || input.operationOrganizationId !== input.documentOrganizationId
    || input.operationExpedienteId !== input.documentExpedienteId
    || !documentKindMatches(input.documentKind, plan.kind)
  ) {
    return undefined;
  }

  const correctionIdentity = plan.kind === "remesa-correction"
    ? readCorrectionIdentity(input.operationPayload)
    : undefined;

  if (plan.kind === "remesa-correction" && !correctionIdentity) {
    return undefined;
  }

  return {
    identity: { kind: plan.kind, number, ...correctionIdentity },
    lifecycleStartedEvent: plan.lifecycleStartedEvent,
    lifecycleEvent: plan.lifecycleEvent
  };
}

function outcome(
  status: ReconciliationStatus,
  reason: ReconciliationOutcomeReason,
  identityMatched: boolean,
  errorText?: string
): ReconciliationOutcome {
  return errorText === undefined
    ? { status, identityMatched, reason }
    : { status, identityMatched, reason, errorText };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCorrectionIdentity(payload: unknown): Pick<ReconciliationIdentity, "correctionCode" | "correctionReason"> | undefined {
  if (!isRecord(payload) || !isRecord(payload.change)) {
    return undefined;
  }

  const correctionReason = scalarString(payload.reasonCode);
  const correctionCode = scalarString(payload.change.code);
  return correctionCode && correctionReason ? { correctionCode, correctionReason } : undefined;
}

function stringValue(record: Record<string, unknown>, field: string): string | undefined {
  return scalarString(record[field]);
}

function scalarString(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized || undefined;
}

function documentKindMatches(documentKind: string, reconciliationKind: ReconciliationDocumentKind): boolean {
  if (reconciliationKind === "cargo") {
    return documentKind === "orden_cargue";
  }

  if (reconciliationKind === "manifest" || reconciliationKind === "manifest-fulfillment") {
    return documentKind === "manifiesto";
  }

  return reconciliationKind === "remesa"
    || reconciliationKind === "remesa-fulfillment"
    || reconciliationKind === "remesa-correction"
    ? documentKind === "remesa"
    : false;
}

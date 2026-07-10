import type { DocumentEvent } from "./documentLifecycle";

type PersistedDocumentKind = "orden_cargue" | "remesa" | "manifiesto";

type OperationIdentityPlan = {
  documentKind: PersistedDocumentKind;
  field: string;
};

const operationIdentityPlans: Record<string, OperationIdentityPlan> = {
  emit_cargo: { documentKind: "orden_cargue", field: "cargoNumber" },
  emit_remesa: { documentKind: "remesa", field: "remesaNumber" },
  emit_manifest: { documentKind: "manifiesto", field: "manifestNumber" },
  fulfill_remesa: { documentKind: "remesa", field: "remesaNumber" },
  fulfill_manifest: { documentKind: "manifiesto", field: "manifestNumber" },
  correct_remesa: { documentKind: "remesa", field: "remesaNumber" },
  annul_cargo: { documentKind: "orden_cargue", field: "cargoNumber" },
  annul_remesa: { documentKind: "remesa", field: "remesaNumber" },
  annul_manifest: { documentKind: "manifiesto", field: "manifestNumber" },
  annul_remesa_fulfillment: { documentKind: "remesa", field: "remesaNumber" },
  annul_manifest_fulfillment: { documentKind: "manifiesto", field: "manifestNumber" }
};

const submissionLifecycle = {
  started: "submission_started",
  succeeded: "submission_succeeded",
  rejected: "attempt_rejected"
} as const;
const fulfillmentLifecycle = {
  started: "fulfillment_started",
  succeeded: "fulfillment_succeeded",
  rejected: "fulfillment_rejected"
} as const;
const correctionLifecycle = {
  started: "correction_started",
  succeeded: "correction_succeeded",
  rejected: "correction_rejected"
} as const;
const annulmentLifecycle = {
  started: "annulment_started",
  succeeded: "annulment_succeeded",
  rejected: "annulment_rejected"
} as const;
const fulfillmentAnnulmentLifecycle = {
  started: "fulfillment_annulment_started",
  succeeded: "fulfillment_annulment_succeeded",
  rejected: "fulfillment_annulment_rejected"
} as const;
const operationLifecyclePlans: Record<string, {
  started: DocumentEvent;
  succeeded: DocumentEvent;
  rejected: DocumentEvent;
}> = {
  emit_cargo: submissionLifecycle,
  emit_remesa: submissionLifecycle,
  emit_manifest: submissionLifecycle,
  fulfill_remesa: fulfillmentLifecycle,
  fulfill_manifest: fulfillmentLifecycle,
  correct_remesa: correctionLifecycle,
  annul_cargo: annulmentLifecycle,
  annul_remesa: annulmentLifecycle,
  annul_manifest: annulmentLifecycle,
  annul_remesa_fulfillment: fulfillmentAnnulmentLifecycle,
  annul_manifest_fulfillment: fulfillmentAnnulmentLifecycle
};

const dryRunOnlyOperations = new Set([
  "emit_cargo",
  "emit_trip",
  "emit_remesa",
  "emit_manifest",
  "fulfill_remesa",
  "fulfill_manifest",
  "correct_remesa",
  "annul_cargo",
  "annul_trip",
  "annul_remesa",
  "annul_manifest",
  "annul_remesa_fulfillment",
  "annul_manifest_fulfillment",
  "upsert_third_party",
  "upsert_vehicle"
]);

export function bindPayloadToPersistedDocument(input: {
  operationType: string;
  payload: Record<string, unknown>;
  documentKind: string;
  documentNumber?: string;
  documentIssuanceRadicado?: string;
  documentRndcRadicado?: string;
  documentOfficialState?: string;
  documentStatus?: string;
  documentFulfillmentState?: string;
}):
  | { ok: true; payload: Record<string, unknown>; documentNumber?: string }
  | { ok: false; error: string } {
  const documentNumber = input.documentNumber?.trim();

  if (input.operationType === "query_acceptance") {
    const radicado = readManifestIssuanceRadicado({
      documentKind: input.documentKind,
      issuanceRadicado: input.documentIssuanceRadicado,
      rndcRadicado: input.documentRndcRadicado,
      officialState: input.documentOfficialState,
      status: input.documentStatus,
      fulfillmentState: input.documentFulfillmentState
    });

    if (input.documentKind !== "manifiesto" || !documentNumber || !radicado) {
      return mismatch();
    }

    return {
      ok: true,
      payload: { manifestRadicado: radicado },
      documentNumber
    };
  }

  const plan = operationIdentityPlans[input.operationType];
  const payloadNumber = readOperationDocumentNumber(input.operationType, input.payload);

  if (!plan || input.documentKind !== plan.documentKind || !documentNumber || payloadNumber !== documentNumber) {
    return mismatch();
  }

  return { ok: true, payload: input.payload, documentNumber };
}

export function readOperationDocumentNumber(operationType: string, payload: unknown): string | undefined {
  const plan = operationIdentityPlans[operationType];

  if (!plan || !isRecord(payload)) {
    return undefined;
  }

  const value = payload[plan.field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function lifecyclePlanForOperation(operationType: string): {
  started: DocumentEvent;
  succeeded: DocumentEvent;
  rejected: DocumentEvent;
} | undefined {
  return operationLifecyclePlans[operationType];
}

export function requiresDryRunOperation(operationType: string): boolean {
  return dryRunOnlyOperations.has(operationType);
}

export function manifestIssuanceOperationMatches(input: {
  document: {
    id: string;
    organizationId?: string;
    expedienteId?: string;
    kind: string;
    number?: string;
    mode?: string;
  };
  operation: {
    organizationId: string;
    expedienteId?: string;
    documentId?: string;
    operationType: string;
    status: string;
    mode: string;
    payload: unknown;
  };
}): boolean {
  const documentNumber = input.document.number?.trim();
  const documentMode = input.document.mode ?? "dry-run";

  return input.document.kind === "manifiesto"
    && Boolean(documentNumber)
    && Boolean(input.document.organizationId)
    && Boolean(input.document.expedienteId)
    && input.operation.operationType === "emit_manifest"
    && input.operation.status === "succeeded"
    && input.operation.organizationId === input.document.organizationId
    && input.operation.expedienteId === input.document.expedienteId
    && input.operation.documentId === input.document.id
    && input.operation.mode === documentMode
    && readOperationDocumentNumber("emit_manifest", input.operation.payload) === documentNumber;
}

export function readManifestIssuanceRadicado(input: {
  documentKind: string;
  issuanceRadicado?: string;
  rndcRadicado?: string;
  officialState?: string;
  status?: string;
  fulfillmentState?: string;
}): string | undefined {
  if (input.documentKind !== "manifiesto") {
    return undefined;
  }

  const issuanceRadicado = input.issuanceRadicado?.trim();

  if (issuanceRadicado) {
    return issuanceRadicado;
  }

  return undefined;
}

function mismatch(): { ok: false; error: string } {
  return { ok: false, error: "Payload document identity does not match the persisted document" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import test from "node:test";
import assert from "node:assert/strict";

type DocumentKind =
  | "cargo"
  | "trip"
  | "remesa"
  | "manifest"
  | "remesa-fulfillment"
  | "manifest-fulfillment"
  | "remesa-correction";

type OutcomeInput = {
  expected: { kind: DocumentKind; number: string; correctionCode?: string; correctionReason?: string };
  reportedStatus: "accepted" | "rejected" | "pending" | "uncertain";
  returned?: { kind: DocumentKind; number: string; correctionCode?: string; correctionReason?: string };
  radicado?: string;
  errorText?: string;
};

type Outcome = {
  status: "accepted" | "rejected" | "pending" | "uncertain";
  identityMatched: boolean;
  reason: string;
  errorText?: string;
};

type ReconciliationModule = {
  resolveReconciliationOutcome?: (input: OutcomeInput) => Outcome;
  readReconciliationIdentity?: (result: unknown) => OutcomeInput["returned"];
  readExpectedReconciliationIdentity?: (payload: unknown) => OutcomeInput["returned"];
  readReconciliationRadicado?: (result: unknown) => string | undefined;
  reconciliationPlanForOperation?: (operationType: string) => {
    kind: DocumentKind;
    lifecycleStartedEvent: string;
    lifecycleEvent: string;
  } | undefined;
  preparePersistedReconciliationTarget?: (input: {
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
  }) => {
    identity: { kind: DocumentKind; number: string; correctionCode?: string; correctionReason?: string };
    lifecycleStartedEvent: string;
    lifecycleEvent: string;
  } | undefined;
};

const modulePath = "./reconciliationOutcome";
const reconciliationModule = (await import(modulePath).catch(() => ({}))) as ReconciliationModule;
const resolveReconciliationOutcome = reconciliationModule.resolveReconciliationOutcome
  ?? (() => ({ status: "missing", identityMatched: false, reason: "missing" }) as unknown as Outcome);
const readReconciliationIdentity = reconciliationModule.readReconciliationIdentity ?? (() => undefined);
const readExpectedReconciliationIdentity = reconciliationModule.readExpectedReconciliationIdentity ?? (() => undefined);
const readReconciliationRadicado = reconciliationModule.readReconciliationRadicado ?? (() => undefined);
const reconciliationPlanForOperation = reconciliationModule.reconciliationPlanForOperation ?? (() => undefined);
const preparePersistedReconciliationTarget = reconciliationModule.preparePersistedReconciliationTarget ?? (() => undefined);

test("accepts reconciliation only when the returned document identity matches", () => {
  const outcome = resolveReconciliationOutcome({
    expected: { kind: "manifest", number: "0041950" },
    reportedStatus: "accepted",
    returned: { kind: "manifest", number: " 0041950 " },
    radicado: "RNDC-41950"
  });

  assert.deepEqual(outcome, {
    status: "accepted",
    identityMatched: true,
    reason: "matched"
  });
});

test("keeps an identity match uncertain when RNDC did not return a radicado", () => {
  const outcome = resolveReconciliationOutcome({
    expected: { kind: "manifest", number: "0041950" },
    reportedStatus: "accepted",
    returned: { kind: "manifest", number: "0041950" }
  });

  assert.deepEqual(outcome, {
    status: "uncertain",
    identityMatched: false,
    reason: "missing_radicado"
  });
});

test("keeps an accepted response uncertain when the document kind differs", () => {
  const outcome = resolveReconciliationOutcome({
    expected: { kind: "manifest", number: "0041950" },
    reportedStatus: "accepted",
    returned: { kind: "remesa", number: "0041950" }
  });

  assert.deepEqual(outcome, {
    status: "uncertain",
    identityMatched: false,
    reason: "document_kind_mismatch"
  });
});

test("keeps an accepted response uncertain when the document number differs", () => {
  const outcome = resolveReconciliationOutcome({
    expected: { kind: "manifest", number: "0041950" },
    reportedStatus: "accepted",
    returned: { kind: "manifest", number: "41950" }
  });

  assert.deepEqual(outcome, {
    status: "uncertain",
    identityMatched: false,
    reason: "document_number_mismatch"
  });
});

test("keeps an accepted response pending when no document was returned", () => {
  const outcome = resolveReconciliationOutcome({
    expected: { kind: "remesa", number: "990001" },
    reportedStatus: "accepted"
  });

  assert.deepEqual(outcome, {
    status: "pending",
    identityMatched: false,
    reason: "document_not_found"
  });
});

test("preserves a rejected reconciliation outcome without inventing an identity", () => {
  const outcome = resolveReconciliationOutcome({
    expected: { kind: "cargo", number: "OC-100" },
    reportedStatus: "rejected",
    errorText: "RNDC rejected the query"
  });

  assert.deepEqual(outcome, {
    status: "rejected",
    identityMatched: false,
    reason: "reported_rejected",
    errorText: "RNDC rejected the query"
  });
});

test("preserves a pending reconciliation outcome", () => {
  const outcome = resolveReconciliationOutcome({
    expected: { kind: "trip", number: "V-200" },
    reportedStatus: "pending"
  });

  assert.deepEqual(outcome, {
    status: "pending",
    identityMatched: false,
    reason: "reported_pending"
  });
});

test("preserves an uncertain reconciliation outcome", () => {
  const outcome = resolveReconciliationOutcome({
    expected: { kind: "manifest-fulfillment", number: "M-300" },
    reportedStatus: "uncertain"
  });

  assert.deepEqual(outcome, {
    status: "uncertain",
    identityMatched: false,
    reason: "reported_uncertain"
  });
});

test("reads the returned manifest identity from the reconciled process and record", () => {
  const result = {
    request: { procesoId: 4 },
    records: [{ NUMMANIFIESTOCARGA: "0041950", INGRESOID: "RNDC-41950" }]
  };

  assert.deepEqual(readReconciliationIdentity(result), {
    kind: "manifest",
    number: "0041950"
  });
  assert.equal(readReconciliationRadicado(result), "RNDC-41950");
});

test("reads correction identity from process 38", () => {
  assert.deepEqual(readReconciliationIdentity({
    request: { procesoId: 38 },
    records: [{
      CONSECUTIVOREMESA: "990001",
      CODIGOCAMBIO: "2",
      MOTIVOCAMBIO: "1",
      INGRESOID: "RNDC-38"
    }]
  }), {
    kind: "remesa-correction",
    number: "990001",
    correctionCode: "2",
    correctionReason: "1"
  });
});

test("does not confirm a different correction for the same remesa", () => {
  assert.deepEqual(resolveReconciliationOutcome({
    expected: {
      kind: "remesa-correction",
      number: "990001",
      correctionCode: "2",
      correctionReason: "1"
    },
    reportedStatus: "accepted",
    returned: {
      kind: "remesa-correction",
      number: "990001",
      correctionCode: "3",
      correctionReason: "2"
    },
    radicado: "RNDC-38"
  }), {
    status: "uncertain",
    identityMatched: false,
    reason: "correction_identity_mismatch"
  });
});

test("does not invent a returned identity when the response has no matching record", () => {
  assert.equal(readReconciliationIdentity({ request: { procesoId: 3 }, records: [] }), undefined);
  assert.equal(readReconciliationIdentity({
    request: { procesoId: 3 },
    records: [{ NUMMANIFIESTOCARGA: "0041950" }]
  }), undefined);
});

test("reads only supported expected identities from the submitted reconciliation payload", () => {
  assert.deepEqual(readExpectedReconciliationIdentity({
    documentType: "remesa",
    documentNumber: "990001"
  }), {
    kind: "remesa",
    number: "990001"
  });
  assert.deepEqual(readExpectedReconciliationIdentity({
    documentType: "remesa-correction",
    documentNumber: "990001",
    correctionCode: "2",
    correctionReason: "1"
  }), {
    kind: "remesa-correction",
    number: "990001",
    correctionCode: "2",
    correctionReason: "1"
  });
  assert.equal(readExpectedReconciliationIdentity({
    documentType: "remesa-correction",
    documentNumber: "990001"
  }), undefined);
  assert.equal(readExpectedReconciliationIdentity({
    documentType: "unknown",
    documentNumber: "990001"
  }), undefined);
});

test("maps only reconcilable operation families to their document identity and success event", () => {
  assert.deepEqual(reconciliationPlanForOperation("emit_manifest"), {
    kind: "manifest",
    lifecycleStartedEvent: "submission_started",
    lifecycleEvent: "submission_succeeded"
  });
  assert.deepEqual(reconciliationPlanForOperation("fulfill_manifest"), {
    kind: "manifest-fulfillment",
    lifecycleStartedEvent: "fulfillment_started",
    lifecycleEvent: "fulfillment_succeeded"
  });
  assert.deepEqual(reconciliationPlanForOperation("emit_remesa"), {
    kind: "remesa",
    lifecycleStartedEvent: "submission_started",
    lifecycleEvent: "submission_succeeded"
  });
  assert.equal(reconciliationPlanForOperation("correct_remesa"), undefined);
  assert.equal(reconciliationPlanForOperation("emit_trip"), undefined);
  assert.equal(reconciliationPlanForOperation("annul_manifest"), undefined);
  assert.equal(reconciliationPlanForOperation("reconcile"), undefined);
});

test("prepares reconciliation only from an exact persisted uncertain operation and document", () => {
  const target = preparePersistedReconciliationTarget({
    operationType: "fulfill_manifest",
    operationStatus: "uncertain",
    operationOrganizationId: "org-1",
    operationExpedienteId: "exp-1",
    operationDocumentId: "doc-1",
    documentId: "doc-1",
    documentOrganizationId: "org-1",
    documentExpedienteId: "exp-1",
    documentKind: "manifiesto",
    documentNumber: "0041950"
  });

  assert.deepEqual(target, {
    identity: { kind: "manifest-fulfillment", number: "0041950" },
    lifecycleStartedEvent: "fulfillment_started",
    lifecycleEvent: "fulfillment_succeeded"
  });
  assert.equal(preparePersistedReconciliationTarget({
    operationType: "emit_manifest",
    operationStatus: "uncertain",
    operationOrganizationId: "org-1",
    operationExpedienteId: "exp-1",
    operationDocumentId: "doc-2",
    documentId: "doc-1",
    documentOrganizationId: "org-1",
    documentExpedienteId: "exp-1",
    documentKind: "manifiesto",
    documentNumber: "0041950"
  }), undefined);
  assert.equal(preparePersistedReconciliationTarget({
    operationType: "emit_manifest",
    operationStatus: "succeeded",
    operationOrganizationId: "org-1",
    operationExpedienteId: "exp-1",
    operationDocumentId: "doc-1",
    documentId: "doc-1",
    documentOrganizationId: "org-1",
    documentExpedienteId: "exp-1",
    documentKind: "manifiesto",
    documentNumber: "0041950"
  }), undefined);
});

test("keeps correction reconciliation manual when RNDC omits the changed values", () => {
  assert.equal(preparePersistedReconciliationTarget({
    operationType: "correct_remesa",
    operationStatus: "uncertain",
    operationOrganizationId: "org-1",
    operationExpedienteId: "exp-1",
    operationDocumentId: "doc-1",
    documentId: "doc-1",
    documentOrganizationId: "org-1",
    documentExpedienteId: "exp-1",
    documentKind: "remesa",
    documentNumber: "990001",
    operationPayload: {
      remesaNumber: "990001",
      reasonCode: "1",
      change: { code: "2" }
    }
  }), undefined);
});

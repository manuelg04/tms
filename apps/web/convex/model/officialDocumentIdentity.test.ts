import assert from "node:assert/strict";
import test from "node:test";

type BindInput = {
  operationType: string;
  payload: Record<string, unknown>;
  documentKind: string;
  documentNumber?: string;
  documentIssuanceRadicado?: string;
};

type BindResult =
  | { ok: true; payload: Record<string, unknown>; documentNumber?: string }
  | { ok: false; error: string };

type IdentityModule = {
  bindPayloadToPersistedDocument?: (input: BindInput) => BindResult;
  readOperationDocumentNumber?: (operationType: string, payload: unknown) => string | undefined;
  lifecyclePlanForOperation?: (operationType: string) => {
    started: string;
    succeeded: string;
    rejected: string;
  } | undefined;
  requiresDryRunOperation?: (operationType: string) => boolean;
  manifestIssuanceOperationMatches?: (input: {
    document: { id: string; organizationId?: string; expedienteId?: string; kind: string; number?: string; mode?: string };
    operation: { organizationId: string; expedienteId?: string; documentId?: string; operationType: string; status: string; mode: string; payload: unknown };
  }) => boolean;
  readManifestIssuanceRadicado?: (input: {
    documentKind: string;
    issuanceRadicado?: string;
    rndcRadicado?: string;
    officialState?: string;
    fulfillmentState?: string;
  }) => string | undefined;
};

const modulePath = "./officialDocumentIdentity";
const identityModule = (await import(modulePath).catch(() => ({}))) as IdentityModule;
const bindPayloadToPersistedDocument = identityModule.bindPayloadToPersistedDocument
  ?? (() => ({ ok: false, error: "missing" }));
const readOperationDocumentNumber = identityModule.readOperationDocumentNumber ?? (() => undefined);
const lifecyclePlanForOperation = identityModule.lifecyclePlanForOperation ?? (() => undefined);
const requiresDryRunOperation = identityModule.requiresDryRunOperation ?? (() => false);
const manifestIssuanceOperationMatches = identityModule.manifestIssuanceOperationMatches ?? (() => false);
const readManifestIssuanceRadicado = identityModule.readManifestIssuanceRadicado ?? (() => undefined);

test("accepts an emission payload only when its number matches the persisted document", () => {
  const result = bindPayloadToPersistedDocument({
    operationType: "emit_manifest",
    payload: { manifestNumber: "0041950", seed: "EXP-1" },
    documentKind: "manifiesto",
    documentNumber: "0041950"
  });

  assert.deepEqual(result, {
    ok: true,
    payload: { manifestNumber: "0041950", seed: "EXP-1" },
    documentNumber: "0041950"
  });
});

test("rejects a payload for a different document number or kind", () => {
  assert.deepEqual(bindPayloadToPersistedDocument({
    operationType: "emit_manifest",
    payload: { manifestNumber: "0041951" },
    documentKind: "manifiesto",
    documentNumber: "0041950"
  }), {
    ok: false,
    error: "Payload document identity does not match the persisted document"
  });
  assert.deepEqual(bindPayloadToPersistedDocument({
    operationType: "fulfill_manifest",
    payload: { manifestNumber: "0041950" },
    documentKind: "remesa",
    documentNumber: "0041950"
  }), {
    ok: false,
    error: "Payload document identity does not match the persisted document"
  });
});

test("builds acceptance queries from the persisted manifest radicado", () => {
  assert.deepEqual(bindPayloadToPersistedDocument({
    operationType: "query_acceptance",
    payload: { from: "2026-07-01", to: "2026-07-10" },
    documentKind: "manifiesto",
    documentNumber: "0041950",
    documentIssuanceRadicado: "48043700"
  }), {
    ok: true,
    payload: { manifestRadicado: "48043700" },
    documentNumber: "0041950"
  });
});

test("reads the original operation number for atomic reconciliation validation", () => {
  assert.equal(readOperationDocumentNumber("emit_remesa", { remesaNumber: "990001" }), "990001");
  assert.equal(readOperationDocumentNumber("fulfill_manifest", { manifestNumber: "0041950" }), "0041950");
  assert.equal(readOperationDocumentNumber("annul_manifest", { manifestNumber: "0041950" }), "0041950");
  assert.equal(readOperationDocumentNumber("emit_manifest", { manifestNumber: "0041951" }), "0041951");
  assert.equal(readOperationDocumentNumber("reconcile", { documentNumber: "0041950" }), undefined);
});

test("maps persisted document operations to server-owned lifecycle events", () => {
  assert.deepEqual(lifecyclePlanForOperation("emit_manifest"), {
    started: "submission_started",
    succeeded: "submission_succeeded",
    rejected: "attempt_rejected"
  });
  assert.deepEqual(lifecyclePlanForOperation("fulfill_manifest"), {
    started: "fulfillment_started",
    succeeded: "fulfillment_succeeded",
    rejected: "fulfillment_rejected"
  });
  assert.deepEqual(lifecyclePlanForOperation("correct_remesa"), {
    started: "correction_started",
    succeeded: "correction_succeeded",
    rejected: "correction_rejected"
  });
  assert.deepEqual(lifecyclePlanForOperation("annul_manifest_fulfillment"), {
    started: "fulfillment_annulment_started",
    succeeded: "fulfillment_annulment_succeeded",
    rejected: "fulfillment_annulment_rejected"
  });
  assert.equal(lifecyclePlanForOperation("reconcile"), undefined);
  assert.equal(lifecyclePlanForOperation("query_acceptance"), undefined);
});

test("keeps official write actions in dry-run until canonical persistence is complete", () => {
  assert.equal(requiresDryRunOperation("emit_manifest"), true);
  assert.equal(requiresDryRunOperation("annul_manifest"), true);
  assert.equal(requiresDryRunOperation("annul_manifest_fulfillment"), true);
  assert.equal(requiresDryRunOperation("emit_remesa"), true);
  assert.equal(requiresDryRunOperation("fulfill_manifest"), true);
  assert.equal(requiresDryRunOperation("upsert_vehicle"), true);
  assert.equal(requiresDryRunOperation("reconcile"), false);
  assert.equal(requiresDryRunOperation("query_acceptance"), false);
});

test("requires a dedicated manifest issuance radicado", () => {
  assert.equal(readManifestIssuanceRadicado({
    documentKind: "manifiesto",
    issuanceRadicado: "ISS-1",
    rndcRadicado: "LATEST-2",
    officialState: "fulfilled",
    fulfillmentState: "fulfilled"
  }), "ISS-1");
  assert.equal(readManifestIssuanceRadicado({
    documentKind: "manifiesto",
    rndcRadicado: "LEGACY-1",
    officialState: "authorized",
    fulfillmentState: "not_requested"
  }), undefined);
  assert.equal(readManifestIssuanceRadicado({
    documentKind: "manifiesto",
    rndcRadicado: "FULFILLMENT-2",
    officialState: "fulfilled",
    fulfillmentState: "fulfilled"
  }), undefined);
});

test("backfills manifest issuance only from an exact durable emission identity", () => {
  const document = {
    id: "doc-1",
    organizationId: "org-1",
    expedienteId: "exp-1",
    kind: "manifiesto",
    number: "0041950",
    mode: "dry-run"
  };
  const operation = {
    organizationId: "org-1",
    expedienteId: "exp-1",
    documentId: "doc-1",
    operationType: "emit_manifest",
    status: "succeeded",
    mode: "dry-run",
    payload: { manifestNumber: "0041950" }
  };

  assert.equal(manifestIssuanceOperationMatches({ document, operation }), true);
  assert.equal(manifestIssuanceOperationMatches({ document, operation: { ...operation, organizationId: "org-2" } }), false);
  assert.equal(manifestIssuanceOperationMatches({ document, operation: { ...operation, expedienteId: "exp-2" } }), false);
  assert.equal(manifestIssuanceOperationMatches({ document, operation: { ...operation, documentId: "doc-2" } }), false);
  assert.equal(manifestIssuanceOperationMatches({ document, operation: { ...operation, mode: "live" } }), false);
  assert.equal(manifestIssuanceOperationMatches({ document, operation: { ...operation, payload: { manifestNumber: "0041951" } } }), false);
  assert.equal(manifestIssuanceOperationMatches({ document, operation: { ...operation, operationType: "fulfill_manifest" } }), false);
});

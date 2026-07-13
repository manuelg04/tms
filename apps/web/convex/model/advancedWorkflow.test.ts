import assert from "node:assert/strict";
import test from "node:test";

type AdvancedModule = {
  advancedCapabilities?: (role: string) => string[];
  validateExceptionRequest?: (input: Record<string, unknown>) => { ok: boolean; errors: string[] };
  buildCorrectionComparison?: (before: Record<string, unknown>, after: Record<string, unknown>) => Array<{ field: string; before: unknown; after: unknown }>;
  buildAnnulmentPlan?: (input: Record<string, unknown>) => { ok: boolean; steps: string[]; blockers: string[] };
  documentIdsForRemesas?: (remesas: Array<{ documentId?: string }>) => string[];
  buildTransshipmentPlan?: (input: Record<string, unknown>) => { ok: boolean; blockers: string[]; sourceManifestNumber?: string; beforeAssignment?: unknown; afterAssignment?: unknown };
  validateEmptyManifest?: (input: Record<string, unknown>) => { ok: boolean; errors: string[]; payload: Record<string, unknown> };
  validateRemesaWithoutOrder?: (input: Record<string, unknown>) => { ok: boolean; errors: string[] };
  resolveManualReconciliation?: (input: Record<string, unknown>) => { status: string; identityMatched: boolean };
};

const modulePath = "./advancedWorkflow";
const advanced = await import(modulePath).catch(() => ({})) as AdvancedModule;
const missing = () => { throw new Error("advanced workflow is not implemented"); };
const advancedCapabilities = advanced.advancedCapabilities ?? missing;
const validateExceptionRequest = advanced.validateExceptionRequest ?? missing;
const buildCorrectionComparison = advanced.buildCorrectionComparison ?? missing;
const buildAnnulmentPlan = advanced.buildAnnulmentPlan ?? missing;
const documentIdsForRemesas = advanced.documentIdsForRemesas ?? missing;
const buildTransshipmentPlan = advanced.buildTransshipmentPlan ?? missing;
const validateEmptyManifest = advanced.validateEmptyManifest ?? missing;
const validateRemesaWithoutOrder = advanced.validateRemesaWithoutOrder ?? missing;
const resolveManualReconciliation = advanced.resolveManualReconciliation ?? missing;

test("only administration can execute advanced exceptions", () => {
  assert.deepEqual(advancedCapabilities("operator"), []);
  assert.deepEqual(advancedCapabilities("auditor"), []);
  assert.deepEqual(advancedCapabilities("admin"), [
    "remesa_without_order",
    "empty_manifest",
    "transshipment",
    "correction",
    "annulment",
    "reconciliation"
  ]);
});

test("every advanced request requires reason observation and explicit confirmation", () => {
  const result = validateExceptionRequest({ type: "correction", reason: "", observation: "", confirmed: false });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ["Motivo requerido", "Observación requerida", "Confirmación explícita requerida"]);
});

test("a correction produces a stable before and after comparison", () => {
  const comparison = buildCorrectionComparison(
    { appointmentDate: "10/07/2026", appointmentTime: "08:00", recipient: "Cliente A" },
    { appointmentDate: "11/07/2026", appointmentTime: "09:30", recipient: "Cliente A" }
  );

  assert.deepEqual(comparison, [
    { field: "appointmentDate", before: "10/07/2026", after: "11/07/2026" },
    { field: "appointmentTime", before: "08:00", after: "09:30" }
  ]);
});

test("annulment reverses fulfillment before a fulfilled manifest", () => {
  const result = buildAnnulmentPlan({
    target: { kind: "manifiesto", officialState: "fulfilled", fulfillmentState: "fulfilled" },
    documents: []
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.steps, ["annul_manifest_fulfillment", "annul_manifest"]);
});

test("a remesa cannot be annulled while an active manifest depends on it", () => {
  const result = buildAnnulmentPlan({
    target: { id: "rem-1", kind: "remesa", officialState: "authorized", fulfillmentState: "not_requested" },
    documents: [{ id: "man-1", kind: "manifiesto", officialState: "authorized", remesaIds: ["rem-1"] }]
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers, ["Anula o libera primero el manifiesto man-1"]);
});

test("document dependencies use official remesa document identifiers", () => {
  assert.deepEqual(documentIdsForRemesas([
    { documentId: "document-rem-1" },
    {},
    { documentId: "document-rem-2" }
  ]), ["document-rem-1", "document-rem-2"]);
});

test("whole-set annulment follows reverse documentary dependency order", () => {
  const result = buildAnnulmentPlan({
    wholeSet: true,
    documents: [
      { id: "order-1", kind: "orden_cargue", officialState: "authorized" },
      { id: "rem-1", kind: "remesa", officialState: "fulfilled", fulfillmentState: "fulfilled" },
      { id: "man-1", kind: "manifiesto", officialState: "fulfilled", fulfillmentState: "fulfilled", remesaIds: ["rem-1"] }
    ]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.steps, [
    "annul_manifest_fulfillment:man-1",
    "annul_remesa_fulfillment:rem-1",
    "annul_manifest:man-1",
    "annul_remesa:rem-1",
    "annul_trip",
    "annul_cargo:order-1"
  ]);
});

test("transshipment links an eligible previous manifest and preserves both assignments", () => {
  const before = { vehicleId: "veh-1", driverId: "drv-1", plate: "ABC123" };
  const after = { vehicleId: "veh-2", driverId: "drv-2", plate: "XYZ789" };
  const result = buildTransshipmentPlan({
    sourceManifest: { number: "880001", officialState: "annulled", fulfillmentState: "not_requested" },
    beforeAssignment: before,
    afterAssignment: after,
    releasedRemesaIds: ["rem-1"],
    reasonCode: "V",
    municipalityCode: "11001000"
  });

  assert.equal(result.ok, true);
  assert.equal(result.sourceManifestNumber, "880001");
  assert.deepEqual(result.beforeAssignment, before);
  assert.deepEqual(result.afterAssignment, after);
});

test("empty manifest is limited to Viaje Vacío and strips tracking fields", () => {
  const result = validateEmptyManifest({
    manifestType: "W",
    remesaIds: [],
    payload: { manifestType: "W", gpsOperator: "hidden", trackingRequired: true, observations: "Retorno vacío" }
  });

  assert.equal(result.ok, true);
  assert.equal("gpsOperator" in result.payload, false);
  assert.equal("trackingRequired" in result.payload, false);
  assert.equal("remesaIds" in result.payload, false);
});

test("remesa without loading order must carry all of its own operational data", () => {
  const result = validateRemesaWithoutOrder({
    consignmentClass: "terrestre_carga",
    sender: { name: "Remitente", identificationNumber: "9001" },
    recipient: { name: "Destinatario", identificationNumber: "9002" },
    loading: { address: "Origen", cityName: "Bogotá", appointmentAt: 1 },
    unloading: { address: "Destino", cityName: "Medellín", appointmentAt: 2 },
    declaredValue: "1000000",
    remissions: [{ quantity: "1", description: "Carga", weightTons: "10" }]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("manual reconciliation never confirms a different document", () => {
  const result = resolveManualReconciliation({
    expected: { kind: "manifiesto", number: "880001" },
    returned: { kind: "manifiesto", number: "880002" },
    reportedStatus: "authorized"
  });

  assert.deepEqual(result, { status: "mismatch", identityMatched: false });
});

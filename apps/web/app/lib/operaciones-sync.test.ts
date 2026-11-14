import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../convex/_generated/dataModel";
import { OperacionesUnavailableError, operacionesSettings, type OperacionesDeliveryPayload } from "./operaciones-client";
import { syncOperacionesDeliveries, type DeliveryPlan, type SyncRuntime } from "./operaciones-sync";

const expedienteId = "exp1" as Id<"expedientes">;
const artifactId = "art1" as Id<"evidenceArtifacts">;

function plan(items: DeliveryPlan["items"]): DeliveryPlan {
  return { code: "DSP-000200", operacionesExpedienteId: "ops1", items };
}

function runtime(overrides: Partial<SyncRuntime> & { plan: DeliveryPlan | null }) {
  const sent: OperacionesDeliveryPayload[] = [];
  const recorded: Array<{ deliveryKey: string; status: string; message: string }> = [];
  const value: SyncRuntime = {
    configured: () => true,
    loadPlan: async () => overrides.plan,
    loadPdf: async () => new TextEncoder().encode("%PDF-1.4"),
    loadRoutePlanPdf: async () => new TextEncoder().encode("%PDF-plan"),
    send: async (payload) => {
      sent.push(payload);
      return { ok: true, outcome: "applied", message: "Orden de cargue agregada al expediente" };
    },
    record: async (input) => {
      recorded.push({ deliveryKey: input.deliveryKey, status: input.status, message: input.message });
    },
    ...overrides
  };
  return { value, sent, recorded };
}

const order = { kind: "loading_order" as const, deliveryKey: "DSP-000200:orden:1", label: "Orden de cargue", number: "1", fileName: "orden-cargue-1.pdf", artifactId, settled: false };

test("a dispatch that did not come from Operaciones sends nothing", async () => {
  const fake = runtime({ plan: null });
  assert.deepEqual(await syncOperacionesDeliveries(expedienteId, "Operador", fake.value), { linked: false });
  assert.equal(fake.sent.length, 0);
});

test("sends the PDF with the Operaciones expediente and records the result", async () => {
  const fake = runtime({ plan: plan([order]) });
  const result = await syncOperacionesDeliveries(expedienteId, "Operador Demo", fake.value);
  assert.equal(result.linked && result.items[0].status, "applied");
  assert.deepEqual(fake.sent[0], {
    expedienteId: "ops1",
    kind: "loading_order",
    deliveryKey: "DSP-000200:orden:1",
    tmsDispatchCode: "DSP-000200",
    actorName: "Operador Demo",
    fileName: "orden-cargue-1.pdf",
    pdfBase64: Buffer.from("%PDF-1.4").toString("base64")
  });
  assert.deepEqual(fake.recorded, [{ deliveryKey: "DSP-000200:orden:1", status: "applied", message: "Orden de cargue agregada al expediente" }]);
});

test("does not resend what Operaciones already has unless it is forced", async () => {
  const fake = runtime({ plan: plan([{ ...order, settled: true }]) });
  const result = await syncOperacionesDeliveries(expedienteId, "Operador", fake.value);
  assert.equal(result.linked && result.items[0].status, "skipped");
  assert.equal(fake.sent.length, 0);
  await syncOperacionesDeliveries(expedienteId, "Operador", fake.value, { force: true });
  assert.equal(fake.sent.length, 1);
});

test("numbers travel without a file and a held delivery is recorded as pending", async () => {
  const numbers = { kind: "manifest_numbers" as const, deliveryKey: "DSP-000200:numeros:45202:45945", label: "Números", number: "45202 / 45945", manifestNumber: "45202", remesaNumber: "45945", settled: false };
  const fake = runtime({
    plan: plan([numbers]),
    send: async () => ({ ok: true, outcome: "pending", message: "Los números quedan en espera" })
  });
  const result = await syncOperacionesDeliveries(expedienteId, "Operador", fake.value);
  assert.equal(result.linked && result.items[0].status, "pending");
  assert.equal(fake.recorded[0].status, "pending");
});

test("a refusal or an outage never breaks the emission and is recorded as failed", async () => {
  const refused = runtime({ plan: plan([order]), send: async () => ({ ok: false, error: "El expediente ya no recibe orden de cargue" }) });
  const first = await syncOperacionesDeliveries(expedienteId, "Operador", refused.value);
  assert.equal(first.linked && first.items[0].message, "El expediente ya no recibe orden de cargue");
  const down = runtime({ plan: plan([order]), send: async () => { throw new OperacionesUnavailableError("Operaciones no respondió"); } });
  const second = await syncOperacionesDeliveries(expedienteId, "Operador", down.value);
  assert.equal(second.linked && second.items[0].status, "failed");
  assert.equal(down.recorded[0].message, "Operaciones no respondió");
});

test("a missing PDF is reported and nothing is sent", async () => {
  const fake = runtime({ plan: plan([{ ...order, artifactId: undefined }]) });
  const result = await syncOperacionesDeliveries(expedienteId, "Operador", fake.value);
  assert.equal(result.linked && result.items[0].status, "failed");
  assert.equal(fake.sent.length, 0);
});

test("the connection needs an address and a long key", () => {
  assert.equal(operacionesSettings({}), null);
  assert.equal(operacionesSettings({ OPERACIONES_API_URL: "https://x.convex.site", OPERACIONES_INTEGRATION_KEY: "short" }), null);
  assert.deepEqual(operacionesSettings({ OPERACIONES_API_URL: "https://x.convex.site/", OPERACIONES_INTEGRATION_KEY: "k".repeat(32) }), { baseUrl: "https://x.convex.site", key: "k".repeat(32) });
});

test("the route plan travels as its own PDF built at send time", async () => {
  const routePlan = { kind: "route_plan" as const, deliveryKey: "DSP-000200:plan-ruta:1284:2026-11-13T18:14", label: "Plan de ruta", number: "1284", fileName: "plan-ruta-DSP-000200.pdf", settled: false };
  const fake = runtime({ plan: plan([routePlan]) });
  const result = await syncOperacionesDeliveries(expedienteId, "Operador", fake.value);
  assert.equal(result.linked && result.items[0].status, "applied");
  assert.equal(fake.sent[0].kind, "route_plan");
  assert.equal(fake.sent[0].fileName, "plan-ruta-DSP-000200.pdf");
  assert.equal(Buffer.from(fake.sent[0].pdfBase64 ?? "", "base64").toString(), "%PDF-plan");
});

test("a route plan that cannot be built is reported and nothing is sent", async () => {
  const routePlan = { kind: "route_plan" as const, deliveryKey: "DSP-000200:plan-ruta:1284:2026-11-13T18:14", label: "Plan de ruta", number: "1284", fileName: "plan-ruta-DSP-000200.pdf", settled: false };
  const fake = runtime({ plan: plan([routePlan]), loadRoutePlanPdf: async () => { throw new Error("sin datos"); } });
  const result = await syncOperacionesDeliveries(expedienteId, "Operador", fake.value);
  assert.equal(result.linked && result.items[0].status, "failed");
  assert.equal(fake.sent.length, 0);
});

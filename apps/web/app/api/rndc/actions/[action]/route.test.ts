import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { createSessionToken, demoUsers } from "../../../../lib/auth.js";
import { validateDurableActionPayload } from "../../../../lib/rndc-action-preflight.js";
import { POST } from "./route.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const sessionSecret = "action-route-session-secret-with-more-than-thirty-two-characters";

beforeEach(() => {
  process.env.AUTH_MODE = "demo";
  process.env.DEMO_AUTH_PASSWORD = "unused-password";
  process.env.AUTH_SESSION_SECRET = sessionSecret;
  process.env.AUTH_JWT_PRIVATE_KEY = "unused";
  process.env.AUTH_JWT_PUBLIC_KEY = "unused";
  process.env.AUTH_JWT_ISSUER = "http://localhost:3000";
  process.env.RNDC_MODE = "dry-run";
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.CONVEX_URL;
  delete process.env.RNDC_INGEST_KEY;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

test("rejects an official action without a persisted document before any backend work", async () => {
  let backendCalls = 0;
  globalThis.fetch = async () => {
    backendCalls += 1;
    return Response.json({ ok: true });
  };

  const response = await POST(authenticatedActionRequest({
    organizationId: "org-1",
    expedienteId: "exp-1",
    requestKey: "request-1",
    businessKey: "emit-remesa:1",
    payload: { remesaNumber: "R-1" }
  }), actionContext("emit_remesa"));
  const body = await response.json() as { error?: string };

  assert.equal(response.status, 400);
  assert.equal(body.error, "A persisted official document is required");
  assert.equal(backendCalls, 0);
});

test("rejects an incomplete durable remesa payload before Convex can enqueue it", async () => {
  let backendCalls = 0;
  globalThis.fetch = async () => {
    backendCalls += 1;
    return Response.json({ ok: true });
  };

  const response = await POST(authenticatedActionRequest({
    organizationId: "org-1",
    expedienteId: "exp-1",
    documentId: "doc-1",
    requestKey: "request-1",
    businessKey: "emit-remesa:1",
    payload: { remesaNumber: "R-1", cargo: { quantityKg: 1_000 } }
  }), actionContext("emit_remesa"));
  const body = await response.json() as { error?: string; missingFields?: string[] };

  assert.equal(response.status, 400);
  assert.match(body.error ?? "", /sender\.idType/);
  assert.ok(body.missingFields?.includes("cargoPolicy.number"));
  assert.equal(backendCalls, 0);
});

test("rejects unknown official actions before reading their payload", async () => {
  const response = await POST(authenticatedActionRequest({}), actionContext("unknown"));

  assert.equal(response.status, 404);
});

test("requires delivery evidence fields for a normal remesa fulfillment", () => {
  const result = validateDurableActionPayload("fulfill_remesa", {
    remesaNumber: "R-1",
    manifestNumber: "M-1",
    compliance: {
      remesaType: "C",
      loadedQuantityKg: 1_000,
      unitCode: 1,
      loadingArrivalDate: "10/07/2026",
      loadingArrivalTime: "08:00",
      loadingEntryDate: "10/07/2026",
      loadingEntryTime: "08:10",
      loadingExitDate: "10/07/2026",
      loadingExitTime: "08:30"
    }
  });

  assert.equal(result.ok, false);
  assert.ok(result.missingFields.includes("compliance.deliveredQuantityKg"));
  assert.ok(result.missingFields.includes("compliance.unloadingExitTime"));
});

test("requires suspension and adjustment reasons for manifest fulfillment", () => {
  const result = validateDurableActionPayload("fulfill_manifest", {
    manifestNumber: "M-1",
    money: { freightValue: 1_000 },
    compliance: {
      manifestType: "S",
      documentsDeliveryDate: "10/07/2026",
      additionalLoadHoursValue: 0,
      additionalUnloadHoursValue: 0,
      additionalFreightValue: 100,
      freightDiscountValue: 50,
      overAdvanceValue: 0
    }
  });

  assert.equal(result.ok, false);
  assert.ok(result.missingFields.includes("compliance.manifestSuspensionReason"));
  assert.ok(result.missingFields.includes("compliance.suspensionConsequence"));
  assert.ok(result.missingFields.includes("compliance.additionalValueReason"));
  assert.ok(result.missingFields.includes("compliance.discountReason"));
});

test("accepts complete emission contracts and rejects non-finite required numbers", () => {
  const route = {
    sender: { idType: "N", id: "9001", siteCode: "1", cityCode: "11001000" },
    recipient: { idType: "N", id: "9002", siteCode: "1", cityCode: "68001000" }
  };
  const cargo = {
    shortDescription: "Carga",
    merchandiseCode: "001",
    packageCode: "10",
    natureCode: "1",
    quantityKg: 1_000
  };
  const appointments = {
    loadingAppointmentDate: "10/07/2026",
    loadingAppointmentTime: "08:00",
    unloadingAppointmentDate: "11/07/2026",
    unloadingAppointmentTime: "09:00"
  };

  assert.equal(validateDurableActionPayload("emit_cargo", {
    cargoNumber: "C-1",
    ...appointments,
    ...route,
    cargo
  }).ok, true);
  assert.equal(validateDurableActionPayload("emit_remesa", {
    remesaNumber: "R-1",
    cargoNumber: "C-1",
    ...appointments,
    ...route,
    cargo,
    cargoPolicy: { number: "P-1", expirationDate: "10/07/2027", insurerNit: "9003" }
  }).ok, true);
  assert.equal(validateDurableActionPayload("emit_manifest", {
    manifestNumber: "M-1",
    tripNumber: "T-1",
    remesaNumber: "R-1",
    cargoNumber: "C-1",
    expeditionDate: "10/07/2026",
    balancePaymentDate: "11/07/2026",
    driver: { idType: "C", id: "1001" },
    vehicle: { plate: "ABC123" },
    vehicleHolder: { idType: "C", id: "1002" },
    sender: route.sender,
    recipient: route.recipient,
    money: { freightValue: 1_000, advanceValue: 0, icaRetentionPerMille: 0 }
  }).ok, true);

  const invalid = validateDurableActionPayload("emit_manifest", {
    manifestNumber: "M-1",
    tripNumber: "T-1",
    remesaNumber: "R-1",
    cargoNumber: "C-1",
    expeditionDate: "10/07/2026",
    balancePaymentDate: "11/07/2026",
    driver: { idType: "C", id: "1001" },
    vehicle: { plate: "ABC123" },
    vehicleHolder: { idType: "C", id: "1002" },
    sender: route.sender,
    recipient: route.recipient,
    money: { freightValue: Number.POSITIVE_INFINITY, advanceValue: 0, icaRetentionPerMille: 0 }
  });

  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.invalidFields, ["money.freightValue"]);
});

test("accepts advanced remesa and Viaje Vacío contracts without invented document links", () => {
  const party = { idType: "N", id: "9001", siteCode: "1", cityCode: "11001000" };
  const cargo = { shortDescription: "Carga", merchandiseCode: "001", packageCode: "10", natureCode: "1", quantityKg: 1_000 };
  const remesa = validateDurableActionPayload("emit_remesa", {
    workflowVariant: "remesa_without_order",
    remesaNumber: "R-1",
    loadingAppointmentDate: "10/07/2026",
    loadingAppointmentTime: "08:00",
    unloadingAppointmentDate: "11/07/2026",
    unloadingAppointmentTime: "09:00",
    sender: party,
    recipient: party,
    cargo,
    cargoPolicy: { number: "P-1", expirationDate: "10/07/2027", insurerNit: "9003" }
  });
  const emptyManifest = validateDurableActionPayload("emit_manifest", {
    workflowVariant: "empty_manifest",
    manifestType: "W",
    manifestNumber: "M-1",
    expeditionDate: "10/07/2026",
    balancePaymentDate: "11/07/2026",
    driver: { idType: "C", id: "1001" },
    vehicle: { plate: "ABC123" },
    vehicleHolder: { idType: "C", id: "1002" },
    sender: { cityCode: "11001000" },
    recipient: { cityCode: "68001000" },
    money: { freightValue: 1_000, advanceValue: 0, icaRetentionPerMille: 0 }
  });

  assert.equal(remesa.ok, true);
  assert.equal(emptyManifest.ok, true);
});

function authenticatedActionRequest(body: Record<string, unknown>): Request {
  const user = demoUsers.find((candidate) => candidate.role === "operator");

  if (!user) {
    throw new Error("Demo operator not found");
  }

  const token = createSessionToken(user, sessionSecret, Date.now(), 3_600);
  return new Request("http://localhost/api/rndc/actions/emit_remesa", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: `tms_session=${encodeURIComponent(token)}`
    },
    body: JSON.stringify(body)
  });
}

function actionContext(action: string): { params: Promise<{ action: string }> } {
  return { params: Promise.resolve({ action }) };
}

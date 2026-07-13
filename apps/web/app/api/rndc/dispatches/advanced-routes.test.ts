import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { createSessionToken, demoUsers } from "../../../lib/auth.js";
import { POST as annul } from "./[expedienteId]/annul/route.js";
import { POST as correct } from "./[expedienteId]/correct/route.js";
import { POST as reconcile } from "./[expedienteId]/reconcile/route.js";
import { POST as structural } from "./[expedienteId]/exceptions/route.js";

const originalEnv = { ...process.env };
const secret = "advanced-routes-session-secret-long-enough";

beforeEach(() => {
  process.env.AUTH_MODE = "demo";
  process.env.DEMO_AUTH_PASSWORD = "unused";
  process.env.AUTH_SESSION_SECRET = secret;
  process.env.AUTH_JWT_PRIVATE_KEY = "unused";
  process.env.AUTH_JWT_PUBLIC_KEY = "unused";
  process.env.AUTH_JWT_ISSUER = "http://localhost:3000";
  process.env.RNDC_MODE = "dry-run";
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.CONVEX_URL;
  delete process.env.RNDC_INGEST_KEY;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

test("an operator can enter the controlled correction flow", async () => {
  const response = await correct(request("operator", {
    requestKey: "req-1",
    documentId: "doc-1",
    reasonCode: "1",
    reason: "Cambio de cita",
    observation: "Cliente confirmó la nueva cita",
    confirmed: true,
    before: { appointmentDate: "2026-07-10", appointmentTime: "08:00" },
    after: { remesaNumber: "R-1", appointmentDate: "2026-07-11", appointmentTime: "09:00" }
  }), context());

  assert.equal(response.status, 503);
});

test("an operator can enter the controlled manifest annulment flow", async () => {
  const response = await annul(request("operator", {
    requestKey: "req-annul-1",
    documentId: "doc-1",
    reasonCode: "A",
    reason: "Manifiesto no utilizado",
    observation: "La operación fue cancelada antes de iniciar",
    confirmed: true
  }), context());

  assert.equal(response.status, 503);
});

test("correction requires explicit confirmation and a before-after comparison", async () => {
  const unconfirmed = await correct(request("admin", {
    requestKey: "req-2",
    documentId: "doc-1",
    reason: "Cambio",
    observation: "Detalle",
    confirmed: false,
    before: {},
    after: { appointmentDate: "2026-07-11", appointmentTime: "09:00" }
  }), context());
  const withoutComparison = await correct(request("admin", {
    requestKey: "req-3",
    documentId: "doc-1",
    reason: "Cambio",
    observation: "Detalle",
    confirmed: true,
    after: { appointmentDate: "2026-07-11", appointmentTime: "09:00" }
  }), context());

  assert.equal(unconfirmed.status, 400);
  assert.equal(withoutComparison.status, 400);
});

test("manual reconciliation requires the exact uncertain operation", async () => {
  const response = await reconcile(request("admin", {
    requestKey: "req-4",
    documentId: "doc-1",
    reason: "Resolver timeout",
    observation: "Consulta manual",
    confirmed: true
  }), context());

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Selecciona el intento incierto exacto" });
});

test("structural exceptions remain hidden behind administration permission", async () => {
  const response = await structural(request("operator", {
    type: "empty_manifest",
    requestKey: "req-5",
    reason: "Retorno",
    observation: "Viaje vacío",
    confirmed: true,
    payload: { manifestType: "W" }
  }), context());

  assert.equal(response.status, 403);
});

function request(role: "admin" | "operator", body: Record<string, unknown>): Request {
  const user = demoUsers.find((candidate) => candidate.role === role);
  if (!user) throw new Error("Demo user missing");
  const token = createSessionToken(user, secret, Date.now(), 3600);
  return new Request("http://localhost/api/rndc/dispatches/exp-1/advanced", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `tms_session=${encodeURIComponent(token)}` },
    body: JSON.stringify(body)
  });
}

function context() {
  return { params: Promise.resolve({ expedienteId: "exp-1" }) };
}

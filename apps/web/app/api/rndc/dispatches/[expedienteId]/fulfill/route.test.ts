import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { createSessionToken, demoUsers } from "../../../../../lib/auth.js";
import { POST } from "./route.js";

const originalEnv = { ...process.env };
const sessionSecret = "fulfill-route-session-secret-with-more-than-thirty-two-characters";

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
  process.env = { ...originalEnv };
});

test("rejects an unauthenticated fulfillment request", async () => {
  const response = await POST(
    new Request("http://localhost/api/rndc/dispatches/exp-1/fulfill", { method: "POST" }),
    context("exp-1")
  );

  assert.equal(response.status, 401);
});

test("rejects fulfillment for an auditor", async () => {
  const auditor = demoUsers.find((candidate) => candidate.role === "auditor");
  assert.ok(auditor);
  const token = createSessionToken(auditor, sessionSecret, Date.now(), 3_600);
  const response = await POST(
    new Request("http://localhost/api/rndc/dispatches/exp-1/fulfill", {
      method: "POST",
      headers: { cookie: `tms_session=${encodeURIComponent(token)}` }
    }),
    context("exp-1")
  );

  assert.equal(response.status, 403);
});

test("rejects fulfillment fields supplied by the browser", async () => {
  const response = await POST(request("exp-1", { deliveredQuantity: "999999" }), context("exp-1"));
  const body = await response.json() as { error?: string };

  assert.equal(response.status, 400);
  assert.match(body.error ?? "", /no puede aportar datos de cumplido/i);
});

test("fails closed when durable storage is not configured", async () => {
  const response = await POST(request("exp-1"), context("exp-1"));

  assert.equal(response.status, 503);
});

function request(expedienteId: string, body?: Record<string, unknown>): Request {
  const operator = demoUsers.find((candidate) => candidate.role === "operator");
  assert.ok(operator);
  const token = createSessionToken(operator, sessionSecret, Date.now(), 3_600);

  return new Request(`http://localhost/api/rndc/dispatches/${expedienteId}/fulfill`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: `tms_session=${encodeURIComponent(token)}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

function context(expedienteId: string): { params: Promise<{ expedienteId: string }> } {
  return { params: Promise.resolve({ expedienteId }) };
}

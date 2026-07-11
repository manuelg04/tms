import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { createSessionToken, demoUsers } from "../../../../../lib/auth.js";
import { POST } from "./route.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const sessionSecret = "emit-route-session-secret-with-more-than-thirty-two-characters";

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

test("rejects an unauthenticated emission request", async () => {
  const response = await POST(
    new Request("http://localhost/api/rndc/dispatches/exp-1/emit", { method: "POST" }),
    emitContext("exp-1")
  );

  assert.equal(response.status, 401);
});

test("rejects a session without RNDC submission permission", async () => {
  const auditor = demoUsers.find((candidate) => candidate.role === "auditor");
  assert.ok(auditor);
  const token = createSessionToken(auditor, sessionSecret, Date.now(), 3_600);
  const response = await POST(
    new Request("http://localhost/api/rndc/dispatches/exp-1/emit", {
      method: "POST",
      headers: { cookie: `tms_session=${encodeURIComponent(token)}` }
    }),
    emitContext("exp-1")
  );

  assert.equal(response.status, 403);
});

test("rejects any browser-provided RNDC fields before touching Convex", async () => {
  let backendCalls = 0;
  globalThis.fetch = async () => {
    backendCalls += 1;
    return Response.json({ ok: true });
  };

  const response = await POST(
    emitRequest("exp-1", { payload: { manifestNumber: "HACKED" } }),
    emitContext("exp-1")
  );
  const body = (await response.json()) as { error?: string };

  assert.equal(response.status, 400);
  assert.match(body.error ?? "", /no puede aportar campos RNDC/);
  assert.equal(backendCalls, 0);
});

test("fails closed when durable storage is not configured", async () => {
  const response = await POST(emitRequest("exp-1"), emitContext("exp-1"));

  assert.equal(response.status, 503);
});

function emitRequest(expedienteId: string, body?: Record<string, unknown>): Request {
  const user = demoUsers.find((candidate) => candidate.role === "operator");

  if (!user) {
    throw new Error("Demo operator not found");
  }

  const token = createSessionToken(user, sessionSecret, Date.now(), 3_600);
  return new Request(`http://localhost/api/rndc/dispatches/${expedienteId}/emit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: `tms_session=${encodeURIComponent(token)}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

function emitContext(expedienteId: string): { params: Promise<{ expedienteId: string }> } {
  return { params: Promise.resolve({ expedienteId }) };
}

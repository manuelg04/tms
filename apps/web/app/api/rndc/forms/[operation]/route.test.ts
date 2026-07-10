import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { createSessionToken, demoUsers } from "../../../../lib/auth.js";
import { POST } from "./route.js";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const sessionSecret = "legacy-form-session-secret-with-more-than-thirty-two-characters";
const serviceToken = "legacy-form-service-token-with-more-than-thirty-two-characters";

beforeEach(() => {
  process.env.AUTH_MODE = "demo";
  process.env.DEMO_AUTH_PASSWORD = "unused-password";
  process.env.AUTH_SESSION_SECRET = sessionSecret;
  process.env.AUTH_JWT_PRIVATE_KEY = "unused";
  process.env.AUTH_JWT_PUBLIC_KEY = "unused";
  process.env.AUTH_JWT_ISSUER = "http://localhost:3000";
  process.env.RNDC_API_URL = "http://localhost:3017";
  process.env.RNDC_SERVICE_TOKEN = serviceToken;
  process.env.RNDC_MODE = "dry-run";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

test("blocks operators from the legacy forms proxy in production", async () => {
  Object.assign(process.env, { NODE_ENV: "production" });
  let backendCalls = 0;
  globalThis.fetch = async () => {
    backendCalls += 1;
    return Response.json({ ok: true });
  };

  const response = await POST(authenticatedRequest("operator"), operationContext("remesa"));

  assert.equal(response.status, 403);
  assert.equal(backendCalls, 0);
});

test("allows administrators to use the legacy forms proxy for dry-run support", async () => {
  Object.assign(process.env, { NODE_ENV: "production" });
  let backendCalls = 0;
  globalThis.fetch = async () => {
    backendCalls += 1;
    return Response.json({ ok: true, mode: "dry-run" });
  };

  const response = await POST(authenticatedRequest("admin"), operationContext("remesa"));

  assert.equal(response.status, 200);
  assert.equal(backendCalls, 1);
});

test("blocks the legacy forms proxy outside dry-run before contacting the backend", async () => {
  Object.assign(process.env, { NODE_ENV: "development" });
  process.env.RNDC_MODE = "live";
  let backendCalls = 0;
  globalThis.fetch = async () => {
    backendCalls += 1;
    return Response.json({ ok: true });
  };

  const response = await POST(authenticatedRequest("admin"), operationContext("manifest"));
  const body = await response.json() as { error?: string };

  assert.equal(response.status, 403);
  assert.equal(body.error, "Legacy RNDC forms are available only in dry-run mode");
  assert.equal(backendCalls, 0);
});

function authenticatedRequest(role: "admin" | "operator"): Request {
  const user = demoUsers.find((candidate) => candidate.role === role);

  if (!user) {
    throw new Error("Demo user not found");
  }

  const token = createSessionToken(user, sessionSecret, Date.now(), 3_600);
  return new Request("http://localhost/api/rndc/forms/remesa", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: `tms_session=${encodeURIComponent(token)}`
    },
    body: JSON.stringify({ remesaNumber: "R-1" })
  });
}

function operationContext(operation: string): { params: Promise<{ operation: string }> } {
  return { params: Promise.resolve({ operation }) };
}

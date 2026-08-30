import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSessionToken, demoUsers } from "../../../../lib/auth.js";
import { POST } from "./route.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.AUTH_MODE = "demo";
  process.env.DEMO_AUTH_PASSWORD = "unused";
  process.env.AUTH_SESSION_SECRET = "test-session-secret-with-enough-length-1234567890";
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

test("master sync rejects anonymous requests", async () => {
  const response = await POST(new Request("http://localhost/api/rndc/masters/sync", { method: "POST", body: JSON.stringify({ kind: "driver", key: "123" }) }));
  assert.equal(response.status, 401);
});

test("master sync rejects unknown kinds and extra keys", async () => {
  const unknownKind = await POST(request({ kind: "customer", key: "123" }));
  assert.equal(unknownKind.status, 400);
  const extraKeys = await POST(request({ kind: "driver", key: "123", payload: {} }));
  assert.equal(extraKeys.status, 400);
});

test("master sync requires durable storage configuration", async () => {
  const response = await POST(request({ kind: "vehicle", key: "abc123" }));
  assert.equal(response.status, 503);
});

function request(body: unknown): Request {
  const user = demoUsers.find((candidate) => candidate.role === "operator");
  if (!user) throw new Error("Demo operator missing");
  const token = createSessionToken(user, process.env.AUTH_SESSION_SECRET!, Date.now(), 3600);
  return new Request("http://localhost/api/rndc/masters/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `tms_session=${encodeURIComponent(token)}` },
    body: JSON.stringify(body)
  });
}

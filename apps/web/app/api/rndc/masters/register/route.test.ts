import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { createSessionToken, demoUsers } from "../../../../lib/auth.js";
import { POST } from "./route.js";

const originalEnv = { ...process.env };
const secret = "master-route-session-secret-long-enough";

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

test("requires an authenticated operator for master transmission", async () => {
  const response = await POST(new Request("http://localhost/api/rndc/masters/register", { method: "POST" }));
  assert.equal(response.status, 401);
});

test("accepts only persisted master identities from the browser", async () => {
  const response = await POST(request({
    driverDocument: "1001",
    vehiclePlate: "STO172",
    driver: { name: "Browser supplied" }
  }));
  assert.equal(response.status, 400);
});

test("fails closed before transmission when durable storage is unavailable", async () => {
  const response = await POST(request({ driverDocument: "1001", vehiclePlate: "STO172" }));
  assert.equal(response.status, 503);
});

function request(body: Record<string, unknown>) {
  const user = demoUsers.find((candidate) => candidate.role === "operator");
  if (!user) throw new Error("Demo operator missing");
  const token = createSessionToken(user, secret, Date.now(), 3600);
  return new Request("http://localhost/api/rndc/masters/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `tms_session=${encodeURIComponent(token)}` },
    body: JSON.stringify(body)
  });
}

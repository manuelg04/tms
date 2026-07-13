import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { createSessionToken, demoUsers } from "../../lib/auth.js";
import { buildEvidenceDownloadHeaders } from "../../lib/evidence-download.js";
import { buildDurableEvidenceHeaders, durableEvidenceWasStored } from "../../lib/rndc-gateway.js";
import { GET as getHealth } from "./health/route.js";
import { POST as submitLegacyForm } from "./forms/[operation]/route.js";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const sessionSecret = "gateway-session-secret-with-more-than-thirty-two-characters";
const serviceToken = "gateway-service-token-with-more-than-thirty-two-characters";

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

test("protects the health route and exposes only the safe mode", async () => {
  const unauthorized = await getHealth(new Request("http://localhost/api/rndc/health"));
  globalThis.fetch = async () => Response.json({ ok: true, status: "alive", secret: "hidden" });
  const authorized = await getHealth(authenticatedRequest("http://localhost/api/rndc/health", "operator"));
  const body = await authorized.json() as Record<string, unknown>;

  assert.equal(unauthorized.status, 401);
  assert.deepEqual(body, { ok: true, mode: "dry-run" });
});

test("allows operators through the typed form gateway and keeps the service secret server-side", async () => {
  let authorization = "";
  let backendUrl = "";
  let expectedMode = "";
  globalThis.fetch = async (input, init) => {
    backendUrl = String(input);
    const headers = new Headers(init?.headers);
    authorization = headers.get("authorization") ?? "";
    expectedMode = headers.get("x-tms-expected-mode") ?? "";
    return Response.json({ ok: true, mode: "dry-run" });
  };
  const request = authenticatedRequest("http://localhost/api/rndc/forms/remesa", "operator", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remesaNumber: "R-1" })
  });
  const response = await submitLegacyForm(request, { params: Promise.resolve({ operation: "remesa" }) });

  assert.equal(response.status, 200);
  assert.equal(backendUrl, "http://localhost:3017/rndc/forms/remesa");
  assert.equal(authorization, `Bearer ${serviceToken}`);
  assert.equal(expectedMode, "dry-run");
});

test("rejects auditors and unknown form operations before calling the backend", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ ok: true });
  };
  const auditor = authenticatedRequest("http://localhost/api/rndc/forms/remesa", "auditor", { method: "POST" });
  const forbidden = await submitLegacyForm(auditor, { params: Promise.resolve({ operation: "remesa" }) });
  const operator = authenticatedRequest("http://localhost/api/rndc/forms/xml", "operator", { method: "POST" });
  const unknown = await submitLegacyForm(operator, { params: Promise.resolve({ operation: "xml" }) });

  assert.equal(forbidden.status, 403);
  assert.equal(unknown.status, 404);
  assert.equal(calls, 0);
});

test("builds server-only durable evidence references and reads the backend storage result", () => {
  const headers = buildDurableEvidenceHeaders({
    organizationId: "org-1",
    expedienteId: "exp-1",
    documentId: "doc-1",
    operationId: "op-1",
    operationType: "emit_remesa",
    leaseOwner: "worker-1"
  });

  assert.equal(headers["X-TMS-Durable-Operation"], "true");
  assert.equal(headers["X-TMS-Organization-Id"], "org-1");
  assert.equal(headers["X-TMS-Expediente-Id"], "exp-1");
  assert.equal(headers["X-TMS-Document-Id"], "doc-1");
  assert.equal(headers["X-TMS-Operation-Id"], "op-1");
  assert.equal(headers["X-TMS-Operation-Type"], "emit_remesa");
  assert.equal(headers["X-TMS-Lease-Owner"], "worker-1");
  assert.equal(durableEvidenceWasStored({ durableEvidence: { stored: true } }), true);
  assert.equal(durableEvidenceWasStored({ durableEvidence: { stored: false } }), false);
  assert.equal(durableEvidenceWasStored({ ok: true }), false);
});

test("builds durable master-operation headers without inventing an expediente", () => {
  assert.deepEqual(buildDurableEvidenceHeaders({
    organizationId: "org-1",
    operationId: "operation-1",
    operationType: "upsert_vehicle",
    leaseOwner: "worker-1"
  }), {
    "X-TMS-Durable-Operation": "true",
    "X-TMS-Organization-Id": "org-1",
    "X-TMS-Operation-Id": "operation-1",
    "X-TMS-Operation-Type": "upsert_vehicle",
    "X-TMS-Lease-Owner": "worker-1"
  });
});

test("builds a private attachment response without allowing a hostile file name", () => {
  const headers = buildEvidenceDownloadHeaders("../request\r\n.xml", "application/xml", 404);

  assert.equal(headers.get("cache-control"), "private, no-store");
  assert.equal(headers.get("content-type"), "application/xml");
  assert.equal(headers.get("content-length"), "404");
  assert.equal(headers.get("content-disposition"), "attachment; filename*=UTF-8''.._request__.xml");
});

function authenticatedRequest(url: string, role: "admin" | "operator" | "auditor", init: RequestInit = {}): Request {
  const user = demoUsers.find((candidate) => candidate.role === role);

  if (!user) {
    throw new Error("Demo user not found");
  }

  const token = createSessionToken(user, sessionSecret, Date.now(), 3_600);
  const headers = new Headers(init.headers);
  headers.set("cookie", `tms_session=${encodeURIComponent(token)}`);
  return new Request(url, { ...init, headers });
}

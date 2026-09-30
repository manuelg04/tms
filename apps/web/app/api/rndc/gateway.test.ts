import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { createSessionToken, demoUsers } from "../../lib/auth.js";
import { buildEvidenceDownloadHeaders } from "../../lib/evidence-download.js";
import { authorizeGatewayRequest, buildDurableEvidenceHeaders, durableEvidenceWasStored, forwardRndcRequest } from "../../lib/rndc-gateway.js";
import { GET as getHealth } from "./health/route.js";

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

test("reports the configured mode once real users are enabled and keeps demo sessions in dry-run", async () => {
  process.env.RNDC_MODE = "live";
  globalThis.fetch = async () => Response.json({ ok: true, status: "alive" });

  const demoResponse = await getHealth(authenticatedRequest("http://localhost/api/rndc/health", "operator"));
  assert.equal(demoResponse.status, 503);
  assert.deepEqual(await demoResponse.json(), { ok: false, mode: "offline" });

  process.env.AUTH_MODE = "local";
  const localResponse = await getHealth(authenticatedRequest("http://localhost/api/rndc/health", "operator"));
  assert.deepEqual(await localResponse.json(), { ok: true, mode: "live" });
});

test("allows operators through the gateway and keeps the service secret server-side", async () => {
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
  const request = authenticatedRequest("http://localhost/api/rndc/actions/emit_remesa", "operator", { method: "POST" });
  const actor = authorizeGatewayRequest(request, "submit_rndc");
  assert.ok(!(actor instanceof Response));
  const response = await forwardRndcRequest("/rndc/forms/remesa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remesaNumber: "R-1" })
  });

  assert.equal(response.status, 200);
  assert.equal(backendUrl, "http://localhost:3017/rndc/forms/remesa");
  assert.equal(authorization, `Bearer ${serviceToken}`);
  assert.equal(expectedMode, "dry-run");
});

test("rejects auditors and anonymous requests before calling the backend", () => {
  const auditor = authorizeGatewayRequest(authenticatedRequest("http://localhost/api/rndc/actions/emit_remesa", "auditor", { method: "POST" }), "submit_rndc");
  const anonymous = authorizeGatewayRequest(new Request("http://localhost/api/rndc/actions/emit_remesa", { method: "POST" }), "submit_rndc");

  assert.ok(auditor instanceof Response);
  assert.equal(auditor.status, 403);
  assert.ok(anonymous instanceof Response);
  assert.equal(anonymous.status, 401);
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

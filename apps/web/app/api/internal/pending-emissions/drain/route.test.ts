import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { POST } from "./route.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const serviceKey = "service-key-for-tests-with-more-than-32-chars";

beforeEach(() => {
  process.env.RNDC_INGEST_KEY = serviceKey;
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.invalid";
  process.env.RNDC_SERVICE_TOKEN = "gateway-token-for-tests-with-more-than-32-chars";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

function drainRequest(authorization?: string): Request {
  return new Request("http://localhost/api/internal/pending-emissions/drain", {
    method: "POST",
    headers: authorization ? { Authorization: authorization } : {}
  });
}

test("the server drain refuses callers without the service key", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({});
  };

  assert.equal((await POST(drainRequest())).status, 401);
  assert.equal((await POST(drainRequest("Bearer wrong-key"))).status, 401);
  assert.equal((await POST(drainRequest(serviceKey))).status, 401);
  assert.equal(calls, 0);
});

test("the server drain fails closed when the service key is not configured", async () => {
  delete process.env.RNDC_INGEST_KEY;
  assert.equal((await POST(drainRequest(`Bearer ${serviceKey}`))).status, 503);
});

test("the server drain touches no dispatch while RNDC is unavailable", async () => {
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return Response.json({ ok: true, available: false, detail: "connect ECONNREFUSED" });
  };
  const response = await POST(drainRequest(`Bearer ${serviceKey}`));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, available: false, processed: [] });
  assert.equal(urls.length, 1);
  assert.equal(urls[0].endsWith("/rndc/availability"), true);
});

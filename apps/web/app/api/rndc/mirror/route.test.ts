import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import { createSessionToken, demoUsers } from "../../../lib/auth";
import { POST } from "./route";

const previous = { ...process.env };
beforeEach(() => {
  process.env.AUTH_MODE = "demo";
  process.env.DEMO_AUTH_PASSWORD = "unused";
  process.env.AUTH_SESSION_SECRET =
    "isolated-session-secret-more-than-32-characters";
  process.env.AUTH_JWT_PRIVATE_KEY = "unused";
  process.env.AUTH_JWT_PUBLIC_KEY = "unused";
  process.env.AUTH_JWT_ISSUER = "http://localhost:3000";
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.CONVEX_URL;
  delete process.env.RNDC_INGEST_KEY;
});
afterEach(() => {
  process.env = { ...previous };
});
function request(
  body: unknown,
  role: "operator" | "auditor" | "client" = "operator",
) {
  const user = demoUsers.find((u) => u.role === role)!;
  const token = createSessionToken(
    user,
    process.env.AUTH_SESSION_SECRET!,
    Date.now(),
    3600,
  );
  return new Request("http://localhost:3000/api/rndc/mirror", {
    method: "POST",
    headers: {
      cookie: `tms_session=${encodeURIComponent(token)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
const valid = { process: 4, from: "2026-09-01", to: "2026-09-29" };
test("mirror gateway rejects anonymous, auditors, clients and forged source selection", async () => {
  assert.equal(
    (
      await POST(
        new Request("http://localhost/api/rndc/mirror", {
          method: "POST",
          body: JSON.stringify(valid),
        }),
      )
    ).status,
    401,
  );
  assert.equal((await POST(request(valid, "auditor"))).status, 403);
  assert.equal((await POST(request(valid, "client"))).status, 403);
  assert.equal(
    (await POST(request({ ...valid, organizationId: "other" }))).status,
    400,
  );
  assert.equal(
    (await POST(request({ ...valid, companyRndcNit: "other" }))).status,
    400,
  );
});
test("mirror gateway bounds official read processes, periods, storage and authentication", async () => {
  assert.equal((await POST(request({ ...valid, process: 1 }))).status, 400);
  assert.equal(
    (await POST(request({ ...valid, from: "2026-02-30" }))).status,
    400,
  );
  assert.equal(
    (await POST(request({ ...valid, from: "2026-08-01" }))).status,
    400,
  );
  assert.equal((await POST(request(valid))).status, 503);
  process.env.CONVEX_URL = "https://isolated.convex.cloud";
  process.env.RNDC_INGEST_KEY = "unused";
  assert.equal((await POST(request(valid))).status, 503);
});

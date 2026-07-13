import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";
import {
  authenticateDemoUser,
  buildDemoJwks,
  canPerform,
  createSessionToken,
  demoUsers,
  readSessionToken,
  signConvexAccessToken
} from "./auth.js";

test("authenticates configured demo users without storing a password in the catalog", () => {
  const user = authenticateDemoUser("operador@mtm.local", "local-secret", "local-secret");

  assert.equal(user?.role, "operator");
  assert.equal("password" in (user ?? {}), false);
  assert.equal(authenticateDemoUser("operador@mtm.local", "wrong", "local-secret"), null);
  assert.equal(authenticateDemoUser("unknown@mtm.local", "local-secret", "local-secret"), null);
});

test("creates tamper-resistant expiring session tokens", () => {
  const user = demoUsers.find((candidate) => candidate.role === "admin");
  assert.ok(user);
  const token = createSessionToken(user, "session-secret-123", 1_000, 60);

  assert.deepEqual(readSessionToken(token, "session-secret-123", 30_000), {
    ...user,
    expiresAt: 61_000
  });
  assert.equal(readSessionToken(`${token}x`, "session-secret-123", 30_000), null);
  assert.equal(readSessionToken(token, "session-secret-123", 61_001), null);
});

test("enforces the provisional role permissions", () => {
  assert.equal(canPerform("admin", "override_rndc"), true);
  assert.equal(canPerform("operator", "submit_rndc"), true);
  assert.equal(canPerform("operator", "manage_official_documents"), true);
  assert.equal(canPerform("operator", "override_rndc"), false);
  assert.equal(canPerform("auditor", "view_audit"), true);
  assert.equal(canPerform("auditor", "edit_expediente"), false);
});

test("issues an RS256 Convex token and publishes its matching JWKS", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const user = demoUsers.find((candidate) => candidate.role === "operator");
  assert.ok(user);
  const token = signConvexAccessToken({
    user,
    privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    issuer: "https://tms.local",
    audience: "tms-demo",
    keyId: "demo-key",
    nowMs: 10_000,
    ttlSeconds: 300
  });
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Record<string, unknown>;
  const valid = verify(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    publicKey,
    Buffer.from(encodedSignature, "base64url")
  );

  assert.equal(valid, true);
  assert.equal(payload.sub, user.id);
  assert.equal(payload.role, "operator");
  assert.equal(payload.aud, "tms-demo");
  assert.deepEqual(buildDemoJwks(publicKey.export({ format: "pem", type: "spki" }).toString(), "demo-key").keys[0], {
    ...publicKey.export({ format: "jwk" }),
    alg: "RS256",
    kid: "demo-key",
    use: "sig"
  });
});

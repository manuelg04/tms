import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test, { after, before } from "node:test";
import { GET as getJwks } from "./jwks/route.js";
import { POST as login } from "./login/route.js";
import { POST as logout } from "./logout/route.js";
import { GET as getSession } from "./session/route.js";
import { POST as getToken } from "./token/route.js";

const originalEnv = { ...process.env };
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

before(() => {
  process.env.AUTH_MODE = "demo";
  process.env.DEMO_AUTH_PASSWORD = "demo-password-123";
  process.env.AUTH_SESSION_SECRET = "session-secret-with-at-least-thirty-two-characters";
  process.env.AUTH_JWT_PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  process.env.AUTH_JWT_PUBLIC_KEY = publicKey.export({ format: "pem", type: "spki" }).toString();
  process.env.AUTH_JWT_ISSUER = "https://tms.local";
  process.env.AUTH_JWT_AUDIENCE = "tms-demo";
  process.env.AUTH_JWT_KEY_ID = "demo-key";
});

after(() => {
  process.env = originalEnv;
});

test("logs in a demo operator with a protected cookie", async () => {
  const response = await login(jsonRequest("http://localhost/api/auth/login", {
    email: "operador@mtm.local",
    password: "demo-password-123"
  }));
  const body = await response.json() as { user?: { role: string } };
  const cookie = response.headers.get("set-cookie") ?? "";

  assert.equal(response.status, 200);
  assert.equal(body.user?.role, "operator");
  assert.match(cookie, /^tms_session=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
});

test("rejects invalid login credentials", async () => {
  const response = await login(jsonRequest("http://localhost/api/auth/login", {
    email: "operador@mtm.local",
    password: "wrong"
  }));

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("returns the session and a signed Convex token", async () => {
  const loginResponse = await login(jsonRequest("http://localhost/api/auth/login", {
    email: "admin@mtm.local",
    password: "demo-password-123"
  }));
  const cookie = cookieHeader(loginResponse.headers.get("set-cookie") ?? "");
  const sessionResponse = await getSession(new Request("http://localhost/api/auth/session", { headers: { cookie } }));
  const tokenResponse = await getToken(new Request("http://localhost/api/auth/token", { method: "POST", headers: { cookie } }));
  const sessionBody = await sessionResponse.json() as { user?: { role: string } };
  const tokenBody = await tokenResponse.json() as { token?: string };
  const [header, payload, signature] = tokenBody.token?.split(".") ?? [];

  assert.equal(sessionBody.user?.role, "admin");
  assert.equal(tokenResponse.status, 200);
  assert.equal(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")), true);
});

test("publishes only the public signing key and clears logout sessions", async () => {
  const jwksResponse = await getJwks();
  const jwks = await jwksResponse.json() as { keys: Record<string, unknown>[] };
  const logoutResponse = await logout();

  assert.equal(jwks.keys[0].kid, "demo-key");
  assert.equal("d" in jwks.keys[0], false);
  assert.match(logoutResponse.headers.get("set-cookie") ?? "", /Max-Age=0/i);
});

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function cookieHeader(value: string): string {
  return value.split(";")[0];
}

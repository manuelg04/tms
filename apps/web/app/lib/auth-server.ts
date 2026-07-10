import {
  buildDemoJwks,
  createSessionToken,
  readSessionToken,
  signConvexAccessToken,
  type DemoUser
} from "./auth";

export const sessionCookieName = "tms_session";

export type AuthSettings = {
  mode: "demo";
  demoPassword: string;
  sessionSecret: string;
  privateKey: string;
  publicKey: string;
  issuer: string;
  audience: string;
  keyId: string;
  secureCookies: boolean;
};

export function getAuthSettings(): AuthSettings {
  if ((process.env.AUTH_MODE ?? "demo") !== "demo") {
    throw new Error("Unsupported authentication mode");
  }

  return {
    mode: "demo",
    demoPassword: required("DEMO_AUTH_PASSWORD"),
    sessionSecret: required("AUTH_SESSION_SECRET"),
    privateKey: readPem("AUTH_JWT_PRIVATE_KEY", "AUTH_JWT_PRIVATE_KEY_BASE64"),
    publicKey: readPem("AUTH_JWT_PUBLIC_KEY", "AUTH_JWT_PUBLIC_KEY_BASE64"),
    issuer: required("AUTH_JWT_ISSUER"),
    audience: process.env.AUTH_JWT_AUDIENCE ?? "tms-demo",
    keyId: process.env.AUTH_JWT_KEY_ID ?? "tms-demo-key",
    secureCookies: process.env.NODE_ENV === "production"
  };
}

export function createSessionCookie(user: DemoUser, settings: AuthSettings, nowMs = Date.now()): string {
  const token = createSessionToken(user, settings.sessionSecret, nowMs, 8 * 60 * 60);
  return serializeCookie(token, 8 * 60 * 60, settings.secureCookies);
}

export function clearSessionCookie(secure: boolean): string {
  return serializeCookie("", 0, secure);
}

export function readRequestSession(request: Request, settings: AuthSettings, nowMs = Date.now()): (DemoUser & { expiresAt: number }) | null {
  const token = readCookie(request.headers.get("cookie"), sessionCookieName);
  return token ? readSessionToken(token, settings.sessionSecret, nowMs) : null;
}

export function createConvexToken(user: DemoUser, settings: AuthSettings, nowMs = Date.now()): string {
  return signConvexAccessToken({
    user,
    privateKey: settings.privateKey,
    issuer: settings.issuer,
    audience: settings.audience,
    keyId: settings.keyId,
    nowMs,
    ttlSeconds: 5 * 60
  });
}

export function createJwks(settings: AuthSettings): { keys: Record<string, unknown>[] } {
  return buildDemoJwks(settings.publicKey, settings.keyId);
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name}`);
  }

  return value;
}

function normalizePem(value: string): string {
  return value.replaceAll("\\n", "\n");
}

function readPem(textName: string, base64Name: string): string {
  const text = process.env[textName];

  if (text) {
    return normalizePem(text);
  }

  const encoded = process.env[base64Name];

  if (!encoded) {
    throw new Error(`Missing ${textName} or ${base64Name}`);
  }

  return Buffer.from(encoded, "base64").toString("utf8");
}

function serializeCookie(value: string, maxAge: number, secure: boolean): string {
  const attributes = [
    `${sessionCookieName}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`
  ];

  if (secure) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) {
    return null;
  }

  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");

    if (key === name) {
      return decodeURIComponent(value.join("="));
    }
  }

  return null;
}

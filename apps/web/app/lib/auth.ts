import { createHash, createHmac, createPublicKey, sign, timingSafeEqual } from "node:crypto";

export type DemoRole = "admin" | "operator" | "auditor";

export type Permission =
  | "view_expediente"
  | "edit_expediente"
  | "submit_rndc"
  | "manage_official_documents"
  | "override_rndc"
  | "view_audit"
  | "download_evidence";

export type DemoUser = {
  id: string;
  email: string;
  name: string;
  role: DemoRole;
};

export const demoUsers: DemoUser[] = [
  { id: "demo-admin", email: "admin@mtm.local", name: "Administrador MTM", role: "admin" },
  { id: "demo-operator", email: "operador@mtm.local", name: "Operador MTM", role: "operator" },
  { id: "demo-auditor", email: "auditor@mtm.local", name: "Auditor MTM", role: "auditor" }
];

const rolePermissions: Record<DemoRole, ReadonlySet<Permission>> = {
  admin: new Set(["view_expediente", "edit_expediente", "submit_rndc", "manage_official_documents", "override_rndc", "view_audit", "download_evidence"]),
  operator: new Set(["view_expediente", "edit_expediente", "submit_rndc", "manage_official_documents", "download_evidence"]),
  auditor: new Set(["view_expediente", "view_audit", "download_evidence"])
};

export function authenticateDemoUser(email: string, password: string, configuredPassword: string): DemoUser | null {
  const user = demoUsers.find((candidate) => candidate.email === email.trim().toLowerCase());

  if (!user || !configuredPassword) {
    return null;
  }

  const suppliedHash = createHash("sha256").update(password).digest();
  const configuredHash = createHash("sha256").update(configuredPassword).digest();
  return timingSafeEqual(suppliedHash, configuredHash) ? user : null;
}

export function createSessionToken(user: DemoUser, secret: string, nowMs: number, ttlSeconds: number): string {
  requireSecret(secret);
  const payload = encodeJson({ ...user, expiresAt: nowMs + ttlSeconds * 1_000 });
  return `${payload}.${signHmac(payload, secret)}`;
}

export function readSessionToken(token: string, secret: string, nowMs: number): (DemoUser & { expiresAt: number }) | null {
  if (!secret) {
    return null;
  }

  const parts = token.split(".");

  if (parts.length !== 2) {
    return null;
  }

  const [payload, signature] = parts;
  const expected = Buffer.from(signHmac(payload, secret));
  const received = Buffer.from(signature);

  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;

    if (!isSessionPayload(parsed) || parsed.expiresAt < nowMs) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function canPerform(role: DemoRole, permission: Permission): boolean {
  return rolePermissions[role].has(permission);
}

export function signConvexAccessToken(input: {
  user: DemoUser;
  privateKey: string;
  issuer: string;
  audience: string;
  keyId: string;
  nowMs: number;
  ttlSeconds: number;
}): string {
  const issuedAt = Math.floor(input.nowMs / 1_000);
  const header = encodeJson({ alg: "RS256", kid: input.keyId, typ: "JWT" });
  const payload = encodeJson({
    aud: input.audience,
    email: input.user.email,
    exp: issuedAt + input.ttlSeconds,
    iat: issuedAt,
    iss: input.issuer,
    name: input.user.name,
    role: input.user.role,
    sub: input.user.id
  });
  const unsigned = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), input.privateKey).toString("base64url");
  return `${unsigned}.${signature}`;
}

export function buildDemoJwks(publicKey: string, keyId: string): { keys: Record<string, unknown>[] } {
  const jwk = createPublicKey(publicKey).export({ format: "jwk" });
  return { keys: [{ ...jwk, alg: "RS256", kid: keyId, use: "sig" }] };
}

function encodeJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signHmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function requireSecret(secret: string): void {
  if (secret.length < 16) {
    throw new Error("Session secret must contain at least 16 characters");
  }
}

function isSessionPayload(value: Record<string, unknown>): value is DemoUser & { expiresAt: number } {
  return typeof value.id === "string"
    && typeof value.email === "string"
    && typeof value.name === "string"
    && (value.role === "admin" || value.role === "operator" || value.role === "auditor")
    && typeof value.expiresAt === "number";
}

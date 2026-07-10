import { generateKeyPairSync, randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildDemoJwks, demoUsers } from "../app/lib/auth.js";

const root = resolve(import.meta.dirname, "..");
const repoRoot = resolve(root, "../..");
const envPath = resolve(root, ".env.local");
const backendEnvPath = resolve(repoRoot, ".env");
const credentialsPath = resolve(root, ".demo-auth.json");
const current = await readFile(envPath, "utf8").catch(() => "");
const backendCurrent = await readFile(backendEnvPath, "utf8").catch(() => "");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = readEnvValue(current, "AUTH_JWT_PRIVATE_KEY_BASE64")
  ? Buffer.from(readEnvValue(current, "AUTH_JWT_PRIVATE_KEY_BASE64") as string, "base64").toString("utf8")
  : privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const publicPem = readEnvValue(current, "AUTH_JWT_PUBLIC_KEY_BASE64")
  ? Buffer.from(readEnvValue(current, "AUTH_JWT_PUBLIC_KEY_BASE64") as string, "base64").toString("utf8")
  : publicKey.export({ format: "pem", type: "spki" }).toString();
const password = readEnvValue(current, "DEMO_AUTH_PASSWORD") ?? randomBytes(18).toString("base64url");
const keyId = readEnvValue(current, "AUTH_JWT_KEY_ID") ?? `tms-demo-${randomBytes(6).toString("hex")}`;
const issuer = readEnvValue(current, "AUTH_JWT_ISSUER") ?? "http://localhost:3000";
const serviceToken = readEnvValue(current, "RNDC_SERVICE_TOKEN")
  ?? readEnvValue(backendCurrent, "RNDC_SERVICE_TOKEN")
  ?? randomBytes(48).toString("base64url");
const jwks = buildDemoJwks(publicPem, keyId);
const values: Record<string, string> = {
  AUTH_MODE: "demo",
  DEMO_AUTH_PASSWORD: password,
  AUTH_SESSION_SECRET: readEnvValue(current, "AUTH_SESSION_SECRET") ?? randomBytes(48).toString("base64url"),
  AUTH_JWT_PRIVATE_KEY_BASE64: Buffer.from(privatePem).toString("base64"),
  AUTH_JWT_PUBLIC_KEY_BASE64: Buffer.from(publicPem).toString("base64"),
  AUTH_JWT_ISSUER: issuer,
  AUTH_JWT_AUDIENCE: "tms-demo",
  AUTH_JWT_KEY_ID: keyId,
  CONVEX_AUTH_JWKS: `data:application/json;base64,${Buffer.from(JSON.stringify(jwks)).toString("base64")}`,
  RNDC_SERVICE_TOKEN: serviceToken,
  RNDC_INGEST_KEY: readEnvValue(current, "RNDC_INGEST_KEY") ?? readEnvValue(backendCurrent, "RNDC_INGEST_KEY") ?? randomBytes(48).toString("base64url"),
  RNDC_ALLOW_TIMEOUT_SIMULATION: "true",
  NEXT_PUBLIC_ENABLE_TIMEOUT_SIMULATION: "true"
};
const next = updateEnv(current, values);
const backendNext = updateEnv(backendCurrent, {
  AUTH_MODE: "service",
  RNDC_SERVICE_TOKEN: serviceToken
});

await writeFile(envPath, next, { mode: 0o600 });
await chmod(envPath, 0o600);
await writeFile(backendEnvPath, backendNext, { mode: 0o600 });
await chmod(backendEnvPath, 0o600);
await writeFile(credentialsPath, `${JSON.stringify({ password, users: demoUsers }, null, 2)}\n`, { mode: 0o600 });
await chmod(credentialsPath, 0o600);
process.stdout.write(`Demo authentication configured in ${credentialsPath}\n`);

function updateEnv(source: string, updates: Record<string, string>): string {
  const lines = source.split(/\r?\n/).filter((line) => line.length > 0);
  const remaining = new Map(Object.entries(updates));
  const result = lines.map((line) => {
    const separator = line.indexOf("=");
    const key = separator === -1 ? line : line.slice(0, separator);
    const value = remaining.get(key);

    if (value === undefined) {
      return line;
    }

    remaining.delete(key);
    return `${key}=${value}`;
  });

  for (const [key, value] of remaining) {
    result.push(`${key}=${value}`);
  }

  return `${result.join("\n")}\n`;
}

function readEnvValue(source: string, key: string): string | undefined {
  const line = source.split(/\r?\n/).find((candidate) => candidate.startsWith(`${key}=`));
  return line?.slice(key.length + 1) || undefined;
}

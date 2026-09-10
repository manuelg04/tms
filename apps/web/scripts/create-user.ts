import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { isJobTitle, jobTitles, validatePasswordStrength } from "../convex/model/userAccounts.js";
import { hashPassword } from "../app/lib/password.js";
import { newIdentity } from "../app/lib/user-accounts.js";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    cargo: { type: "string", default: "administrador" },
    org: { type: "string", default: "transportes-mtm" },
    password: { type: "string" }
  }
});

const env = await loadEnv();
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? env.NEXT_PUBLIC_CONVEX_URL;
const serviceKey = process.env.RNDC_INGEST_KEY ?? env.RNDC_INGEST_KEY;
const password = values.password ?? process.env.USER_PASSWORD;

if (!values.email || !values.name || !password) {
  fail("Uso: npm run auth:create-user -- --email correo --name \"Nombre\" --cargo administrador|jefe_seguridad|auxiliar_seguridad [--org slug] --password clave (o USER_PASSWORD en el entorno)");
}

if (!isJobTitle(values.cargo)) {
  fail(`Cargo no válido. Opciones: ${jobTitles.join(", ")}`);
}

const weakness = validatePasswordStrength(password);
if (weakness) fail(weakness);
if (!convexUrl || !serviceKey) fail("Faltan NEXT_PUBLIC_CONVEX_URL o RNDC_INGEST_KEY en apps/web/.env.local o en el entorno");

const client = new ConvexHttpClient(convexUrl);
const userId = await client.mutation(api.userAccounts.createWithServiceKey, {
  serviceKey,
  organizationSlug: values.org,
  name: values.name,
  email: values.email,
  jobTitle: values.cargo,
  passwordHash: await hashPassword(password),
  ...newIdentity()
});

process.stdout.write(`Usuario ${values.email} (${values.cargo}) listo en ${values.org}: ${userId}\n`);

async function loadEnv(): Promise<Record<string, string>> {
  const source = await readFile(resolve(import.meta.dirname, "../.env.local"), "utf8").catch(() => "");
  const result: Record<string, string> = {};

  for (const line of source.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator > 0 && !line.startsWith("#")) {
      result[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }

  return result;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

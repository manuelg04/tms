import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import {
  parseCatalogueImport,
  sameCatalogueRecord,
} from "../app/rutas/catalogue-import";
import { createConvexToken, getAuthSettings } from "../app/lib/auth-server";
import {
  assertDevelopmentConvexTarget,
  parseEnvContent,
} from "./lib/rndc-catalog-runtime";

const args = process.argv.slice(2);
const artifactPath = args.find((arg) => !arg.startsWith("--"));
if (
  !artifactPath ||
  args.some((arg) => arg !== artifactPath && arg !== "--apply")
)
  throw new Error("Uso: ingest-avansat-routes <catálogo.json> [--apply]");
const apply = args.includes("--apply");
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const env = parseEnvContent(
  readFileSync(path.join(root, "apps/web/.env.local"), "utf8"),
);
Object.assign(process.env, env);
assertDevelopmentConvexTarget(
  env.CONVEX_DEPLOYMENT,
  env.NEXT_PUBLIC_CONVEX_URL,
);
const bytes = readFileSync(path.resolve(artifactPath));
if (bytes.length > 25 * 1024 * 1024)
  throw new Error("El catálogo supera 25 MB.");
const input = parseCatalogueImport(bytes.toString("utf8"));
const client = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);
const serviceKey = env.RNDC_SERVICE_KEY ?? env.RNDC_INGEST_KEY;
if (!serviceKey) throw new Error("Falta la clave de servicio existente.");
const organizationId = await client.query(anyApi.fleet.organizationBySlug, {
  ingestKey: env.RNDC_INGEST_KEY,
  slug: "transportes-mtm",
});
if (!organizationId)
  throw new Error("Transportes MTM no existe en el destino configurado.");
const account = await client.query(anyApi.userAccounts.credentialsByEmail, {
  serviceKey,
  email: "admin@mtm.local",
});
if (
  !account ||
  account.status !== "active" ||
  account.organizationStatus !== "active" ||
  !account.roles.includes("admin")
)
  throw new Error("El administrador existente no está disponible.");
const user = {
  id: account.authSubject,
  email: account.email,
  name: account.name,
  role: "admin" as const,
};
const settings = getAuthSettings();
let authenticatedAt = 0;
function authenticate() {
  if (Date.now() - authenticatedAt < 60000) return;
  client.setAuth(createConvexToken(user, settings));
  authenticatedAt = Date.now();
}
authenticate();
const actor = await client.query(anyApi.access.me, {});
if (actor.organizationId !== organizationId)
  throw new Error(
    "La organización del administrador no corresponde a Transportes MTM.",
  );
const current = await client.query(anyApi.routes.catalogue, {});
const report = {
  startedAt: new Date().toISOString(),
  deployment: env.CONVEX_DEPLOYMENT,
  organizationId,
  mode: apply ? "apply" : "dry-run",
  sourceSha256: createHash("sha256").update(bytes).digest("hex"),
  expectedPoints: input.points.length,
  expectedRoutes: input.routes.length,
  points: { inserted: 0, updated: 0, unchanged: 0 },
  routes: { inserted: 0, updated: 0, unchanged: 0 },
  verified: false,
  error: "",
};
const reportDir = path.join(
  root,
  "local/rndc-avansat/2026-09-29/catalogo-completo/receipts",
);
mkdirSync(reportDir, { recursive: true, mode: 0o700 });
const reportPath = path.join(
  reportDir,
  `${report.startedAt.replace(/[:.]/g, "-")}-${report.mode}.json`,
);
function saveReport() {
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  });
}
async function ingest(kind: "points" | "routes") {
  const existing = new Map<string, Record<string, unknown>>(
    current[kind].map((r: Record<string, unknown>) => [String(r.code), r]),
  );
  const pending = input[kind].filter((record) => {
    const old = existing.get(record.code);
    if (old && old.source !== "avansat")
      throw new Error(
        `El código ${record.code} de ${kind} pertenece al TMS; requiere resolver el conflicto.`,
      );
    if (old && sameCatalogueRecord(old, record)) {
      report[kind].unchanged++;
      return false;
    }
    return true;
  });
  let cursor = 0;
  let failure: unknown;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < pending.length && !failure) {
        const record = pending[cursor++];
        const old = existing.get(record.code);
        try {
          if (apply) {
            authenticate();
            await client.mutation(
              kind === "points"
                ? anyApi.routes.savePoint
                : anyApi.routes.saveRoute,
              {
                ...record,
                source: "avansat",
                expectedRevision: old?.revision ?? 0,
              },
              { skipQueue: true },
            );
          }
          report[kind][old ? "updated" : "inserted"]++;
          if ((report[kind].inserted + report[kind].updated) % 100 === 0) {
            saveReport();
            console.log(
              `${kind}: ${report[kind].inserted + report[kind].updated}/${pending.length}`,
            );
          }
        } catch (error) {
          failure = error;
        }
      }
    }),
  );
  saveReport();
  if (failure) throw failure;
}
try {
  await ingest("points");
  await ingest("routes");
  if (apply) {
    authenticate();
    const stored = await client.query(anyApi.routes.catalogue, {});
    for (const kind of ["points", "routes"] as const) {
      const records = new Map<string, Record<string, unknown>>(
        stored[kind].map((r: Record<string, unknown>) => [String(r.code), r]),
      );
      for (const record of input[kind]) {
        const saved = records.get(record.code);
        if (
          !saved ||
          saved.source !== "avansat" ||
          !sameCatalogueRecord(saved, record)
        )
          throw new Error(`No coincide la lectura de ${kind}: ${record.code}`);
      }
    }
    report.verified = true;
  }
  saveReport();
  console.log(JSON.stringify({ ...report, reportPath }));
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  saveReport();
  console.error(
    `Carga incompleta. Revisa ${reportPath}; el mismo archivo permite continuar sin duplicar.`,
  );
  process.exitCode = 1;
}

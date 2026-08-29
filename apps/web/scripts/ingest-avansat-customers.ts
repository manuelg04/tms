import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { assertDevelopmentConvexTarget, parseEnvContent } from "./lib/rndc-catalog-runtime.js";
import {
  certifyAvansatCustomerArtifact,
  chunkAvansatCustomers,
  deterministicAvansatCustomerRunId,
  hashAvansatCustomerBatch,
  verifyAvansatCustomerReadback,
  type AvansatCustomerArtifact,
  type AvansatCustomerReadback,
  type PreparedAvansatCustomer
} from "./lib/avansat-customers.js";

const EXPECTED_TOTAL = 490;
const BATCH_SIZE = 50;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const DEFAULT_ORGANIZATION_SLUG = "transportes-mtm";

type ImportTotals = {
  batchesApplied: number;
  customersInserted: number;
  customersUpdated: number;
  customersUnchanged: number;
  locationsInserted: number;
  locationsUpdated: number;
  locationsUnchanged: number;
  snapshotsInserted: number;
};

type ImportRun = {
  status: "running" | "completed" | "failed";
  totals: ImportTotals;
};

type VerificationPage = {
  items: AvansatCustomerReadback[];
  nextCursor: string | null;
  done: boolean;
};

function parseArgs(argv: string[]): { artifactPath: string; apply: boolean; recover: boolean; organizationSlug: string } {
  let artifactPath = "";
  let apply = false;
  let recover = false;
  let organizationSlug = DEFAULT_ORGANIZATION_SLUG;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--apply") apply = true;
    else if (arg === "--recover") recover = true;
    else if (arg === "--org") organizationSlug = argv[++index] ?? "";
    else if (!arg.startsWith("--") && !artifactPath) artifactPath = arg;
    else throw new Error(`Argumento no reconocido: ${arg}`);
  }
  if (!artifactPath) throw new Error("Uso: npm run ingest:avansat-customers -- <extraccion.json> [--apply] [--recover] [--org slug]");
  if (!organizationSlug.trim()) throw new Error("La organización no puede estar vacía");
  if (recover && !apply) throw new Error("La recuperación solo está disponible junto con --apply");
  return { artifactPath, apply, recover, organizationSlug: organizationSlug.trim().toLowerCase() };
}

function readArtifact(filePath: string): { resolvedPath: string; artifact: AvansatCustomerArtifact; fileHash: string } {
  const resolvedPath = path.resolve(filePath);
  const stat = lstatSync(resolvedPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("La extracción debe ser un archivo regular, no un enlace");
  if (stat.size < 1 || stat.size > MAX_FILE_BYTES) throw new Error("La extracción está vacía o supera el límite seguro de 25 MB");
  const bytes = readFileSync(resolvedPath);
  let artifact: AvansatCustomerArtifact;
  try {
    artifact = JSON.parse(bytes.toString("utf8")) as AvansatCustomerArtifact;
  } catch {
    throw new Error("La extracción no contiene JSON válido");
  }
  return { resolvedPath, artifact, fileHash: createHash("sha256").update(bytes).digest("hex") };
}

function emptyTotals(): ImportTotals {
  return {
    batchesApplied: 0,
    customersInserted: 0,
    customersUpdated: 0,
    customersUnchanged: 0,
    locationsInserted: 0,
    locationsUpdated: 0,
    locationsUnchanged: 0,
    snapshotsInserted: 0
  };
}

function addTotals(target: ImportTotals, incoming: ImportTotals): void {
  for (const key of Object.keys(target) as Array<keyof ImportTotals>) target[key] += incoming[key];
}

function totalsEqual(left: ImportTotals, right: ImportTotals): boolean {
  return (Object.keys(left) as Array<keyof ImportTotals>).every((key) => left[key] === right[key]);
}

function batchPayload(rows: PreparedAvansatCustomer[]) {
  return rows.map((row) => ({
    customer: row.customer,
    location: row.location,
    capturedAt: row.capturedAt,
    contentHash: row.contentHash,
    sourceJson: row.sourceJson
  }));
}

async function readCustomers(
  client: ConvexHttpClient,
  ingestKey: string,
  organizationId: string
): Promise<AvansatCustomerReadback[]> {
  const items: AvansatCustomerReadback[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  while (true) {
    const page = await client.query(anyApi.avansatCustomers.verificationPage, {
      ingestKey,
      organizationId,
      cursor,
      limit: 200
    }) as VerificationPage;
    items.push(...page.items);
    if (page.done) return items;
    if (!page.nextCursor || cursors.has(page.nextCursor)) throw new Error("La paginación de verificación de clientes no avanzó");
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

function readEnv(filePath: string): Record<string, string> {
  try {
    return parseEnvContent(readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function writeReport(reportDir: string, timestamp: string, report: unknown): string {
  mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${timestamp}-clientes-avansat.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return reportPath;
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const timestamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const repoRoot = path.resolve(webRoot, "../..");
  const reportDir = path.join(repoRoot, "output", "ingesta");
  const options = parseArgs(process.argv.slice(2));
  const source = readArtifact(options.artifactPath);
  if (source.artifact.expectedTotal !== EXPECTED_TOTAL) {
    throw new Error(`La extracción debe declarar exactamente ${EXPECTED_TOTAL} clientes`);
  }
  const certified = certifyAvansatCustomerArtifact(source.artifact);
  const batches = chunkAvansatCustomers(certified.rows, BATCH_SIZE);
  const batchHashes = batches.map((rows, batchIndex) => hashAvansatCustomerBatch(batchIndex, rows));
  const runFingerprint = createHash("sha256")
    .update(`${certified.manifestHash}\u0000${source.artifact.capturedAt}`)
    .digest("hex");
  const originalClientRunId = deterministicAvansatCustomerRunId(runFingerprint);
  const baseReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    mode: options.apply ? "apply" : "dry-run",
    organizationSlug: options.organizationSlug,
    source: { fileName: path.basename(source.resolvedPath), sha256: source.fileHash },
    capturedAt: source.artifact.capturedAt,
    manifestHash: certified.manifestHash,
    clientRunId: originalClientRunId,
    stats: certified.stats,
    batchCount: batches.length
  };

  console.log(`Extracción certificada: ${certified.stats.total} clientes únicos en ${batches.length} lotes.`);
  console.log(`Activos: ${certified.stats.active} · Inactivos: ${certified.stats.inactive} · Con correo: ${certified.stats.withEmail} · Con sede: ${certified.stats.withLocation}`);
  if (!options.apply) {
    const reportPath = writeReport(reportDir, timestamp, { ...baseReport, target: "local-only", status: "validated", finishedAt: new Date().toISOString() });
    console.log("Simulación terminada: no se escribió nada en Convex.");
    console.log(`Reporte: ${reportPath}`);
    return;
  }

  const webEnv = readEnv(path.join(webRoot, ".env.local"));
  const rootEnv = readEnv(path.join(repoRoot, ".env"));
  const deployment = process.env.CONVEX_DEPLOYMENT ?? webEnv.CONVEX_DEPLOYMENT ?? rootEnv.CONVEX_DEPLOYMENT ?? "";
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL ?? webEnv.NEXT_PUBLIC_CONVEX_URL ?? rootEnv.CONVEX_URL ?? "";
  const ingestKey = process.env.RNDC_INGEST_KEY ?? webEnv.RNDC_INGEST_KEY ?? rootEnv.RNDC_INGEST_KEY ?? "";
  if (!deployment || !convexUrl || !ingestKey) throw new Error("Falta la configuración local requerida para la ingesta de desarrollo");
  assertDevelopmentConvexTarget(deployment, convexUrl);

  const client = new ConvexHttpClient(convexUrl);
  const organizationId = await client.query(anyApi.fleet.organizationBySlug, { ingestKey, slug: options.organizationSlug }) as string | null;
  if (!organizationId) throw new Error(`No existe la organización ${options.organizationSlug} en Convex desarrollo`);
  let clientRunId = originalClientRunId;
  let begin = await client.mutation(anyApi.avansatCustomers.beginImport, {
    ingestKey,
    organizationId,
    clientRunId,
    manifestHash: certified.manifestHash,
    capturedAt: source.artifact.capturedAt,
    expectedTotal: certified.rows.length,
    batchCount: batches.length
  }) as { importRunId: string; status: ImportRun["status"]; replayed: boolean };
  let supersededImportRunId: string | undefined;
  if (options.recover && begin.status !== "completed") {
    supersededImportRunId = begin.importRunId;
    if (begin.status === "running") {
      await client.mutation(anyApi.avansatCustomers.failImport, { ingestKey, importRunId: begin.importRunId });
    }
    const recoveryFingerprint = createHash("sha256").update(`${runFingerprint}\u0000recovery-1`).digest("hex");
    clientRunId = deterministicAvansatCustomerRunId(recoveryFingerprint);
    begin = await client.mutation(anyApi.avansatCustomers.beginImport, {
      ingestKey,
      organizationId,
      clientRunId,
      manifestHash: certified.manifestHash,
      capturedAt: source.artifact.capturedAt,
      expectedTotal: certified.rows.length,
      batchCount: batches.length
    }) as { importRunId: string; status: ImportRun["status"]; replayed: boolean };
  }
  if (begin.status === "failed") throw new Error("La corrida certificada está marcada como fallida y requiere revisión");

  const totals = emptyTotals();
  let replayedBatches = 0;
  if (begin.status === "running") {
    for (const [batchIndex, rows] of batches.entries()) {
      const result = await client.mutation(anyApi.avansatCustomers.upsertBatch, {
        ingestKey,
        importRunId: begin.importRunId,
        batchIndex,
        batchHash: batchHashes[batchIndex],
        rows: batchPayload(rows)
      }) as ImportTotals & { replayed: boolean };
      if (result.customersInserted + result.customersUpdated + result.customersUnchanged !== rows.length) {
        throw new Error(`La confirmación del lote ${batchIndex + 1} no coincide con las filas enviadas`);
      }
      if (result.replayed) replayedBatches += 1;
      addTotals(totals, result);
      console.log(`Lote ${batchIndex + 1}/${batches.length} confirmado.`);
    }
  }

  const stored = await readCustomers(client, ingestKey, organizationId);
  const readback = verifyAvansatCustomerReadback(certified.rows, stored);
  await client.mutation(anyApi.avansatCustomers.completeImport, { ingestKey, importRunId: begin.importRunId });
  const run = await client.query(anyApi.avansatCustomers.getImport, { ingestKey, importRunId: begin.importRunId }) as ImportRun | null;
  if (!run || run.status !== "completed") throw new Error("Convex no confirmó la certificación final de la ingesta");
  if (begin.status === "running" && !totalsEqual(run.totals, totals)) throw new Error("Los totales finales no coinciden con las confirmaciones de lotes");

  const reportPath = writeReport(reportDir, timestamp, {
    ...baseReport,
    target: { environment: "development", deployment },
    status: "completed",
    clientRunId,
    importRunId: begin.importRunId,
    supersededImportRunId,
    resumed: begin.replayed,
    replayedBatches,
    totals: run.totals,
    readback,
    finishedAt: new Date().toISOString()
  });
  console.log(begin.status === "completed"
    ? "La misma ingesta ya estaba certificada; se verificó sin volver a escribir lotes."
    : "Ingesta completada y verificada en Convex desarrollo.");
  console.log(`Reporte: ${reportPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "La ingesta terminó con un error desconocido";
  console.error(message.replace(/https?:\/\/\S+/g, "[URL]").replace(/\/Users\/[^/\s]+/g, "[USER_HOME]"));
  process.exit(1);
});

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { parseRndcDivisionMaestro } from "./lib/rndc-division-maestro.js";

const BATCH_SIZE = 100;

type Options = { filePath: string; dryRun: boolean };

function parseArgs(argv: string[]): Options {
  const options: Options = { filePath: "", dryRun: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (!options.filePath) {
      options.filePath = arg;
    }
  }
  if (!options.filePath) {
    console.error("Uso: npm run ingest:rndc-divisions -- <Maestro_División Política Administrativa_RNDC.xls> [--dry-run]");
    process.exit(1);
  }
  return options;
}

function parseEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) {
      env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

function readEnvFile(filePath: string): Record<string, string> {
  try {
    return parseEnv(readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function toCsvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const repoRoot = path.resolve(webRoot, "../..");
  const today = new Date().toISOString().slice(0, 10);

  const parsed = parseRndcDivisionMaestro(readFileSync(options.filePath, "latin1"), today);
  const { stats } = parsed;
  console.log(`Archivo: ${path.resolve(options.filePath)}`);
  console.log(`Filas leídas: ${stats.rows} · Divisiones únicas: ${parsed.divisions.length}`);
  console.log(`  Municipios: ${stats.municipalities} · Zonas/corregimientos: ${stats.zones} · Departamentos: ${stats.departments}`);
  console.log(`  Con coordenadas: ${stats.withCoordinates}`);
  console.log(`Filas rechazadas o duplicadas: ${parsed.rejected.length}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = path.join(repoRoot, "output", "ingesta");
  mkdirSync(reportDir, { recursive: true });
  if (parsed.rejected.length > 0) {
    const rejectedPath = path.join(reportDir, `${timestamp}-divisiones-rechazados.csv`);
    const lines = parsed.rejected.map((row) => [String(row.line), row.code, row.reason].map(toCsvField).join(","));
    writeFileSync(rejectedPath, ["line,code,reason", ...lines].join("\n") + "\n", "utf8");
    console.log(`Rechazados: ${rejectedPath}`);
  }

  if (options.dryRun) {
    const samplePath = path.join(reportDir, `${timestamp}-divisiones-muestra.json`);
    writeFileSync(samplePath, JSON.stringify(parsed.divisions.slice(0, 3), null, 2) + "\n", "utf8");
    console.log(`Muestra: ${samplePath}`);
    console.log("Dry run: no se envió nada a Convex.");
    return;
  }

  const webEnv = readEnvFile(path.join(webRoot, ".env.local"));
  const backendEnv = readEnvFile(path.join(repoRoot, ".env"));
  const convexUrl = process.env.CONVEX_URL ?? webEnv.NEXT_PUBLIC_CONVEX_URL ?? backendEnv.CONVEX_URL;
  const ingestKey = process.env.RNDC_INGEST_KEY ?? webEnv.RNDC_INGEST_KEY ?? backendEnv.RNDC_INGEST_KEY;
  if (!convexUrl || !ingestKey) {
    console.error("Faltan NEXT_PUBLIC_CONVEX_URL y/o RNDC_INGEST_KEY (apps/web/.env.local o .env raíz).");
    process.exit(1);
  }

  const client = new ConvexHttpClient(convexUrl);
  const totals = { inserted: 0, updated: 0 };
  for (const batch of chunk(parsed.divisions, BATCH_SIZE)) {
    const result = await client.mutation(anyApi.lookups.upsertDivisionBatch, { ingestKey, divisions: batch });
    totals.inserted += result.inserted;
    totals.updated += result.updated;
  }

  const summaryPath = path.join(reportDir, `${timestamp}-divisiones-resumen.json`);
  writeFileSync(summaryPath, JSON.stringify({ filePath: path.resolve(options.filePath), finishedAt: new Date().toISOString(), stats, rejected: parsed.rejected.length, totals }, null, 2) + "\n", "utf8");
  console.log(`Divisiones: ${totals.inserted} nuevos, ${totals.updated} actualizados`);
  console.log(`Resumen: ${summaryPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

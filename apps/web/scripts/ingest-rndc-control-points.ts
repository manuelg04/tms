import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { parseRndcControlPointMaestro } from "./lib/rndc-control-point-maestro.js";

const BATCH_SIZE = 100;
const DEFAULT_ORGANIZATION_SLUG = "transportes-mtm";

type Options = { filePath: string; dryRun: boolean; organizationSlug: string };

function parseArgs(argv: string[]): Options {
  const options: Options = { filePath: "", dryRun: false, organizationSlug: DEFAULT_ORGANIZATION_SLUG };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--org") {
      options.organizationSlug = argv[++index] ?? options.organizationSlug;
    } else if (!options.filePath) {
      options.filePath = arg;
    }
  }
  if (!options.filePath) {
    console.error("Uso: npm run ingest:rndc-control-points -- <Maestro_Puesto de Control_RNDC.xls> [--dry-run] [--org slug]");
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

  const parsed = parseRndcControlPointMaestro(readFileSync(options.filePath, "latin1"), today);
  const { stats } = parsed;
  console.log(`Archivo: ${path.resolve(options.filePath)}`);
  console.log(`Filas leídas: ${stats.rows} · Puestos únicos: ${parsed.controlPoints.length}`);
  console.log(`  Básculas: ${stats.byType.bascula} · Fijos: ${stats.byType.fijo} · Alternos: ${stats.byType.alterno} · Otros: ${stats.byType.otro}`);
  console.log(`  Activos: ${stats.byStatus.activo} · Inactivos: ${stats.byStatus.inactivo} · Sin estado: ${stats.byStatus.sin_estado}`);
  console.log(`  Calibración vigente: ${stats.calibrationValid} · vencida: ${stats.calibrationExpired}`);
  console.log(`  Con coordenadas: ${stats.withCoordinates} (corregidas por venir invertidas: ${stats.swappedCoordinates})`);
  console.log(`Filas rechazadas o duplicadas: ${parsed.rejected.length}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = path.join(repoRoot, "output", "ingesta");
  mkdirSync(reportDir, { recursive: true });
  if (parsed.rejected.length > 0) {
    const rejectedPath = path.join(reportDir, `${timestamp}-puestos-control-rechazados.csv`);
    const lines = parsed.rejected.map((row) => [String(row.line), row.code, row.reason].map(toCsvField).join(","));
    writeFileSync(rejectedPath, ["line,code,reason", ...lines].join("\n") + "\n", "utf8");
    console.log(`Rechazados: ${rejectedPath}`);
  }

  if (options.dryRun) {
    const samplePath = path.join(reportDir, `${timestamp}-puestos-control-muestra.json`);
    writeFileSync(samplePath, JSON.stringify(parsed.controlPoints.slice(0, 3), null, 2) + "\n", "utf8");
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
  const organizationId = await client.query(anyApi.fleet.organizationBySlug, { ingestKey, slug: options.organizationSlug });
  if (!organizationId) {
    console.error(`No existe la organización "${options.organizationSlug}" en Convex.`);
    process.exit(1);
  }

  const totals = { inserted: 0, updated: 0 };
  for (const batch of chunk(parsed.controlPoints, BATCH_SIZE)) {
    const result = await client.mutation(anyApi.fleet.upsertControlPointBatch, { ingestKey, organizationId, controlPoints: batch });
    totals.inserted += result.inserted;
    totals.updated += result.updated;
  }

  const summaryPath = path.join(reportDir, `${timestamp}-puestos-control-resumen.json`);
  writeFileSync(summaryPath, JSON.stringify({ filePath: path.resolve(options.filePath), finishedAt: new Date().toISOString(), organizationSlug: options.organizationSlug, stats, rejected: parsed.rejected.length, totals }, null, 2) + "\n", "utf8");
  console.log(`Puestos de control: ${totals.inserted} nuevos, ${totals.updated} actualizados`);
  console.log(`Resumen: ${summaryPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

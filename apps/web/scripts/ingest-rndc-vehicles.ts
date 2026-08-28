import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { parseRndcVehicleMaestro, type RndcVehicleInput } from "./lib/rndc-vehicle-maestro.js";

const BATCH_SIZE = 200;
const DEFAULT_ORGANIZATION_SLUG = "transportes-mtm";

type Options = {
  filePath: string;
  dryRun: boolean;
  organizationSlug: string;
  onlyActive: boolean;
};

function parseArgs(argv: string[]): Options {
  const options: Options = { filePath: "", dryRun: false, organizationSlug: DEFAULT_ORGANIZATION_SLUG, onlyActive: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--only-active") {
      options.onlyActive = true;
    } else if (arg === "--org") {
      options.organizationSlug = argv[++index] ?? options.organizationSlug;
    } else if (!options.filePath) {
      options.filePath = arg;
    }
  }
  if (!options.filePath) {
    console.error("Uso: npm run ingest:rndc-vehicles -- <Maestro_Vehículo_RNDC.xls> [--dry-run] [--only-active] [--org slug]");
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

  const text = readFileSync(options.filePath, "latin1");
  const parsed = parseRndcVehicleMaestro(text, today);
  const vehicles = options.onlyActive ? parsed.vehicles.filter((vehicle) => vehicle.status === "activo") : parsed.vehicles;

  console.log(`Archivo: ${path.resolve(options.filePath)}`);
  console.log(`Filas leídas: ${parsed.stats.rows}`);
  console.log(`Vehículos válidos: ${parsed.vehicles.length} (a cargar: ${vehicles.length})`);
  console.log(`  Cabezotes: ${parsed.stats.byKind.cabezote} · Rígidos: ${parsed.stats.byKind.rigido} · Remolques: ${parsed.stats.byKind.remolque} · Otros: ${parsed.stats.byKind.otro}`);
  console.log(`  Activos: ${parsed.stats.byStatus.activo} · Archivados: ${parsed.stats.byStatus.archivado}`);
  console.log(`  Sin tenedor: ${parsed.stats.missingPossessor}`);
  console.log(`Filas rechazadas: ${parsed.rejected.length}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = path.join(repoRoot, "output", "ingesta");
  mkdirSync(reportDir, { recursive: true });

  if (parsed.rejected.length > 0) {
    const rejectedPath = path.join(reportDir, `${timestamp}-vehiculos-rechazados.csv`);
    const lines = parsed.rejected.map((row) => [String(row.line), row.plate, row.reason].map(toCsvField).join(","));
    writeFileSync(rejectedPath, ["line,plate,reason", ...lines].join("\n") + "\n", "utf8");
    console.log(`Rechazados: ${rejectedPath}`);
  }

  if (options.dryRun) {
    const samplePath = path.join(reportDir, `${timestamp}-vehiculos-muestra.json`);
    writeFileSync(samplePath, JSON.stringify(vehicles.slice(0, 5), null, 2) + "\n", "utf8");
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

  const totals = { vehiclesInserted: 0, vehiclesUpdated: 0 };
  const batches = chunk(vehicles, BATCH_SIZE);
  for (const [index, batch] of batches.entries()) {
    const result = await client.mutation(anyApi.fleet.upsertFleetBatch, {
      ingestKey,
      organizationId,
      drivers: [],
      vehicles: batch as RndcVehicleInput[],
      relations: []
    });
    totals.vehiclesInserted += result.vehiclesInserted;
    totals.vehiclesUpdated += result.vehiclesUpdated;
    if ((index + 1) % 10 === 0 || index + 1 === batches.length) {
      console.log(`Lotes enviados: ${index + 1}/${batches.length}`);
    }
  }

  const summary = {
    filePath: path.resolve(options.filePath),
    finishedAt: new Date().toISOString(),
    organizationSlug: options.organizationSlug,
    onlyActive: options.onlyActive,
    stats: parsed.stats,
    rejected: parsed.rejected.length,
    totals
  };
  const summaryPath = path.join(reportDir, `${timestamp}-vehiculos-resumen.json`);
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

  console.log(`Vehículos: ${totals.vehiclesInserted} nuevos, ${totals.vehiclesUpdated} actualizados`);
  console.log(`Resumen: ${summaryPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

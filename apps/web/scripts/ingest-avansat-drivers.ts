import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { buildCityIndex, parseAvansatDrivers } from "./lib/avansat-drivers.js";
import { parseRndcDivisionMaestro } from "./lib/rndc-division-maestro.js";

const BATCH_SIZE = 100;
const DEFAULT_ORGANIZATION_SLUG = "transportes-mtm";
const DIVISIONS_FILE = "Maestro_División Política Administrativa_RNDC.xls";

type Options = {
  filePaths: string[];
  divisionsPath?: string;
  skipPath?: string;
  dryRun: boolean;
  organizationSlug: string;
};

function parseArgs(argv: string[]): Options {
  const options: Options = { filePaths: [], dryRun: false, organizationSlug: DEFAULT_ORGANIZATION_SLUG };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--org") {
      options.organizationSlug = argv[++index] ?? options.organizationSlug;
    } else if (arg === "--divisions") {
      options.divisionsPath = argv[++index];
    } else if (arg === "--skip") {
      options.skipPath = argv[++index];
    } else {
      options.filePaths.push(arg);
    }
  }
  if (options.filePaths.length === 0) {
    console.error(`Uso: npm run ingest:avansat-drivers -- <Excel_Conductores_Mes.xls> [más archivos] [--divisions "${DIVISIONS_FILE}"] [--skip cedulas.txt] [--dry-run] [--org slug]`);
    process.exit(1);
  }
  if (!options.divisionsPath) {
    const sibling = path.join(path.dirname(options.filePaths[0]), DIVISIONS_FILE);
    if (existsSync(sibling)) {
      options.divisionsPath = sibling;
    }
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

  const cities = options.divisionsPath
    ? buildCityIndex(parseRndcDivisionMaestro(readFileSync(options.divisionsPath, "latin1"), today).divisions)
    : undefined;
  const parsed = parseAvansatDrivers(
    options.filePaths.map((filePath) => ({ name: path.basename(filePath), text: readFileSync(filePath, "latin1") })),
    { today, cities }
  );

  if (options.skipPath) {
    const skipped = new Set(readFileSync(options.skipPath, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    const before = parsed.drivers.length;
    parsed.drivers = parsed.drivers.filter((driver) => !skipped.has(driver.document));
    console.log(`Omitidos por --skip: ${before - parsed.drivers.length} · Quedan para cargar: ${parsed.drivers.length}`);
  }

  console.log(`Archivos: ${options.filePaths.map((filePath) => path.basename(filePath)).join(", ")}`);
  console.log(cities ? `Municipios tomados de: ${path.resolve(options.divisionsPath!)}` : "Sin maestro de municipios: los conductores quedan sin código de ciudad.");
  console.log(`Filas leídas: ${parsed.stats.rows} · Conductores únicos: ${parsed.stats.drivers} · Repetidos entre archivos: ${parsed.stats.duplicates}`);
  console.log(`Creados en Avansat entre ${parsed.stats.createdFrom ?? "?"} y ${parsed.stats.createdTo ?? "?"}`);
  console.log(`Con código de ciudad: ${parsed.stats.withCityCode} · Con categoría de licencia: ${parsed.stats.withLicenseCategory} · Licencia vigente: ${parsed.stats.withValidLicense}`);
  console.log(`Por categoría: ${JSON.stringify(parsed.stats.byLicenseCategory)}`);
  console.log(`Filas rechazadas: ${parsed.rejected.length} · Avisos: ${parsed.warnings.length}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = path.join(repoRoot, "output", "ingesta");
  mkdirSync(reportDir, { recursive: true });

  if (parsed.rejected.length > 0) {
    const rejectedPath = path.join(reportDir, `${timestamp}-conductores-avansat-rechazados.csv`);
    const lines = parsed.rejected.map((row) => [row.file, String(row.line), row.document, row.reason].map(toCsvField).join(","));
    writeFileSync(rejectedPath, ["file,line,document,reason", ...lines].join("\n") + "\n", "utf8");
    console.log(`Rechazados: ${rejectedPath}`);
  }
  if (parsed.warnings.length > 0) {
    const warningsPath = path.join(reportDir, `${timestamp}-conductores-avansat-avisos.csv`);
    const lines = parsed.warnings.map((row) => [row.document, row.field, row.value, row.reason].map(toCsvField).join(","));
    writeFileSync(warningsPath, ["document,field,value,reason", ...lines].join("\n") + "\n", "utf8");
    console.log(`Avisos: ${warningsPath}`);
    const byReason: Record<string, number> = {};
    for (const warning of parsed.warnings) {
      const key = `${warning.reason}: ${warning.value}`;
      byReason[key] = (byReason[key] ?? 0) + 1;
    }
    for (const [key, count] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count} × ${key}`);
    }
  }

  if (options.dryRun) {
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

  const totals = { driversInserted: 0, driversUpdated: 0 };
  for (const batch of chunk(parsed.drivers, BATCH_SIZE)) {
    const result = await client.mutation(anyApi.fleet.upsertFleetBatch, { ingestKey, organizationId, drivers: batch, vehicles: [], relations: [] });
    totals.driversInserted += result.driversInserted;
    totals.driversUpdated += result.driversUpdated;
  }

  const summaryPath = path.join(reportDir, `${timestamp}-conductores-avansat-resumen.json`);
  writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        files: options.filePaths.map((filePath) => path.resolve(filePath)),
        finishedAt: new Date().toISOString(),
        organizationSlug: options.organizationSlug,
        stats: parsed.stats,
        rejected: parsed.rejected.length,
        warnings: parsed.warnings.length,
        documents: parsed.drivers.map((driver) => driver.document),
        totals
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(`Conductores: ${totals.driversInserted} nuevos, ${totals.driversUpdated} actualizados`);
  console.log(`Resumen: ${summaryPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

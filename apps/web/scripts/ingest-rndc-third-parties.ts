import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { collectVehicleParties, parseRndcThirdPartyMaestro } from "./lib/rndc-third-party-maestro.js";

const BATCH_SIZE = 200;
const DEFAULT_ORGANIZATION_SLUG = "transportes-mtm";

type Options = {
  filePath: string;
  vehiclesPath?: string;
  dryRun: boolean;
  organizationSlug: string;
};

function parseArgs(argv: string[]): Options {
  const options: Options = { filePath: "", dryRun: false, organizationSlug: DEFAULT_ORGANIZATION_SLUG };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--org") {
      options.organizationSlug = argv[++index] ?? options.organizationSlug;
    } else if (arg === "--vehicles") {
      options.vehiclesPath = argv[++index];
    } else if (!options.filePath) {
      options.filePath = arg;
    }
  }
  if (!options.filePath) {
    console.error("Uso: npm run ingest:rndc-third-parties -- <Maestro_Tercero_RNDC.xls> [--vehicles Maestro_Vehículo_RNDC.xls] [--dry-run] [--org slug]");
    process.exit(1);
  }
  if (!options.vehiclesPath) {
    const sibling = path.join(path.dirname(options.filePath), "Maestro_Vehículo_RNDC.xls");
    if (existsSync(sibling)) {
      options.vehiclesPath = sibling;
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

  const vehicleParties = options.vehiclesPath ? collectVehicleParties(readFileSync(options.vehiclesPath, "latin1")) : undefined;
  const parsed = parseRndcThirdPartyMaestro(readFileSync(options.filePath, "latin1"), {
    today,
    ownerDocuments: vehicleParties?.owners,
    possessorDocuments: vehicleParties?.possessors
  });

  console.log(`Archivo: ${path.resolve(options.filePath)}`);
  console.log(options.vehiclesPath ? `Roles propietario/tenedor tomados de: ${path.resolve(options.vehiclesPath)}` : "Sin maestro de vehículos: no se infieren roles propietario/tenedor.");
  console.log(`Filas leídas: ${parsed.stats.rows}`);
  console.log(`Terceros únicos: ${parsed.stats.parties} · Sedes: ${parsed.stats.sites} · Con más de una sede: ${parsed.stats.multiSiteParties}`);
  console.log(`Conductores (con categoría de licencia): ${parsed.stats.drivers} · Licencia vigente: ${parsed.stats.driversWithValidLicense}`);
  console.log(`Por tipo de identificación: ${JSON.stringify(parsed.stats.byDocumentType)}`);
  console.log(`Por rol: ${JSON.stringify(parsed.stats.byRole)}`);
  console.log(`Filas rechazadas: ${parsed.rejected.length}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = path.join(repoRoot, "output", "ingesta");
  mkdirSync(reportDir, { recursive: true });

  if (parsed.rejected.length > 0) {
    const rejectedPath = path.join(reportDir, `${timestamp}-terceros-rechazados.csv`);
    const lines = parsed.rejected.map((row) => [String(row.line), row.document, row.reason].map(toCsvField).join(","));
    writeFileSync(rejectedPath, ["line,document,reason", ...lines].join("\n") + "\n", "utf8");
    console.log(`Rechazados: ${rejectedPath}`);
  }

  if (options.dryRun) {
    const samplePath = path.join(reportDir, `${timestamp}-terceros-muestra.json`);
    const multiSite = parsed.parties.find((party) => party.siteCount > 1);
    writeFileSync(
      samplePath,
      JSON.stringify(
        {
          drivers: parsed.drivers.slice(0, 2),
          parties: parsed.parties.slice(0, 2),
          multiSite: multiSite ? { party: multiSite, sites: parsed.sites.filter((site) => site.document === multiSite.document) } : null
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
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

  const totals = { driversInserted: 0, driversUpdated: 0, partiesInserted: 0, partiesUpdated: 0, sitesInserted: 0, sitesUpdated: 0, sitesSkipped: 0 };
  const driverBatches = chunk(parsed.drivers, BATCH_SIZE);
  const partyBatches = chunk(parsed.parties, BATCH_SIZE);
  const siteBatches = chunk(parsed.sites, BATCH_SIZE);
  const totalBatches = driverBatches.length + partyBatches.length + siteBatches.length;
  let sent = 0;
  const progress = () => {
    sent += 1;
    if (sent % 10 === 0 || sent === totalBatches) {
      console.log(`Lotes enviados: ${sent}/${totalBatches}`);
    }
  };

  for (const batch of driverBatches) {
    const result = await client.mutation(anyApi.fleet.upsertFleetBatch, { ingestKey, organizationId, drivers: batch, vehicles: [], relations: [] });
    totals.driversInserted += result.driversInserted;
    totals.driversUpdated += result.driversUpdated;
    progress();
  }
  for (const batch of partyBatches) {
    const result = await client.mutation(anyApi.fleet.upsertThirdPartyBatch, { ingestKey, organizationId, parties: batch, sites: [] });
    totals.partiesInserted += result.partiesInserted;
    totals.partiesUpdated += result.partiesUpdated;
    progress();
  }
  for (const batch of siteBatches) {
    const result = await client.mutation(anyApi.fleet.upsertThirdPartyBatch, { ingestKey, organizationId, parties: [], sites: batch });
    totals.sitesInserted += result.sitesInserted;
    totals.sitesUpdated += result.sitesUpdated;
    totals.sitesSkipped += result.sitesSkipped.length;
    progress();
  }

  const summary = {
    filePath: path.resolve(options.filePath),
    vehiclesPath: options.vehiclesPath ? path.resolve(options.vehiclesPath) : null,
    finishedAt: new Date().toISOString(),
    organizationSlug: options.organizationSlug,
    stats: parsed.stats,
    rejected: parsed.rejected.length,
    totals
  };
  const summaryPath = path.join(reportDir, `${timestamp}-terceros-resumen.json`);
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

  console.log(`Conductores: ${totals.driversInserted} nuevos, ${totals.driversUpdated} actualizados`);
  console.log(`Terceros: ${totals.partiesInserted} nuevos, ${totals.partiesUpdated} actualizados`);
  console.log(`Sedes: ${totals.sitesInserted} nuevas, ${totals.sitesUpdated} actualizadas, ${totals.sitesSkipped} omitidas`);
  console.log(`Resumen: ${summaryPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

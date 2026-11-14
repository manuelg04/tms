import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { parseAvansatVehicles, planAvansatVehicleLoad, type ExistingState } from "./lib/avansat-vehicles.js";

const BATCH_SIZE = 100;
const DEFAULT_ORGANIZATION_SLUG = "transportes-mtm";

type Options = {
  filePath: string;
  snapshotDir: string;
  dryRun: boolean;
  organizationSlug: string;
};

function parseArgs(argv: string[]): Options {
  const options: Options = { filePath: "", snapshotDir: "", dryRun: false, organizationSlug: DEFAULT_ORGANIZATION_SLUG };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--org") {
      options.organizationSlug = argv[++index] ?? options.organizationSlug;
    } else if (arg === "--snapshot") {
      options.snapshotDir = argv[++index] ?? "";
    } else if (!options.filePath) {
      options.filePath = arg;
    }
  }
  if (!options.filePath || !options.snapshotDir) {
    console.error("Uso: npm run ingest:avansat-vehicles -- <vehiculos.tsv> --snapshot <carpeta de npx convex export descomprimida> [--dry-run] [--org slug]");
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

function readTable(snapshotDir: string, table: string): Array<Record<string, unknown>> {
  const filePath = path.join(snapshotDir, table, "documents.jsonl");
  if (!existsSync(filePath)) {
    console.error(`La copia no trae la tabla ${table}: ${filePath}`);
    process.exit(1);
  }
  return readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function loadExisting(snapshotDir: string, organizationId: string | undefined): ExistingState & { organizationId: string } {
  const vehicles = readTable(snapshotDir, "vehicles");
  const counts = new Map<string, number>();
  for (const vehicle of vehicles) {
    const id = text(vehicle.organizationId);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const resolved = organizationId ?? [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!resolved) {
    console.error("No se pudo saber la organización a partir de la copia.");
    process.exit(1);
  }
  return {
    organizationId: resolved,
    vehicles: new Map(
      vehicles
        .filter((vehicle) => vehicle.organizationId === resolved)
        .map((vehicle) => [String(vehicle.plate), { trailer: text(vehicle.trailer), ownerDocument: text(vehicle.ownerDocument), possessorDocument: text(vehicle.possessorDocument) }])
    ),
    parties: new Set(readTable(snapshotDir, "thirdParties").filter((party) => party.organizationId === resolved).map((party) => String(party.document)))
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const repoRoot = path.resolve(webRoot, "../..");
  const today = new Date().toISOString().slice(0, 10);

  const webEnv = readEnvFile(path.join(webRoot, ".env.local"));
  const backendEnv = readEnvFile(path.join(repoRoot, ".env"));
  const convexUrl = process.env.CONVEX_URL ?? webEnv.NEXT_PUBLIC_CONVEX_URL ?? backendEnv.CONVEX_URL;
  const ingestKey = process.env.RNDC_INGEST_KEY ?? webEnv.RNDC_INGEST_KEY ?? backendEnv.RNDC_INGEST_KEY;
  let client: ConvexHttpClient | undefined;
  let organizationId: string | undefined;
  if (!options.dryRun) {
    if (!convexUrl || !ingestKey) {
      console.error("Faltan NEXT_PUBLIC_CONVEX_URL y/o RNDC_INGEST_KEY (apps/web/.env.local o .env raíz).");
      process.exit(1);
    }
    client = new ConvexHttpClient(convexUrl);
    organizationId = await client.query(anyApi.fleet.organizationBySlug, { ingestKey, slug: options.organizationSlug });
    if (!organizationId) {
      console.error(`No existe la organización "${options.organizationSlug}" en Convex.`);
      process.exit(1);
    }
  }

  const parsed = parseAvansatVehicles(readFileSync(options.filePath, "utf8"), { today });
  const existing = loadExisting(options.snapshotDir, organizationId);
  const plan = planAvansatVehicleLoad(parsed, existing);

  console.log(`Archivo: ${path.resolve(options.filePath)}`);
  console.log(`Filas leídas: ${parsed.stats.rows} · Vehículos: ${parsed.stats.vehicles} · Rechazadas: ${parsed.rejected.length}`);
  console.log(`Creados en Avansat entre ${parsed.stats.createdFrom ?? "?"} y ${parsed.stats.createdTo ?? "?"}`);
  console.log(`Vinculados al RNDC según Avansat: ${parsed.stats.registeredInRndc} · Con remolque: ${parsed.stats.withTrailer} · SOAT vigente: ${parsed.stats.withValidSoat}`);
  console.log(`Vehículos nuevos: ${plan.newVehicles.length} · Existentes a completar: ${plan.vehiclePatches.length} · Existentes sin cambio: ${plan.untouchedVehicles.length}`);
  console.log(`  A completar: remolque ${plan.vehiclePatches.filter((patch) => patch.trailer).length}, poseedor ${plan.vehiclePatches.filter((patch) => patch.possessorDocument).length}, propietario ${plan.vehiclePatches.filter((patch) => patch.ownerDocument).length}`);
  console.log(`Propietarios y poseedores: ${parsed.stats.parties} (${parsed.stats.companies} empresas) · Nuevos: ${plan.newParties.length} (${plan.newParties.filter((party) => party.documentType === "N").length} empresas) · Ya estaban: ${plan.existingParties.length}`);
  console.log(`Vínculos conductor–placa por cargar: ${plan.relations.length}`);
  console.log(`Avisos: ${parsed.warnings.length}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = path.join(repoRoot, "output", "ingesta");
  mkdirSync(reportDir, { recursive: true });
  const planPath = path.join(reportDir, `${timestamp}-vehiculos-avansat-plan.json`);
  writeFileSync(
    planPath,
    JSON.stringify(
      {
        file: path.resolve(options.filePath),
        stats: parsed.stats,
        rejected: parsed.rejected,
        warnings: parsed.warnings,
        newVehicles: plan.newVehicles.map((vehicle) => vehicle.plate),
        vehiclePatches: plan.vehiclePatches,
        untouchedVehicles: plan.untouchedVehicles,
        newParties: plan.newParties.map((party) => ({ documentType: party.documentType, document: party.document, name: party.name, roles: party.roles })),
        existingParties: plan.existingParties
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  console.log(`Plan: ${planPath}`);

  if (options.dryRun || !client || !organizationId || !ingestKey) {
    console.log("Dry run: no se envió nada a Convex.");
    return;
  }

  const totals = { vehiclesInserted: 0, vehiclesUpdated: 0, partiesInserted: 0, partiesUpdated: 0, relationsInserted: 0, relationsUpdated: 0, relationsSkipped: [] as Array<{ driverDocument: string; vehiclePlate: string; reason: string }> };
  for (const batch of chunk([...plan.newVehicles, ...plan.vehiclePatches], BATCH_SIZE)) {
    const result = await client.mutation(anyApi.fleet.upsertFleetBatch, { ingestKey, organizationId, drivers: [], vehicles: batch, relations: [] });
    totals.vehiclesInserted += result.vehiclesInserted;
    totals.vehiclesUpdated += result.vehiclesUpdated;
  }
  for (const batch of chunk(plan.newParties, BATCH_SIZE)) {
    const result = await client.mutation(anyApi.fleet.upsertThirdPartyBatch, { ingestKey, organizationId, parties: batch, sites: [] });
    totals.partiesInserted += result.partiesInserted;
    totals.partiesUpdated += result.partiesUpdated;
  }
  for (const batch of chunk(plan.relations, BATCH_SIZE)) {
    const result = await client.mutation(anyApi.fleet.upsertFleetBatch, { ingestKey, organizationId, drivers: [], vehicles: [], relations: batch });
    totals.relationsInserted += result.relationsInserted;
    totals.relationsUpdated += result.relationsUpdated;
    totals.relationsSkipped.push(...result.relationsSkipped);
  }

  const summaryPath = path.join(reportDir, `${timestamp}-vehiculos-avansat-resumen.json`);
  writeFileSync(summaryPath, JSON.stringify({ finishedAt: new Date().toISOString(), organizationSlug: options.organizationSlug, plan: planPath, totals }, null, 2) + "\n", "utf8");
  console.log(`Vehículos: ${totals.vehiclesInserted} nuevos, ${totals.vehiclesUpdated} completados`);
  console.log(`Terceros: ${totals.partiesInserted} nuevos, ${totals.partiesUpdated} actualizados`);
  console.log(`Vínculos: ${totals.relationsInserted} nuevos, ${totals.relationsUpdated} actualizados, ${totals.relationsSkipped.length} omitidos`);
  console.log(`Resumen: ${summaryPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

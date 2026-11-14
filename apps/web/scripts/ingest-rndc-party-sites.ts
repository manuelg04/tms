import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { parsePartySitesLookup } from "./lib/rndc-party-sites.js";

const BATCH_SIZE = 100;
const DEFAULT_ORGANIZATION_SLUG = "transportes-mtm";

type Options = { filePath: string; apply: boolean; organizationSlug: string };

function parseArgs(argv: string[]): Options {
  const options: Options = { filePath: "", apply: false, organizationSlug: DEFAULT_ORGANIZATION_SLUG };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "apply") {
      options.apply = true;
    } else if (arg.startsWith("org=")) {
      options.organizationSlug = arg.slice(4) || options.organizationSlug;
    } else if (!options.filePath) {
      options.filePath = arg;
    }
  }
  if (!options.filePath) {
    console.error("Uso: npm run ingest:rndc-party-sites -- <resultado de rndc:lookup-sites .json> [apply] [org=slug]");
    process.exit(1);
  }
  return options;
}

function readEnvFile(filePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    return env;
  }
  return env;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const repoRoot = path.resolve(webRoot, "../..");
  const filePath = path.resolve(process.env.INIT_CWD ?? process.cwd(), options.filePath);
  const { sites, summary } = parsePartySitesLookup(readFileSync(filePath, "utf8"));

  console.log(`Archivo: ${filePath}`);
  console.log(`Terceros consultados: ${summary.parties} · sin sedes en el RNDC: ${summary.partiesWithoutSites.length} · consultas fallidas: ${summary.failedLookups.length}`);
  console.log(`Sedes: ${summary.sites} · con coordenadas: ${summary.withCoordinates} · sin coordenadas: ${summary.withoutCoordinates}`);
  if (summary.failedLookups.length > 0) console.log(`Consultas fallidas (no se tocan): ${summary.failedLookups.join(", ")}`);

  if (!options.apply) {
    console.log("Revisión sin cambios: no se envió nada a Convex. Agrega 'apply' para guardar.");
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

  const totals = { sitesInserted: 0, sitesUpdated: 0, sitesSkipped: 0 };
  for (let index = 0; index < sites.length; index += BATCH_SIZE) {
    const result = await client.mutation(anyApi.fleet.upsertThirdPartyBatch, { ingestKey, organizationId, parties: [], sites: sites.slice(index, index + BATCH_SIZE) });
    totals.sitesInserted += result.sitesInserted;
    totals.sitesUpdated += result.sitesUpdated;
    totals.sitesSkipped += result.sitesSkipped.length;
  }
  console.log(`Convex ${convexUrl}: sedes nuevas ${totals.sitesInserted}, actualizadas ${totals.sitesUpdated}, omitidas porque el tercero no existe ${totals.sitesSkipped}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
const actorToken = process.env.TMS_ADMIN_ACTOR_TOKEN;
const total = Number(process.argv[2] ?? "50000");
const batchId = process.argv[3] ?? "phase6";

if (!convexUrl || !actorToken) {
  throw new Error("Set CONVEX_URL and TMS_ADMIN_ACTOR_TOKEN before seeding volume data");
}

if (!Number.isInteger(total) || total < 1 || total > 100_000) {
  throw new Error("Record count must be an integer between 1 and 100000");
}

const client = new ConvexHttpClient(convexUrl);
const baseTimestamp = Date.now();
let inserted = 0;
let existing = 0;

for (let offset = 0; offset < total; offset += 200) {
  const result = await client.mutation(api.dispatchSearch.seedVolumeBatch, {
    actorToken,
    batchId,
    offset,
    count: Math.min(200, total - offset),
    baseTimestamp
  });
  inserted += result.inserted;
  existing += result.existing;
  process.stdout.write(`\rProcesados ${Math.min(offset + 200, total)} de ${total}`);
}

process.stdout.write("\n");
process.stdout.write(`Insertados: ${inserted}. Ya existentes: ${existing}. Lote: ${batchId}.\n`);
const verificationStartedAt = performance.now();
const verification = await client.query(api.dispatchSearch.page, {
  actorToken,
  paginationOpts: { cursor: null, numItems: 25 },
  filters: { search: `VOL-${batchId}` }
});
process.stdout.write(`Consulta verificada: ${verification.page.length} filas en ${(performance.now() - verificationStartedAt).toFixed(1)} ms.\n`);

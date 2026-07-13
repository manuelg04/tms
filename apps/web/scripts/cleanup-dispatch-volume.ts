import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
const actorToken = process.env.TMS_ADMIN_ACTOR_TOKEN;
const batchId = process.argv[2] ?? "phase6";

if (!convexUrl || !actorToken) {
  throw new Error("Set CONVEX_URL and TMS_ADMIN_ACTOR_TOKEN before cleaning volume data");
}

const client = new ConvexHttpClient(convexUrl);
let deleted = 0;

while (true) {
  const result = await client.mutation(api.dispatchSearch.cleanupVolumeBatch, { actorToken, batchId, limit: 500 });
  deleted += result.deleted;
  process.stdout.write(`\rEliminados ${deleted}`);
  if (result.deleted === 0) {
    break;
  }
}

process.stdout.write("\n");
process.stdout.write(`Limpieza terminada para el lote ${batchId}.\n`);

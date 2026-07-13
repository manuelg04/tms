import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
const actorToken = process.env.TMS_ADMIN_ACTOR_TOKEN;

if (!convexUrl || !actorToken) {
  throw new Error("Set CONVEX_URL and TMS_ADMIN_ACTOR_TOKEN before rebuilding dispatch search");
}

const client = new ConvexHttpClient(convexUrl);
let cursor: string | undefined;
let processed = 0;

while (true) {
  const result = await client.mutation(api.dispatchSearch.rebuildSearchPage, { actorToken, cursor, limit: 100 });
  processed += result.processed;
  process.stdout.write(`\rIndexados ${processed}`);
  if (result.done || !result.nextCursor) {
    break;
  }
  cursor = result.nextCursor;
}

process.stdout.write("\nÍndice de despachos actualizado.\n");

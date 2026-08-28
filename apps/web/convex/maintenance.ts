import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const TEST_ORDER_CODE = /^OS-(GUIDED|ASYNC|EARLY|TMP|REM|MAN|UI|SMOKE|E2E|TEST)-\d+$/i;

async function deleteByIndex(ctx: MutationCtx, table: string, index: string, expedienteId: Id<"expedientes">): Promise<number> {
  const rows = await (ctx.db.query(table as never) as never as { withIndex: (name: string, fn: (q: { eq: (field: string, value: unknown) => unknown }) => unknown) => { collect: () => Promise<Array<{ _id: Id<never> }>> } })
    .withIndex(index, (q) => q.eq("expedienteId", expedienteId))
    .collect();
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}

export const purgeTestDispatches = internalMutation({
  args: { limit: v.optional(v.number()), dryRun: v.optional(v.boolean()) },
  returns: v.object({ matched: v.number(), deleted: v.number(), remaining: v.number(), dependents: v.number() }),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
    const expedientes = await ctx.db.query("expedientes").collect();
    const targets: Array<{ expedienteId: Id<"expedientes">; tripId?: Id<"trips">; serviceOrderId: Id<"serviceOrders"> }> = [];
    for (const expediente of expedientes) {
      const order = await ctx.db.get("serviceOrders", expediente.serviceOrderId);
      if (order && TEST_ORDER_CODE.test(order.code)) targets.push({ expedienteId: expediente._id, tripId: expediente.tripId ?? undefined, serviceOrderId: order._id });
    }
    if (args.dryRun) return { matched: targets.length, deleted: 0, remaining: targets.length, dependents: 0 };

    let deleted = 0;
    let dependents = 0;
    for (const target of targets.slice(0, limit)) {
      for (const [table, index] of [
        ["expedienteRemesas", "by_expediente_and_sequence"],
        ["documents", "by_expediente"],
        ["complianceChecks", "by_expediente_and_checked_at"],
        ["expedienteEvents", "by_expediente_and_occurred_at"],
        ["expedienteNovelties", "by_expediente_and_opened_at"],
        ["deliveryEvidence", "by_expediente_and_captured_at"],
        ["evidenceArtifacts", "by_expediente_and_created_at"],
        ["dispatchExceptions", "by_expediente_and_created_at"],
        ["rndcOperations", "by_expediente_and_created_at"],
        ["dispatchSnapshots", "by_expediente_and_taken_at"]
      ] as const) {
        dependents += await deleteByIndex(ctx, table, index, target.expedienteId);
      }
      if (target.tripId && (await ctx.db.get("trips", target.tripId))) await ctx.db.delete("trips", target.tripId);
      await ctx.db.delete("expedientes", target.expedienteId);
      const order = await ctx.db.get("serviceOrders", target.serviceOrderId);
      if (order) {
        const customer = await ctx.db.get("customers", order.customerId);
        await ctx.db.delete("serviceOrders", order._id);
        if (customer && /^(Cliente|Destinatario) (GUIDED|ASYNC|EARLY|TMP|REM|MAN|UI|SMOKE|E2E|TEST)-\d+$/i.test(customer.name)) {
          const locations = await ctx.db.query("customerLocations").withIndex("by_customer_and_code", (q) => q.eq("customerId", customer._id)).collect();
          for (const location of locations) await ctx.db.delete("customerLocations", location._id);
          await ctx.db.delete("customers", customer._id);
        }
      }
      deleted += 1;
    }
    return { matched: targets.length, deleted, remaining: targets.length - deleted, dependents };
  }
});

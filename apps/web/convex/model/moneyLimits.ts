import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { resolveMoneyLimits, type MoneyLimits } from "./moneyChecks";

export async function loadMoneyLimits(ctx: Pick<QueryCtx, "db">, organizationId: Id<"organizations">): Promise<MoneyLimits> {
  const organization = await ctx.db.get("organizations", organizationId);
  return resolveMoneyLimits(organization?.moneyLimits);
}

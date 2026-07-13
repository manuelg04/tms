import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { toListRow } from "../expedientes";
import { searchTextForRow } from "../dispatchSearch";

export async function refreshDispatchSearchText(ctx: MutationCtx, expedienteId: Id<"expedientes">): Promise<void> {
  const expediente = await ctx.db.get("expedientes", expedienteId);

  if (!expediente) {
    return;
  }

  const row = await toListRow(ctx, expediente);
  await ctx.db.patch("expedientes", expedienteId, { searchText: searchTextForRow(row) });
}

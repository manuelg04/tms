import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { normalizeSearchText } from "./searchText";

export type MerchandiseProductInput = {
  name: string;
  code: string;
  natureCode?: string;
  packagingCode?: string;
  uses?: number;
};

export function merchandiseProductName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function isMerchandiseCode(value: string | undefined): value is string {
  return /^\d{6}$/.test((value ?? "").trim());
}

export function matchMerchandiseProduct<T extends { name: string }>(products: readonly T[], name: string | undefined): T | undefined {
  const wanted = normalizeSearchText(name);
  return wanted ? products.find((product) => normalizeSearchText(product.name) === wanted) : undefined;
}

export async function rememberMerchandiseProduct(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  input: MerchandiseProductInput,
  source: "rndc" | "tms"
): Promise<"created" | "updated" | "kept" | "skipped"> {
  const name = merchandiseProductName(input.name);
  const searchText = normalizeSearchText(name);
  const code = input.code.trim();

  if (!searchText || !isMerchandiseCode(code)) {
    return "skipped";
  }

  const existing = await ctx.db
    .query("merchandiseProducts")
    .withIndex("by_organization_and_search", (q) => q.eq("organizationId", organizationId).eq("searchText", searchText))
    .unique();
  const now = Date.now();

  if (!existing) {
    await ctx.db.insert("merchandiseProducts", {
      organizationId,
      name,
      searchText,
      code,
      natureCode: input.natureCode?.trim() || undefined,
      packagingCode: input.packagingCode?.trim() || undefined,
      uses: input.uses ?? 1,
      source,
      updatedAt: now
    });
    return "created";
  }

  if (source === "tms") {
    if (existing.source === "tms" && existing.code !== code) {
      await ctx.db.patch("merchandiseProducts", existing._id, { code, updatedAt: now });
      return "updated";
    }
    return "kept";
  }

  await ctx.db.patch("merchandiseProducts", existing._id, {
    name,
    code,
    natureCode: input.natureCode?.trim() || existing.natureCode,
    packagingCode: input.packagingCode?.trim() || existing.packagingCode,
    uses: input.uses ?? existing.uses,
    source: "rndc",
    updatedAt: now
  });
  return "updated";
}

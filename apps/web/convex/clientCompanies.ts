import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { appendAudit, requireActor } from "./model/access";

const staff = ["admin", "operator", "auditor"] as const;

export const companyValidator = v.object({
  _id: v.id("customers"),
  code: v.string(),
  name: v.string(),
  identificationNumber: v.optional(v.string()),
  status: v.union(v.literal("active"), v.literal("inactive")),
});

export function normalizeCompanyName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function companyKey(value: string): string {
  return normalizeCompanyName(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function companyCode(value: string): string {
  return `EMP-${companyKey(value).replace(/\s+/g, "-").slice(0, 40) || "sin-nombre"}`;
}

export async function findCompanyByName(ctx: MutationCtx, organizationId: Id<"organizations">, name: string): Promise<Doc<"customers"> | null> {
  const key = companyKey(name);
  if (!key) return null;
  const byCode = await ctx.db
    .query("customers")
    .withIndex("by_organization_and_code", (q) => q.eq("organizationId", organizationId).eq("code", companyCode(name)))
    .unique();
  if (byCode) return byCode;
  const candidates = await ctx.db
    .query("customers")
    .withSearchIndex("search_customer_name", (q) => q.search("name", name).eq("organizationId", organizationId))
    .take(10);
  return candidates.find((row) => companyKey(row.name) === key) ?? null;
}

export async function resolveCustomer(
  ctx: MutationCtx,
  actor: Doc<"users">,
  input: { customerId?: Id<"customers">; name: string },
): Promise<Doc<"customers">> {
  if (input.customerId) {
    const existing = await ctx.db.get("customers", input.customerId);
    if (!existing || existing.organizationId !== actor.organizationId) throw new ConvexError("La empresa seleccionada no existe.");
    return existing;
  }
  const name = normalizeCompanyName(input.name);
  if (!name) throw new ConvexError("Indica la empresa cliente.");
  const found = await findCompanyByName(ctx, actor.organizationId, name);
  if (found) return found;
  const now = Date.now();
  const id = await ctx.db.insert("customers", {
    organizationId: actor.organizationId,
    code: companyCode(name),
    name,
    status: "active",
    source: "manual",
    createdBy: actor._id,
    updatedBy: actor._id,
    createdAt: now,
    updatedAt: now,
  });
  await appendAudit(ctx, {
    organizationId: actor.organizationId,
    actorType: "user",
    actorId: actor._id,
    action: "customer.created",
    entityType: "customer",
    entityId: id,
    detailsJson: JSON.stringify({ name }),
    createdAt: now,
  });
  const created = await ctx.db.get("customers", id);
  if (!created) throw new ConvexError("No fue posible registrar la empresa.");
  return created;
}

export const list = query({
  args: {},
  returns: v.array(companyValidator),
  handler: async (ctx) => {
    const actor = await requireActor(ctx, undefined, [...staff]);
    const rows = await ctx.db
      .query("customers")
      .withIndex("by_organization_and_status", (q) => q.eq("organizationId", actor.organizationId).eq("status", "active"))
      .take(500);
    return rows
      .map((row) => ({ _id: row._id, code: row.code, name: row.name, identificationNumber: row.identificationNumber, status: row.status }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  },
});

export const search = query({
  args: { term: v.string() },
  returns: v.array(companyValidator),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...staff]);
    const term = args.term.trim();
    if (term.length < 2) return [];
    const rows = await ctx.db
      .query("customers")
      .withSearchIndex("search_customer_name", (q) => q.search("name", term).eq("organizationId", actor.organizationId))
      .take(12);
    return rows
      .filter((row) => row.status === "active")
      .map((row) => ({ _id: row._id, code: row.code, name: row.name, identificationNumber: row.identificationNumber, status: row.status }));
  },
});

export const create = mutation({
  args: { name: v.string(), identificationNumber: v.optional(v.string()) },
  returns: v.id("customers"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, ["admin", "operator"]);
    const name = normalizeCompanyName(args.name);
    if (name.length < 3) throw new ConvexError("El nombre de la empresa debe tener al menos 3 caracteres.");
    const existing = await findCompanyByName(ctx, actor.organizationId, name);
    if (existing) {
      if (args.identificationNumber && !existing.identificationNumber) {
        await ctx.db.patch("customers", existing._id, { identificationNumber: args.identificationNumber.trim(), updatedBy: actor._id, updatedAt: Date.now() });
      }
      return existing._id;
    }
    const created = await resolveCustomer(ctx, actor, { name });
    if (args.identificationNumber?.trim()) {
      await ctx.db.patch("customers", created._id, { identificationNumber: args.identificationNumber.trim(), identificationType: "NIT" });
    }
    return created._id;
  },
});

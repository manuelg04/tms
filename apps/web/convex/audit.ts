import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireActor, requireSameOrganization } from "./model/access";

const auditValidator = v.object({
  _id: v.id("auditEvents"),
  _creationTime: v.number(),
  organizationId: v.id("organizations"),
  actorType: v.union(v.literal("user"), v.literal("service"), v.literal("system")),
  actorId: v.optional(v.id("users")),
  action: v.string(),
  entityType: v.string(),
  entityId: v.string(),
  reason: v.optional(v.string()),
  detailsJson: v.optional(v.string()),
  createdAt: v.number()
});

export const listForEntity = query({
  args: {
    actorToken: v.optional(v.string()),
    organizationId: v.id("organizations"),
    entityType: v.string(),
    entityId: v.string(),
    limit: v.optional(v.number())
  },
  returns: v.array(auditValidator),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "auditor", "operator"]);
    requireSameOrganization(actor, args.organizationId);
    return await ctx.db
      .query("auditEvents")
      .withIndex("by_organization_entity_and_created_at", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("entityType", args.entityType)
          .eq("entityId", args.entityId)
      )
      .order("desc")
      .take(Math.min(Math.max(args.limit ?? 100, 1), 250));
  }
});

export const recent = query({
  args: { actorToken: v.optional(v.string()), organizationId: v.id("organizations"), limit: v.optional(v.number()) },
  returns: v.array(auditValidator),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "auditor"]);
    requireSameOrganization(actor, args.organizationId);
    return await ctx.db
      .query("auditEvents")
      .withIndex("by_organization_and_created_at", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(Math.min(Math.max(args.limit ?? 100, 1), 250));
  }
});

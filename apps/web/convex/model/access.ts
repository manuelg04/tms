import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type ActorRole = "admin" | "operator" | "auditor" | "finance";

export async function requireActor(
  ctx: QueryCtx | MutationCtx,
  actorToken?: string,
  allowedRoles?: ActorRole[]
): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  const authenticatedActor = identity
    ? await ctx.db
        .query("users")
        .withIndex("by_auth_subject", (q) => q.eq("authSubject", identity.subject))
        .unique()
    : null;
  const tokenActor = actorToken
    ? await ctx.db
        .query("users")
        .withIndex("by_actor_token", (q) => q.eq("actorToken", actorToken))
        .unique()
    : null;

  if (authenticatedActor && tokenActor && authenticatedActor._id !== tokenActor._id) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Authenticated actor does not match the actor token" });
  }

  const actor = authenticatedActor ?? tokenActor;

  if (!actor || actor.status !== "active") {
    throw new ConvexError({ code: "UNAUTHORIZED", message: "Invalid or disabled actor" });
  }

  const organization = await ctx.db.get("organizations", actor.organizationId);

  if (!organization || organization.status !== "active") {
    throw new ConvexError({ code: "UNAUTHORIZED", message: "Organization is not active" });
  }

  if (allowedRoles && !actor.roles.some((role) => allowedRoles.includes(role))) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Actor does not have the required role" });
  }

  return actor;
}

export function requireSameOrganization(actor: Doc<"users">, organizationId: Id<"organizations">): void {
  if (actor.organizationId !== organizationId) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Resource belongs to another organization" });
  }
}

export function requireServiceKey(serviceKey: string): void {
  const expected = process.env.RNDC_SERVICE_KEY ?? process.env.RNDC_INGEST_KEY;

  if (!expected || serviceKey !== expected) {
    throw new ConvexError({ code: "UNAUTHORIZED", message: "Invalid service key" });
  }
}

export async function appendAudit(
  ctx: MutationCtx,
  input: {
    organizationId: Id<"organizations">;
    actorType: "user" | "service" | "system";
    actorId?: Id<"users">;
    action: string;
    entityType: string;
    entityId: string;
    reason?: string;
    detailsJson?: string;
    createdAt?: number;
  }
): Promise<Id<"auditEvents">> {
  return await ctx.db.insert("auditEvents", {
    organizationId: input.organizationId,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    reason: input.reason,
    detailsJson: input.detailsJson,
    createdAt: input.createdAt ?? Date.now()
  });
}

import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { appendAudit, requireActor, requireSameOrganization, requireServiceKey } from "./model/access";

const roleValidator = v.union(
  v.literal("admin"),
  v.literal("operator"),
  v.literal("auditor"),
  v.literal("finance")
);

const statusValidator = v.union(v.literal("active"), v.literal("disabled"));

const userOutputValidator = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  organizationId: v.id("organizations"),
  externalId: v.optional(v.string()),
  authSubject: v.optional(v.string()),
  name: v.string(),
  email: v.string(),
  roles: v.array(roleValidator),
  status: statusValidator,
  createdAt: v.number(),
  updatedAt: v.number()
});

export const bootstrapOrganization = mutation({
  args: {
    serviceKey: v.string(),
    organization: v.object({ slug: v.string(), name: v.string() }),
    actor: v.object({
      externalId: v.optional(v.string()),
      authSubject: v.optional(v.string()),
      actorToken: v.string(),
      name: v.string(),
      email: v.string(),
      roles: v.array(roleValidator)
    })
  },
  returns: v.object({ organizationId: v.id("organizations"), userId: v.id("users") }),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    const now = Date.now();
    const slug = args.organization.slug.trim().toLowerCase();
    const email = args.actor.email.trim().toLowerCase();
    const tokenOwner = await ctx.db
      .query("users")
      .withIndex("by_actor_token", (q) => q.eq("actorToken", args.actor.actorToken))
      .unique();
    const subjectOwner = args.actor.authSubject
      ? await ctx.db
          .query("users")
          .withIndex("by_auth_subject", (q) => q.eq("authSubject", args.actor.authSubject))
          .unique()
      : null;
    let organization = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();

    if (!organization) {
      const organizationId = await ctx.db.insert("organizations", {
        slug,
        name: args.organization.name.trim(),
        status: "active",
        createdAt: now,
        updatedAt: now
      });
      organization = await ctx.db.get("organizations", organizationId);
    } else {
      await ctx.db.patch("organizations", organization._id, {
        name: args.organization.name.trim(),
        status: "active",
        updatedAt: now
      });
    }

    if (!organization) {
      throw new ConvexError({ code: "INTERNAL", message: "Organization could not be created" });
    }

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_organization_and_email", (q) => q.eq("organizationId", organization._id).eq("email", email))
      .unique();

    if (tokenOwner && tokenOwner._id !== existingUser?._id) {
      throw new ConvexError({ code: "CONFLICT", message: "Actor token is already assigned" });
    }

    if (subjectOwner && subjectOwner._id !== existingUser?._id) {
      throw new ConvexError({ code: "CONFLICT", message: "Authentication subject is already assigned" });
    }

    let userId;

    if (existingUser) {
      await ctx.db.patch("users", existingUser._id, {
        externalId: args.actor.externalId,
        authSubject: args.actor.authSubject,
        actorToken: args.actor.actorToken,
        name: args.actor.name.trim(),
        roles: args.actor.roles,
        status: "active",
        updatedAt: now
      });
      userId = existingUser._id;
    } else {
      userId = await ctx.db.insert("users", {
        organizationId: organization._id,
        externalId: args.actor.externalId,
        authSubject: args.actor.authSubject,
        actorToken: args.actor.actorToken,
        name: args.actor.name.trim(),
        email,
        roles: args.actor.roles,
        status: "active",
        createdAt: now,
        updatedAt: now
      });
    }

    await appendAudit(ctx, {
      organizationId: organization._id,
      actorType: "service",
      action: "organization.bootstrap",
      entityType: "organization",
      entityId: organization._id,
      createdAt: now
    });

    return { organizationId: organization._id, userId };
  }
});

export const upsertUser = mutation({
  args: {
    actorToken: v.optional(v.string()),
    organizationId: v.id("organizations"),
    externalId: v.optional(v.string()),
    authSubject: v.optional(v.string()),
    newActorToken: v.string(),
    name: v.string(),
    email: v.string(),
    roles: v.array(roleValidator),
    status: statusValidator
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin"]);
    requireSameOrganization(actor, args.organizationId);
    const now = Date.now();
    const email = args.email.trim().toLowerCase();
    const tokenOwner = await ctx.db
      .query("users")
      .withIndex("by_actor_token", (q) => q.eq("actorToken", args.newActorToken))
      .unique();
    const subjectOwner = args.authSubject
      ? await ctx.db
          .query("users")
          .withIndex("by_auth_subject", (q) => q.eq("authSubject", args.authSubject))
          .unique()
      : null;
    const existing = await ctx.db
      .query("users")
      .withIndex("by_organization_and_email", (q) => q.eq("organizationId", args.organizationId).eq("email", email))
      .unique();

    if (tokenOwner && tokenOwner._id !== existing?._id) {
      throw new ConvexError({ code: "CONFLICT", message: "Actor token is already assigned" });
    }

    if (subjectOwner && subjectOwner._id !== existing?._id) {
      throw new ConvexError({ code: "CONFLICT", message: "Authentication subject is already assigned" });
    }

    let userId;

    if (existing) {
      await ctx.db.patch("users", existing._id, {
        externalId: args.externalId,
        authSubject: args.authSubject,
        actorToken: args.newActorToken,
        name: args.name.trim(),
        roles: args.roles,
        status: args.status,
        updatedAt: now
      });
      userId = existing._id;
    } else {
      userId = await ctx.db.insert("users", {
        organizationId: args.organizationId,
        externalId: args.externalId,
        authSubject: args.authSubject,
        actorToken: args.newActorToken,
        name: args.name.trim(),
        email,
        roles: args.roles,
        status: args.status,
        createdAt: now,
        updatedAt: now
      });
    }

    await appendAudit(ctx, {
      organizationId: args.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: existing ? "user.updated" : "user.created",
      entityType: "user",
      entityId: userId,
      createdAt: now
    });

    return userId;
  }
});

export const me = query({
  args: { actorToken: v.optional(v.string()) },
  returns: userOutputValidator,
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    const { actorToken: _actorToken, ...safeActor } = actor;
    return safeActor;
  }
});

export const listUsers = query({
  args: { actorToken: v.optional(v.string()), organizationId: v.id("organizations") },
  returns: v.array(userOutputValidator),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "auditor"]);
    requireSameOrganization(actor, args.organizationId);
    const users = await ctx.db
      .query("users")
      .withIndex("by_organization_and_email", (q) => q.eq("organizationId", args.organizationId))
      .collect();

    return users.map(({ actorToken: _actorToken, ...user }) => user);
  }
});

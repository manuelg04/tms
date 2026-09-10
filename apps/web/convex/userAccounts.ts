import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { appendAudit, requireActor, requireServiceKey } from "./model/access";
import { assertPasswordHash, normalizeEmail, normalizeName, rolesForJobTitle } from "./model/userAccounts";

const jobTitleValidator = v.union(
  v.literal("administrador"),
  v.literal("jefe_seguridad"),
  v.literal("auxiliar_seguridad")
);

const statusValidator = v.union(v.literal("active"), v.literal("disabled"));

const accountValidator = v.object({
  _id: v.id("users"),
  name: v.string(),
  email: v.string(),
  jobTitle: v.optional(jobTitleValidator),
  roles: v.array(v.string()),
  status: statusValidator,
  hasPassword: v.boolean(),
  passwordUpdatedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number()
});

export const credentialsByEmail = query({
  args: { serviceKey: v.string(), email: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      authSubject: v.string(),
      name: v.string(),
      email: v.string(),
      roles: v.array(v.string()),
      jobTitle: v.optional(jobTitleValidator),
      status: statusValidator,
      organizationStatus: v.string(),
      passwordHash: v.optional(v.string())
    })
  ),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    const email = args.email.trim().toLowerCase();
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    if (!user || !user.authSubject) {
      return null;
    }

    const organization = await ctx.db.get("organizations", user.organizationId);

    return {
      authSubject: user.authSubject,
      name: user.name,
      email: user.email,
      roles: user.roles,
      jobTitle: user.jobTitle,
      status: user.status,
      organizationStatus: organization?.status ?? "missing",
      passwordHash: user.passwordHash
    };
  }
});

export const list = query({
  args: {},
  returns: v.object({ accounts: v.array(accountValidator), canManage: v.boolean(), canView: v.boolean(), selfId: v.id("users") }),
  handler: async (ctx) => {
    const actor = await requireActor(ctx);

    if (!actor.roles.includes("admin") && !actor.roles.includes("auditor")) {
      return { accounts: [], canManage: false, canView: false, selfId: actor._id };
    }

    const users = await ctx.db
      .query("users")
      .withIndex("by_organization_and_email", (q) => q.eq("organizationId", actor.organizationId))
      .collect();

    return {
      accounts: users
        .map((user) => ({
          _id: user._id,
          name: user.name,
          email: user.email,
          jobTitle: user.jobTitle,
          roles: user.roles,
          status: user.status,
          hasPassword: Boolean(user.passwordHash),
          passwordUpdatedAt: user.passwordUpdatedAt,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
      canManage: actor.roles.includes("admin"),
      canView: true,
      selfId: actor._id
    };
  }
});

export const create = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    jobTitle: jobTitleValidator,
    passwordHash: v.string(),
    authSubject: v.string(),
    actorToken: v.string()
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, ["admin"]);
    const now = Date.now();
    const email = normalizeEmail(args.email);
    const name = normalizeName(args.name);
    assertPasswordHash(args.passwordHash);
    await assertUniqueIdentity(ctx, email, args.authSubject, args.actorToken);

    const userId = await ctx.db.insert("users", {
      organizationId: actor.organizationId,
      authSubject: args.authSubject,
      actorToken: args.actorToken,
      name,
      email,
      roles: rolesForJobTitle(args.jobTitle),
      status: "active",
      jobTitle: args.jobTitle,
      passwordHash: args.passwordHash,
      passwordUpdatedAt: now,
      createdAt: now,
      updatedAt: now
    });

    await appendAudit(ctx, {
      organizationId: actor.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "user.created",
      entityType: "user",
      entityId: userId,
      detailsJson: JSON.stringify({ email, jobTitle: args.jobTitle }),
      createdAt: now
    });

    return userId;
  }
});

export const createWithServiceKey = mutation({
  args: {
    serviceKey: v.string(),
    organizationSlug: v.string(),
    name: v.string(),
    email: v.string(),
    jobTitle: jobTitleValidator,
    passwordHash: v.string(),
    authSubject: v.string(),
    actorToken: v.string()
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    const organization = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", args.organizationSlug.trim().toLowerCase()))
      .unique();

    if (!organization || organization.status !== "active") {
      throw new ConvexError({ code: "NOT_FOUND", message: "La organización no existe o está inactiva" });
    }

    const now = Date.now();
    const email = normalizeEmail(args.email);
    const name = normalizeName(args.name);
    assertPasswordHash(args.passwordHash);
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    if (existing) {
      if (existing.organizationId !== organization._id) {
        throw new ConvexError({ code: "CONFLICT", message: "El correo pertenece a otra organización" });
      }

      await ctx.db.patch("users", existing._id, {
        name,
        jobTitle: args.jobTitle,
        roles: rolesForJobTitle(args.jobTitle),
        status: "active",
        passwordHash: args.passwordHash,
        passwordUpdatedAt: now,
        updatedAt: now,
        ...(existing.authSubject ? {} : { authSubject: args.authSubject })
      });
      await appendAudit(ctx, {
        organizationId: organization._id,
        actorType: "service",
        action: "user.reset_by_service",
        entityType: "user",
        entityId: existing._id,
        createdAt: now
      });
      return existing._id;
    }

    await assertUniqueIdentity(ctx, email, args.authSubject, args.actorToken);
    const userId = await ctx.db.insert("users", {
      organizationId: organization._id,
      authSubject: args.authSubject,
      actorToken: args.actorToken,
      name,
      email,
      roles: rolesForJobTitle(args.jobTitle),
      status: "active",
      jobTitle: args.jobTitle,
      passwordHash: args.passwordHash,
      passwordUpdatedAt: now,
      createdAt: now,
      updatedAt: now
    });

    await appendAudit(ctx, {
      organizationId: organization._id,
      actorType: "service",
      action: "user.created_by_service",
      entityType: "user",
      entityId: userId,
      detailsJson: JSON.stringify({ email, jobTitle: args.jobTitle }),
      createdAt: now
    });

    return userId;
  }
});

export const update = mutation({
  args: {
    userId: v.id("users"),
    name: v.optional(v.string()),
    jobTitle: v.optional(jobTitleValidator),
    status: v.optional(statusValidator)
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, ["admin"]);
    const target = await ctx.db.get("users", args.userId);

    if (!target || target.organizationId !== actor.organizationId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "El usuario no existe" });
    }

    const nextStatus = args.status ?? target.status;
    const nextJobTitle = args.jobTitle ?? target.jobTitle;
    const nextRoles = args.jobTitle ? rolesForJobTitle(args.jobTitle) : target.roles;
    const losesAdmin = target.roles.includes("admin") && (nextStatus !== "active" || !nextRoles.includes("admin"));

    if (target._id === actor._id && losesAdmin) {
      throw new ConvexError({ code: "FORBIDDEN", message: "No puedes quitarte a ti mismo el acceso de administrador" });
    }

    if (losesAdmin) {
      const admins = await ctx.db
        .query("users")
        .withIndex("by_organization_and_email", (q) => q.eq("organizationId", actor.organizationId))
        .collect();
      const remaining = admins.filter((user) => user._id !== target._id && user.status === "active" && user.roles.includes("admin"));

      if (remaining.length === 0) {
        throw new ConvexError({ code: "FORBIDDEN", message: "Debe quedar al menos un administrador activo" });
      }
    }

    const now = Date.now();
    await ctx.db.patch("users", target._id, {
      ...(args.name ? { name: normalizeName(args.name) } : {}),
      ...(args.jobTitle ? { jobTitle: args.jobTitle, roles: nextRoles } : {}),
      ...(args.status ? { status: args.status } : {}),
      updatedAt: now
    });

    await appendAudit(ctx, {
      organizationId: actor.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "user.updated",
      entityType: "user",
      entityId: target._id,
      detailsJson: JSON.stringify({ name: args.name, jobTitle: nextJobTitle, status: nextStatus }),
      createdAt: now
    });

    return null;
  }
});

export const setPassword = mutation({
  args: { userId: v.id("users"), passwordHash: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, ["admin"]);
    const target = await ctx.db.get("users", args.userId);

    if (!target || target.organizationId !== actor.organizationId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "El usuario no existe" });
    }

    assertPasswordHash(args.passwordHash);
    const now = Date.now();
    await ctx.db.patch("users", target._id, { passwordHash: args.passwordHash, passwordUpdatedAt: now, updatedAt: now });
    await appendAudit(ctx, {
      organizationId: actor.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "user.password_reset",
      entityType: "user",
      entityId: target._id,
      createdAt: now
    });

    return null;
  }
});

export const setOwnPassword = mutation({
  args: { passwordHash: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    assertPasswordHash(args.passwordHash);
    const now = Date.now();
    await ctx.db.patch("users", actor._id, { passwordHash: args.passwordHash, passwordUpdatedAt: now, updatedAt: now });
    await appendAudit(ctx, {
      organizationId: actor.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "user.password_changed",
      entityType: "user",
      entityId: actor._id,
      createdAt: now
    });

    return null;
  }
});

async function assertUniqueIdentity(ctx: MutationCtx, email: string, authSubject: string, actorToken: string): Promise<void> {
  const byEmail = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", email)).first();

  if (byEmail) {
    throw new ConvexError({ code: "CONFLICT", message: "Ya existe un usuario con ese correo" });
  }

  const bySubject = await ctx.db.query("users").withIndex("by_auth_subject", (q) => q.eq("authSubject", authSubject)).unique();
  const byToken = await ctx.db.query("users").withIndex("by_actor_token", (q) => q.eq("actorToken", actorToken)).unique();

  if (bySubject || byToken) {
    throw new ConvexError({ code: "CONFLICT", message: "La identidad generada ya está asignada, intenta de nuevo" });
  }
}

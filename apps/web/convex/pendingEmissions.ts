import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { appendAudit, requireActor, requireSameOrganization, requireServiceKey } from "./model/access";
import { covers, retryIsDue, tickerIsIdle, widestScope, TICK_MS } from "./model/pendingEmission";
import { chainScope, pendingStatus } from "./model/pendingEmissionValidators";

const readers = ["admin", "operator", "auditor"] as const;
const writers = ["admin", "operator"] as const;
const row = v.object({
  _id: v.id("pendingEmissions"),
  expedienteId: v.id("expedientes"),
  code: v.string(),
  scope: chainScope,
  status: pendingStatus,
  requestedByName: v.string(),
  requestedAt: v.number(),
  attempts: v.number(),
  lastAttemptAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
});

async function entryFor(ctx: QueryCtx, expedienteId: Id<"expedientes">) {
  return await ctx.db
    .query("pendingEmissions")
    .withIndex("by_expediente", (q) => q.eq("expedienteId", expedienteId))
    .unique();
}

async function ownExpediente(ctx: QueryCtx, actor: Doc<"users">, expedienteId: Id<"expedientes">) {
  const expediente = await ctx.db.get("expedientes", expedienteId);
  if (!expediente) throw new ConvexError("Despacho no disponible.");
  requireSameOrganization(actor, expediente.organizationId);
  return expediente;
}

async function toRow(ctx: QueryCtx, entry: Doc<"pendingEmissions">) {
  const expediente = await ctx.db.get("expedientes", entry.expedienteId);
  return {
    _id: entry._id,
    expedienteId: entry.expedienteId,
    code: expediente?.code ?? "",
    scope: entry.scope,
    status: entry.status,
    requestedByName: entry.requestedByName,
    requestedAt: entry.requestedAt,
    attempts: entry.attempts,
    lastAttemptAt: entry.lastAttemptAt,
    lastError: entry.lastError,
  };
}

async function ensureTicker(ctx: MutationCtx) {
  const now = Date.now();
  const ticker = await ctx.db.query("pendingEmissionTicker").first();
  if (!tickerIsIdle(ticker, now)) return;
  await ctx.scheduler.runAfter(TICK_MS, internal.pendingEmissions.kick, {});
  if (ticker) await ctx.db.patch("pendingEmissionTicker", ticker._id, { scheduledFor: now + TICK_MS });
  else await ctx.db.insert("pendingEmissionTicker", { scheduledFor: now + TICK_MS });
}

async function hasWaiting(ctx: QueryCtx) {
  const entry = await ctx.db
    .query("pendingEmissions")
    .withIndex("by_status_and_requested_at", (q) => q.eq("status", "waiting"))
    .first();
  return entry !== null;
}

async function audit(ctx: MutationCtx, actor: Doc<"users">, action: string, entityId: string) {
  await appendAudit(ctx, {
    organizationId: actor.organizationId,
    actorType: "user",
    actorId: actor._id,
    action,
    entityType: "pendingEmissions",
    entityId,
  });
}

export const list = query({
  args: {},
  returns: v.object({ rows: v.array(row), waiting: v.number(), attention: v.number() }),
  handler: async (ctx) => {
    const actor = await requireActor(ctx, undefined, [...readers]);
    const entries = await ctx.db
      .query("pendingEmissions")
      .withIndex("by_organization_and_requested_at", (q) => q.eq("organizationId", actor.organizationId))
      .take(100);
    const rows = await Promise.all(entries.map((entry) => toRow(ctx, entry)));
    return {
      rows,
      waiting: rows.filter((entry) => entry.status === "waiting").length,
      attention: rows.filter((entry) => entry.status === "attention").length,
    };
  },
});

export const forDispatch = query({
  args: { expedienteId: v.id("expedientes") },
  returns: v.union(row, v.null()),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...readers]);
    const expediente = await ctx.db.get("expedientes", args.expedienteId);
    if (!expediente || expediente.organizationId !== actor.organizationId) return null;
    const entry = await entryFor(ctx, args.expedienteId);
    return entry ? await toRow(ctx, entry) : null;
  },
});

export const enqueue = mutation({
  args: { expedienteId: v.id("expedientes"), scope: chainScope, reason: v.optional(v.string()) },
  returns: v.id("pendingEmissions"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...writers]);
    await ownExpediente(ctx, actor, args.expedienteId);
    const existing = await entryFor(ctx, args.expedienteId);
    const reason = args.reason?.slice(0, 500);
    if (existing) {
      await ctx.db.patch("pendingEmissions", existing._id, {
        scope: widestScope(existing.scope, args.scope),
        status: "waiting",
        lastError: reason,
        lastAttemptAt: undefined,
      });
      await ensureTicker(ctx);
      return existing._id;
    }
    const id = await ctx.db.insert("pendingEmissions", {
      organizationId: actor.organizationId,
      expedienteId: args.expedienteId,
      scope: args.scope,
      status: "waiting",
      requestedBy: actor._id,
      requestedByName: actor.name,
      requestedAt: Date.now(),
      attempts: 0,
      lastError: reason,
    });
    await audit(ctx, actor, "emission.queued", id);
    await ensureTicker(ctx);
    return id;
  },
});

export const claimDue = mutation({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.object({ expedienteId: v.id("expedientes"), scope: chainScope, requestedByName: v.string() })),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...writers]);
    const now = Date.now();
    const entries = await ctx.db
      .query("pendingEmissions")
      .withIndex("by_organization_and_requested_at", (q) => q.eq("organizationId", actor.organizationId))
      .take(100);
    const due = entries.filter((entry) => retryIsDue(entry, now)).slice(0, Math.min(Math.max(args.limit ?? 5, 1), 10));
    for (const entry of due) {
      await ctx.db.patch("pendingEmissions", entry._id, { lastAttemptAt: now, attempts: entry.attempts + 1 });
    }
    return due.map((entry) => ({ expedienteId: entry.expedienteId, scope: entry.scope, requestedByName: entry.requestedByName }));
  },
});

export const settle = mutation({
  args: {
    expedienteId: v.id("expedientes"),
    outcome: v.union(v.literal("done"), v.literal("retry"), v.literal("attention")),
    error: v.optional(v.string()),
    completedScope: v.optional(chainScope),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...writers]);
    await ownExpediente(ctx, actor, args.expedienteId);
    const entry = await entryFor(ctx, args.expedienteId);
    if (!entry) return null;
    if (args.outcome === "done" && args.completedScope && !covers(args.completedScope, entry.scope)) {
      return null;
    }
    if (args.outcome === "done") {
      await ctx.db.delete("pendingEmissions", entry._id);
      await audit(ctx, actor, "emission.queue_completed", entry._id);
      return null;
    }
    await ctx.db.patch("pendingEmissions", entry._id, {
      status: args.outcome === "attention" ? "attention" : "waiting",
      lastError: args.error?.slice(0, 500),
    });
    return null;
  },
});

export const cancel = mutation({
  args: { expedienteId: v.id("expedientes") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...writers]);
    await ownExpediente(ctx, actor, args.expedienteId);
    const entry = await entryFor(ctx, args.expedienteId);
    if (!entry) return null;
    await ctx.db.delete("pendingEmissions", entry._id);
    await audit(ctx, actor, "emission.queue_cancelled", entry._id);
    return null;
  },
});

const serviceEntry = v.object({
  expedienteId: v.id("expedientes"),
  scope: chainScope,
  requestedByName: v.string(),
  requester: v.object({
    subject: v.string(),
    email: v.string(),
    name: v.string(),
    role: v.union(v.literal("admin"), v.literal("operator")),
  }),
});

export const claimDueFromService = mutation({
  args: { serviceKey: v.string(), limit: v.optional(v.number()) },
  returns: v.array(serviceEntry),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    const now = Date.now();
    const entries = await ctx.db
      .query("pendingEmissions")
      .withIndex("by_status_and_requested_at", (q) => q.eq("status", "waiting"))
      .take(100);
    const due = entries.filter((entry) => retryIsDue(entry, now)).slice(0, Math.min(Math.max(args.limit ?? 5, 1), 10));
    const claimed = [];
    for (const entry of due) {
      const user = await ctx.db.get("users", entry.requestedBy);
      const role = user?.roles.includes("admin") ? "admin" as const : user?.roles.includes("operator") ? "operator" as const : null;
      if (!user || user.status !== "active" || !user.authSubject || !role) {
        await ctx.db.patch("pendingEmissions", entry._id, {
          status: "attention",
          lastAttemptAt: now,
          lastError: "La persona que pidió la emisión ya no tiene una cuenta activa con permiso para transmitir. Abre el despacho y vuelve a guardar y emitir.",
        });
        continue;
      }
      await ctx.db.patch("pendingEmissions", entry._id, { lastAttemptAt: now, attempts: entry.attempts + 1 });
      claimed.push({
        expedienteId: entry.expedienteId,
        scope: entry.scope,
        requestedByName: entry.requestedByName,
        requester: { subject: user.authSubject, email: user.email, name: user.name, role },
      });
    }
    return claimed;
  },
});

export const settleFromService = mutation({
  args: {
    serviceKey: v.string(),
    expedienteId: v.id("expedientes"),
    outcome: v.union(v.literal("retry"), v.literal("attention")),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    const entry = await entryFor(ctx, args.expedienteId);
    if (!entry) return null;
    await ctx.db.patch("pendingEmissions", entry._id, {
      status: args.outcome === "attention" ? "attention" : "waiting",
      lastError: args.error?.slice(0, 500),
    });
    return null;
  },
});

export const tick = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (await hasWaiting(ctx)) await ensureTicker(ctx);
    return null;
  },
});

export const kick = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    try {
      const webUrl = process.env.TMS_WEB_URL;
      const serviceKey = process.env.RNDC_SERVICE_KEY ?? process.env.RNDC_INGEST_KEY;
      if (!webUrl || !serviceKey) return null;
      const response = await fetch(`${webUrl.replace(/\/$/, "")}/api/internal/pending-emissions/drain`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}` },
        signal: AbortSignal.timeout(110_000),
      });
      if (!response.ok) {
        console.warn(`Pending emission drain answered ${response.status}`);
      }
    } catch (error) {
      console.warn(`Pending emission drain failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await ctx.runMutation(internal.pendingEmissions.tick, {});
    }
    return null;
  },
});

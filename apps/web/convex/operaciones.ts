import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { appendAudit, requireActor, requireSameOrganization } from "./model/access";
import { buildOperacionesDeliveryPlan } from "./model/operacionesDelivery";

const deliveryKind = v.union(
  v.literal("loading_order"),
  v.literal("manifest_numbers"),
  v.literal("official_manifest"),
  v.literal("official_remesa")
);
const deliveryStatus = v.union(v.literal("applied"), v.literal("pending"), v.literal("failed"));
const deliveryValidator = v.object({
  kind: deliveryKind,
  deliveryKey: v.string(),
  number: v.optional(v.string()),
  status: deliveryStatus,
  message: v.string(),
  updatedAt: v.number()
});
const linkValidator = v.object({
  operacionesExpedienteId: v.string(),
  plate: v.optional(v.string()),
  driverName: v.optional(v.string()),
  linkedAt: v.number()
});

export const link = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
    operacionesExpedienteId: v.string(),
    plate: v.optional(v.string()),
    driverName: v.optional(v.string())
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const expediente = await ctx.db.get("expedientes", args.expedienteId);
    const operacionesExpedienteId = args.operacionesExpedienteId.trim();

    if (!expediente) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Despacho no encontrado" });
    }

    requireSameOrganization(actor, expediente.organizationId);

    if (!operacionesExpedienteId) {
      throw new ConvexError({ code: "INVALID", message: "Falta la solicitud de Operaciones" });
    }

    const existing = await ctx.db
      .query("operacionesLinks")
      .withIndex("by_expediente", (q) => q.eq("expedienteId", expediente._id))
      .unique();

    if (existing) {
      if (existing.operacionesExpedienteId !== operacionesExpedienteId) {
        throw new ConvexError({ code: "CONFLICT", message: "El despacho ya está vinculado a otra solicitud de Operaciones" });
      }
      return null;
    }

    const now = Date.now();
    await ctx.db.insert("operacionesLinks", {
      organizationId: actor.organizationId,
      expedienteId: expediente._id,
      operacionesExpedienteId,
      plate: args.plate?.trim() || undefined,
      driverName: args.driverName?.trim() || undefined,
      linkedBy: actor._id,
      linkedAt: now
    });
    await ctx.db.insert("expedienteEvents", {
      organizationId: actor.organizationId,
      expedienteId: expediente._id,
      eventType: "operaciones_linked",
      title: "Despacho creado desde una solicitud de planilla de Operaciones",
      occurredAt: now,
      actorId: actor._id
    });
    await appendAudit(ctx, {
      organizationId: actor.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "dispatch.operaciones_linked",
      entityType: "expediente",
      entityId: expediente._id,
      detailsJson: JSON.stringify({ operacionesExpedienteId }),
      createdAt: now
    });
    return null;
  }
});

export const linkedRequests = query({
  args: { actorToken: v.optional(v.string()), operacionesExpedienteIds: v.array(v.string()) },
  returns: v.array(
    v.object({
      operacionesExpedienteId: v.string(),
      expedienteId: v.id("expedientes"),
      code: v.string(),
      status: v.string()
    })
  ),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    const ids = [...new Set(args.operacionesExpedienteIds.map((id) => id.trim()).filter(Boolean))].slice(0, 100);
    const rows = await Promise.all(
      ids.map((id) =>
        ctx.db
          .query("operacionesLinks")
          .withIndex("by_organization_and_operaciones_expediente", (q) =>
            q.eq("organizationId", actor.organizationId).eq("operacionesExpedienteId", id)
          )
          .order("desc")
          .take(5)
      )
    );
    const result = [];

    for (const links of rows) {
      for (const item of links) {
        const expediente = await ctx.db.get("expedientes", item.expedienteId);
        if (expediente && expediente.status !== "cancelled") {
          result.push({
            operacionesExpedienteId: item.operacionesExpedienteId,
            expedienteId: expediente._id,
            code: expediente.code,
            status: expediente.status
          });
          break;
        }
      }
    }

    return result;
  }
});

export const forDispatch = query({
  args: { actorToken: v.optional(v.string()), expedienteId: v.id("expedientes") },
  returns: v.union(
    v.null(),
    v.object({
      link: linkValidator,
      deliveries: v.array(deliveryValidator),
      ready: v.array(v.object({ kind: deliveryKind, deliveryKey: v.string(), label: v.string(), number: v.optional(v.string()) }))
    })
  ),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    const loaded = await loadLinkedDispatch(ctx, args.expedienteId, actor.organizationId);

    if (!loaded) {
      return null;
    }

    const deliveries = await ctx.db
      .query("operacionesDeliveries")
      .withIndex("by_expediente", (q) => q.eq("expedienteId", args.expedienteId))
      .take(50);

    return {
      link: {
        operacionesExpedienteId: loaded.link.operacionesExpedienteId,
        plate: loaded.link.plate,
        driverName: loaded.link.driverName,
        linkedAt: loaded.link.linkedAt
      },
      deliveries: deliveries.map((item) => ({
        kind: item.kind,
        deliveryKey: item.deliveryKey,
        number: item.number,
        status: item.status,
        message: item.message,
        updatedAt: item.updatedAt
      })),
      ready: loaded.plan.map((item) => ({ kind: item.kind, deliveryKey: item.deliveryKey, label: item.label, number: item.number }))
    };
  }
});

export const deliveryPlan = query({
  args: { actorToken: v.optional(v.string()), expedienteId: v.id("expedientes") },
  returns: v.union(
    v.null(),
    v.object({
      code: v.string(),
      operacionesExpedienteId: v.string(),
      items: v.array(
        v.object({
          kind: deliveryKind,
          deliveryKey: v.string(),
          label: v.string(),
          number: v.optional(v.string()),
          manifestNumber: v.optional(v.string()),
          remesaNumber: v.optional(v.string()),
          fileName: v.optional(v.string()),
          artifactId: v.optional(v.id("evidenceArtifacts")),
          settled: v.boolean()
        })
      )
    })
  ),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const loaded = await loadLinkedDispatch(ctx, args.expedienteId, actor.organizationId);

    if (!loaded) {
      return null;
    }

    const recorded = await ctx.db
      .query("operacionesDeliveries")
      .withIndex("by_expediente", (q) => q.eq("expedienteId", args.expedienteId))
      .take(50);
    const applied = new Set(recorded.filter((item) => item.status === "applied").map((item) => item.deliveryKey));
    const items = [];

    for (const item of loaded.plan) {
      let artifactId: Id<"evidenceArtifacts"> | undefined;

      if (item.documentId) {
        const artifacts = await ctx.db
          .query("evidenceArtifacts")
          .withIndex("by_document", (q) => q.eq("documentId", item.documentId as Id<"documents">))
          .take(50);
        artifactId = artifacts
          .filter((artifact) => artifact.kind === "pdf")
          .sort((left, right) => right.createdAt - left.createdAt)[0]?._id;
      }

      items.push({
        kind: item.kind,
        deliveryKey: item.deliveryKey,
        label: item.label,
        number: item.number,
        manifestNumber: item.manifestNumber,
        remesaNumber: item.remesaNumber,
        fileName: item.fileName,
        artifactId,
        settled: applied.has(item.deliveryKey)
      });
    }

    return { code: loaded.code, operacionesExpedienteId: loaded.link.operacionesExpedienteId, items };
  }
});

export const recordDelivery = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
    kind: deliveryKind,
    deliveryKey: v.string(),
    number: v.optional(v.string()),
    status: deliveryStatus,
    message: v.string()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const expediente = await ctx.db.get("expedientes", args.expedienteId);

    if (!expediente) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Despacho no encontrado" });
    }

    requireSameOrganization(actor, expediente.organizationId);
    const now = Date.now();
    const existing = await ctx.db
      .query("operacionesDeliveries")
      .withIndex("by_expediente_and_key", (q) => q.eq("expedienteId", expediente._id).eq("deliveryKey", args.deliveryKey))
      .unique();
    const message = args.message.slice(0, 400);

    if (existing) {
      if (existing.status === args.status && existing.message === message) {
        return null;
      }
      await ctx.db.patch("operacionesDeliveries", existing._id, { status: args.status, message, deliveredBy: actor._id, updatedAt: now });
    } else {
      await ctx.db.insert("operacionesDeliveries", {
        organizationId: actor.organizationId,
        expedienteId: expediente._id,
        kind: args.kind,
        deliveryKey: args.deliveryKey,
        number: args.number,
        status: args.status,
        message,
        deliveredBy: actor._id,
        updatedAt: now
      });
    }

    if (args.status !== "failed" && existing?.status !== args.status) {
      await ctx.db.insert("expedienteEvents", {
        organizationId: actor.organizationId,
        expedienteId: expediente._id,
        eventType: "operaciones_delivery",
        title: args.status === "applied" ? `Enviado a Operaciones: ${message}` : `Recibido por Operaciones, en espera: ${message}`,
        occurredAt: now,
        actorId: actor._id
      });
    }

    return null;
  }
});

async function loadLinkedDispatch(ctx: QueryCtx, expedienteId: Id<"expedientes">, organizationId: Id<"organizations">) {
  const expediente = await ctx.db.get("expedientes", expedienteId);

  if (!expediente || expediente.organizationId !== organizationId) {
    return null;
  }

  const link = await ctx.db
    .query("operacionesLinks")
    .withIndex("by_expediente", (q) => q.eq("expedienteId", expedienteId))
    .unique();

  if (!link) {
    return null;
  }

  const documents = await ctx.db
    .query("documents")
    .withIndex("by_expediente", (q) => q.eq("expedienteId", expedienteId))
    .take(100);

  return {
    link,
    code: expediente.code,
    plan: buildOperacionesDeliveryPlan({ code: expediente.code, expediente, documents })
  };
}

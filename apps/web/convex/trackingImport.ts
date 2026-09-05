import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { appendAudit } from "./model/access";
import {
  checkpointKind,
  trackingQueue,
  trackingSource,
  trackingSummary,
} from "./model/trackingValidators";
import referenceCatalogue from "./model/trackingReference.json" with { type: "json" };

export const installReferenceCatalogues = internalMutation({
  args: { organizationId: v.id("organizations") },
  returns: v.object({ incidents: v.number(), alarms: v.number() }),
  handler: async (ctx, args) => {
    const organization = await ctx.db.get("organizations", args.organizationId);
    if (!organization || organization.status !== "active")
      throw new ConvexError("La organización no está activa.");
    let incidents = 0,
      alarms = 0;
    for (const [order, incident] of referenceCatalogue.incidents.entries()) {
      if (
        await ctx.db
          .query("trackingIncidents")
          .withIndex("by_org_code", (q) =>
            q
              .eq("organizationId", args.organizationId)
              .eq("code", incident.code),
          )
          .unique()
      )
        continue;
      await ctx.db.insert("trackingIncidents", {
        organizationId: args.organizationId,
        ...incident,
        order,
      });
      incidents++;
    }
    const existing = await ctx.db
      .query("trackingAlarms")
      .withIndex("by_org_code", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    const history = await ctx.db
      .query("auditEvents")
      .withIndex("by_organization_entity_and_created_at", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("entityType", "trackingCatalogue")
          .eq("entityId", args.organizationId),
      )
      .first();
    if (existing.length === 0 && !history)
      for (const alarm of referenceCatalogue.alarms) {
        await ctx.db.insert("trackingAlarms", {
          organizationId: args.organizationId,
          ...alarm,
          revision: 0,
          updatedAt: Date.now(),
        });
        alarms++;
      }
    if (!history)
      await appendAudit(ctx, {
        organizationId: args.organizationId,
        actorType: "system",
        action: "tracking.catalogues_installed",
        entityType: "trackingCatalogue",
        entityId: args.organizationId,
      });
    return { incidents, alarms };
  },
});

export const importDispatch = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    sourceKey: v.string(),
    externalCode: v.string(),
    expedienteId: v.optional(v.id("expedientes")),
    queue: trackingQueue,
    summary: trackingSummary,
    information: v.array(v.object({ label: v.string(), value: v.string() })),
    observations: v.string(),
    communications: v.string(),
    protections: v.string(),
    checkpoints: v.array(
      v.object({
        key: v.string(),
        code: v.string(),
        label: v.string(),
        kind: checkpointKind,
        scheduledAt: v.string(),
        completed: v.boolean(),
        order: v.number(),
      }),
    ),
    reports: v.array(
      v.object({
        key: v.string(),
        source: trackingSource,
        position: v.optional(v.union(v.literal("A"), v.literal("S"))),
        site: v.string(),
        incidentCode: v.string(),
        incidentLabel: v.string(),
        special: v.boolean(),
        controlAt: v.string(),
        recordedAt: v.string(),
        scheduledAt: v.string(),
        timeText: v.string(),
        requestedAt: v.optional(v.string()),
        controller: v.string(),
        observation: v.string(),
        createdAt: v.number(),
      }),
    ),
    notes: v.array(
      v.object({
        key: v.string(),
        site: v.string(),
        incident: v.string(),
        special: v.boolean(),
        observation: v.string(),
        recordedAt: v.string(),
        controller: v.string(),
      }),
    ),
    positions: v.array(
      v.object({
        key: v.string(),
        latitude: v.number(),
        longitude: v.number(),
        event: v.string(),
        recordedAt: v.string(),
        location: v.string(),
        speed: v.optional(v.number()),
      }),
    ),
    locations: v.array(
      v.object({ key: v.string(), name: v.string(), order: v.number() }),
    ),
  },
  returns: v.id("trackingDispatches"),
  handler: async (ctx, args) => {
    const organization = await ctx.db.get("organizations", args.organizationId);
    if (!organization || organization.status !== "active")
      throw new ConvexError("La organización no está activa.");
    if (!args.externalCode.trim() || !args.sourceKey.trim())
      throw new ConvexError("El despacho necesita una identidad de origen.");
    if (args.expedienteId) {
      const expediente = await ctx.db.get("expedientes", args.expedienteId);
      if (!expediente || expediente.organizationId !== args.organizationId)
        throw new ConvexError("El expediente no pertenece a la organización.");
    }
    const existing = await ctx.db
      .query("trackingDispatches")
      .withIndex("by_org_code", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("externalCode", args.externalCode),
      )
      .unique();
    if (existing) {
      if (existing.sourceKey !== args.sourceKey)
        throw new ConvexError(
          "El despacho ya tiene seguimiento. La importación no sobrescribe sus reportes.",
        );
      return existing._id;
    }
    for (const rows of [
      args.checkpoints,
      args.reports,
      args.notes,
      args.positions,
      args.locations,
    ]) {
      if (new Set(rows.map((row) => row.key)).size !== rows.length)
        throw new ConvexError(
          "Los registros necesitan claves únicas, aunque repitan sitio.",
        );
    }
    for (const point of args.positions) {
      if (
        !Number.isFinite(point.latitude) ||
        !Number.isFinite(point.longitude) ||
        Math.abs(point.latitude) > 90 ||
        Math.abs(point.longitude) > 180
      )
        throw new ConvexError("La posición no es válida.");
    }
    const { checkpoints, reports, notes, positions, locations, ...dispatch } =
      args;
    const dispatchId = await ctx.db.insert("trackingDispatches", {
      ...dispatch,
      revision: 0,
      updatedAt: Date.now(),
    });
    for (const checkpoint of checkpoints)
      await ctx.db.insert("trackingCheckpoints", {
        organizationId: args.organizationId,
        dispatchId,
        ...checkpoint,
      });
    for (const { key, ...report } of reports)
      await ctx.db.insert("trackingReports", {
        organizationId: args.organizationId,
        dispatchId,
        requestKey: key,
        ...report,
      });
    for (const note of notes)
      await ctx.db.insert("trackingNotes", {
        organizationId: args.organizationId,
        dispatchId,
        ...note,
      });
    for (const position of positions)
      await ctx.db.insert("trackingPositions", {
        organizationId: args.organizationId,
        dispatchId,
        ...position,
      });
    for (const location of locations) {
      if (
        !(await ctx.db
          .query("trackingLocations")
          .withIndex("by_org_key", (q) =>
            q.eq("organizationId", args.organizationId).eq("key", location.key),
          )
          .unique())
      )
        await ctx.db.insert("trackingLocations", {
          organizationId: args.organizationId,
          ...location,
        });
    }
    await appendAudit(ctx, {
      organizationId: args.organizationId,
      actorType: "system",
      action: "tracking.imported",
      entityType: "trackingDispatch",
      entityId: dispatchId,
      detailsJson: JSON.stringify({ sourceKey: args.sourceKey }),
    });
    return dispatchId;
  },
});

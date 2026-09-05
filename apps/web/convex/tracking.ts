import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  appendAudit,
  requireActor,
  requireSameOrganization,
} from "./model/access";
import {
  alarmDoc,
  noteDoc,
  checkpointDoc,
  incidentDoc,
  positionDoc,
  reportDoc,
  trackingDispatchDoc,
} from "./model/trackingValidators";
import {
  bogotaDateTime,
  normalizeAlarm,
  normalizeTrackingText,
  validateRequestedTime,
} from "./model/tracking";

const readers = ["admin", "operator", "auditor"] as const;
async function getDispatch(
  ctx: QueryCtx,
  dispatchId: Id<"trackingDispatches">,
) {
  const actor = await requireActor(ctx, undefined, [...readers]);
  const dispatch = await ctx.db.get("trackingDispatches", dispatchId);
  if (!dispatch) throw new ConvexError("El despacho no está disponible.");
  requireSameOrganization(actor, dispatch.organizationId);
  return { actor, dispatch };
}

export const board = query({
  args: {},
  returns: v.object({
    rows: v.array(trackingDispatchDoc),
    alarms: v.array(alarmDoc),
    canConfigure: v.boolean(),
  }),
  handler: async (ctx) => {
    const actor = await requireActor(ctx, undefined, [...readers]);
    const [enRoute, pending, alarms] = await Promise.all([
      ctx.db
        .query("trackingDispatches")
        .withIndex("by_org_queue", (q) =>
          q.eq("organizationId", actor.organizationId).eq("queue", "en_route"),
        )
        .collect(),
      ctx.db
        .query("trackingDispatches")
        .withIndex("by_org_queue", (q) =>
          q
            .eq("organizationId", actor.organizationId)
            .eq("queue", "pending_arrival"),
        )
        .collect(),
      ctx.db
        .query("trackingAlarms")
        .withIndex("by_org_code", (q) =>
          q.eq("organizationId", actor.organizationId),
        )
        .collect(),
    ]);
    return {
      rows: [...enRoute, ...pending],
      alarms: alarms.sort(
        (a, b) =>
          a.minutes - b.minutes ||
          a.code.localeCompare(b.code, "es", { numeric: true }),
      ),
      canConfigure: actor.roles.includes("admin"),
    };
  },
});

export const detail = query({
  args: { dispatchId: v.id("trackingDispatches") },
  returns: v.object({
    dispatch: trackingDispatchDoc,
    checkpoints: v.array(checkpointDoc),
    reports: v.array(reportDoc),
    notes: v.array(noteDoc),
    positions: v.array(positionDoc),
    incidents: v.array(incidentDoc),
    canReport: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { actor, dispatch } = await getDispatch(ctx, args.dispatchId);
    const [checkpoints, reports, positions, incidents, notes] =
      await Promise.all([
        ctx.db
          .query("trackingCheckpoints")
          .withIndex("by_dispatch", (q) => q.eq("dispatchId", dispatch._id))
          .collect(),
        ctx.db
          .query("trackingReports")
          .withIndex("by_dispatch", (q) => q.eq("dispatchId", dispatch._id))
          .collect(),
        ctx.db
          .query("trackingPositions")
          .withIndex("by_dispatch", (q) => q.eq("dispatchId", dispatch._id))
          .collect(),
        ctx.db
          .query("trackingIncidents")
          .withIndex("by_org_code", (q) =>
            q.eq("organizationId", actor.organizationId),
          )
          .collect(),
        ctx.db
          .query("trackingNotes")
          .withIndex("by_dispatch", (q) => q.eq("dispatchId", dispatch._id))
          .collect(),
      ]);
    return {
      dispatch,
      checkpoints: checkpoints.sort((a, b) => a.order - b.order),
      reports: reports.sort((a, b) => a.createdAt - b.createdAt),
      positions,
      notes: notes.sort(
        (a, b) =>
          b.recordedAt.localeCompare(a.recordedAt) ||
          b._creationTime - a._creationTime,
      ),
      incidents: incidents
        .filter((i) => i.selectable)
        .sort((a, b) => a.order - b.order),
      canReport:
        actor.roles.some((r) => r === "admin" || r === "operator") &&
        dispatch.queue !== "arrived",
    };
  },
});

export const locations = query({
  args: { search: v.string() },
  returns: v.array(v.object({ key: v.string(), name: v.string() })),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...readers]);
    const needle = normalizeTrackingText(args.search);
    if (needle.length < 5) return [];
    const rows = await ctx.db
      .query("trackingLocations")
      .withIndex("by_org_key", (q) =>
        q.eq("organizationId", actor.organizationId),
      )
      .collect();
    return rows
      .filter((row) => normalizeTrackingText(row.name).includes(needle))
      .sort((a, b) => a.order - b.order)
      .slice(0, 10)
      .map((row) => ({ key: row.key, name: row.name }));
  },
});

export const reportCheckpoint = mutation({
  args: {
    dispatchId: v.id("trackingDispatches"),
    checkpointId: v.id("trackingCheckpoints"),
    incidentCode: v.string(),
    position: v.union(v.literal("A"), v.literal("S")),
    site: v.string(),
    observation: v.string(),
    requestedAt: v.optional(v.string()),
    requestKey: v.string(),
    expectedRevision: v.number(),
  },
  returns: v.id("trackingReports"),
  handler: async (ctx, args) => {
    const { actor, dispatch } = await getDispatch(ctx, args.dispatchId);
    if (!actor.roles.some((r) => r === "admin" || r === "operator"))
      throw new ConvexError("No tienes permiso para registrar seguimientos.");
    if (!args.requestKey.trim() || args.requestKey.length > 100)
      throw new ConvexError("La solicitud de seguimiento no es válida.");
    const existing = await ctx.db
      .query("trackingReports")
      .withIndex("by_dispatch_request", (q) =>
        q.eq("dispatchId", dispatch._id).eq("requestKey", args.requestKey),
      )
      .unique();
    if (existing) {
      if (
        existing.checkpointId !== args.checkpointId ||
        existing.incidentCode !== args.incidentCode ||
        existing.position !== args.position ||
        existing.site !== args.site.trim() ||
        existing.observation !== args.observation ||
        existing.requestedAt !== args.requestedAt ||
        existing.createdBy !== actor._id
      )
        throw new ConvexError("Esta solicitud ya se usó con otros datos.");
      return existing._id;
    }
    if (dispatch.queue === "arrived")
      throw new ConvexError("Este despacho ya tiene llegada registrada.");
    if (dispatch.revision !== args.expectedRevision)
      throw new ConvexError(
        "El seguimiento cambió. Revisa la información actualizada antes de guardar.",
      );
    const checkpoint = await ctx.db.get(
      "trackingCheckpoints",
      args.checkpointId,
    );
    if (
      !checkpoint ||
      checkpoint.dispatchId !== dispatch._id ||
      checkpoint.organizationId !== actor.organizationId ||
      checkpoint.completed
    )
      throw new ConvexError("El punto de control ya no está pendiente.");
    const incident = await ctx.db
      .query("trackingIncidents")
      .withIndex("by_org_code", (q) =>
        q
          .eq("organizationId", actor.organizationId)
          .eq("code", args.incidentCode),
      )
      .unique();
    if (!incident?.selectable)
      throw new ConvexError("Selecciona una novedad disponible.");
    const site = args.site.trim();
    if (!site || site.length > 50)
      throw new ConvexError("El sitio debe tener entre 1 y 50 caracteres.");
    if (args.observation.length > 500)
      throw new ConvexError("La observación no puede superar 500 caracteres.");
    if (
      checkpoint.kind === "delivery" &&
      (args.position !== "S" || site !== checkpoint.label)
    )
      throw new ConvexError(
        "La entrega debe reportarse en el lugar de entrega.",
      );
    if (incident.requestsTime) {
      try {
        validateRequestedTime(args.requestedAt ?? "");
      } catch {
        throw new ConvexError("Indica la fecha y hora de la novedad.");
      }
    } else if (args.requestedAt !== undefined)
      throw new ConvexError("Esta novedad no solicita tiempo.");
    const now = Date.now(),
      recordedAt = bogotaDateTime(now);
    const reportId = await ctx.db.insert("trackingReports", {
      organizationId: actor.organizationId,
      dispatchId: dispatch._id,
      checkpointId: checkpoint._id,
      requestKey: args.requestKey,
      source: "tracking",
      site,
      position: args.position,
      incidentCode: incident.code,
      incidentLabel: incident.name,
      special: incident.special,
      controlAt: recordedAt,
      recordedAt,
      scheduledAt: checkpoint.scheduledAt,
      timeText: "",
      requestedAt: args.requestedAt,
      observation: args.observation,
      controller: actor.name,
      createdBy: actor._id,
      createdAt: now,
    });
    await ctx.db.insert("trackingNotes", {
      organizationId: actor.organizationId,
      dispatchId: dispatch._id,
      key: args.requestKey,
      site,
      incident: incident.name,
      special: incident.special,
      observation: args.observation,
      recordedAt,
      controller: actor.name,
    });
    const atCheckpoint = args.position === "S" && incident.code === "2";
    if (atCheckpoint)
      await ctx.db.patch("trackingCheckpoints", checkpoint._id, {
        completed: true,
      });
    const { time: _time, alarmCode: _alarm, ...summary } = dispatch.summary;
    await ctx.db.patch("trackingDispatches", dispatch._id, {
      queue:
        atCheckpoint && checkpoint.kind === "delivery"
          ? "pending_arrival"
          : dispatch.queue,
      revision: dispatch.revision + 1,
      updatedAt: now,
      summary: {
        ...summary,
        lastReportedAt: recordedAt,
        lastCheckpoint: site,
        incident: incident.name,
      },
    });
    await appendAudit(ctx, {
      organizationId: actor.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "tracking.reported",
      entityType: "trackingDispatch",
      entityId: dispatch._id,
      detailsJson: JSON.stringify({
        reportId,
        checkpointId: checkpoint._id,
        requestKey: args.requestKey,
      }),
      createdAt: now,
    });
    return reportId;
  },
});

export const alarms = query({
  args: {},
  returns: v.object({ alarms: v.array(alarmDoc), canConfigure: v.boolean() }),
  handler: async (ctx) => {
    const actor = await requireActor(ctx, undefined, [...readers]);
    const alarms = await ctx.db
      .query("trackingAlarms")
      .withIndex("by_org_code", (q) =>
        q.eq("organizationId", actor.organizationId),
      )
      .collect();
    return {
      alarms: alarms.sort(
        (a, b) =>
          a.minutes - b.minutes ||
          a.code.localeCompare(b.code, "es", { numeric: true }),
      ),
      canConfigure: actor.roles.includes("admin"),
    };
  },
});

export const saveAlarm = mutation({
  args: {
    alarmId: v.optional(v.id("trackingAlarms")),
    expectedRevision: v.optional(v.number()),
    name: v.string(),
    minutes: v.string(),
    color: v.string(),
  },
  returns: v.id("trackingAlarms"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, ["admin"]);
    let values;
    try {
      values = normalizeAlarm(args);
    } catch (error) {
      throw new ConvexError(
        error instanceof Error ? error.message : "Revisa la alarma.",
      );
    }
    let id: Id<"trackingAlarms">;
    if (args.alarmId) {
      const alarm = await ctx.db.get("trackingAlarms", args.alarmId);
      if (!alarm) throw new ConvexError("La alarma ya no existe.");
      requireSameOrganization(actor, alarm.organizationId);
      if (alarm.revision !== args.expectedRevision)
        throw new ConvexError(
          "La alarma cambió. Ábrela de nuevo para revisar sus valores.",
        );
      await ctx.db.patch("trackingAlarms", alarm._id, {
        ...values,
        revision: alarm.revision + 1,
        updatedAt: Date.now(),
      });
      id = alarm._id;
    } else {
      const alarms = await ctx.db
        .query("trackingAlarms")
        .withIndex("by_org_code", (q) =>
          q.eq("organizationId", actor.organizationId),
        )
        .collect();
      const code = String(
        Math.max(
          0,
          ...alarms.map((a) => Number(a.code)).filter(Number.isFinite),
        ) + 1,
      );
      id = await ctx.db.insert("trackingAlarms", {
        organizationId: actor.organizationId,
        code,
        ...values,
        revision: 0,
        updatedAt: Date.now(),
      });
    }
    await appendAudit(ctx, {
      organizationId: actor.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: args.alarmId
        ? "tracking.alarm_updated"
        : "tracking.alarm_created",
      entityType: "trackingAlarm",
      entityId: id,
    });
    return id;
  },
});

export const deleteAlarm = mutation({
  args: { alarmId: v.id("trackingAlarms"), expectedRevision: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, ["admin"]);
    const alarm = await ctx.db.get("trackingAlarms", args.alarmId);
    if (!alarm) throw new ConvexError("La alarma ya no existe.");
    requireSameOrganization(actor, alarm.organizationId);
    if (alarm.revision !== args.expectedRevision)
      throw new ConvexError(
        "La alarma cambió. Revisa sus valores antes de eliminarla.",
      );
    const used = await ctx.db
      .query("trackingDispatches")
      .withIndex("by_org_code", (q) =>
        q.eq("organizationId", actor.organizationId),
      )
      .collect();
    for (const dispatch of used.filter(
      (d) => d.summary.alarmCode === alarm.code,
    )) {
      const { alarmCode: _code, ...summary } = dispatch.summary;
      await ctx.db.patch("trackingDispatches", dispatch._id, {
        summary,
        revision: dispatch.revision + 1,
        updatedAt: Date.now(),
      });
    }
    await ctx.db.delete("trackingAlarms", alarm._id);
    await appendAudit(ctx, {
      organizationId: actor.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "tracking.alarm_deleted",
      entityType: "trackingAlarm",
      entityId: alarm._id,
      detailsJson: JSON.stringify({
        code: alarm.code,
        name: alarm.name,
        minutes: alarm.minutes,
        color: alarm.color,
      }),
    });
    return null;
  },
});

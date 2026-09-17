import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  appendAudit,
  requireActor,
  requireSameOrganization,
} from "./model/access";
import {
  monitoringAttachment,
  monitoringCargoCondition,
  monitoringChannel,
  monitoringReportDoc,
  monitoringTripDoc,
} from "./model/monitoringValidators";
import {
  describeReport,
  formatTripCode,
  nextDueAt,
  validateTripInput,
} from "./model/monitoring";

const readers = ["admin", "operator", "auditor"] as const;
const writers = ["admin", "operator"] as const;

async function getTrip(ctx: QueryCtx | MutationCtx, tripId: Id<"monitoringTrips">) {
  const actor = await requireActor(ctx, undefined, [...readers]);
  const trip = await ctx.db.get("monitoringTrips", tripId);
  if (!trip) throw new ConvexError("El viaje no está disponible.");
  requireSameOrganization(actor, trip.organizationId);
  return { actor, trip };
}

function canWrite(actor: Doc<"users">): boolean {
  return actor.roles.some((r) => r === "admin" || r === "operator");
}

const reportWithUrls = v.object({
  ...monitoringReportDoc.fields,
  attachmentUrls: v.array(
    v.object({
      fileName: v.string(),
      contentType: v.string(),
      url: v.union(v.string(), v.null()),
    }),
  ),
});

export const board = query({
  args: {},
  returns: v.object({
    trips: v.array(monitoringTripDoc),
    canReport: v.boolean(),
    isAdmin: v.boolean(),
  }),
  handler: async (ctx) => {
    const actor = await requireActor(ctx, undefined, [...readers]);
    const trips = await ctx.db
      .query("monitoringTrips")
      .withIndex("by_org_status", (q) =>
        q.eq("organizationId", actor.organizationId),
      )
      .collect();
    trips.sort((a, b) => {
      if (a.status !== b.status) return a.status === "en_ruta" ? -1 : 1;
      if (a.status === "en_ruta")
        return (a.nextDueAt ?? 0) - (b.nextDueAt ?? 0);
      return (b.deliveredAt ?? 0) - (a.deliveredAt ?? 0);
    });
    return {
      trips,
      canReport: canWrite(actor),
      isAdmin: actor.roles.includes("admin"),
    };
  },
});

export const detail = query({
  args: { tripId: v.id("monitoringTrips") },
  returns: v.union(
    v.object({
      trip: monitoringTripDoc,
      reports: v.array(reportWithUrls),
      canReport: v.boolean(),
      isAdmin: v.boolean(),
      organizationName: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...readers]);
    const trip = await ctx.db.get("monitoringTrips", args.tripId);
    if (!trip || trip.organizationId !== actor.organizationId) return null;
    const organization = await ctx.db.get("organizations", trip.organizationId);
    const rows = await ctx.db
      .query("monitoringReports")
      .withIndex("by_trip", (q) => q.eq("tripId", trip._id))
      .collect();
    rows.sort((a, b) => a.at - b.at || a.createdAt - b.createdAt);
    const reports = await Promise.all(
      rows.map(async (report) => ({
        ...report,
        attachmentUrls: await Promise.all(
          (report.attachments ?? []).map(async (file) => ({
            fileName: file.fileName,
            contentType: file.contentType,
            url: await ctx.storage.getUrl(file.storageId),
          })),
        ),
      })),
    );
    return {
      trip,
      reports,
      canReport: canWrite(actor) && trip.status === "en_ruta",
      isAdmin: actor.roles.includes("admin"),
      organizationName: organization?.name ?? "",
    };
  },
});

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireActor(ctx, undefined, [...writers]);
    return await ctx.storage.generateUploadUrl();
  },
});

export const createTrip = mutation({
  args: {
    manifest: v.optional(v.string()),
    origin: v.string(),
    destination: v.string(),
    waypoints: v.array(v.string()),
    plate: v.string(),
    trailerPlate: v.optional(v.string()),
    driverName: v.string(),
    driverDocument: v.optional(v.string()),
    driverPhone: v.string(),
    customer: v.string(),
    cargo: v.string(),
    departureAt: v.number(),
    expectedArrivalAt: v.optional(v.number()),
    intervalMinutes: v.number(),
    observations: v.optional(v.string()),
    registerDeparture: v.boolean(),
  },
  returns: v.id("monitoringTrips"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...writers]);
    try {
      validateTripInput(args);
    } catch (error) {
      throw new ConvexError((error as Error).message);
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("monitoringTrips")
      .withIndex("by_org_code", (q) =>
        q.eq("organizationId", actor.organizationId),
      )
      .collect();
    const sequence =
      existing.reduce(
        (max, trip) => Math.max(max, Number(trip.code.replace(/\D/g, "")) || 0),
        0,
      ) + 1;
    const clean = (value?: string) => value?.trim() || undefined;
    const tripId = await ctx.db.insert("monitoringTrips", {
      organizationId: actor.organizationId,
      code: formatTripCode(sequence),
      manifest: clean(args.manifest),
      origin: args.origin.trim(),
      destination: args.destination.trim(),
      waypoints: args.waypoints.map((w) => w.trim()).filter(Boolean),
      plate: args.plate.trim().toUpperCase(),
      trailerPlate: clean(args.trailerPlate)?.toUpperCase(),
      driverName: args.driverName.trim(),
      driverDocument: clean(args.driverDocument),
      driverPhone: args.driverPhone.trim(),
      customer: args.customer.trim(),
      cargo: args.cargo.trim(),
      departureAt: args.departureAt,
      expectedArrivalAt: args.expectedArrivalAt,
      intervalMinutes: args.intervalMinutes,
      status: "en_ruta",
      observations: clean(args.observations),
      reportCount: 0,
      nextDueAt: nextDueAt(args.departureAt, args.intervalMinutes),
      createdBy: actor._id,
      createdByName: actor.name,
      createdAt: now,
      updatedAt: now,
    });
    if (args.registerDeparture) {
      await insertReport(ctx, actor, tripId, {
        requestKey: `inicio:${tripId}`,
        kind: "inicio",
        at: args.departureAt,
        location: args.origin.trim(),
        channel: "presencial",
        contacted: true,
        hasNovelty: false,
        observation:
          "Vehículo cargado y despachado. Se confirma inicio de viaje y se activa el monitoreo en ruta.",
      });
    }
    await appendAudit(ctx, {
      organizationId: actor.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "monitoring.trip.created",
      entityType: "monitoringTrip",
      entityId: tripId,
      createdAt: now,
    });
    return tripId;
  },
});

type ReportInput = {
  requestKey: string;
  kind: "inicio" | "control" | "novedad" | "entrega";
  at: number;
  location: string;
  channel: "llamada" | "whatsapp" | "presencial" | "otro";
  contacted: boolean;
  hasNovelty: boolean;
  noveltyType?: string;
  observation: string;
  receivedBy?: string;
  deliveredWeightKg?: number;
  cargoCondition?: "conforme" | "con_novedad";
  documents?: string[];
  attachments?: Array<{
    storageId: Id<"_storage">;
    fileName: string;
    contentType: string;
  }>;
};

async function insertReport(
  ctx: MutationCtx,
  actor: Doc<"users">,
  tripId: Id<"monitoringTrips">,
  input: ReportInput,
): Promise<Id<"monitoringReports">> {
  const trip = await ctx.db.get("monitoringTrips", tripId);
  if (!trip) throw new ConvexError("El viaje no está disponible.");
  const duplicate = await ctx.db
    .query("monitoringReports")
    .withIndex("by_trip_request", (q) =>
      q.eq("tripId", tripId).eq("requestKey", input.requestKey),
    )
    .unique();
  if (duplicate) return duplicate._id;
  if (!input.location.trim())
    throw new ConvexError("Indica el lugar o municipio del reporte.");
  if (input.observation.length > 1000)
    throw new ConvexError("La observación no puede superar 1000 caracteres.");
  const now = Date.now();
  const reportId = await ctx.db.insert("monitoringReports", {
    organizationId: trip.organizationId,
    tripId,
    requestKey: input.requestKey,
    kind: input.kind,
    at: input.at,
    location: input.location.trim(),
    channel: input.channel,
    contacted: input.contacted,
    hasNovelty: input.hasNovelty,
    noveltyType: input.hasNovelty ? input.noveltyType?.trim() || "Otra novedad" : undefined,
    observation: input.observation.trim(),
    receivedBy: input.receivedBy?.trim() || undefined,
    deliveredWeightKg: input.deliveredWeightKg,
    cargoCondition: input.cargoCondition,
    documents: input.documents,
    attachments: input.attachments,
    operatorName: actor.name,
    createdBy: actor._id,
    createdAt: now,
  });
  const isLatest = !trip.lastReportAt || input.at >= trip.lastReportAt;
  await ctx.db.patch("monitoringTrips", tripId, {
    reportCount: trip.reportCount + 1,
    updatedAt: now,
    ...(isLatest
      ? {
          lastReportAt: input.at,
          lastReportSummary: describeReport(input),
          lastReportHasNovelty: input.hasNovelty,
          nextDueAt:
            input.kind === "entrega"
              ? undefined
              : nextDueAt(input.at, trip.intervalMinutes),
        }
      : {}),
    ...(input.kind === "entrega"
      ? { status: "entregado" as const, deliveredAt: input.at, nextDueAt: undefined }
      : {}),
  });
  await appendAudit(ctx, {
    organizationId: trip.organizationId,
    actorType: "user",
    actorId: actor._id,
    action: `monitoring.report.${input.kind}`,
    entityType: "monitoringTrip",
    entityId: tripId,
    detailsJson: JSON.stringify({ reportId, at: input.at, location: input.location }),
    createdAt: now,
  });
  return reportId;
}

export const addReport = mutation({
  args: {
    tripId: v.id("monitoringTrips"),
    requestKey: v.string(),
    at: v.number(),
    location: v.string(),
    channel: monitoringChannel,
    contacted: v.boolean(),
    hasNovelty: v.boolean(),
    noveltyType: v.optional(v.string()),
    observation: v.string(),
  },
  returns: v.id("monitoringReports"),
  handler: async (ctx, args) => {
    const { actor, trip } = await getTrip(ctx, args.tripId);
    if (!canWrite(actor))
      throw new ConvexError("Tu cargo no permite registrar reportes.");
    if (trip.status !== "en_ruta")
      throw new ConvexError("El viaje ya fue entregado; no admite más reportes.");
    if (args.at < trip.departureAt - 60 * 60 * 1000)
      throw new ConvexError("El reporte no puede ser anterior a la salida del viaje.");
    if (args.at > Date.now() + 10 * 60 * 1000)
      throw new ConvexError("El reporte no puede tener una hora futura.");
    return await insertReport(ctx, actor, trip._id, {
      ...args,
      kind: args.hasNovelty ? "novedad" : "control",
    });
  },
});

export const registerDelivery = mutation({
  args: {
    tripId: v.id("monitoringTrips"),
    requestKey: v.string(),
    at: v.number(),
    location: v.string(),
    receivedBy: v.string(),
    deliveredWeightKg: v.optional(v.number()),
    cargoCondition: monitoringCargoCondition,
    documents: v.array(v.string()),
    attachments: v.array(monitoringAttachment),
    observation: v.string(),
  },
  returns: v.id("monitoringReports"),
  handler: async (ctx, args) => {
    const { actor, trip } = await getTrip(ctx, args.tripId);
    if (!canWrite(actor))
      throw new ConvexError("Tu cargo no permite registrar la entrega.");
    if (trip.status !== "en_ruta")
      throw new ConvexError("El viaje ya tiene una entrega registrada.");
    if (!args.receivedBy.trim())
      throw new ConvexError("Indica quién recibió la carga.");
    if (args.at > Date.now() + 10 * 60 * 1000)
      throw new ConvexError("La entrega no puede tener una hora futura.");
    if (
      args.deliveredWeightKg !== undefined &&
      (!Number.isFinite(args.deliveredWeightKg) || args.deliveredWeightKg <= 0)
    )
      throw new ConvexError("El peso entregado debe ser un número mayor que cero.");
    return await insertReport(ctx, actor, trip._id, {
      requestKey: args.requestKey,
      kind: "entrega",
      at: args.at,
      location: args.location,
      channel: "presencial",
      contacted: true,
      hasNovelty: args.cargoCondition === "con_novedad",
      noveltyType:
        args.cargoCondition === "con_novedad" ? "Novedad en la entrega" : undefined,
      observation: args.observation,
      receivedBy: args.receivedBy,
      deliveredWeightKg: args.deliveredWeightKg,
      cargoCondition: args.cargoCondition,
      documents: args.documents,
      attachments: args.attachments,
    });
  },
});

export const deleteTrip = mutation({
  args: { tripId: v.id("monitoringTrips") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { actor, trip } = await getTrip(ctx, args.tripId);
    if (!actor.roles.includes("admin"))
      throw new ConvexError("Solo un administrador puede eliminar un viaje.");
    const reports = await ctx.db
      .query("monitoringReports")
      .withIndex("by_trip", (q) => q.eq("tripId", trip._id))
      .collect();
    for (const report of reports) {
      for (const file of report.attachments ?? [])
        await ctx.storage.delete(file.storageId);
      await ctx.db.delete("monitoringReports", report._id);
    }
    await ctx.db.delete("monitoringTrips", trip._id);
    await appendAudit(ctx, {
      organizationId: trip.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "monitoring.trip.deleted",
      entityType: "monitoringTrip",
      entityId: trip._id,
      reason: trip.code,
    });
    return null;
  },
});

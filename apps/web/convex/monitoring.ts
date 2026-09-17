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
  monitoringRouteGeometry,
  monitoringTripDoc,
} from "./model/monitoringValidators";
import {
  describeReport,
  formatTripCode,
  nextDueAt,
  normalizeMonitoringText,
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

type Place = { lat: number; lng: number; name: string };

function placeTokens(text: string): string[] {
  return text
    .split(/[,·|/()-]+/)
    .map((token) => normalizeMonitoringText(token).replace(/\bd\.?c\.?$/i, "").replace(/[^a-z0-9 ]/g, "").trim())
    .filter((token) => token.length >= 3);
}

const placeName = (name: string) => placeTokens(name)[0] ?? normalizeMonitoringText(name);

type Corridor = { a: Place; b: Place } | null;

function distanceToCorridor(place: { lat: number; lng: number }, corridor: Corridor): number {
  if (!corridor) return 0;
  const { a, b } = corridor;
  const kx = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const ax = a.lng * kx, ay = a.lat, bx = b.lng * kx, by = b.lat, px = place.lng * kx, py = place.lat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

async function resolvePlace(ctx: QueryCtx, text: string, hints: string[] = [], corridor: Corridor = null): Promise<Place | null> {
  const tokens = placeTokens(text);
  const hintTokens = hints.flatMap(placeTokens);
  for (const token of tokens) {
    const candidates = (
      await ctx.db
        .query("rndcDivisions")
        .withSearchIndex("search_text", (q) => q.search("searchText", token).eq("isMunicipality", true))
        .take(12)
    )
      .filter((row) => row.latitude && row.longitude)
      .map((row) => ({ lat: Number(row.latitude), lng: Number(row.longitude), name: row.name, department: normalizeMonitoringText(row.departmentName) }));
    const exact = candidates.filter((row) => placeName(row.name) === token);
    const byHint = exact.find((row) => [...tokens, ...hintTokens].some((t) => t !== token && row.department === t));
    const byCorridor = corridor && exact.length > 1 ? [...exact].sort((x, y) => distanceToCorridor(x, corridor) - distanceToCorridor(y, corridor))[0] : undefined;
    const preferred =
      byHint ?? byCorridor ?? exact[0] ?? candidates.find((row) => token.includes(placeName(row.name)) && placeName(row.name).length >= 4);
    if (preferred) return { lat: preferred.lat, lng: preferred.lng, name: preferred.name };
  }
  return null;
}

const mapStop = v.object({
  index: v.number(),
  name: v.string(),
  role: v.union(v.literal("origin"), v.literal("waypoint"), v.literal("destination")),
  lat: v.union(v.number(), v.null()),
  lng: v.union(v.number(), v.null()),
});
const mapReport = v.object({
  _id: v.id("monitoringReports"),
  at: v.number(),
  location: v.string(),
  kind: v.string(),
  hasNovelty: v.boolean(),
  noveltyType: v.optional(v.string()),
  observation: v.string(),
  operatorName: v.string(),
  channel: v.string(),
  contacted: v.boolean(),
  stopIndex: v.union(v.number(), v.null()),
  lat: v.union(v.number(), v.null()),
  lng: v.union(v.number(), v.null()),
});

export const mapData = query({
  args: { tripId: v.id("monitoringTrips") },
  returns: v.union(
    v.object({
      stops: v.array(mapStop),
      reports: v.array(mapReport),
      routeGeometry: v.union(monitoringRouteGeometry, v.null()),
      stopsKey: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...readers]);
    const trip = await ctx.db.get("monitoringTrips", args.tripId);
    if (!trip || trip.organizationId !== actor.organizationId) return null;
    const names = [trip.origin, ...trip.waypoints, trip.destination];
    const originPlace = await resolvePlace(ctx, trip.origin, [trip.destination]);
    const destinationPlace = await resolvePlace(ctx, trip.destination, [trip.origin]);
    const corridor: Corridor = originPlace && destinationPlace ? { a: originPlace, b: destinationPlace } : null;
    const stops = await Promise.all(
      names.map(async (name, index) => {
        const place = index === 0 ? originPlace : index === names.length - 1 ? destinationPlace : await resolvePlace(ctx, name, [trip.origin, trip.destination], corridor);
        return {
          index,
          name,
          role: (index === 0 ? "origin" : index === names.length - 1 ? "destination" : "waypoint") as "origin" | "waypoint" | "destination",
          lat: place?.lat ?? null,
          lng: place?.lng ?? null,
        };
      }),
    );
    const rows = await ctx.db
      .query("monitoringReports")
      .withIndex("by_trip", (q) => q.eq("tripId", trip._id))
      .collect();
    rows.sort((a, b) => a.at - b.at);
    const stopKey = placeName;
    const reports = [];
    for (const [index, report] of rows.entries()) {
      const location = normalizeMonitoringText(report.location);
      let stopIndex: number | null = null;
      if (report.kind === "inicio") stopIndex = 0;
      else if (report.kind === "entrega") stopIndex = stops.length - 1;
      else {
        const match = stops.findIndex((stop) => {
          const key = stopKey(stop.name);
          return key.length >= 3 && location.includes(key);
        });
        stopIndex = match >= 0 ? match : null;
      }
      const stop = stopIndex !== null ? stops[stopIndex] : null;
      const place = stop?.lat !== null && stop?.lat !== undefined ? { lat: stop.lat, lng: stop.lng! } : await resolvePlace(ctx, report.location, [trip.destination, trip.origin], corridor);
      reports.push({
        _id: report._id,
        at: report.at,
        location: report.location,
        kind: report.kind,
        hasNovelty: report.hasNovelty,
        noveltyType: report.noveltyType,
        observation: report.observation,
        operatorName: report.operatorName,
        channel: report.channel,
        contacted: report.contacted,
        stopIndex,
        lat: place?.lat ?? null,
        lng: place?.lng ?? null,
      });
      void index;
    }
    const stopsKey = stops.map((s) => (s.lat === null ? "x" : `${s.lng!.toFixed(4)},${s.lat.toFixed(4)}`)).join(";");
    return {
      stops,
      reports,
      routeGeometry: trip.routeGeometry && trip.routeGeometry.stopsKey === stopsKey ? trip.routeGeometry : null,
      stopsKey,
    };
  },
});

export const saveRouteGeometry = mutation({
  args: {
    tripId: v.id("monitoringTrips"),
    stopsKey: v.string(),
    coordinates: v.array(v.array(v.number())),
    distanceKm: v.number(),
    durationMin: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { trip } = await getTrip(ctx, args.tripId);
    if (args.coordinates.length < 2 || args.coordinates.length > 6000 || args.coordinates.some((c) => c.length !== 2))
      throw new ConvexError("La geometría de la ruta no es válida.");
    if (trip.routeGeometry?.stopsKey === args.stopsKey) return null;
    await ctx.db.patch("monitoringTrips", trip._id, {
      routeGeometry: {
        coordinates: args.coordinates,
        distanceKm: args.distanceKm,
        durationMin: args.durationMin,
        stopsKey: args.stopsKey,
        computedAt: Date.now(),
      },
    });
    return null;
  },
});

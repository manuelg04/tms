import { v } from "convex/values";

export const monitoringTripStatus = v.union(
  v.literal("en_ruta"),
  v.literal("entregado"),
);
export const monitoringReportKind = v.union(
  v.literal("inicio"),
  v.literal("control"),
  v.literal("novedad"),
  v.literal("entrega_parcial"),
  v.literal("entrega"),
);
export const monitoringChannel = v.union(
  v.literal("llamada"),
  v.literal("whatsapp"),
  v.literal("presencial"),
  v.literal("otro"),
);
export const monitoringCargoCondition = v.union(
  v.literal("conforme"),
  v.literal("con_novedad"),
);
export const monitoringAttachment = v.object({
  storageId: v.id("_storage"),
  fileName: v.string(),
  contentType: v.string(),
});
export const monitoringRouteGeometry = v.object({
  coordinates: v.array(v.array(v.number())),
  distanceKm: v.number(),
  durationMin: v.number(),
  stopsKey: v.string(),
  computedAt: v.number(),
});
export const monitoringTripFields = {
  organizationId: v.id("organizations"),
  code: v.string(),
  manifest: v.optional(v.string()),
  origin: v.string(),
  destination: v.string(),
  waypoints: v.array(v.string()),
  deliveryWaypoints: v.optional(v.array(v.string())),
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
  status: monitoringTripStatus,
  observations: v.optional(v.string()),
  lastReportAt: v.optional(v.number()),
  lastReportSummary: v.optional(v.string()),
  lastReportHasNovelty: v.optional(v.boolean()),
  nextDueAt: v.optional(v.number()),
  reportCount: v.number(),
  deliveredAt: v.optional(v.number()),
  routeGeometry: v.optional(monitoringRouteGeometry),
  actualGeometry: v.optional(monitoringRouteGeometry),
  createdBy: v.optional(v.id("users")),
  createdByName: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
};
export const monitoringTripDoc = v.object({
  _id: v.id("monitoringTrips"),
  _creationTime: v.number(),
  ...monitoringTripFields,
});
export const monitoringReportFields = {
  organizationId: v.id("organizations"),
  tripId: v.id("monitoringTrips"),
  requestKey: v.string(),
  kind: monitoringReportKind,
  at: v.number(),
  location: v.string(),
  municipality: v.optional(v.string()),
  municipalityCode: v.optional(v.string()),
  reference: v.optional(v.string()),
  channel: monitoringChannel,
  contacted: v.boolean(),
  hasNovelty: v.boolean(),
  noveltyType: v.optional(v.string()),
  observation: v.string(),
  receivedBy: v.optional(v.string()),
  deliveredWeightKg: v.optional(v.number()),
  cargoCondition: v.optional(monitoringCargoCondition),
  documents: v.optional(v.array(v.string())),
  attachments: v.optional(v.array(monitoringAttachment)),
  operatorName: v.string(),
  createdBy: v.optional(v.id("users")),
  createdAt: v.number(),
};
export const monitoringReportDoc = v.object({
  _id: v.id("monitoringReports"),
  _creationTime: v.number(),
  ...monitoringReportFields,
});

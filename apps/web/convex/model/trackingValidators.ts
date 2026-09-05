import { v } from "convex/values";

export const trackingQueue = v.union(
  v.literal("en_route"),
  v.literal("pending_arrival"),
  v.literal("arrived"),
);
export const trackingSource = v.union(
  v.literal("tracking"),
  v.literal("gps"),
  v.literal("mobile"),
);
export const checkpointKind = v.union(
  v.literal("physical"),
  v.literal("virtual"),
  v.literal("delivery"),
);
export const trackingSummary = v.object({
  nem: v.string(),
  manifest: v.string(),
  manifestType: v.string(),
  origin: v.string(),
  destination: v.string(),
  plate: v.string(),
  cargo: v.string(),
  affiliation: v.string(),
  bodyType: v.string(),
  departureDate: v.string(),
  driver: v.string(),
  rating: v.string(),
  customer: v.string(),
  phone: v.string(),
  lastReportedAt: v.string(),
  lastCheckpoint: v.string(),
  incident: v.string(),
  time: v.optional(v.string()),
  alarmCode: v.optional(v.string()),
});
export const trackingDispatchFields = {
  organizationId: v.id("organizations"),
  externalCode: v.string(),
  expedienteId: v.optional(v.id("expedientes")),
  sourceKey: v.string(),
  queue: trackingQueue,
  summary: trackingSummary,
  revision: v.number(),
  information: v.array(v.object({ label: v.string(), value: v.string() })),
  observations: v.string(),
  communications: v.string(),
  protections: v.string(),
  updatedAt: v.number(),
};
export const trackingDispatchDoc = v.object({
  _id: v.id("trackingDispatches"),
  _creationTime: v.number(),
  ...trackingDispatchFields,
});
export const checkpointFields = {
  organizationId: v.id("organizations"),
  dispatchId: v.id("trackingDispatches"),
  key: v.string(),
  code: v.string(),
  label: v.string(),
  kind: checkpointKind,
  scheduledAt: v.string(),
  order: v.number(),
  completed: v.boolean(),
};
export const checkpointDoc = v.object({
  _id: v.id("trackingCheckpoints"),
  _creationTime: v.number(),
  ...checkpointFields,
});
export const reportFields = {
  organizationId: v.id("organizations"),
  dispatchId: v.id("trackingDispatches"),
  requestKey: v.string(),
  checkpointId: v.optional(v.id("trackingCheckpoints")),
  source: trackingSource,
  site: v.string(),
  position: v.optional(v.union(v.literal("A"), v.literal("S"))),
  incidentCode: v.string(),
  incidentLabel: v.string(),
  special: v.boolean(),
  controlAt: v.string(),
  recordedAt: v.string(),
  scheduledAt: v.string(),
  timeText: v.string(),
  requestedAt: v.optional(v.string()),
  observation: v.string(),
  controller: v.string(),
  createdBy: v.optional(v.id("users")),
  createdAt: v.number(),
};
export const reportDoc = v.object({
  _id: v.id("trackingReports"),
  _creationTime: v.number(),
  ...reportFields,
});
export const incidentFields = {
  organizationId: v.id("organizations"),
  code: v.string(),
  name: v.string(),
  generatesAlert: v.boolean(),
  requestsTime: v.boolean(),
  special: v.boolean(),
  maintainsAlarm: v.boolean(),
  selectable: v.boolean(),
  order: v.number(),
};
export const incidentDoc = v.object({
  _id: v.id("trackingIncidents"),
  _creationTime: v.number(),
  ...incidentFields,
});
export const alarmFields = {
  organizationId: v.id("organizations"),
  code: v.string(),
  name: v.string(),
  minutes: v.number(),
  color: v.string(),
  revision: v.number(),
  updatedAt: v.number(),
};
export const alarmDoc = v.object({
  _id: v.id("trackingAlarms"),
  _creationTime: v.number(),
  ...alarmFields,
});
export const locationFields = {
  organizationId: v.id("organizations"),
  key: v.string(),
  name: v.string(),
  order: v.number(),
};
export const positionFields = {
  organizationId: v.id("organizations"),
  dispatchId: v.id("trackingDispatches"),
  key: v.string(),
  latitude: v.number(),
  longitude: v.number(),
  event: v.string(),
  recordedAt: v.string(),
  location: v.string(),
  speed: v.optional(v.number()),
};
export const positionDoc = v.object({
  _id: v.id("trackingPositions"),
  _creationTime: v.number(),
  ...positionFields,
});

export const noteFields = {
  organizationId: v.id("organizations"),
  dispatchId: v.id("trackingDispatches"),
  key: v.string(),
  site: v.string(),
  incident: v.string(),
  special: v.boolean(),
  observation: v.string(),
  recordedAt: v.string(),
  controller: v.string(),
};
export const noteDoc = v.object({
  _id: v.id("trackingNotes"),
  _creationTime: v.number(),
  ...noteFields,
});

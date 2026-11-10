import { v } from "convex/values";
import { checkpointKind } from "./trackingValidators";

export const pointInput = {
  code: v.string(),
  name: v.string(),
  cityCode: v.string(),
  city: v.string(),
  controller: v.string(),
  address: v.string(),
  phone: v.string(),
  virtual: v.boolean(),
  active: v.boolean(),
  latitude: v.optional(v.union(v.number(), v.string())),
  longitude: v.optional(v.union(v.number(), v.string())),
  temperature: v.optional(v.union(v.number(), v.string())),
  altitude: v.optional(v.union(v.number(), v.string())),
  photoId: v.optional(v.id("_storage")),
};
export const pointFields = {
  organizationId: v.id("organizations"),
  ...pointInput,
  source: v.union(v.literal("avansat"), v.literal("tms")),
  revision: v.number(),
  updatedAt: v.number(),
};
export const pointDoc = v.object({
  _id: v.id("operationalPoints"),
  _creationTime: v.number(),
  ...pointFields,
});
export const routeStop = v.object({
  key: v.string(),
  pointCode: v.string(),
  minutes: v.union(v.number(), v.string()),
  kilometers: v.optional(v.union(v.number(), v.string())),
  active: v.optional(v.boolean()),
  assigned: v.optional(v.boolean()),
});
export const routeInput = {
  code: v.string(),
  origin: v.string(),
  originCode: v.string(),
  destination: v.string(),
  destinationCode: v.string(),
  via: v.string(),
  active: v.boolean(),
  stops: v.array(routeStop),
};
export const routeFields = {
  organizationId: v.id("organizations"),
  ...routeInput,
  source: v.union(v.literal("avansat"), v.literal("tms")),
  revision: v.number(),
  updatedAt: v.number(),
};
export const routeDoc = v.object({
  _id: v.id("operationalRoutes"),
  _creationTime: v.number(),
  ...routeFields,
});
export const plannedStop = v.object({
  key: v.string(),
  code: v.string(),
  label: v.string(),
  kind: checkpointKind,
  minutes: v.number(),
  kilometers: v.optional(v.number()),
  scheduledAt: v.string(),
  controller: v.string(),
  address: v.string(),
  phone: v.string(),
});
export const planFields = {
  organizationId: v.id("organizations"),
  dispatchId: v.id("trackingDispatches"),
  routeId: v.id("operationalRoutes"),
  routeCode: v.string(),
  routeRevision: v.number(),
  origin: v.string(),
  originCode: v.string(),
  destination: v.string(),
  destinationCode: v.string(),
  via: v.string(),
  departureAt: v.string(),
  stops: v.array(plannedStop),
  createdAt: v.number(),
  createdBy: v.id("users"),
  requestKey: v.string(),
};
export const planDoc = v.object({
  _id: v.id("routePlans"),
  _creationTime: v.number(),
  ...planFields,
});
export const dispatchPlanFields = {
  organizationId: v.id("organizations"),
  expedienteId: v.id("expedientes"),
  routeId: v.id("operationalRoutes"),
  routeCode: v.string(),
  routeRevision: v.number(),
  origin: v.string(),
  originCode: v.string(),
  destination: v.string(),
  destinationCode: v.string(),
  via: v.string(),
  departureAt: v.string(),
  stops: v.array(plannedStop),
  createdAt: v.number(),
  createdBy: v.id("users"),
  requestKey: v.string(),
};
export const dispatchPlanDoc = v.object({
  _id: v.id("dispatchRoutePlans"),
  _creationTime: v.number(),
  ...dispatchPlanFields,
});

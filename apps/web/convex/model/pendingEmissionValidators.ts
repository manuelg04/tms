import { v } from "convex/values";

export const chainScope = v.union(v.literal("orden"), v.literal("remesas"), v.literal("manifiesto"));
export const pendingStatus = v.union(v.literal("waiting"), v.literal("attention"));

export const pendingEmissionFields = {
  organizationId: v.id("organizations"),
  expedienteId: v.id("expedientes"),
  scope: chainScope,
  status: pendingStatus,
  requestedBy: v.id("users"),
  requestedByName: v.string(),
  requestedAt: v.number(),
  attempts: v.number(),
  lastAttemptAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
};

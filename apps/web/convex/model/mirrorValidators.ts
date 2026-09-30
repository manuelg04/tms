import { v } from "convex/values";

export const mirrorProcess = v.union(
  ...[3, 4, 5, 6, 9, 32, 28, 29].map((n) => v.literal(n)),
);
export const mirrorRecord = v.object({
  radicado: v.string(),
  date: v.string(),
  documentDate: v.string(),
  manifest: v.string(),
  remesa: v.string(),
  plate: v.string(),
  fields: v.record(v.string(), v.string()),
});
export const mirrorRecordFields = {
  organizationId: v.id("organizations"),
  companyRndcNit: v.string(),
  process: mirrorProcess,
  ...mirrorRecord.fields,
  runId: v.id("rndcMirrorRuns"),
  queriedAt: v.number(),
};
export const mirrorRecordDoc = v.object({
  _id: v.id("rndcMirrorRecords"),
  _creationTime: v.number(),
  ...mirrorRecordFields,
});
export const mirrorRunFields = {
  organizationId: v.id("organizations"),
  companyRndcNit: v.string(),
  process: mirrorProcess,
  from: v.string(),
  to: v.string(),
  externalId: v.string(),
  startedAt: v.string(),
  finishedAt: v.string(),
  createdAt: v.number(),
  completed: v.boolean(),
  count: v.number(),
  evidenceId: v.id("_storage"),
};
export const mirrorRunDoc = v.object({
  _id: v.id("rndcMirrorRuns"),
  _creationTime: v.number(),
  ...mirrorRunFields,
});

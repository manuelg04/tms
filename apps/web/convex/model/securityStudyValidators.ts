import { v } from "convex/values";

export const securityStudyStatus = v.union(
  v.literal("pendiente"),
  v.literal("en_estudio"),
  v.literal("aprobado"),
  v.literal("rechazado"),
);
export const securityCheckResult = v.union(
  v.literal("sin_consultar"),
  v.literal("sin_novedad"),
  v.literal("con_hallazgo"),
);
export const dossierDocument = v.object({
  id: v.string(),
  kind: v.string(),
  storageId: v.id("_storage"),
  fileName: v.string(),
  contentType: v.string(),
  note: v.optional(v.string()),
  uploadedAt: v.number(),
  uploadedByName: v.string(),
});
export const securityCheck = v.object({
  kind: v.string(),
  result: securityCheckResult,
  detail: v.optional(v.string()),
  checkedAt: v.optional(v.number()),
  checkedByName: v.optional(v.string()),
});
export const driverDossierFields = {
  organizationId: v.id("organizations"),
  document: v.string(),
  documentType: v.optional(v.string()),
  name: v.string(),
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
  birthDate: v.optional(v.string()),
  city: v.optional(v.string()),
  licenseNumber: v.optional(v.string()),
  licenseCategory: v.optional(v.string()),
  licenseExpiresAt: v.optional(v.string()),
  documents: v.array(dossierDocument),
  notes: v.optional(v.string()),
  searchText: v.string(),
  createdBy: v.optional(v.id("users")),
  createdByName: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
};
export const driverDossierDoc = v.object({
  _id: v.id("driverDossiers"),
  _creationTime: v.number(),
  ...driverDossierFields,
});
export const securityStudyFields = {
  organizationId: v.id("organizations"),
  dossierId: v.id("driverDossiers"),
  code: v.string(),
  driverDocument: v.string(),
  driverName: v.string(),
  customerId: v.optional(v.id("customers")),
  customer: v.string(),
  plate: v.optional(v.string()),
  requestedBy: v.optional(v.string()),
  status: securityStudyStatus,
  checks: v.array(securityCheck),
  analystNotes: v.optional(v.string()),
  decisionReason: v.optional(v.string()),
  decidedAt: v.optional(v.number()),
  decidedByName: v.optional(v.string()),
  validUntil: v.optional(v.number()),
  createdBy: v.optional(v.id("users")),
  createdByName: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
};
export const securityStudyDoc = v.object({
  _id: v.id("securityStudies"),
  _creationTime: v.number(),
  ...securityStudyFields,
});

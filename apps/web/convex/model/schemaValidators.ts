import { v } from "convex/values";

export const documentStatus = v.union(
  v.literal("draft"),
  v.literal("pending"),
  v.literal("sent"),
  v.literal("authorized"),
  v.literal("rejected"),
  v.literal("fulfilled"),
  v.literal("annulled")
);

export const documentKind = v.union(
  v.literal("orden_cargue"),
  v.literal("remesa"),
  v.literal("manifiesto"),
  v.literal("cumplido"),
  v.literal("anulacion")
);

export const rndcMode = v.union(v.literal("dry-run"), v.literal("live"));

export const organizationStatus = v.union(v.literal("active"), v.literal("inactive"));

export const userRole = v.union(
  v.literal("admin"),
  v.literal("operator"),
  v.literal("auditor"),
  v.literal("finance"),
  v.literal("client")
);

export const userStatus = v.union(v.literal("active"), v.literal("disabled"));

export const userJobTitle = v.union(
  v.literal("administrador"),
  v.literal("jefe_seguridad"),
  v.literal("auxiliar_seguridad"),
  v.literal("empresa")
);

export const serviceOrderStatus = v.union(
  v.literal("draft"),
  v.literal("confirmed"),
  v.literal("assigned"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("cancelled")
);

export const expedienteStatus = v.union(
  v.literal("draft"),
  v.literal("ready"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("cancelled")
);

export const officialDocumentState = v.union(
  v.literal("draft"),
  v.literal("pending"),
  v.literal("authorized"),
  v.literal("fulfilled"),
  v.literal("annulled")
);

export const fulfillmentState = v.union(
  v.literal("not_requested"),
  v.literal("pending"),
  v.literal("fulfilled"),
  v.literal("rejected"),
  v.literal("annulment_pending")
);

export const correctionState = v.union(
  v.literal("none"),
  v.literal("pending"),
  v.literal("corrected"),
  v.literal("rejected")
);

export const annulmentState = v.union(
  v.literal("none"),
  v.literal("pending"),
  v.literal("annulled"),
  v.literal("rejected")
);

export const reconciliationState = v.union(
  v.literal("not_needed"),
  v.literal("pending"),
  v.literal("confirmed"),
  v.literal("mismatch")
);

export const acceptanceState = v.union(
  v.literal("not_applicable"),
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("delegated"),
  v.literal("rejected")
);

export const rndcOperationStatus = v.union(
  v.literal("queued"),
  v.literal("claimed"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("uncertain"),
  v.literal("reconciling"),
  v.literal("cancelled")
);

export const rndcOperationType = v.union(
  v.literal("emit_cargo"),
  v.literal("emit_trip"),
  v.literal("emit_remesa"),
  v.literal("emit_manifest"),
  v.literal("fulfill_remesa"),
  v.literal("fulfill_manifest"),
  v.literal("correct_remesa"),
  v.literal("annul_cargo"),
  v.literal("annul_trip"),
  v.literal("annul_remesa"),
  v.literal("annul_manifest"),
  v.literal("annul_remesa_fulfillment"),
  v.literal("annul_remesa_initial_fulfillment"),
  v.literal("annul_manifest_fulfillment"),
  v.literal("upsert_third_party"),
  v.literal("upsert_vehicle"),
  v.literal("reconcile"),
  v.literal("query_acceptance")
);

export const rndcReferenceCatalogKind = v.union(
  v.literal("vehicle_line"),
  v.literal("insurer"),
  v.literal("packaging"),
  v.literal("body_type")
);

export const rndcReferenceImportStatus = v.union(
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed")
);

export const rndcReferenceFailureCode = v.union(
  v.literal("SOURCE_VALIDATION_FAILED"),
  v.literal("BATCH_APPLY_FAILED"),
  v.literal("VERIFICATION_FAILED"),
  v.literal("IMPORT_INTERRUPTED"),
  v.literal("INTERNAL_ERROR")
);

export const rndcReferenceFailureMessage = v.union(
  v.literal("The RNDC catalog source could not be validated"),
  v.literal("An RNDC catalog batch could not be applied"),
  v.literal("The RNDC catalog import could not be verified"),
  v.literal("The RNDC catalog import was interrupted"),
  v.literal("The RNDC catalog import failed")
);

export const rndcReferenceFileSummary = v.object({
  fileName: v.string(),
  sha256: v.string(),
  catalogDigest: v.optional(v.string()),
  rowsRead: v.number(),
  normalizedRows: v.number(),
  historicalRows: v.number(),
  batchCount: v.number()
});

export const rndcReferenceOutcome = v.object({
  batchesApplied: v.number(),
  inserted: v.number(),
  updated: v.number(),
  unchanged: v.number(),
  outdated: v.number()
});

export const rndcReferenceTotals = v.object({
  vehicleLines: rndcReferenceOutcome,
  insurers: rndcReferenceOutcome,
  packages: rndcReferenceOutcome,
  bodyTypes: rndcReferenceOutcome
});

export const masterWorkReference = v.object({
  company: v.string(),
  contactName: v.optional(v.string()),
  phone: v.optional(v.string()),
  position: v.optional(v.string()),
  trips: v.optional(v.string()),
  tenure: v.optional(v.string()),
  city: v.optional(v.string()),
  cityCode: v.optional(v.string()),
  merchandise: v.optional(v.string())
});

export const masterSyncValidator = v.object({
  state: v.union(v.literal("pending"), v.literal("registered"), v.literal("rejected")),
  updatedAt: v.number(),
  version: v.optional(v.number()),
  error: v.optional(v.string()),
  operationId: v.optional(v.string())
});

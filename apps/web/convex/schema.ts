import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  consignmentDraftValidator,
  loadingOrderDraftValidator,
  logisticsTimesDraftValidator,
  manifestDraftValidator,
  snapshotKindValidator
} from "./model/draftValidators";

const documentStatus = v.union(
  v.literal("draft"),
  v.literal("pending"),
  v.literal("sent"),
  v.literal("authorized"),
  v.literal("rejected"),
  v.literal("fulfilled"),
  v.literal("annulled")
);

const documentKind = v.union(
  v.literal("orden_cargue"),
  v.literal("remesa"),
  v.literal("manifiesto"),
  v.literal("cumplido"),
  v.literal("anulacion")
);

const rndcMode = v.union(v.literal("dry-run"), v.literal("live"));

const organizationStatus = v.union(v.literal("active"), v.literal("inactive"));

const userRole = v.union(
  v.literal("admin"),
  v.literal("operator"),
  v.literal("auditor"),
  v.literal("finance")
);

const userStatus = v.union(v.literal("active"), v.literal("disabled"));

const serviceOrderStatus = v.union(
  v.literal("draft"),
  v.literal("confirmed"),
  v.literal("assigned"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("cancelled")
);

const expedienteStatus = v.union(
  v.literal("draft"),
  v.literal("ready"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("cancelled")
);

const officialDocumentState = v.union(
  v.literal("draft"),
  v.literal("pending"),
  v.literal("authorized"),
  v.literal("fulfilled"),
  v.literal("annulled")
);

const fulfillmentState = v.union(
  v.literal("not_requested"),
  v.literal("pending"),
  v.literal("fulfilled"),
  v.literal("rejected"),
  v.literal("annulment_pending")
);

const correctionState = v.union(
  v.literal("none"),
  v.literal("pending"),
  v.literal("corrected"),
  v.literal("rejected")
);

const annulmentState = v.union(
  v.literal("none"),
  v.literal("pending"),
  v.literal("annulled"),
  v.literal("rejected")
);

const reconciliationState = v.union(
  v.literal("not_needed"),
  v.literal("pending"),
  v.literal("confirmed"),
  v.literal("mismatch")
);

const acceptanceState = v.union(
  v.literal("not_applicable"),
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("delegated"),
  v.literal("rejected")
);

const rndcOperationStatus = v.union(
  v.literal("queued"),
  v.literal("claimed"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("uncertain"),
  v.literal("reconciling"),
  v.literal("cancelled")
);

const rndcOperationType = v.union(
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
  v.literal("annul_manifest_fulfillment"),
  v.literal("upsert_third_party"),
  v.literal("upsert_vehicle"),
  v.literal("reconcile"),
  v.literal("query_acceptance")
);

export default defineSchema({
  trips: defineTable({
    organizationId: v.optional(v.id("organizations")),
    expedienteId: v.optional(v.id("expedientes")),
    code: v.string(),
    status: v.string(),
    originCity: v.optional(v.string()),
    destinationCity: v.optional(v.string()),
    vehiclePlate: v.optional(v.string()),
    driverName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_status", ["status"])
    .index("by_code", ["code"])
    .index("by_organization", ["organizationId"]),

  documents: defineTable({
    organizationId: v.optional(v.id("organizations")),
    expedienteId: v.optional(v.id("expedientes")),
    expedienteRemesaId: v.optional(v.id("expedienteRemesas")),
    tripId: v.id("trips"),
    kind: documentKind,
    status: documentStatus,
    number: v.optional(v.string()),
    rndcRadicado: v.optional(v.string()),
    issuanceRadicado: v.optional(v.string()),
    mode: v.optional(rndcMode),
    pdfUrlPath: v.optional(v.string()),
    errorText: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    officialState: v.optional(officialDocumentState),
    fulfillmentState: v.optional(fulfillmentState),
    correctionState: v.optional(correctionState),
    annulmentState: v.optional(annulmentState),
    reconciliationState: v.optional(reconciliationState),
    acceptanceState: v.optional(acceptanceState),
    acceptanceActorName: v.optional(v.string()),
    acceptanceActorDocument: v.optional(v.string()),
    acceptanceRecordedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_trip", ["tripId"])
    .index("by_status", ["status"])
    .index("by_kind", ["kind"])
    .index("by_kind_and_status", ["kind", "status"])
    .index("by_kind_and_number", ["kind", "number"])
    .index("by_expediente", ["expedienteId"])
    .index("by_organization_and_number", ["organizationId", "number"])
    .index("by_organization_kind_and_number", ["organizationId", "kind", "number"])
    .index("by_organization", ["organizationId"])
    .index("by_organization_and_status", ["organizationId", "status"])
    .index("by_organization_and_kind", ["organizationId", "kind"])
    .index("by_organization_kind_and_status", ["organizationId", "kind", "status"]),

  rndcAttempts: defineTable({
    organizationId: v.optional(v.id("organizations")),
    rndcOperationId: v.optional(v.id("rndcOperations")),
    documentId: v.optional(v.id("documents")),
    tripId: v.optional(v.id("trips")),
    operation: v.string(),
    action: v.string(),
    attemptNumber: v.optional(v.number()),
    title: v.optional(v.string()),
    procesoId: v.optional(v.number()),
    status: v.string(),
    mode: v.optional(rndcMode),
    radicado: v.optional(v.string()),
    requestXmlStorageId: v.optional(v.id("_storage")),
    responseXmlStorageId: v.optional(v.id("_storage")),
    requestPath: v.optional(v.string()),
    responsePath: v.optional(v.string()),
    errorText: v.optional(v.string()),
    createdAt: v.number(),
    finishedAt: v.optional(v.number())
  })
    .index("by_document", ["documentId"])
    .index("by_trip", ["tripId"])
    .index("by_status", ["status"])
    .index("by_rndc_operation", ["rndcOperationId"]),

  drivers: defineTable({
    organizationId: v.optional(v.id("organizations")),
    document: v.string(),
    documentType: v.optional(v.string()),
    name: v.optional(v.string()),
    status: v.optional(v.string()),
    birthDate: v.optional(v.string()),
    sex: v.optional(v.string()),
    bloodType: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    phone1: v.optional(v.string()),
    phone2: v.optional(v.string()),
    cellphone: v.optional(v.string()),
    licenseNumber: v.optional(v.string()),
    licenseCategory: v.optional(v.string()),
    licenseExpiresAt: v.optional(v.string()),
    eps: v.optional(v.string()),
    arp: v.optional(v.string()),
    pensionFund: v.optional(v.string()),
    hazmatCourse: v.optional(v.string()),
    hazmatCourseExpiresAt: v.optional(v.string()),
    observations: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_document", ["document"])
    .index("by_organization_and_document", ["organizationId", "document"]),

  vehicles: defineTable({
    organizationId: v.optional(v.id("organizations")),
    plate: v.string(),
    make: v.optional(v.string()),
    line: v.optional(v.string()),
    modelYear: v.optional(v.string()),
    color: v.optional(v.string()),
    bodyType: v.optional(v.string()),
    configuration: v.optional(v.string()),
    trailer: v.optional(v.string()),
    linkType: v.optional(v.string()),
    capacityTn: v.optional(v.string()),
    emptyWeightTn: v.optional(v.string()),
    ownerDocument: v.optional(v.string()),
    ownerName: v.optional(v.string()),
    ownerCellphone: v.optional(v.string()),
    ownerPhone: v.optional(v.string()),
    possessorDocument: v.optional(v.string()),
    possessorName: v.optional(v.string()),
    possessorCellphone: v.optional(v.string()),
    possessorPhone: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_plate", ["plate"])
    .index("by_organization_and_plate", ["organizationId", "plate"]),

  driverVehicles: defineTable({
    driverId: v.id("drivers"),
    vehicleId: v.id("vehicles"),
    driverDocument: v.string(),
    vehiclePlate: v.string(),
    matchConfidence: v.optional(v.string()),
    matchBasis: v.optional(v.string()),
    roles: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_document_and_plate", ["driverDocument", "vehiclePlate"])
    .index("by_driver", ["driverId"])
    .index("by_vehicle", ["vehicleId"]),

  notifications: defineTable({
    organizationId: v.optional(v.id("organizations")),
    userId: v.optional(v.id("users")),
    title: v.string(),
    body: v.string(),
    status: v.union(v.literal("unread"), v.literal("read")),
    relatedTripId: v.optional(v.id("trips")),
    relatedDocumentId: v.optional(v.id("documents")),
    createdAt: v.number()
  })
    .index("by_status", ["status"])
    .index("by_created_at", ["createdAt"])
    .index("by_organization_and_status", ["organizationId", "status"])
    .index("by_user_and_status", ["userId", "status"]),

  counters: defineTable({
    organizationId: v.optional(v.id("organizations")),
    documentType: v.string(),
    lastValue: v.number(),
    updatedAt: v.number()
  })
    .index("by_document_type", ["documentType"])
    .index("by_organization_and_document_type", ["organizationId", "documentType"]),

  organizations: defineTable({
    slug: v.string(),
    name: v.string(),
    status: organizationStatus,
    createdAt: v.number(),
    updatedAt: v.number()
  }).index("by_slug", ["slug"]),

  users: defineTable({
    organizationId: v.id("organizations"),
    externalId: v.optional(v.string()),
    authSubject: v.optional(v.string()),
    actorToken: v.string(),
    name: v.string(),
    email: v.string(),
    roles: v.array(userRole),
    status: userStatus,
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_actor_token", ["actorToken"])
    .index("by_auth_subject", ["authSubject"])
    .index("by_organization_and_email", ["organizationId", "email"])
    .index("by_organization_and_external_id", ["organizationId", "externalId"]),

  customers: defineTable({
    organizationId: v.id("organizations"),
    code: v.string(),
    name: v.string(),
    identificationType: v.optional(v.string()),
    identificationNumber: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    status: organizationStatus,
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_organization_and_code", ["organizationId", "code"])
    .index("by_organization_and_identification", ["organizationId", "identificationNumber"])
    .index("by_organization_and_status", ["organizationId", "status"]),

  customerLocations: defineTable({
    organizationId: v.id("organizations"),
    customerId: v.id("customers"),
    code: v.string(),
    name: v.string(),
    kind: v.union(v.literal("loading"), v.literal("unloading"), v.literal("both")),
    address: v.string(),
    city: v.string(),
    municipalityCode: v.optional(v.string()),
    contactName: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    status: organizationStatus,
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_customer_and_code", ["customerId", "code"])
    .index("by_organization_and_customer", ["organizationId", "customerId"]),

  serviceOrders: defineTable({
    organizationId: v.id("organizations"),
    code: v.string(),
    customerId: v.id("customers"),
    loadingLocationId: v.id("customerLocations"),
    unloadingLocationId: v.id("customerLocations"),
    status: serviceOrderStatus,
    customerReference: v.optional(v.string()),
    cargoDescription: v.string(),
    cargoQuantity: v.optional(v.number()),
    cargoUnit: v.optional(v.string()),
    cargoWeightKg: v.optional(v.number()),
    agreedRate: v.number(),
    currency: v.string(),
    scheduledLoadingAt: v.optional(v.number()),
    scheduledUnloadingAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_organization_and_code", ["organizationId", "code"])
    .index("by_organization_and_status", ["organizationId", "status"])
    .index("by_customer", ["customerId"]),

  trailers: defineTable({
    organizationId: v.id("organizations"),
    plate: v.string(),
    trailerType: v.optional(v.string()),
    configuration: v.optional(v.string()),
    capacityKg: v.optional(v.number()),
    ownerDocument: v.optional(v.string()),
    status: v.union(v.literal("available"), v.literal("assigned"), v.literal("maintenance"), v.literal("inactive")),
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_organization_and_plate", ["organizationId", "plate"])
    .index("by_organization_and_status", ["organizationId", "status"]),

  expedientes: defineTable({
    organizationId: v.id("organizations"),
    serviceOrderId: v.id("serviceOrders"),
    tripId: v.optional(v.id("trips")),
    code: v.string(),
    status: expedienteStatus,
    driverId: v.optional(v.id("drivers")),
    secondDriverId: v.optional(v.id("drivers")),
    vehicleId: v.optional(v.id("vehicles")),
    trailerId: v.optional(v.id("trailers")),
    manifestDocumentId: v.optional(v.id("documents")),
    manifestNumber: v.optional(v.string()),
    cargoNumber: v.optional(v.string()),
    tripNumber: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    agencyCode: v.optional(v.string()),
    loadingOrderDraft: v.optional(loadingOrderDraftValidator),
    manifestDraft: v.optional(manifestDraftValidator),
    logisticsTimes: v.optional(logisticsTimesDraftValidator),
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_organization_and_code", ["organizationId", "code"])
    .index("by_organization_and_status", ["organizationId", "status"])
    .index("by_service_order", ["serviceOrderId"]),

  expedienteRemesas: defineTable({
    organizationId: v.id("organizations"),
    expedienteId: v.id("expedientes"),
    sequence: v.number(),
    number: v.optional(v.string()),
    documentId: v.optional(v.id("documents")),
    cargoDescription: v.string(),
    cargoQuantity: v.optional(v.number()),
    cargoUnit: v.optional(v.string()),
    cargoWeightKg: v.optional(v.number()),
    consigneeName: v.optional(v.string()),
    consigneeDocument: v.optional(v.string()),
    draft: v.optional(consignmentDraftValidator),
    officialState: officialDocumentState,
    fulfillmentState,
    correctionState,
    annulmentState,
    reconciliationState,
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_expediente_and_sequence", ["expedienteId", "sequence"])
    .index("by_organization_and_number", ["organizationId", "number"]),

  complianceChecks: defineTable({
    organizationId: v.id("organizations"),
    expedienteId: v.id("expedientes"),
    subjectType: v.union(v.literal("driver"), v.literal("vehicle"), v.literal("trailer")),
    subjectId: v.string(),
    checkType: v.string(),
    status: v.union(v.literal("passed"), v.literal("warning"), v.literal("failed")),
    expiresAt: v.optional(v.number()),
    details: v.optional(v.string()),
    checkedAt: v.number(),
    checkedBy: v.id("users")
  })
    .index("by_expediente_and_checked_at", ["expedienteId", "checkedAt"])
    .index("by_organization_and_status", ["organizationId", "status"])
    .index("by_subject", ["subjectType", "subjectId"]),

  expedienteEvents: defineTable({
    organizationId: v.id("organizations"),
    expedienteId: v.id("expedientes"),
    eventType: v.string(),
    title: v.string(),
    details: v.optional(v.string()),
    occurredAt: v.number(),
    actorId: v.optional(v.id("users"))
  }).index("by_expediente_and_occurred_at", ["expedienteId", "occurredAt"]),

  expedienteNovelties: defineTable({
    organizationId: v.id("organizations"),
    expedienteId: v.id("expedientes"),
    category: v.string(),
    severity: v.union(v.literal("info"), v.literal("warning"), v.literal("critical")),
    status: v.union(v.literal("open"), v.literal("resolved")),
    description: v.string(),
    resolution: v.optional(v.string()),
    openedAt: v.number(),
    resolvedAt: v.optional(v.number()),
    openedBy: v.id("users"),
    resolvedBy: v.optional(v.id("users"))
  })
    .index("by_expediente_and_opened_at", ["expedienteId", "openedAt"])
    .index("by_organization_and_status", ["organizationId", "status"]),

  deliveryEvidence: defineTable({
    organizationId: v.id("organizations"),
    expedienteId: v.id("expedientes"),
    evidenceArtifactId: v.id("evidenceArtifacts"),
    kind: v.union(v.literal("pod"), v.literal("photo"), v.literal("signature"), v.literal("document"), v.literal("other")),
    notes: v.optional(v.string()),
    capturedAt: v.number(),
    capturedBy: v.id("users")
  }).index("by_expediente_and_captured_at", ["expedienteId", "capturedAt"]),

  evidenceArtifacts: defineTable({
    organizationId: v.id("organizations"),
    expedienteId: v.optional(v.id("expedientes")),
    documentId: v.optional(v.id("documents")),
    rndcOperationId: v.optional(v.id("rndcOperations")),
    storageId: v.id("_storage"),
    kind: v.union(
      v.literal("request_xml"),
      v.literal("response_xml"),
      v.literal("pdf"),
      v.literal("photo"),
      v.literal("signature"),
      v.literal("pod"),
      v.literal("other")
    ),
    fileName: v.string(),
    contentType: v.optional(v.string()),
    size: v.number(),
    sha256: v.string(),
    uploadedByType: v.union(v.literal("user"), v.literal("service")),
    uploadedByUserId: v.optional(v.id("users")),
    createdAt: v.number()
  })
    .index("by_expediente_and_created_at", ["expedienteId", "createdAt"])
    .index("by_document", ["documentId"])
    .index("by_rndc_operation", ["rndcOperationId"])
    .index("by_storage_id", ["storageId"]),

  auditEvents: defineTable({
    organizationId: v.id("organizations"),
    actorType: v.union(v.literal("user"), v.literal("service"), v.literal("system")),
    actorId: v.optional(v.id("users")),
    action: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    reason: v.optional(v.string()),
    detailsJson: v.optional(v.string()),
    createdAt: v.number()
  })
    .index("by_organization_and_created_at", ["organizationId", "createdAt"])
    .index("by_organization_entity_and_created_at", ["organizationId", "entityType", "entityId", "createdAt"])
    .index("by_entity_and_created_at", ["entityType", "entityId", "createdAt"]),

  rndcOperations: defineTable({
    organizationId: v.id("organizations"),
    expedienteId: v.optional(v.id("expedientes")),
    documentId: v.optional(v.id("documents")),
    expedienteRemesaId: v.optional(v.id("expedienteRemesas")),
    operationType: rndcOperationType,
    procesoId: v.optional(v.number()),
    status: rndcOperationStatus,
    mode: rndcMode,
    requestKey: v.string(),
    businessKey: v.string(),
    payloadJson: v.string(),
    availableAt: v.number(),
    attemptCount: v.number(),
    maxAttempts: v.number(),
    leaseOwner: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    claimedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    uncertainAt: v.optional(v.number()),
    resultRadicado: v.optional(v.string()),
    resultJson: v.optional(v.string()),
    lastError: v.optional(v.string()),
    reconciledByOperationId: v.optional(v.id("rndcOperations")),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_organization_and_request_key", ["organizationId", "requestKey"])
    .index("by_organization_and_business_key", ["organizationId", "businessKey"])
    .index("by_status_and_available_at", ["status", "availableAt"])
    .index("by_status_and_lease_expiration", ["status", "leaseExpiresAt"])
    .index("by_expediente_and_created_at", ["expedienteId", "createdAt"])
    .index("by_expediente_and_status", ["expedienteId", "status"])
    .index("by_document_and_created_at", ["documentId", "createdAt"])
    .index("by_document_and_status", ["documentId", "status"]),

  dispatchSnapshots: defineTable({
    organizationId: v.id("organizations"),
    expedienteId: v.id("expedientes"),
    documentId: v.optional(v.id("documents")),
    remesaId: v.optional(v.id("expedienteRemesas")),
    kind: snapshotKindValidator,
    documentNumber: v.optional(v.string()),
    payloadJson: v.string(),
    fingerprint: v.string(),
    takenAt: v.number(),
    takenBy: v.id("users")
  })
    .index("by_expediente_and_taken_at", ["expedienteId", "takenAt"])
    .index("by_expediente_kind_and_taken_at", ["expedienteId", "kind", "takenAt"])
    .index("by_document", ["documentId"])
    .index("by_remesa", ["remesaId"]),

  counterRanges: defineTable({
    organizationId: v.id("organizations"),
    agencyCode: v.string(),
    documentType: v.string(),
    prefix: v.string(),
    padding: v.number(),
    nextValue: v.number(),
    endValue: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("inactive")),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index("by_organization_agency_and_type", ["organizationId", "agencyCode", "documentType"]),

  rndcRequestKeys: defineTable({
    organizationId: v.id("organizations"),
    requestKey: v.string(),
    operationId: v.id("rndcOperations"),
    createdAt: v.number()
  }).index("by_organization_and_request_key", ["organizationId", "requestKey"])
});

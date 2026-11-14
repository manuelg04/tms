import { defineSchema, defineTable } from "convex/server";
import { pointFields, routeFields, planFields, dispatchPlanFields } from "./model/routeValidators";
import { mirrorRecordFields, mirrorRunFields } from "./model/mirrorValidators";
import { v } from "convex/values";
import { monitoringReportFields, monitoringTripFields } from "./model/monitoringValidators";
import { driverDossierFields, securityStudyFields } from "./model/securityStudyValidators";
import { trackingDispatchFields, checkpointFields, reportFields, incidentFields, alarmFields, locationFields, positionFields, noteFields } from "./model/trackingValidators";
import {
  consignmentDraftValidator,
  fulfillmentDraftValidator,
  loadingOrderDraftValidator,
  logisticsTimesDraftValidator,
  manifestDraftValidator,
  moneyLimitsValidator,
  manifestFulfillmentDraftValidator,
  snapshotKindValidator
} from "./model/draftValidators";
import {
  documentStatus,
  documentKind,
  rndcMode,
  organizationStatus,
  userRole,
  userStatus,
  userJobTitle,
  serviceOrderStatus,
  expedienteStatus,
  officialDocumentState,
  fulfillmentState,
  correctionState,
  annulmentState,
  reconciliationState,
  acceptanceState,
  rndcOperationStatus,
  rndcOperationType
} from "./model/schemaValidators";
import { masterTables } from "./model/schemaMasterTables";
import { pendingEmissionFields } from "./model/pendingEmissionValidators";

export default defineSchema({
  ...masterTables,
  rndcMirrorRecords: defineTable(mirrorRecordFields).index("by_org_process_id", ["organizationId", "process", "radicado"]).index("by_org_process_date", ["organizationId", "process", "date"]).index("by_org_manifest", ["organizationId", "manifest"]).index("by_org_remesa", ["organizationId", "remesa"]),
  rndcMirrorPending: defineTable(mirrorRecordFields).index("by_run", ["runId"]).index("by_run_id", ["runId", "radicado"]),
  rndcMirrorRuns: defineTable(mirrorRunFields).index("by_org_external", ["organizationId", "externalId"]).index("by_org_date", ["organizationId", "createdAt"]),
  operationalPoints: defineTable(pointFields).index("by_org_code", ["organizationId", "code"]),
  operationalRoutes: defineTable(routeFields).index("by_org_code", ["organizationId", "code"]),
  routePlans: defineTable(planFields).index("by_dispatch", ["dispatchId"]),
  dispatchRoutePlans: defineTable(dispatchPlanFields)
    .index("by_expediente", ["expedienteId"])
    .index("by_organization_and_created_at", ["organizationId", "createdAt"]),
  pendingEmissions: defineTable(pendingEmissionFields)
    .index("by_expediente", ["expedienteId"])
    .index("by_organization_and_requested_at", ["organizationId", "requestedAt"])
    .index("by_status_and_requested_at", ["status", "requestedAt"]),
  pendingEmissionTicker: defineTable({ scheduledFor: v.number() }),
  monitoringTrips: defineTable(monitoringTripFields)
    .index("by_org_status", ["organizationId", "status"])
    .index("by_org_code", ["organizationId", "code"])
    .index("by_org_customer", ["organizationId", "customerId"]),
  driverDossiers: defineTable(driverDossierFields)
    .index("by_org_document", ["organizationId", "document"])
    .searchIndex("search_dossier", { searchField: "searchText", filterFields: ["organizationId"] }),
  securityStudies: defineTable(securityStudyFields)
    .index("by_org_status", ["organizationId", "status"])
    .index("by_org_code", ["organizationId", "code"])
    .index("by_org_customer", ["organizationId", "customerId"])
    .index("by_dossier", ["dossierId"]),
  monitoringReports: defineTable(monitoringReportFields)
    .index("by_trip", ["tripId"])
    .index("by_trip_request", ["tripId", "requestKey"]),
  trackingDispatches: defineTable(trackingDispatchFields)
    .index("by_org_source", ["organizationId", "sourceKey"])
    .index("by_org_code", ["organizationId", "externalCode"])
    .index("by_org_queue", ["organizationId", "queue"])
    .index("by_expediente", ["expedienteId"]),
  trackingNotes: defineTable(noteFields).index("by_dispatch", ["dispatchId"]),
  trackingCheckpoints: defineTable(checkpointFields).index("by_dispatch", ["dispatchId"]),
  trackingReports: defineTable(reportFields)
    .index("by_dispatch", ["dispatchId"])
    .index("by_dispatch_request", ["dispatchId", "requestKey"]),
  trackingIncidents: defineTable(incidentFields).index("by_org_code", ["organizationId", "code"]),
  trackingAlarms: defineTable(alarmFields).index("by_org_code", ["organizationId", "code"]),
  trackingLocations: defineTable(locationFields).index("by_org_key", ["organizationId", "key"]),
  trackingPositions: defineTable(positionFields).index("by_dispatch", ["dispatchId"]),
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
  notifications: defineTable({
    organizationId: v.optional(v.id("organizations")),
    userId: v.optional(v.id("users")),
    title: v.string(),
    body: v.string(),
    status: v.union(v.literal("unread"), v.literal("read")),
    relatedTripId: v.optional(v.id("trips")),
    relatedDocumentId: v.optional(v.id("documents")),
    category: v.optional(v.union(
      v.literal("rejection"),
      v.literal("reconciliation"),
      v.literal("fulfillment"),
      v.literal("evidence")
    )),
    actionLabel: v.optional(v.string()),
    actionHref: v.optional(v.string()),
    createdAt: v.number()
  })
    .index("by_status", ["status"])
    .index("by_created_at", ["createdAt"])
    .index("by_organization_and_created_at", ["organizationId", "createdAt"])
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
    moneyLimits: v.optional(moneyLimitsValidator),
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
    jobTitle: v.optional(userJobTitle),
    customerId: v.optional(v.id("customers")),
    passwordHash: v.optional(v.string()),
    passwordUpdatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_actor_token", ["actorToken"])
    .index("by_auth_subject", ["authSubject"])
    .index("by_email", ["email"])
    .index("by_organization_and_email", ["organizationId", "email"])
    .index("by_organization_and_external_id", ["organizationId", "externalId"]),
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
    workflowVariant: v.optional(v.union(
      v.literal("standard"),
      v.literal("remesa_without_order"),
      v.literal("empty_manifest"),
      v.literal("transshipment")
    )),
    sourceManifestDocumentId: v.optional(v.id("documents")),
    searchText: v.optional(v.string()),
    loadingOrderDraft: v.optional(loadingOrderDraftValidator),
    manifestDraft: v.optional(manifestDraftValidator),
    manifestFulfillmentDraft: v.optional(manifestFulfillmentDraftValidator),
    logisticsTimes: v.optional(logisticsTimesDraftValidator),
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_organization_and_code", ["organizationId", "code"])
    .index("by_organization_and_status", ["organizationId", "status"])
    .index("by_organization_status_and_updated_at", ["organizationId", "status", "updatedAt"])
    .index("by_organization_and_updated_at", ["organizationId", "updatedAt"])
    .index("by_service_order", ["serviceOrderId"])
    .searchIndex("search_dispatches", { searchField: "searchText", filterFields: ["organizationId"] }),
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
    fulfillmentDraft: v.optional(fulfillmentDraftValidator),
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
  operacionesLinks: defineTable({
    organizationId: v.id("organizations"),
    expedienteId: v.id("expedientes"),
    operacionesExpedienteId: v.string(),
    plate: v.optional(v.string()),
    driverName: v.optional(v.string()),
    linkedBy: v.id("users"),
    linkedAt: v.number()
  })
    .index("by_expediente", ["expedienteId"])
    .index("by_organization_and_operaciones_expediente", ["organizationId", "operacionesExpedienteId"]),
  operacionesDeliveries: defineTable({
    organizationId: v.id("organizations"),
    expedienteId: v.id("expedientes"),
    kind: v.union(
      v.literal("loading_order"),
      v.literal("manifest_numbers"),
      v.literal("official_manifest"),
      v.literal("official_remesa")
    ),
    deliveryKey: v.string(),
    number: v.optional(v.string()),
    status: v.union(v.literal("applied"), v.literal("pending"), v.literal("failed")),
    message: v.string(),
    deliveredBy: v.id("users"),
    updatedAt: v.number()
  })
    .index("by_expediente", ["expedienteId"])
    .index("by_expediente_and_key", ["expedienteId", "deliveryKey"]),
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
  dispatchExceptions: defineTable({
    organizationId: v.id("organizations"),
    expedienteId: v.id("expedientes"),
    requestKey: v.string(),
    type: v.union(
      v.literal("remesa_without_order"),
      v.literal("empty_manifest"),
      v.literal("transshipment"),
      v.literal("correction"),
      v.literal("annulment"),
      v.literal("reconciliation")
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("rejected"),
      v.literal("uncertain"),
      v.literal("cancelled")
    ),
    documentId: v.optional(v.id("documents")),
    sourceManifestDocumentId: v.optional(v.id("documents")),
    originalOperationId: v.optional(v.id("rndcOperations")),
    reasonCode: v.optional(v.string()),
    reason: v.string(),
    observation: v.string(),
    confirmed: v.boolean(),
    beforeJson: v.optional(v.string()),
    afterJson: v.optional(v.string()),
    comparisonJson: v.optional(v.string()),
    dependencyPlanJson: v.optional(v.string()),
    operationIds: v.optional(v.array(v.id("rndcOperations"))),
    evidenceCount: v.optional(v.number()),
    resultJson: v.optional(v.string()),
    createdBy: v.id("users"),
    completedBy: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number())
  })
    .index("by_expediente_and_created_at", ["expedienteId", "createdAt"])
    .index("by_organization_and_request_key", ["organizationId", "requestKey"])
    .index("by_document_and_created_at", ["documentId", "createdAt"])
    .index("by_organization_and_status", ["organizationId", "status"]),
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
  loadingOrderReservations: defineTable({
    organizationId: v.id("organizations"),
    token: v.string(),
    number: v.string(),
    status: v.union(v.literal("reserved"), v.literal("consumed")),
    expedienteId: v.optional(v.id("expedientes")),
    reservedBy: v.id("users"),
    reservedAt: v.number(),
    consumedAt: v.optional(v.number())
  })
    .index("by_organization_and_token", ["organizationId", "token"])
    .index("by_organization_and_number", ["organizationId", "number"]),
  rndcRequestKeys: defineTable({
    organizationId: v.id("organizations"),
    requestKey: v.string(),
    operationId: v.id("rndcOperations"),
    createdAt: v.number()
  }).index("by_organization_and_request_key", ["organizationId", "requestKey"])
});

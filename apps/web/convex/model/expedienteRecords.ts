import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { OfficialDocumentState } from "./documentLifecycle";
import {
  consignmentMissingFields,
  deriveDispatchStage,
  loadingOrderMissingFields,
  manifestMissingFields,
  type ConsignmentDraft,
  type DispatchProjection,
  type LoadingOrderDraft
} from "./dispatchWorkflow";
import { dispatchPrimaryAction } from "./dispatchPresentation";
import { loadMoneyLimits } from "./moneyLimits";
import { hasOpenRejection } from "./openRejection";
import {
  consignmentDraftValidator,
  fulfillmentDraftValidator,
  loadingOrderDraftValidator,
  logisticsTimesDraftValidator,
  manifestDraftValidator,
  manifestFulfillmentDraftValidator
} from "./draftValidators";

export const statusValidator = v.union(
  v.literal("draft"),
  v.literal("ready"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("cancelled")
);

export const officialStateValidator = v.union(
  v.literal("draft"),
  v.literal("pending"),
  v.literal("authorized"),
  v.literal("fulfilled"),
  v.literal("annulled")
);

export const fulfillmentStateValidator = v.union(
  v.literal("not_requested"),
  v.literal("pending"),
  v.literal("fulfilled"),
  v.literal("rejected"),
  v.literal("annulment_pending")
);

export const correctionStateValidator = v.union(
  v.literal("none"),
  v.literal("pending"),
  v.literal("corrected"),
  v.literal("rejected")
);

export const annulmentStateValidator = v.union(
  v.literal("none"),
  v.literal("pending"),
  v.literal("annulled"),
  v.literal("rejected")
);

export const reconciliationStateValidator = v.union(
  v.literal("not_needed"),
  v.literal("pending"),
  v.literal("confirmed"),
  v.literal("mismatch")
);

export const expedienteValidator = v.object({
  _id: v.id("expedientes"),
  _creationTime: v.number(),
  organizationId: v.id("organizations"),
  serviceOrderId: v.id("serviceOrders"),
  tripId: v.optional(v.id("trips")),
  code: v.string(),
  status: statusValidator,
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
});

export const remesaValidator = v.object({
  _id: v.id("expedienteRemesas"),
  _creationTime: v.number(),
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
  officialState: officialStateValidator,
  fulfillmentState: fulfillmentStateValidator,
  correctionState: correctionStateValidator,
  annulmentState: annulmentStateValidator,
  reconciliationState: reconciliationStateValidator,
  createdBy: v.id("users"),
  updatedBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number()
});

export const serviceOrderDetailValidator = v.object({
  _id: v.id("serviceOrders"),
  code: v.string(),
  status: v.string(),
  customerReference: v.optional(v.string()),
  cargoDescription: v.string(),
  cargoQuantity: v.optional(v.number()),
  cargoUnit: v.optional(v.string()),
  cargoWeightKg: v.optional(v.number()),
  agreedRate: v.number(),
  currency: v.string(),
  scheduledLoadingAt: v.optional(v.number()),
  scheduledUnloadingAt: v.optional(v.number()),
  notes: v.optional(v.string())
});

export const partyValidator = v.union(
  v.object({ _id: v.id("drivers"), document: v.string(), name: v.optional(v.string()), phone: v.optional(v.string()) }),
  v.null()
);

export const vehicleValidator = v.union(
  v.object({
    _id: v.id("vehicles"),
    plate: v.string(),
    make: v.optional(v.string()),
    line: v.optional(v.string()),
    lineName: v.optional(v.string()),
    modelYear: v.optional(v.string()),
    configuration: v.optional(v.string()),
    configurationLabel: v.optional(v.string()),
    capacityTn: v.optional(v.string()),
    ownerName: v.optional(v.string()),
    ownerDocument: v.optional(v.string()),
    possessorName: v.optional(v.string()),
    possessorDocument: v.optional(v.string())
  }),
  v.null()
);

export const trailerValidator = v.union(
  v.object({ _id: v.id("trailers"), plate: v.string(), trailerType: v.optional(v.string()), status: v.string() }),
  v.null()
);

export const documentValidator = v.object({
  _id: v.id("documents"),
  kind: v.string(),
  number: v.optional(v.string()),
  rndcRadicado: v.optional(v.string()),
  issuanceRadicado: v.optional(v.string()),
  mode: v.optional(v.union(v.literal("dry-run"), v.literal("live"))),
  status: v.string(),
  officialState: v.optional(officialStateValidator),
  fulfillmentState: v.optional(fulfillmentStateValidator),
  correctionState: v.optional(correctionStateValidator),
  annulmentState: v.optional(annulmentStateValidator),
  reconciliationState: v.optional(reconciliationStateValidator),
  acceptanceState: v.optional(v.string()),
  acceptanceActorName: v.optional(v.string()),
  acceptanceActorDocument: v.optional(v.string()),
  acceptanceRecordedAt: v.optional(v.number()),
  updatedAt: v.number()
});

export const complianceValidator = v.object({
  _id: v.id("complianceChecks"),
  subjectType: v.string(),
  subjectId: v.string(),
  checkType: v.string(),
  status: v.string(),
  expiresAt: v.optional(v.number()),
  details: v.optional(v.string()),
  checkedAt: v.number(),
  checkedBy: v.id("users")
});

export const eventValidator = v.object({
  _id: v.id("expedienteEvents"),
  eventType: v.string(),
  title: v.string(),
  details: v.optional(v.string()),
  occurredAt: v.number(),
  actorId: v.optional(v.id("users"))
});

export const noveltyValidator = v.object({
  _id: v.id("expedienteNovelties"),
  category: v.string(),
  severity: v.string(),
  status: v.string(),
  description: v.string(),
  resolution: v.optional(v.string()),
  openedAt: v.number(),
  resolvedAt: v.optional(v.number()),
  openedBy: v.id("users"),
  resolvedBy: v.optional(v.id("users"))
});

export const deliveryEvidenceValidator = v.object({
  _id: v.id("deliveryEvidence"),
  kind: v.string(),
  notes: v.optional(v.string()),
  capturedAt: v.number(),
  capturedBy: v.id("users"),
  artifact: v.object({
    _id: v.id("evidenceArtifacts"),
    fileName: v.string(),
    contentType: v.optional(v.string()),
    size: v.number(),
    sha256: v.string()
  })
});

export const dispatchStageValidator = v.union(
  v.literal("orden_cargue"),
  v.literal("remesas"),
  v.literal("vehiculo_conductor"),
  v.literal("manifiesto"),
  v.literal("envio_rndc"),
  v.literal("cumplido_inicial"),
  v.literal("cumplido_final"),
  v.literal("cumplido"),
  v.literal("anulado")
);

export const listRowValidator = v.object({
  expediente: expedienteValidator,
  serviceOrderCode: v.string(),
  customerName: v.string(),
  originCity: v.string(),
  destinationCity: v.string(),
  agencyCode: v.optional(v.string()),
  orderNumber: v.optional(v.string()),
  remesaNumbers: v.array(v.string()),
  manifestNumber: v.optional(v.string()),
  vehiclePlate: v.optional(v.string()),
  driverName: v.optional(v.string()),
  stage: dispatchStageValidator,
  blockers: v.array(v.string()),
  rndcStatus: v.string(),
  orderState: v.string(),
  remesaStates: v.array(v.string()),
  manifestState: v.string(),
  nextAction: v.string(),
  nextActionKind: v.string(),
  remesaCount: v.number(),
  openNoveltyCount: v.number()
});

export async function requireExpediente(ctx: QueryCtx, expedienteId: Id<"expedientes">): Promise<Doc<"expedientes">> {
  const expediente = await ctx.db.get("expedientes", expedienteId);

  if (!expediente) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Expediente not found" });
  }

  return expediente;
}

export async function validateAssignments(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
  args: {
    driverId?: Id<"drivers">;
    secondDriverId?: Id<"drivers">;
    vehicleId?: Id<"vehicles">;
    trailerId?: Id<"trailers">;
  }
): Promise<void> {
  const resources = await Promise.all([
    args.driverId ? ctx.db.get("drivers", args.driverId) : null,
    args.secondDriverId ? ctx.db.get("drivers", args.secondDriverId) : null,
    args.vehicleId ? ctx.db.get("vehicles", args.vehicleId) : null,
    args.trailerId ? ctx.db.get("trailers", args.trailerId) : null
  ]);

  if ((args.driverId && !resources[0]) || (args.secondDriverId && !resources[1]) || (args.vehicleId && !resources[2]) || (args.trailerId && !resources[3])) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Assignment resource not found" });
  }

  for (const resource of resources) {
    if (resource && resource.organizationId !== undefined && resource.organizationId !== organizationId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Assignment resource belongs to another organization" });
    }
  }
}

export async function toListRow(ctx: Pick<QueryCtx, "db">, expediente: Doc<"expedientes">) {
  const order = await ctx.db.get("serviceOrders", expediente.serviceOrderId);

  if (!order) {
    throw new ConvexError({ code: "INTEGRITY_ERROR", message: "Service order is missing" });
  }

  const moneyLimits = await loadMoneyLimits(ctx, expediente.organizationId);
  const [customer, loadingLocation, unloadingLocation, remesas, openNovelties, driver, vehicle, trip, documents, operations] = await Promise.all([
    ctx.db.get("customers", order.customerId),
    ctx.db.get("customerLocations", order.loadingLocationId),
    ctx.db.get("customerLocations", order.unloadingLocationId),
    ctx.db
      .query("expedienteRemesas")
      .withIndex("by_expediente_and_sequence", (q) => q.eq("expedienteId", expediente._id))
      .collect(),
    ctx.db
      .query("expedienteNovelties")
      .withIndex("by_expediente_and_opened_at", (q) => q.eq("expedienteId", expediente._id))
      .collect(),
    expediente.driverId ? ctx.db.get("drivers", expediente.driverId) : null,
    expediente.vehicleId ? ctx.db.get("vehicles", expediente.vehicleId) : null,
    expediente.tripId ? ctx.db.get("trips", expediente.tripId) : null,
    ctx.db.query("documents").withIndex("by_expediente", (q) => q.eq("expedienteId", expediente._id)).collect(),
    ctx.db
      .query("rndcOperations")
      .withIndex("by_expediente_and_created_at", (q) => q.eq("expedienteId", expediente._id))
      .order("desc")
      .take(50)
  ]);

  if (!customer || !loadingLocation || !unloadingLocation) {
    throw new ConvexError({ code: "INTEGRITY_ERROR", message: "Expediente master data is incomplete" });
  }

  const latestDocument = (kind: string) => documents
    .filter((document) => document.kind === kind)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  const orderDocument = latestDocument("orden_cargue");
  const manifestDocument = latestDocument("manifiesto");
  const orderDraft = (expediente.loadingOrderDraft ?? null) as LoadingOrderDraft | null;
  const projection: DispatchProjection = {
    annulled: expediente.status === "cancelled",
    workflowVariant: expediente.workflowVariant,
    loadingOrder: orderDraft
      ? { missingFields: loadingOrderMissingFields(orderDraft), officialState: officialState(orderDocument) }
      : orderDocument ? { missingFields: [], officialState: officialState(orderDocument) } : null,
    consignments: remesas.map((remesa) => ({
      missingFields: consignmentMissingFields((remesa.draft ?? null) as ConsignmentDraft | null, orderDraft),
      officialState: remesa.officialState,
      fulfillmentState: remesa.fulfillmentState
    })),
    assignment: { vehicleAssigned: Boolean(expediente.vehicleId), driverAssigned: Boolean(expediente.driverId) },
    manifest: expediente.manifestDraft
      ? {
          missingFields: manifestMissingFields(expediente.manifestDraft, remesas.length, moneyLimits),
          officialState: officialState(manifestDocument),
          fulfillmentState: manifestDocument?.fulfillmentState ?? "not_requested"
        }
      : manifestDocument ? { missingFields: [], officialState: officialState(manifestDocument), fulfillmentState: manifestDocument.fulfillmentState ?? "not_requested" } : null,
    cargoInfoState: officialState(orderDocument)
  };
  const stageResult = deriveDispatchStage(projection);
  const hasUncertainOperation = operations.some((operation) => operation.status === "uncertain" || operation.status === "reconciling");
  const hasOperationInFlight = operations.some((operation) => operation.status === "queued" || operation.status === "claimed");
  const hasRejectedOperation = hasOpenRejection(operations, documents);
  const nextAction = dispatchPrimaryAction({
    stage: stageResult.stage,
    blockers: stageResult.blockers,
    hasRejectedOperation,
    hasUncertainOperation,
    hasOperationInFlight,
    printed: Boolean(expediente.loadingOrderDraft?.printedAt && expediente.manifestDraft?.printedAt)
  });
  const rndcStatus = hasUncertainOperation
    ? "Resultado incierto"
    : hasRejectedOperation
      ? "Requiere atención"
      : hasOperationInFlight
        ? "En proceso"
        : documents.length > 0 && documents.every((document) => ["authorized", "fulfilled", "annulled"].includes(document.officialState ?? "draft"))
          ? "Autorizado"
          : "Pendiente";

  return {
    expediente,
    serviceOrderCode: order.code,
    customerName: customer.name,
    originCity: loadingLocation.city,
    destinationCity: unloadingLocation.city,
    agencyCode: expediente.agencyCode,
    orderNumber: expediente.loadingOrderDraft?.orderNumber ?? expediente.cargoNumber,
    remesaNumbers: remesas.flatMap((remesa) => remesa.number ? [remesa.number] : []),
    manifestNumber: expediente.manifestDraft?.manifestNumber ?? expediente.manifestNumber,
    vehiclePlate: vehicle?.plate ?? trip?.vehiclePlate,
    driverName: driver?.name ?? trip?.driverName,
    stage: stageResult.stage,
    blockers: stageResult.blockers,
    rndcStatus,
    orderState: officialState(orderDocument),
    remesaStates: remesas.map((remesa) => remesa.officialState),
    manifestState: officialState(manifestDocument),
    nextAction: nextAction.label,
    nextActionKind: nextAction.kind,
    remesaCount: remesas.length,
    openNoveltyCount: openNovelties.filter((novelty) => novelty.status === "open").length
  };
}

export function officialState(document: Doc<"documents"> | undefined): OfficialDocumentState {
  const state = document?.officialState ?? document?.status;
  return state === "authorized" || state === "fulfilled" || state === "annulled" || state === "pending" ? state : "draft";
}

export function normalizeCode(value: string): string {
  const normalized = value.trim().toUpperCase();

  if (!normalized) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "Expediente code is required" });
  }

  return normalized;
}

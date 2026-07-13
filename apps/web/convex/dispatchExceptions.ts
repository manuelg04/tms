import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { appendAudit, requireActor, requireSameOrganization } from "./model/access";
import {
  buildCorrectionComparison,
  buildTransshipmentPlan,
  validateEmptyManifest,
  validateExceptionRequest,
  validateRemesaWithoutOrder
} from "./model/advancedWorkflow";
import { buildDispatchSnapshot } from "./model/dispatchSnapshot";
import { initialDocumentLifecycle } from "./model/documentLifecycle";

const typeValidator = v.union(
  v.literal("remesa_without_order"),
  v.literal("empty_manifest"),
  v.literal("transshipment"),
  v.literal("correction"),
  v.literal("annulment"),
  v.literal("reconciliation")
);

const statusValidator = v.union(
  v.literal("pending"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("rejected"),
  v.literal("uncertain"),
  v.literal("cancelled")
);

const exceptionValidator = v.object({
  _id: v.id("dispatchExceptions"),
  _creationTime: v.number(),
  organizationId: v.id("organizations"),
  expedienteId: v.id("expedientes"),
  requestKey: v.string(),
  type: typeValidator,
  status: statusValidator,
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
});

export const listForExpediente = query({
  args: { actorToken: v.optional(v.string()), expedienteId: v.id("expedientes") },
  returns: v.array(exceptionValidator),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    const expediente = await requireExpediente(ctx, args.expedienteId);
    requireSameOrganization(actor, expediente.organizationId);
    return await ctx.db
      .query("dispatchExceptions")
      .withIndex("by_expediente_and_created_at", (q) => q.eq("expedienteId", expediente._id))
      .order("desc")
      .take(100);
  }
});

export const start = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
    requestKey: v.string(),
    type: typeValidator,
    documentId: v.optional(v.id("documents")),
    sourceManifestDocumentId: v.optional(v.id("documents")),
    originalOperationId: v.optional(v.id("rndcOperations")),
    reasonCode: v.optional(v.string()),
    reason: v.string(),
    observation: v.string(),
    confirmed: v.boolean(),
    beforeJson: v.optional(v.string()),
    afterJson: v.optional(v.string()),
    dependencyPlanJson: v.optional(v.string())
  },
  returns: v.id("dispatchExceptions"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin"]);
    const expediente = await requireExpediente(ctx, args.expedienteId);
    requireSameOrganization(actor, expediente.organizationId);
    const validation = validateExceptionRequest(args);

    if (!validation.ok) throw invalid(validation.errors);
    const existing = await ctx.db
      .query("dispatchExceptions")
      .withIndex("by_organization_and_request_key", (q) => q.eq("organizationId", expediente.organizationId).eq("requestKey", args.requestKey))
      .unique();
    if (existing) return existing._id;
    if (args.documentId) await requireDocument(ctx, expediente, args.documentId);
    const before = parseRecord(args.beforeJson);
    const after = parseRecord(args.afterJson);
    const comparison = before && after ? buildCorrectionComparison(before, after) : undefined;

    if (args.type === "correction" && (!comparison || comparison.length === 0)) {
      throw invalid(["La corrección no contiene cambios"]);
    }

    const now = Date.now();
    const exceptionId = await ctx.db.insert("dispatchExceptions", {
      organizationId: expediente.organizationId,
      expedienteId: expediente._id,
      requestKey: args.requestKey,
      type: args.type,
      status: "in_progress",
      documentId: args.documentId,
      sourceManifestDocumentId: args.sourceManifestDocumentId,
      originalOperationId: args.originalOperationId,
      reasonCode: clean(args.reasonCode),
      reason: args.reason.trim(),
      observation: args.observation.trim(),
      confirmed: true,
      beforeJson: args.beforeJson,
      afterJson: args.afterJson,
      comparisonJson: comparison ? JSON.stringify(comparison) : undefined,
      dependencyPlanJson: args.dependencyPlanJson,
      createdBy: actor._id,
      createdAt: now,
      updatedAt: now
    });
    await record(ctx, expediente, actor, exceptionId, args.type, args.reason, now, "started");
    return exceptionId;
  }
});

export const complete = mutation({
  args: {
    actorToken: v.optional(v.string()),
    exceptionId: v.id("dispatchExceptions"),
    status: v.union(v.literal("completed"), v.literal("rejected"), v.literal("uncertain")),
    operationIds: v.optional(v.array(v.id("rndcOperations"))),
    evidenceCount: v.number(),
    resultJson: v.optional(v.string())
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin"]);
    const exception = await ctx.db.get("dispatchExceptions", args.exceptionId);

    if (!exception) throw new ConvexError({ code: "NOT_FOUND", message: "Excepción no encontrada" });
    requireSameOrganization(actor, exception.organizationId);

    if (exception.status !== "in_progress" && exception.status !== "uncertain") {
      throw new ConvexError({ code: "INVALID_STATE", message: "La excepción ya fue cerrada" });
    }
    if (args.status === "completed" && args.evidenceCount < 1) {
      throw new ConvexError({ code: "EVIDENCE_REQUIRED", message: "La excepción no puede completarse sin evidencia durable" });
    }

    const now = Date.now();
    await ctx.db.patch("dispatchExceptions", exception._id, {
      status: args.status,
      operationIds: args.operationIds,
      evidenceCount: args.evidenceCount,
      resultJson: args.resultJson,
      completedBy: actor._id,
      completedAt: args.status === "uncertain" ? undefined : now,
      updatedAt: now
    });
    const expediente = await requireExpediente(ctx, exception.expedienteId);
    await record(ctx, expediente, actor, exception._id, exception.type, exception.reason, now, args.status);
    return null;
  }
});

export const applyStructural = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
    requestKey: v.string(),
    type: v.union(v.literal("remesa_without_order"), v.literal("empty_manifest"), v.literal("transshipment")),
    reasonCode: v.optional(v.string()),
    reason: v.string(),
    observation: v.string(),
    confirmed: v.boolean(),
    payloadJson: v.string(),
    sourceManifestDocumentId: v.optional(v.id("documents")),
    replacementVehicleId: v.optional(v.id("vehicles")),
    replacementDriverId: v.optional(v.id("drivers"))
  },
  returns: v.id("dispatchExceptions"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin"]);
    const expediente = await requireExpediente(ctx, args.expedienteId);
    requireSameOrganization(actor, expediente.organizationId);
    const validation = validateExceptionRequest(args);
    if (!validation.ok) throw invalid(validation.errors);
    const existingException = await ctx.db
      .query("dispatchExceptions")
      .withIndex("by_organization_and_request_key", (q) => q.eq("organizationId", expediente.organizationId).eq("requestKey", args.requestKey))
      .unique();
    if (existingException) return existingException._id;
    const payload = parseRecord(args.payloadJson);
    if (!payload) throw invalid(["Datos de excepción inválidos"]);
    const now = Date.now();
    let beforeJson: string | undefined;
    let afterJson: string | undefined;

    if (args.type === "remesa_without_order") {
      const remesaValidation = validateRemesaWithoutOrder(payload);
      if (!remesaValidation.ok) throw invalid(remesaValidation.errors);
      const existing = await ctx.db
        .query("expedienteRemesas")
        .withIndex("by_expediente_and_sequence", (q) => q.eq("expedienteId", expediente._id))
        .collect();
      if (existing.length > 0) throw invalid(["La excepción sólo puede iniciar un despacho sin remesas previas"]);
      const draft = payload as Doc<"expedienteRemesas">["draft"] & Record<string, unknown>;
      const firstLine = Array.isArray(draft.remissions) ? draft.remissions[0] : undefined;
      await ctx.db.insert("expedienteRemesas", {
        organizationId: expediente.organizationId,
        expedienteId: expediente._id,
        sequence: 1,
        cargoDescription: firstLine?.description ?? "",
        cargoUnit: draft.unitOfMeasure,
        consigneeName: draft.recipient?.name,
        consigneeDocument: draft.recipient?.identificationNumber,
        draft,
        ...initialDocumentLifecycle(),
        createdBy: actor._id,
        updatedBy: actor._id,
        createdAt: now,
        updatedAt: now
      });
      await ctx.db.patch("expedientes", expediente._id, { workflowVariant: "remesa_without_order", loadingOrderDraft: undefined, updatedBy: actor._id, updatedAt: now });
      afterJson = args.payloadJson;
    }

    if (args.type === "empty_manifest") {
      const remesas = await ctx.db
        .query("expedienteRemesas")
        .withIndex("by_expediente_and_sequence", (q) => q.eq("expedienteId", expediente._id))
        .collect();
      const empty = validateEmptyManifest({ manifestType: payload.manifestType, remesaIds: remesas.map((row) => row._id), payload });
      if (!empty.ok) throw invalid(empty.errors);
      const serviceOrder = await ctx.db.get("serviceOrders", expediente.serviceOrderId);
      const [loadingLocation, unloadingLocation] = serviceOrder
        ? await Promise.all([ctx.db.get("customerLocations", serviceOrder.loadingLocationId), ctx.db.get("customerLocations", serviceOrder.unloadingLocationId)])
        : [null, null];
      const manifestDraft = {
        ...empty.payload,
        originCityName: loadingLocation?.city,
        originMunicipalityCode: loadingLocation?.municipalityCode,
        destinationCityName: unloadingLocation?.city,
        destinationMunicipalityCode: unloadingLocation?.municipalityCode
      } as Doc<"expedientes">["manifestDraft"];
      await ctx.db.patch("expedientes", expediente._id, {
        workflowVariant: "empty_manifest",
        manifestDraft,
        updatedBy: actor._id,
        updatedAt: now
      });
      afterJson = JSON.stringify(manifestDraft);
    }

    if (args.type === "transshipment") {
      if (!args.sourceManifestDocumentId || !args.replacementVehicleId || !args.replacementDriverId) {
        throw invalid(["Manifiesto anterior, vehículo y conductor de reemplazo requeridos"]);
      }
      const source = await requireDocument(ctx, expediente, args.sourceManifestDocumentId);
      const [oldVehicle, oldDriver, newVehicle, newDriver] = await Promise.all([
        expediente.vehicleId ? ctx.db.get("vehicles", expediente.vehicleId) : null,
        expediente.driverId ? ctx.db.get("drivers", expediente.driverId) : null,
        ctx.db.get("vehicles", args.replacementVehicleId),
        ctx.db.get("drivers", args.replacementDriverId)
      ]);
      if (!newVehicle || !newDriver) throw invalid(["La flota de reemplazo no existe"]);
      const before = { vehicleId: expediente.vehicleId, driverId: expediente.driverId, plate: oldVehicle?.plate, driver: oldDriver?.name };
      const after = { vehicleId: newVehicle._id, driverId: newDriver._id, plate: newVehicle.plate, driver: newDriver.name };
      const plan = buildTransshipmentPlan({
        sourceManifest: { number: source.number, officialState: source.officialState ?? source.status, fulfillmentState: source.fulfillmentState, suspended: payload.sourceSuspended === true },
        beforeAssignment: before,
        afterAssignment: after,
        releasedRemesaIds: Array.isArray(payload.releasedRemesaIds) ? payload.releasedRemesaIds.filter((item): item is string => typeof item === "string") : [],
        reasonCode: args.reasonCode,
        municipalityCode: clean(payload.municipalityCode)
      });
      if (!plan.ok) throw invalid(plan.blockers);
      await saveAssignmentSnapshot(ctx, expediente, actor._id, before, now);
      await saveAssignmentSnapshot(ctx, expediente, actor._id, after, now + 1);
      await ctx.db.patch("expedientes", expediente._id, {
        workflowVariant: "transshipment",
        sourceManifestDocumentId: source._id,
        vehicleId: newVehicle._id,
        driverId: newDriver._id,
        manifestDocumentId: undefined,
        manifestNumber: undefined,
        tripNumber: undefined,
        status: "draft",
        manifestDraft: { ...expediente.manifestDraft, manifestNumber: undefined, sourceManifestNumber: source.number },
        updatedBy: actor._id,
        updatedAt: now
      });
      beforeJson = JSON.stringify(before);
      afterJson = JSON.stringify(after);
    }

    const exceptionId = await ctx.db.insert("dispatchExceptions", {
      organizationId: expediente.organizationId,
      expedienteId: expediente._id,
      requestKey: args.requestKey,
      type: args.type,
      status: "completed",
      sourceManifestDocumentId: args.sourceManifestDocumentId,
      reasonCode: clean(args.reasonCode),
      reason: args.reason.trim(),
      observation: args.observation.trim(),
      confirmed: true,
      beforeJson,
      afterJson,
      comparisonJson: beforeJson && afterJson ? JSON.stringify(buildCorrectionComparison(JSON.parse(beforeJson), JSON.parse(afterJson))) : undefined,
      evidenceCount: 1,
      resultJson: args.payloadJson,
      createdBy: actor._id,
      completedBy: actor._id,
      createdAt: now,
      updatedAt: now,
      completedAt: now
    });
    await record(ctx, expediente, actor, exceptionId, args.type, args.reason, now, "completed");
    return exceptionId;
  }
});

async function requireExpediente(ctx: QueryCtx, expedienteId: Id<"expedientes">): Promise<Doc<"expedientes">> {
  const expediente = await ctx.db.get("expedientes", expedienteId);
  if (!expediente) throw new ConvexError({ code: "NOT_FOUND", message: "Expediente no encontrado" });
  return expediente;
}

async function requireDocument(ctx: QueryCtx, expediente: Doc<"expedientes">, documentId: Id<"documents">): Promise<Doc<"documents">> {
  const document = await ctx.db.get("documents", documentId);
  if (!document || document.expedienteId !== expediente._id || document.organizationId !== expediente.organizationId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Documento no encontrado en el expediente" });
  }
  return document;
}

async function saveAssignmentSnapshot(ctx: MutationCtx, expediente: Doc<"expedientes">, actorId: Id<"users">, value: unknown, takenAt: number) {
  const snapshot = buildDispatchSnapshot("asignacion", value, { takenAt });
  await ctx.db.insert("dispatchSnapshots", {
    organizationId: expediente.organizationId,
    expedienteId: expediente._id,
    kind: "asignacion",
    payloadJson: snapshot.payloadJson,
    fingerprint: snapshot.fingerprint,
    takenAt,
    takenBy: actorId
  });
}

async function record(
  ctx: MutationCtx,
  expediente: Doc<"expedientes">,
  actor: Doc<"users">,
  exceptionId: Id<"dispatchExceptions">,
  type: string,
  reason: string,
  now: number,
  state: string
) {
  await ctx.db.insert("expedienteEvents", {
    organizationId: expediente.organizationId,
    expedienteId: expediente._id,
    eventType: `advanced_exception_${state}`,
    title: `${label(type)}: ${state === "completed" ? "completada" : state === "started" ? "iniciada" : state}`,
    details: reason.trim(),
    occurredAt: now,
    actorId: actor._id
  });
  await appendAudit(ctx, {
    organizationId: expediente.organizationId,
    actorType: "user",
    actorId: actor._id,
    action: `dispatch.exception_${state}`,
    entityType: "dispatch_exception",
    entityId: exceptionId,
    reason: reason.trim(),
    detailsJson: JSON.stringify({ type, expedienteId: expediente._id }),
    createdAt: now
  });
}

function invalid(errors: string[]) {
  return new ConvexError({ code: "VALIDATION", message: errors[0] ?? "Excepción inválida", data: { errors } });
}

function parseRecord(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function clean(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function label(type: string) {
  const labels: Record<string, string> = {
    remesa_without_order: "Remesa sin orden de cargue",
    empty_manifest: "Manifiesto vacío",
    transshipment: "Transbordo",
    correction: "Corrección",
    annulment: "Anulación",
    reconciliation: "Conciliación"
  };
  return labels[type] ?? "Excepción operativa";
}

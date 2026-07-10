import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { appendAudit, requireActor, requireSameOrganization } from "./model/access";
import { initialDocumentLifecycle } from "./model/documentLifecycle";

const statusValidator = v.union(
  v.literal("draft"),
  v.literal("ready"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("cancelled")
);

const officialStateValidator = v.union(
  v.literal("draft"),
  v.literal("pending"),
  v.literal("authorized"),
  v.literal("fulfilled"),
  v.literal("annulled")
);

const fulfillmentStateValidator = v.union(
  v.literal("not_requested"),
  v.literal("pending"),
  v.literal("fulfilled"),
  v.literal("rejected"),
  v.literal("annulment_pending")
);

const correctionStateValidator = v.union(
  v.literal("none"),
  v.literal("pending"),
  v.literal("corrected"),
  v.literal("rejected")
);

const annulmentStateValidator = v.union(
  v.literal("none"),
  v.literal("pending"),
  v.literal("annulled"),
  v.literal("rejected")
);

const reconciliationStateValidator = v.union(
  v.literal("not_needed"),
  v.literal("pending"),
  v.literal("confirmed"),
  v.literal("mismatch")
);

const expedienteValidator = v.object({
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
  createdBy: v.id("users"),
  updatedBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number()
});

const remesaValidator = v.object({
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

const serviceOrderDetailValidator = v.object({
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

const partyValidator = v.union(
  v.object({ _id: v.id("drivers"), document: v.string(), name: v.optional(v.string()) }),
  v.null()
);

const vehicleValidator = v.union(
  v.object({ _id: v.id("vehicles"), plate: v.string(), make: v.optional(v.string()), line: v.optional(v.string()) }),
  v.null()
);

const trailerValidator = v.union(
  v.object({ _id: v.id("trailers"), plate: v.string(), trailerType: v.optional(v.string()), status: v.string() }),
  v.null()
);

const documentValidator = v.object({
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

const complianceValidator = v.object({
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

const eventValidator = v.object({
  _id: v.id("expedienteEvents"),
  eventType: v.string(),
  title: v.string(),
  details: v.optional(v.string()),
  occurredAt: v.number(),
  actorId: v.optional(v.id("users"))
});

const noveltyValidator = v.object({
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

const deliveryEvidenceValidator = v.object({
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

const listRowValidator = v.object({
  expediente: expedienteValidator,
  serviceOrderCode: v.string(),
  customerName: v.string(),
  originCity: v.string(),
  destinationCity: v.string(),
  remesaCount: v.number(),
  openNoveltyCount: v.number()
});

export const create = mutation({
  args: {
    actorToken: v.optional(v.string()),
    organizationId: v.id("organizations"),
    serviceOrderId: v.id("serviceOrders"),
    code: v.string(),
    notes: v.optional(v.string())
  },
  returns: v.id("expedientes"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    requireSameOrganization(actor, args.organizationId);
    const order = await ctx.db.get("serviceOrders", args.serviceOrderId);

    if (!order || order.organizationId !== args.organizationId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Service order not found" });
    }

    const code = normalizeCode(args.code);
    const existing = await ctx.db
      .query("expedientes")
      .withIndex("by_organization_and_code", (q) => q.eq("organizationId", args.organizationId).eq("code", code))
      .unique();

    if (existing) {
      if (existing.serviceOrderId !== args.serviceOrderId) {
        throw new ConvexError({ code: "CONFLICT", message: "Expediente code belongs to another service order" });
      }

      return existing._id;
    }

    const now = Date.now();
    const [loadingLocation, unloadingLocation] = await Promise.all([
      ctx.db.get("customerLocations", order.loadingLocationId),
      ctx.db.get("customerLocations", order.unloadingLocationId)
    ]);
    const tripId = await ctx.db.insert("trips", {
      organizationId: args.organizationId,
      code,
      status: "borrador",
      originCity: loadingLocation?.city,
      destinationCity: unloadingLocation?.city,
      createdAt: now,
      updatedAt: now
    });
    const expedienteId = await ctx.db.insert("expedientes", {
      organizationId: args.organizationId,
      serviceOrderId: args.serviceOrderId,
      tripId,
      code,
      status: "draft",
      notes: args.notes,
      createdBy: actor._id,
      updatedBy: actor._id,
      createdAt: now,
      updatedAt: now
    });
    await ctx.db.patch("trips", tripId, { expedienteId });
    await ctx.db.insert("expedienteEvents", {
      organizationId: args.organizationId,
      expedienteId,
      eventType: "expediente_created",
      title: "Expediente creado",
      occurredAt: now,
      actorId: actor._id
    });
    await appendAudit(ctx, {
      organizationId: args.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "expediente.created",
      entityType: "expediente",
      entityId: expedienteId,
      createdAt: now
    });
    return expedienteId;
  }
});

export const update = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
    status: v.optional(statusValidator),
    driverId: v.optional(v.id("drivers")),
    secondDriverId: v.optional(v.id("drivers")),
    vehicleId: v.optional(v.id("vehicles")),
    trailerId: v.optional(v.id("trailers")),
    manifestNumber: v.optional(v.string()),
    cargoNumber: v.optional(v.string()),
    tripNumber: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    reason: v.optional(v.string())
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const expediente = await requireExpediente(ctx, args.expedienteId);
    requireSameOrganization(actor, expediente.organizationId);
    await validateAssignments(ctx, expediente.organizationId, args);
    const now = Date.now();
    const patch: Partial<Doc<"expedientes">> = { updatedBy: actor._id, updatedAt: now };

    for (const key of [
      "status",
      "driverId",
      "secondDriverId",
      "vehicleId",
      "trailerId",
      "manifestNumber",
      "cargoNumber",
      "tripNumber",
      "startedAt",
      "completedAt",
      "notes"
    ] as const) {
      const value = args[key];
      if (value !== undefined) {
        Object.assign(patch, { [key]: value });
      }
    }

    await ctx.db.patch("expedientes", expediente._id, patch);

    if (args.status) {
      const serviceOrderStatus =
        args.status === "ready"
          ? "assigned"
          : args.status === "in_progress"
            ? "in_progress"
            : args.status === "completed"
              ? "completed"
              : args.status === "cancelled"
                ? "cancelled"
                : undefined;

      if (serviceOrderStatus) {
        await ctx.db.patch("serviceOrders", expediente.serviceOrderId, {
          status: serviceOrderStatus,
          updatedBy: actor._id,
          updatedAt: now
        });
      }
    }

    if (expediente.tripId) {
      const driver = args.driverId ? await ctx.db.get("drivers", args.driverId) : null;
      const vehicle = args.vehicleId ? await ctx.db.get("vehicles", args.vehicleId) : null;
      await ctx.db.patch("trips", expediente.tripId, {
        status: args.status ?? expediente.status,
        driverName: driver?.name,
        vehiclePlate: vehicle?.plate,
        updatedAt: now
      });
    }

    if (args.status && args.status !== expediente.status) {
      await ctx.db.insert("expedienteEvents", {
        organizationId: expediente.organizationId,
        expedienteId: expediente._id,
        eventType: "status_changed",
        title: `Estado actualizado a ${args.status}`,
        details: args.reason,
        occurredAt: now,
        actorId: actor._id
      });
    }

    await appendAudit(ctx, {
      organizationId: expediente.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "expediente.updated",
      entityType: "expediente",
      entityId: expediente._id,
      reason: args.reason,
      createdAt: now
    });
    return null;
  }
});

export const removeDraft = mutation({
  args: { actorToken: v.optional(v.string()), expedienteId: v.id("expedientes"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin"]);
    const expediente = await requireExpediente(ctx, args.expedienteId);
    requireSameOrganization(actor, expediente.organizationId);

    if (expediente.status !== "draft") {
      throw new ConvexError({ code: "INVALID_STATE", message: "Only draft expedientes can be removed" });
    }

    const [remesa, document, operation] = await Promise.all([
      ctx.db
        .query("expedienteRemesas")
        .withIndex("by_expediente_and_sequence", (q) => q.eq("expedienteId", expediente._id))
        .first(),
      ctx.db.query("documents").withIndex("by_expediente", (q) => q.eq("expedienteId", expediente._id)).first(),
      ctx.db
        .query("rndcOperations")
        .withIndex("by_expediente_and_created_at", (q) => q.eq("expedienteId", expediente._id))
        .first()
    ]);

    if (remesa || document || operation) {
      throw new ConvexError({ code: "INVALID_STATE", message: "Expediente already has operational records" });
    }

    const now = Date.now();
    await ctx.db.delete("expedientes", expediente._id);

    if (expediente.tripId) {
      await ctx.db.delete("trips", expediente.tripId);
    }

    await appendAudit(ctx, {
      organizationId: expediente.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "expediente.removed",
      entityType: "expediente",
      entityId: expediente._id,
      reason: args.reason,
      createdAt: now
    });
    return null;
  }
});

export const upsertRemesa = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
    sequence: v.number(),
    number: v.optional(v.string()),
    cargoDescription: v.string(),
    cargoQuantity: v.optional(v.number()),
    cargoUnit: v.optional(v.string()),
    cargoWeightKg: v.optional(v.number()),
    consigneeName: v.optional(v.string()),
    consigneeDocument: v.optional(v.string())
  },
  returns: v.id("expedienteRemesas"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const expediente = await requireExpediente(ctx, args.expedienteId);
    requireSameOrganization(actor, expediente.organizationId);

    if (!Number.isInteger(args.sequence) || args.sequence < 1) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Remesa sequence must be a positive integer" });
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("expedienteRemesas")
      .withIndex("by_expediente_and_sequence", (q) => q.eq("expedienteId", expediente._id).eq("sequence", args.sequence))
      .unique();
    const number = args.number?.trim();
    const numberOwner = number
      ? await ctx.db
          .query("expedienteRemesas")
          .withIndex("by_organization_and_number", (q) =>
            q.eq("organizationId", expediente.organizationId).eq("number", number)
          )
          .unique()
      : null;

    if (numberOwner && numberOwner._id !== existing?._id) {
      throw new ConvexError({ code: "CONFLICT", message: "Remesa number belongs to another expediente" });
    }

    const values = {
      number,
      cargoDescription: args.cargoDescription.trim(),
      cargoQuantity: args.cargoQuantity,
      cargoUnit: args.cargoUnit,
      cargoWeightKg: args.cargoWeightKg,
      consigneeName: args.consigneeName,
      consigneeDocument: args.consigneeDocument,
      updatedBy: actor._id,
      updatedAt: now
    };
    let remesaId;

    if (existing) {
      if (existing.officialState !== "draft") {
        throw new ConvexError({ code: "INVALID_STATE", message: "Only draft remesas can be edited" });
      }
      await ctx.db.patch("expedienteRemesas", existing._id, values);
      remesaId = existing._id;
    } else {
      const lifecycle = initialDocumentLifecycle();
      remesaId = await ctx.db.insert("expedienteRemesas", {
        organizationId: expediente.organizationId,
        expedienteId: expediente._id,
        sequence: args.sequence,
        ...values,
        ...lifecycle,
        createdBy: actor._id,
        createdAt: now
      });
    }

    await appendAudit(ctx, {
      organizationId: expediente.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: existing ? "expediente_remesa.updated" : "expediente_remesa.created",
      entityType: "expediente_remesa",
      entityId: remesaId,
      createdAt: now
    });
    return remesaId;
  }
});

export const removeDraftRemesa = mutation({
  args: { actorToken: v.optional(v.string()), remesaId: v.id("expedienteRemesas"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const remesa = await ctx.db.get("expedienteRemesas", args.remesaId);

    if (!remesa) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Remesa not found" });
    }

    requireSameOrganization(actor, remesa.organizationId);

    if (remesa.officialState !== "draft" || remesa.documentId) {
      throw new ConvexError({ code: "INVALID_STATE", message: "Only an unissued draft remesa can be removed" });
    }

    const now = Date.now();
    await ctx.db.delete("expedienteRemesas", remesa._id);
    await appendAudit(ctx, {
      organizationId: remesa.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "expediente_remesa.removed",
      entityType: "expediente_remesa",
      entityId: remesa._id,
      reason: args.reason,
      createdAt: now
    });
    return null;
  }
});

export const recordComplianceCheck = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
    subjectType: v.union(v.literal("driver"), v.literal("vehicle"), v.literal("trailer")),
    subjectId: v.string(),
    checkType: v.string(),
    status: v.union(v.literal("passed"), v.literal("warning"), v.literal("failed")),
    expiresAt: v.optional(v.number()),
    details: v.optional(v.string()),
    checkedAt: v.optional(v.number())
  },
  returns: v.id("complianceChecks"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const expediente = await requireExpediente(ctx, args.expedienteId);
    requireSameOrganization(actor, expediente.organizationId);
    const checkedAt = args.checkedAt ?? Date.now();
    const checkId = await ctx.db.insert("complianceChecks", {
      organizationId: expediente.organizationId,
      expedienteId: expediente._id,
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      checkType: args.checkType,
      status: args.status,
      expiresAt: args.expiresAt,
      details: args.details,
      checkedAt,
      checkedBy: actor._id
    });
    await appendAudit(ctx, {
      organizationId: expediente.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "compliance_check.recorded",
      entityType: "compliance_check",
      entityId: checkId,
      createdAt: checkedAt
    });
    return checkId;
  }
});

export const appendEvent = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
    eventType: v.string(),
    title: v.string(),
    details: v.optional(v.string()),
    occurredAt: v.optional(v.number())
  },
  returns: v.id("expedienteEvents"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const expediente = await requireExpediente(ctx, args.expedienteId);
    requireSameOrganization(actor, expediente.organizationId);
    const occurredAt = args.occurredAt ?? Date.now();
    const eventId = await ctx.db.insert("expedienteEvents", {
      organizationId: expediente.organizationId,
      expedienteId: expediente._id,
      eventType: args.eventType,
      title: args.title,
      details: args.details,
      occurredAt,
      actorId: actor._id
    });
    await appendAudit(ctx, {
      organizationId: expediente.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "expediente.event_appended",
      entityType: "expediente_event",
      entityId: eventId,
      createdAt: occurredAt
    });
    return eventId;
  }
});

export const openNovelty = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
    category: v.string(),
    severity: v.union(v.literal("info"), v.literal("warning"), v.literal("critical")),
    description: v.string()
  },
  returns: v.id("expedienteNovelties"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const expediente = await requireExpediente(ctx, args.expedienteId);
    requireSameOrganization(actor, expediente.organizationId);
    const now = Date.now();
    const noveltyId = await ctx.db.insert("expedienteNovelties", {
      organizationId: expediente.organizationId,
      expedienteId: expediente._id,
      category: args.category,
      severity: args.severity,
      status: "open",
      description: args.description,
      openedAt: now,
      openedBy: actor._id
    });
    await appendAudit(ctx, {
      organizationId: expediente.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "novelty.opened",
      entityType: "novelty",
      entityId: noveltyId,
      createdAt: now
    });
    return noveltyId;
  }
});

export const resolveNovelty = mutation({
  args: { actorToken: v.optional(v.string()), noveltyId: v.id("expedienteNovelties"), resolution: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const novelty = await ctx.db.get("expedienteNovelties", args.noveltyId);

    if (!novelty) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Novelty not found" });
    }

    requireSameOrganization(actor, novelty.organizationId);

    if (novelty.status === "resolved") {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch("expedienteNovelties", novelty._id, {
      status: "resolved",
      resolution: args.resolution,
      resolvedAt: now,
      resolvedBy: actor._id
    });
    await appendAudit(ctx, {
      organizationId: novelty.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "novelty.resolved",
      entityType: "novelty",
      entityId: novelty._id,
      createdAt: now
    });
    return null;
  }
});

export const attachDeliveryEvidence = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
    evidenceArtifactId: v.id("evidenceArtifacts"),
    kind: v.union(v.literal("pod"), v.literal("photo"), v.literal("signature"), v.literal("document"), v.literal("other")),
    notes: v.optional(v.string()),
    capturedAt: v.optional(v.number())
  },
  returns: v.id("deliveryEvidence"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const [expediente, artifact] = await Promise.all([
      requireExpediente(ctx, args.expedienteId),
      ctx.db.get("evidenceArtifacts", args.evidenceArtifactId)
    ]);
    requireSameOrganization(actor, expediente.organizationId);

    if (
      !artifact ||
      artifact.organizationId !== expediente.organizationId ||
      (artifact.expedienteId !== undefined && artifact.expedienteId !== expediente._id)
    ) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Evidence artifact not found" });
    }

    const capturedAt = args.capturedAt ?? Date.now();
    const deliveryEvidenceId = await ctx.db.insert("deliveryEvidence", {
      organizationId: expediente.organizationId,
      expedienteId: expediente._id,
      evidenceArtifactId: artifact._id,
      kind: args.kind,
      notes: args.notes,
      capturedAt,
      capturedBy: actor._id
    });
    await appendAudit(ctx, {
      organizationId: expediente.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "delivery_evidence.attached",
      entityType: "delivery_evidence",
      entityId: deliveryEvidenceId,
      createdAt: capturedAt
    });
    return deliveryEvidenceId;
  }
});

export const list = query({
  args: {
    actorToken: v.optional(v.string()),
    organizationId: v.id("organizations"),
    status: v.optional(statusValidator),
    limit: v.optional(v.number())
  },
  returns: v.array(listRowValidator),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    requireSameOrganization(actor, args.organizationId);
    const expedientes = await ctx.db
      .query("expedientes")
      .withIndex("by_organization_and_status", (index) =>
        args.status
          ? index.eq("organizationId", args.organizationId).eq("status", args.status)
          : index.eq("organizationId", args.organizationId)
      )
      .order("desc")
      .take(Math.min(Math.max(args.limit ?? 100, 1), 200));
    return await Promise.all(expedientes.map((expediente) => toListRow(ctx, expediente)));
  }
});

export const detail = query({
  args: { actorToken: v.optional(v.string()), expedienteId: v.id("expedientes") },
  returns: v.union(
    v.null(),
    v.object({
      expediente: expedienteValidator,
      serviceOrder: serviceOrderDetailValidator,
      customer: v.object({ _id: v.id("customers"), code: v.string(), name: v.string() }),
      loadingLocation: v.object({ _id: v.id("customerLocations"), name: v.string(), address: v.string(), city: v.string() }),
      unloadingLocation: v.object({ _id: v.id("customerLocations"), name: v.string(), address: v.string(), city: v.string() }),
      driver: partyValidator,
      secondDriver: partyValidator,
      vehicle: vehicleValidator,
      trailer: trailerValidator,
      remesas: v.array(remesaValidator),
      documents: v.array(documentValidator),
      complianceChecks: v.array(complianceValidator),
      events: v.array(eventValidator),
      novelties: v.array(noveltyValidator),
      deliveryEvidence: v.array(deliveryEvidenceValidator)
    })
  ),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    const expediente = await ctx.db.get("expedientes", args.expedienteId);

    if (!expediente) {
      return null;
    }

    requireSameOrganization(actor, expediente.organizationId);
    const order = await ctx.db.get("serviceOrders", expediente.serviceOrderId);

    if (!order) {
      throw new ConvexError({ code: "INTEGRITY_ERROR", message: "Service order is missing" });
    }

    const [customer, loadingLocation, unloadingLocation, driver, secondDriver, vehicle, trailer] = await Promise.all([
      ctx.db.get("customers", order.customerId),
      ctx.db.get("customerLocations", order.loadingLocationId),
      ctx.db.get("customerLocations", order.unloadingLocationId),
      expediente.driverId ? ctx.db.get("drivers", expediente.driverId) : null,
      expediente.secondDriverId ? ctx.db.get("drivers", expediente.secondDriverId) : null,
      expediente.vehicleId ? ctx.db.get("vehicles", expediente.vehicleId) : null,
      expediente.trailerId ? ctx.db.get("trailers", expediente.trailerId) : null
    ]);

    if (!customer || !loadingLocation || !unloadingLocation) {
      throw new ConvexError({ code: "INTEGRITY_ERROR", message: "Expediente master data is incomplete" });
    }

    const [remesas, documents, complianceChecks, events, novelties, deliveryRows] = await Promise.all([
      ctx.db
        .query("expedienteRemesas")
        .withIndex("by_expediente_and_sequence", (q) => q.eq("expedienteId", expediente._id))
        .collect(),
      ctx.db.query("documents").withIndex("by_expediente", (q) => q.eq("expedienteId", expediente._id)).collect(),
      ctx.db
        .query("complianceChecks")
        .withIndex("by_expediente_and_checked_at", (q) => q.eq("expedienteId", expediente._id))
        .order("desc")
        .take(200),
      ctx.db
        .query("expedienteEvents")
        .withIndex("by_expediente_and_occurred_at", (q) => q.eq("expedienteId", expediente._id))
        .order("desc")
        .take(300),
      ctx.db
        .query("expedienteNovelties")
        .withIndex("by_expediente_and_opened_at", (q) => q.eq("expedienteId", expediente._id))
        .order("desc")
        .take(200),
      ctx.db
        .query("deliveryEvidence")
        .withIndex("by_expediente_and_captured_at", (q) => q.eq("expedienteId", expediente._id))
        .order("desc")
        .take(200)
    ]);
    const deliveryEvidence = [];

    for (const row of deliveryRows) {
      const artifact = await ctx.db.get("evidenceArtifacts", row.evidenceArtifactId);
      if (artifact) {
        deliveryEvidence.push({
          _id: row._id,
          kind: row.kind,
          notes: row.notes,
          capturedAt: row.capturedAt,
          capturedBy: row.capturedBy,
          artifact: {
            _id: artifact._id,
            fileName: artifact.fileName,
            contentType: artifact.contentType,
            size: artifact.size,
            sha256: artifact.sha256
          }
        });
      }
    }

    return {
      expediente,
      serviceOrder: {
        _id: order._id,
        code: order.code,
        status: order.status,
        customerReference: order.customerReference,
        cargoDescription: order.cargoDescription,
        cargoQuantity: order.cargoQuantity,
        cargoUnit: order.cargoUnit,
        cargoWeightKg: order.cargoWeightKg,
        agreedRate: order.agreedRate,
        currency: order.currency,
        scheduledLoadingAt: order.scheduledLoadingAt,
        scheduledUnloadingAt: order.scheduledUnloadingAt,
        notes: order.notes
      },
      customer: { _id: customer._id, code: customer.code, name: customer.name },
      loadingLocation: {
        _id: loadingLocation._id,
        name: loadingLocation.name,
        address: loadingLocation.address,
        city: loadingLocation.city
      },
      unloadingLocation: {
        _id: unloadingLocation._id,
        name: unloadingLocation.name,
        address: unloadingLocation.address,
        city: unloadingLocation.city
      },
      driver: driver ? { _id: driver._id, document: driver.document, name: driver.name } : null,
      secondDriver: secondDriver ? { _id: secondDriver._id, document: secondDriver.document, name: secondDriver.name } : null,
      vehicle: vehicle ? { _id: vehicle._id, plate: vehicle.plate, make: vehicle.make, line: vehicle.line } : null,
      trailer: trailer ? { _id: trailer._id, plate: trailer.plate, trailerType: trailer.trailerType, status: trailer.status } : null,
      remesas,
      documents: documents.map((document) => ({
        _id: document._id,
        kind: document.kind,
        number: document.number,
        rndcRadicado: document.rndcRadicado,
        issuanceRadicado: document.issuanceRadicado,
        mode: document.mode,
        status: document.status,
        officialState: document.officialState,
        fulfillmentState: document.fulfillmentState,
        correctionState: document.correctionState,
        annulmentState: document.annulmentState,
        reconciliationState: document.reconciliationState,
        acceptanceState: document.acceptanceState,
        acceptanceActorName: document.acceptanceActorName,
        acceptanceActorDocument: document.acceptanceActorDocument,
        acceptanceRecordedAt: document.acceptanceRecordedAt,
        updatedAt: document.updatedAt
      })),
      complianceChecks: complianceChecks.map((check) => ({
        _id: check._id,
        subjectType: check.subjectType,
        subjectId: check.subjectId,
        checkType: check.checkType,
        status: check.status,
        expiresAt: check.expiresAt,
        details: check.details,
        checkedAt: check.checkedAt,
        checkedBy: check.checkedBy
      })),
      events: events.map((event) => ({
        _id: event._id,
        eventType: event.eventType,
        title: event.title,
        details: event.details,
        occurredAt: event.occurredAt,
        actorId: event.actorId
      })),
      novelties: novelties.map((novelty) => ({
        _id: novelty._id,
        category: novelty.category,
        severity: novelty.severity,
        status: novelty.status,
        description: novelty.description,
        resolution: novelty.resolution,
        openedAt: novelty.openedAt,
        resolvedAt: novelty.resolvedAt,
        openedBy: novelty.openedBy,
        resolvedBy: novelty.resolvedBy
      })),
      deliveryEvidence
    };
  }
});

async function requireExpediente(ctx: QueryCtx, expedienteId: Id<"expedientes">): Promise<Doc<"expedientes">> {
  const expediente = await ctx.db.get("expedientes", expedienteId);

  if (!expediente) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Expediente not found" });
  }

  return expediente;
}

async function validateAssignments(
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

async function toListRow(ctx: QueryCtx, expediente: Doc<"expedientes">) {
  const order = await ctx.db.get("serviceOrders", expediente.serviceOrderId);

  if (!order) {
    throw new ConvexError({ code: "INTEGRITY_ERROR", message: "Service order is missing" });
  }

  const [customer, loadingLocation, unloadingLocation, remesas, openNovelties] = await Promise.all([
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
      .collect()
  ]);

  if (!customer || !loadingLocation || !unloadingLocation) {
    throw new ConvexError({ code: "INTEGRITY_ERROR", message: "Expediente master data is incomplete" });
  }

  return {
    expediente,
    serviceOrderCode: order.code,
    customerName: customer.name,
    originCity: loadingLocation.city,
    destinationCity: unloadingLocation.city,
    remesaCount: remesas.length,
    openNoveltyCount: openNovelties.filter((novelty) => novelty.status === "open").length
  };
}

function normalizeCode(value: string): string {
  const normalized = value.trim().toUpperCase();

  if (!normalized) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "Expediente code is required" });
  }

  return normalized;
}

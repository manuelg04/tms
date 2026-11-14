import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { appendAudit, requireActor, requireSameOrganization } from "./model/access";
import { initialDocumentLifecycle } from "./model/documentLifecycle";
import { moneyLimitsValidator } from "./model/draftValidators";
import { loadMoneyLimits } from "./model/moneyLimits";
import { currentManifestDocument } from "./model/currentManifest";
import { sameMunicipality } from "./model/tripRoute";
import { expedienteRouteReview } from "./model/tripRouteRecords";
import { normalizeSearchText } from "./model/dispatchSearch";
import {
  statusValidator,
  expedienteValidator,
  remesaValidator,
  serviceOrderDetailValidator,
  partyValidator,
  vehicleValidator,
  trailerValidator,
  documentValidator,
  complianceValidator,
  eventValidator,
  noveltyValidator,
  deliveryEvidenceValidator,
  requireExpediente,
  validateAssignments,
  officialState,
  normalizeCode
} from "./model/expedienteRecords";

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
    const [customer, loadingLocation, unloadingLocation] = await Promise.all([
      ctx.db.get("customers", order.customerId),
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
      searchText: normalizeSearchText([code, order.code, customer?.name, loadingLocation?.city, unloadingLocation?.city].filter(Boolean).join(" ")),
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
      deliveryEvidence: v.array(deliveryEvidenceValidator),
      moneyLimits: moneyLimitsValidator,
      route: v.object({
        origin: v.object({ code: v.optional(v.string()), city: v.optional(v.string()) }),
        destination: v.object({ code: v.optional(v.string()), city: v.optional(v.string()) }),
        sameMunicipality: v.boolean(),
        blockers: v.array(v.string()),
        differences: v.array(v.string())
      })
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
    const emitted = (state: string | undefined) => state === "authorized" || state === "fulfilled";
    const routeReview = await expedienteRouteReview(
      ctx,
      expediente,
      remesas,
      {
        orderEmitted: documents.some((document) => document.kind === "orden_cargue" && emitted(document.officialState)),
        manifestEmitted: emitted(currentManifestDocument(expediente, documents)?.officialState)
      },
      { loading: loadingLocation, unloading: unloadingLocation }
    );

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
      driver: driver ? { _id: driver._id, document: driver.document, name: driver.name, phone: driver.cellphone ?? driver.phone1 } : null,
      secondDriver: secondDriver ? { _id: secondDriver._id, document: secondDriver.document, name: secondDriver.name } : null,
      vehicle: vehicle
        ? {
            _id: vehicle._id,
            plate: vehicle.plate,
            make: vehicle.make,
            line: vehicle.line,
            lineName: vehicle.lineName,
            modelYear: vehicle.modelYear,
            configuration: vehicle.configuration,
            configurationLabel: vehicle.configurationLabel,
            capacityTn: vehicle.capacityTn,
            ownerName: vehicle.ownerName,
            ownerDocument: vehicle.ownerDocument,
            possessorName: vehicle.possessorName,
            possessorDocument: vehicle.possessorDocument
          }
        : null,
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
        errorText: document.errorText,
        expedienteRemesaId: document.expedienteRemesaId,
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
      deliveryEvidence,
      moneyLimits: await loadMoneyLimits(ctx, expediente.organizationId),
      route: {
        origin: routeReview.route.origin,
        destination: routeReview.route.destination,
        sameMunicipality: Boolean((routeReview.route.origin.code || routeReview.route.origin.city) && (routeReview.route.destination.code || routeReview.route.destination.city) && sameMunicipality(routeReview.route)),
        blockers: routeReview.siteBlockers,
        differences: routeReview.differences
      }
    };
  }
});

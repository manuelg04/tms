import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { appendAudit, requireActor, requireSameOrganization } from "./model/access";
import { claimNextConsecutive } from "./model/consecutiveRange";
import { buildDispatchSnapshot, type SnapshotKind } from "./model/dispatchSnapshot";
import {
  assertStageEditable,
  bogotaDate,
  consignmentMissingFields,
  deriveDispatchStage,
  emissionDependencyBlockers,
  emissionScopeTargets,
  effectiveConsignment,
  loadingOrderMissingFields,
  manifestMissingFields,
  type ConsignmentDraft,
  type DispatchProjection,
  type EmissionScope,
  type LoadingOrderDraft
} from "./model/dispatchWorkflow";
import { initialDocumentLifecycle, type OfficialDocumentState } from "./model/documentLifecycle";
import {
  consignmentDraftValidator,
  fulfillmentDraftValidator,
  loadingOrderDraftValidator,
  manifestDraftValidator,
  manifestFulfillmentDraftValidator
} from "./model/draftValidators";
import { validateFulfillmentQuantities, validateLogisticsTimeline } from "./model/fulfillmentWorkflow";
import { normalizeSearchText } from "./model/dispatchSearch";
import { refreshDispatchSearchText } from "./model/dispatchSearchProjection";

const stageValidator = v.union(
  v.literal("orden_cargue"),
  v.literal("remesas"),
  v.literal("vehiculo_conductor"),
  v.literal("manifiesto"),
  v.literal("envio_rndc"),
  v.literal("cargue_descargue"),
  v.literal("cumplido_inicial"),
  v.literal("cumplido_final"),
  v.literal("cumplido"),
  v.literal("anulado")
);

const emissionScopeValidator = v.union(
  v.literal("orden"),
  v.literal("remesas"),
  v.literal("manifiesto"),
  v.literal("todo")
);

const consecutiveDefaults: Record<string, { prefix: string; padding: number }> = {
  expediente: { prefix: "DSP-", padding: 6 },
  orden_cargue: { prefix: "", padding: 7 },
  remesa: { prefix: "", padding: 5 },
  viaje: { prefix: "", padding: 7 },
  manifiesto: { prefix: "", padding: 7 }
};

export const createDraft = mutation({
  args: {
    actorToken: v.optional(v.string()),
    serviceOrderId: v.id("serviceOrders"),
    agencyCode: v.optional(v.string()),
    notes: v.optional(v.string())
  },
  returns: v.object({ expedienteId: v.id("expedientes"), code: v.string() }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const order = await ctx.db.get("serviceOrders", args.serviceOrderId);

    if (!order || order.organizationId !== actor.organizationId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Orden de servicio no encontrada" });
    }

    const [customer, loadingLocation, unloadingLocation] = await Promise.all([
      ctx.db.get("customers", order.customerId),
      ctx.db.get("customerLocations", order.loadingLocationId),
      ctx.db.get("customerLocations", order.unloadingLocationId)
    ]);
    const now = Date.now();
    const agencyCode = args.agencyCode?.trim() || "";
    const code = await claimConsecutive(ctx, actor.organizationId, agencyCode, "expediente", now);
    const existing = await ctx.db
      .query("expedientes")
      .withIndex("by_organization_and_code", (q) => q.eq("organizationId", actor.organizationId).eq("code", code))
      .unique();

    if (existing) {
      throw new ConvexError({ code: "CONFLICT", message: `El consecutivo de expediente ${code} ya está en uso` });
    }

    const loadingOrderDraft: LoadingOrderDraft & { customerId?: Id<"customers"> } = {
      agencyCode: agencyCode || undefined,
      customerId: order.customerId,
      customerReference: order.customerReference,
      sender: customer
        ? {
            name: customer.name,
            identificationType: customer.identificationType,
            identificationNumber: customer.identificationNumber,
            phone: customer.phone
          }
        : undefined,
      loading: loadingLocation
        ? {
            siteName: loadingLocation.name,
            address: loadingLocation.address,
            cityName: loadingLocation.city,
            municipalityCode: loadingLocation.municipalityCode,
            appointmentAt: order.scheduledLoadingAt
          }
        : undefined,
      unloading: unloadingLocation
        ? {
            siteName: unloadingLocation.name,
            address: unloadingLocation.address,
            cityName: unloadingLocation.city,
            municipalityCode: unloadingLocation.municipalityCode,
            appointmentAt: order.scheduledUnloadingAt
          }
        : undefined,
      cargoDescription: order.cargoDescription,
      cargoQuantity: order.cargoQuantity !== undefined ? String(order.cargoQuantity) : undefined,
      cargoUnit: order.cargoUnit,
      generatesConsignment: true
    };
    const tripId = await ctx.db.insert("trips", {
      organizationId: actor.organizationId,
      code,
      status: "borrador",
      originCity: loadingLocation?.city,
      destinationCity: unloadingLocation?.city,
      createdAt: now,
      updatedAt: now
    });
    const expedienteId = await ctx.db.insert("expedientes", {
      organizationId: actor.organizationId,
      serviceOrderId: args.serviceOrderId,
      tripId,
      code,
      status: "draft",
      notes: args.notes,
      agencyCode: agencyCode || undefined,
      searchText: normalizeSearchText([
        code,
        order.code,
        customer?.name,
        loadingLocation?.city,
        unloadingLocation?.city,
        agencyCode
      ].filter(Boolean).join(" ")),
      loadingOrderDraft,
      createdBy: actor._id,
      updatedBy: actor._id,
      createdAt: now,
      updatedAt: now
    });
    await ctx.db.patch("trips", tripId, { expedienteId });
    await ctx.db.insert("expedienteEvents", {
      organizationId: actor.organizationId,
      expedienteId,
      eventType: "dispatch_draft_created",
      title: "Despacho creado en borrador",
      occurredAt: now,
      actorId: actor._id
    });
    await appendAudit(ctx, {
      organizationId: actor.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "dispatch.draft_created",
      entityType: "expediente",
      entityId: expedienteId,
      createdAt: now
    });
    await refreshDispatchSearchText(ctx, expedienteId);
    return { expedienteId, code };
  }
});

export const saveLoadingOrderDraft = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
    draft: loadingOrderDraftValidator
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const expediente = await requireEditableExpediente(ctx, actor, args.expedienteId);
    const cargoInfoState = await officialStateFor(ctx, expediente, "orden_cargue");
    guardEdit(() => assertStageEditable("orden_cargue", { officialState: "draft", cargoInfoState }));

    if (args.draft.customerId) {
      const customer = await ctx.db.get("customers", args.draft.customerId);
      if (!customer || customer.organizationId !== expediente.organizationId) {
        throw new ConvexError({ code: "NOT_FOUND", message: "Cliente no encontrado" });
      }
    }

    const now = Date.now();
    await ctx.db.patch("expedientes", expediente._id, {
      loadingOrderDraft: args.draft,
      agencyCode: args.draft.agencyCode ?? expediente.agencyCode,
      updatedBy: actor._id,
      updatedAt: now
    });
    await appendAudit(ctx, {
      organizationId: expediente.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "dispatch.loading_order_saved",
      entityType: "expediente",
      entityId: expediente._id,
      createdAt: now
    });
    await refreshDispatchSearchText(ctx, expediente._id);
    return null;
  }
});

export const saveConsignmentsDraft = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
    upserts: v.array(
      v.object({
        remesaId: v.optional(v.id("expedienteRemesas")),
        sequence: v.number(),
        draft: consignmentDraftValidator
      })
    ),
    removals: v.optional(v.array(v.id("expedienteRemesas")))
  },
  returns: v.array(v.id("expedienteRemesas")),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const expediente = await requireEditableExpediente(ctx, actor, args.expedienteId);
    const existingRows = await ctx.db
      .query("expedienteRemesas")
      .withIndex("by_expediente_and_sequence", (q) => q.eq("expedienteId", expediente._id))
      .collect();
    const existingById = new Map(existingRows.map((row) => [row._id, row]));
    const removals = args.removals ?? [];
    const removalSet = new Set(removals);

    for (const upsert of args.upserts) {
      if (!Number.isInteger(upsert.sequence) || upsert.sequence < 1) {
        throw new ConvexError({ code: "INVALID_INPUT", message: "La secuencia de la remesa debe ser un entero positivo" });
      }
      if (upsert.remesaId) {
        const row = existingById.get(upsert.remesaId);
        if (!row) {
          throw new ConvexError({ code: "NOT_FOUND", message: "Remesa no encontrada en este despacho" });
        }
        if (removalSet.has(upsert.remesaId)) {
          throw new ConvexError({ code: "INVALID_INPUT", message: "Una remesa no puede actualizarse y eliminarse a la vez" });
        }
        guardEdit(() => assertStageEditable("remesa", { officialState: row.officialState }));
      }
    }

    for (const remesaId of removals) {
      const row = existingById.get(remesaId);
      if (!row) {
        throw new ConvexError({ code: "NOT_FOUND", message: "Remesa no encontrada en este despacho" });
      }
      if (row.officialState !== "draft" || row.documentId) {
        throw new ConvexError({ code: "INVALID_STATE", message: "Sólo una remesa en borrador sin documento puede eliminarse" });
      }
    }

    const finalSequences = new Map<number, string>();

    for (const row of existingRows) {
      if (!removalSet.has(row._id)) {
        finalSequences.set(row.sequence, row._id);
      }
    }

    for (const upsert of args.upserts) {
      const currentOwner = finalSequences.get(upsert.sequence);
      const ownId = upsert.remesaId ?? `new-${upsert.sequence}`;

      if (currentOwner !== undefined && currentOwner !== upsert.remesaId) {
        throw new ConvexError({ code: "CONFLICT", message: `La secuencia ${upsert.sequence} ya está en uso` });
      }

      if (upsert.remesaId) {
        const previous = existingById.get(upsert.remesaId);
        if (previous && previous.sequence !== upsert.sequence) {
          finalSequences.delete(previous.sequence);
        }
      }

      finalSequences.set(upsert.sequence, ownId);
    }

    const now = Date.now();
    const orderDraft = expediente.loadingOrderDraft ?? null;
    const savedIds: Id<"expedienteRemesas">[] = [];

    for (const remesaId of removals) {
      await ctx.db.delete("expedienteRemesas", remesaId);
    }

    for (const upsert of args.upserts) {
      const effective = effectiveConsignment(upsert.draft, orderDraft);
      const denormalized = {
        cargoDescription: effective.remissions?.[0]?.description ?? "",
        cargoUnit: effective.unitOfMeasure,
        consigneeName: effective.recipient?.name,
        consigneeDocument: effective.recipient?.identificationNumber
      };

      if (upsert.remesaId) {
        await ctx.db.patch("expedienteRemesas", upsert.remesaId, {
          sequence: upsert.sequence,
          draft: upsert.draft,
          ...denormalized,
          updatedBy: actor._id,
          updatedAt: now
        });
        savedIds.push(upsert.remesaId);
      } else {
        const lifecycle = initialDocumentLifecycle();
        const remesaId = await ctx.db.insert("expedienteRemesas", {
          organizationId: expediente.organizationId,
          expedienteId: expediente._id,
          sequence: upsert.sequence,
          draft: upsert.draft,
          ...denormalized,
          ...lifecycle,
          createdBy: actor._id,
          updatedBy: actor._id,
          createdAt: now,
          updatedAt: now
        });
        savedIds.push(remesaId);
      }
    }

    await ctx.db.patch("expedientes", expediente._id, { updatedBy: actor._id, updatedAt: now });
    await appendAudit(ctx, {
      organizationId: expediente.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "dispatch.consignments_saved",
      entityType: "expediente",
      entityId: expediente._id,
      detailsJson: JSON.stringify({ upserts: args.upserts.length, removals: removals.length }),
      createdAt: now
    });
    await refreshDispatchSearchText(ctx, expediente._id);
    return savedIds;
  }
});

export const saveAssignmentDraft = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
    driverId: v.optional(v.union(v.id("drivers"), v.null())),
    secondDriverId: v.optional(v.union(v.id("drivers"), v.null())),
    vehicleId: v.optional(v.union(v.id("vehicles"), v.null())),
    trailerId: v.optional(v.union(v.id("trailers"), v.null()))
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const expediente = await requireEditableExpediente(ctx, actor, args.expedienteId);
    const patch: Partial<Doc<"expedientes">> = { updatedBy: actor._id, updatedAt: Date.now() };
    const lookups: Array<Promise<void>> = [];
    const assign = <Key extends "driverId" | "secondDriverId" | "vehicleId" | "trailerId">(
      key: Key,
      table: "drivers" | "vehicles" | "trailers"
    ) => {
      const value = args[key];
      if (value === undefined) {
        return;
      }
      if (value === null) {
        patch[key] = undefined;
        return;
      }
      lookups.push(
        (async () => {
          const row = await ctx.db.get(table, value as never);
          if (!row || (row.organizationId !== undefined && row.organizationId !== expediente.organizationId)) {
            throw new ConvexError({ code: "NOT_FOUND", message: "Recurso de asignación no encontrado" });
          }
          patch[key] = value as never;
        })()
      );
    };

    assign("driverId", "drivers");
    assign("secondDriverId", "drivers");
    assign("vehicleId", "vehicles");
    assign("trailerId", "trailers");
    await Promise.all(lookups);
    await ctx.db.patch("expedientes", expediente._id, patch);

    if (expediente.tripId) {
      const driverId = args.driverId === null ? undefined : args.driverId ?? expediente.driverId;
      const vehicleId = args.vehicleId === null ? undefined : args.vehicleId ?? expediente.vehicleId;
      const [driver, vehicle] = await Promise.all([
        driverId ? ctx.db.get("drivers", driverId) : null,
        vehicleId ? ctx.db.get("vehicles", vehicleId) : null
      ]);
      await ctx.db.patch("trips", expediente.tripId, {
        driverName: driver?.name,
        vehiclePlate: vehicle?.plate,
        updatedAt: Date.now()
      });
    }

    await appendAudit(ctx, {
      organizationId: expediente.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "dispatch.assignment_saved",
      entityType: "expediente",
      entityId: expediente._id,
      createdAt: Date.now()
    });
    await refreshDispatchSearchText(ctx, expediente._id);
    return null;
  }
});

export const saveManifestDraft = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
    draft: manifestDraftValidator
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const expediente = await requireEditableExpediente(ctx, actor, args.expedienteId);
    const manifestState = await officialStateFor(ctx, expediente, "manifiesto");
    guardEdit(() => assertStageEditable("manifiesto", { officialState: manifestState }));
    const now = Date.now();
    await ctx.db.patch("expedientes", expediente._id, {
      manifestDraft: args.draft,
      updatedBy: actor._id,
      updatedAt: now
    });
    await appendAudit(ctx, {
      organizationId: expediente.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "dispatch.manifest_saved",
      entityType: "expediente",
      entityId: expediente._id,
      createdAt: now
    });
    await refreshDispatchSearchText(ctx, expediente._id);
    return null;
  }
});

const logisticsEventInputValidator = v.object({
  occurredAt: v.number(),
  observation: v.optional(v.string())
});

const logisticsSiteInputValidator = v.object({
  arrival: v.optional(logisticsEventInputValidator),
  entry: v.optional(logisticsEventInputValidator),
  start: v.optional(logisticsEventInputValidator),
  end: v.optional(logisticsEventInputValidator),
  exit: v.optional(logisticsEventInputValidator)
});

export const recordLogisticsTimes = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
    origin: logisticsSiteInputValidator,
    destination: logisticsSiteInputValidator,
    finalDelivery: v.optional(logisticsEventInputValidator)
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const expediente = await requireExpediente(ctx, args.expedienteId);
    requireSameOrganization(actor, expediente.organizationId);
    const errors = validateLogisticsTimeline({
      origin: eventTimestamps(args.origin),
      destination: eventTimestamps(args.destination),
      finalDelivery: args.finalDelivery?.occurredAt
    });

    if (errors.length > 0) {
      throw new ConvexError({ code: "VALIDATION", message: errors[0], data: { errors } });
    }

    const remesas = await ctx.db
      .query("expedienteRemesas")
      .withIndex("by_expediente_and_sequence", (q) => q.eq("expedienteId", expediente._id))
      .collect();
    const stage = deriveDispatchStage(await buildProjection(ctx, expediente, remesas));

    if (!["cargue_descargue", "cumplido_inicial"].includes(stage.stage)) {
      throw new ConvexError({ code: "INVALID_STATE", message: "Los tiempos sólo se registran después de autorizar el despacho y antes de cumplirlo" });
    }

    const now = Date.now();
    const toRecord = (event: { occurredAt: number; observation?: string } | undefined) => event
      ? { ...event, recordedAt: now, recordedBy: actor._id }
      : undefined;
    const site = (value: typeof args.origin) => ({
      arrival: toRecord(value.arrival),
      entry: toRecord(value.entry),
      start: toRecord(value.start),
      end: toRecord(value.end),
      exit: toRecord(value.exit)
    });
    const logisticsTimes = {
      origin: site(args.origin),
      destination: site(args.destination),
      finalDelivery: toRecord(args.finalDelivery)
    };
    await ctx.db.patch("expedientes", expediente._id, {
      logisticsTimes,
      status: "in_progress",
      startedAt: expediente.startedAt ?? now,
      updatedBy: actor._id,
      updatedAt: now
    });
    await ctx.db.insert("expedienteEvents", {
      organizationId: expediente.organizationId,
      expedienteId: expediente._id,
      eventType: "logistics_times_recorded",
      title: "Tiempos de cargue y descargue actualizados",
      occurredAt: now,
      actorId: actor._id
    });
    await appendAudit(ctx, {
      organizationId: expediente.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "dispatch.logistics_times_recorded",
      entityType: "expediente",
      entityId: expediente._id,
      createdAt: now
    });
    await refreshDispatchSearchText(ctx, expediente._id);
    return null;
  }
});

export const recordFulfillmentDraft = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
    remesaId: v.id("expedienteRemesas"),
    draft: fulfillmentDraftValidator
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const [expediente, remesa] = await Promise.all([
      requireExpediente(ctx, args.expedienteId),
      ctx.db.get("expedienteRemesas", args.remesaId)
    ]);
    requireSameOrganization(actor, expediente.organizationId);

    if (!remesa || remesa.expedienteId !== expediente._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Remesa no encontrada en este despacho" });
    }

    if (remesa.officialState !== "authorized" || remesa.fulfillmentState === "fulfilled") {
      throw new ConvexError({ code: "INVALID_STATE", message: "Sólo una remesa autorizada y pendiente puede preparar su cumplido" });
    }

    const errors = validateFulfillmentQuantities(args.draft);

    if (errors.length > 0) {
      throw new ConvexError({ code: "VALIDATION", message: errors[0], data: { errors } });
    }

    const now = Date.now();
    await ctx.db.patch("expedienteRemesas", remesa._id, {
      fulfillmentDraft: args.draft,
      updatedBy: actor._id,
      updatedAt: now
    });
    await appendAudit(ctx, {
      organizationId: expediente.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "dispatch.consignment_fulfillment_saved",
      entityType: "expediente_remesa",
      entityId: remesa._id,
      createdAt: now
    });
    await refreshDispatchSearchText(ctx, expediente._id);
    return null;
  }
});

export const recordManifestFulfillmentDraft = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
    draft: manifestFulfillmentDraftValidator
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const expediente = await requireExpediente(ctx, args.expedienteId);
    requireSameOrganization(actor, expediente.organizationId);
    const remesas = await ctx.db
      .query("expedienteRemesas")
      .withIndex("by_expediente_and_sequence", (q) => q.eq("expedienteId", expediente._id))
      .collect();

    if (remesas.length === 0 || remesas.some((remesa) => remesa.fulfillmentState !== "fulfilled")) {
      throw new ConvexError({ code: "INVALID_STATE", message: "Cumple todas las remesas antes de preparar el cumplido final" });
    }

    const now = Date.now();
    await ctx.db.patch("expedientes", expediente._id, {
      manifestFulfillmentDraft: args.draft,
      updatedBy: actor._id,
      updatedAt: now
    });
    await appendAudit(ctx, {
      organizationId: expediente.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "dispatch.manifest_fulfillment_saved",
      entityType: "expediente",
      entityId: expediente._id,
      createdAt: now
    });
    await refreshDispatchSearchText(ctx, expediente._id);
    return null;
  }
});

const preparationResultValidator = v.object({
  code: v.string(),
  scope: emissionScopeValidator,
  orderNumber: v.optional(v.string()),
  consignmentNumbers: v.array(v.string()),
  tripNumber: v.optional(v.string()),
  manifestNumber: v.optional(v.string()),
  alreadyPrepared: v.boolean()
});

export const prepareForEmission = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
    scope: emissionScopeValidator
  },
  returns: preparationResultValidator,
  handler: prepareForEmissionHandler
});

export const prepareEmission = mutation({
  args: { actorToken: v.optional(v.string()), expedienteId: v.id("expedientes") },
  returns: preparationResultValidator,
  handler: (ctx, args) => prepareForEmissionHandler(ctx, { ...args, scope: "todo" })
});

async function prepareForEmissionHandler(
  ctx: MutationCtx,
  args: { actorToken?: string; expedienteId: Id<"expedientes">; scope: EmissionScope }
) {
  const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
  const expediente = await requireExpediente(ctx, args.expedienteId);
  requireSameOrganization(actor, expediente.organizationId);

  if (expediente.status === "completed" || expediente.status === "cancelled") {
    throw new ConvexError({ code: "INVALID_STATE", message: "El despacho cerrado no puede prepararse para emisión" });
  }

  const [remesas, snapshots] = await Promise.all([
    ctx.db
      .query("expedienteRemesas")
      .withIndex("by_expediente_and_sequence", (q) => q.eq("expedienteId", expediente._id))
      .collect(),
    ctx.db
      .query("dispatchSnapshots")
      .withIndex("by_expediente_and_taken_at", (q) => q.eq("expedienteId", expediente._id))
      .order("desc")
      .take(200)
  ]);
  const variant = expediente.workflowVariant ?? "standard";
  const targets = emissionScopeTargets(args.scope, variant);
  const orderDraft = expediente.loadingOrderDraft as (LoadingOrderDraft & { customerId?: Id<"customers"> }) | undefined;
  const orderNumber = orderDraft?.orderNumber ?? expediente.cargoNumber;
  const manifestNumber = expediente.manifestDraft?.manifestNumber ?? expediente.manifestNumber;
  const consignmentNumbers = remesas.flatMap((remesa) => remesa.number ? [remesa.number] : []);
  const orderState = await officialStateFor(ctx, expediente, "orden_cargue");
  const latestOrderSnapshot = snapshots.find((snapshot) => snapshot.kind === "orden_cargue");
  const latestManifestSnapshot = snapshots.find((snapshot) => snapshot.kind === "manifiesto");
  const latestAssignmentSnapshot = snapshots.find((snapshot) => snapshot.kind === "asignacion");
  const latestRemesaSnapshots = new Map<string, Doc<"dispatchSnapshots">>();

  for (const snapshot of snapshots) {
    if (snapshot.kind === "remesa" && snapshot.remesaId && !latestRemesaSnapshots.has(snapshot.remesaId)) {
      latestRemesaSnapshots.set(snapshot.remesaId, snapshot);
    }
  }

  const orderPrepared = !targets.order || Boolean(
    orderNumber && (isAuthorizedState(orderState) || snapshotHasExpeditionDate(latestOrderSnapshot))
  );
  const consignmentsPrepared = !targets.consignments || (
    remesas.length > 0 && remesas.every((remesa) =>
      Boolean(remesa.number && (isAuthorizedState(remesa.officialState) || snapshotHasExpeditionDate(latestRemesaSnapshots.get(remesa._id))))
    )
  );
  const manifestState = await officialStateFor(ctx, expediente, "manifiesto");
  const manifestPrepared = !targets.manifest || Boolean(
    manifestNumber && (isAuthorizedState(manifestState) || latestManifestSnapshot)
  );
  const tripPrepared = !targets.trip || Boolean(expediente.tripNumber);
  const assignmentPrepared = !targets.assignment || Boolean(latestAssignmentSnapshot);

  if (orderPrepared && consignmentsPrepared && manifestPrepared && tripPrepared && assignmentPrepared) {
    return {
      code: expediente.code,
      scope: args.scope,
      orderNumber,
      consignmentNumbers,
      tripNumber: expediente.tripNumber,
      manifestNumber,
      alreadyPrepared: true
    };
  }

  const dependencyBlockers = emissionDependencyBlockers(args.scope, {
    workflowVariant: variant,
    orderOfficialState: orderState,
    consignmentOfficialStates: remesas.map((remesa) => remesa.officialState)
  });
  const blockers: string[] = [...dependencyBlockers];

  if (targets.order) {
    blockers.push(...loadingOrderMissingFields(orderDraft));
  }
  if (targets.consignments) {
    if (remesas.length === 0) {
      blockers.push("El despacho no tiene remesas");
    }
    for (let index = 0; index < remesas.length; index += 1) {
      blockers.push(
        ...consignmentMissingFields((remesas[index].draft ?? null) as ConsignmentDraft | null, orderDraft)
          .map((blocker) => `Remesa ${index + 1}: ${blocker}`)
      );
    }
  }
  if (targets.manifest) {
    blockers.push(...manifestMissingFields(expediente.manifestDraft));
  }
  if (targets.assignment && (!expediente.driverId || !expediente.vehicleId)) {
    if (!expediente.driverId) {
      blockers.push("Falta asignar el conductor");
    }
    if (!expediente.vehicleId) {
      blockers.push("Falta asignar el vehículo");
    }
  }

  if (blockers.length > 0) {
    throw new ConvexError({
      code: "VALIDATION",
      message: "El documento tiene datos pendientes y no puede prepararse",
      data: { scope: args.scope, blockers }
    });
  }

  const now = Date.now();
  const expeditionDate = orderDraft?.expeditionDate ?? bogotaDate(now);
  const agencyCode = expediente.agencyCode ?? "";
  const preparedOrderNumber = targets.order
    ? orderNumber ?? (await claimConsecutive(ctx, expediente.organizationId, agencyCode, "orden_cargue", now))
    : orderNumber;
  const preparedTripNumber = targets.trip
    ? expediente.tripNumber ?? (await claimConsecutive(ctx, expediente.organizationId, agencyCode, "viaje", now))
    : expediente.tripNumber;
  const preparedManifestNumber = targets.manifest
    ? manifestNumber ?? (await claimConsecutive(ctx, expediente.organizationId, agencyCode, "manifiesto", now))
    : manifestNumber;
  const preparedConsignmentNumbers: string[] = [];

  if (targets.consignments) {
    for (const remesa of remesas) {
      const number = remesa.number ?? (await claimConsecutive(ctx, expediente.organizationId, agencyCode, "remesa", now));
      preparedConsignmentNumbers.push(number);
      const latestSnapshot = latestRemesaSnapshots.get(remesa._id);

      if (!remesa.number) {
        await ctx.db.patch("expedienteRemesas", remesa._id, { number, updatedBy: actor._id, updatedAt: now });
      }
      if (!snapshotHasExpeditionDate(latestSnapshot) && !isAuthorizedState(remesa.officialState)) {
        const effective = effectiveConsignment((remesa.draft ?? {}) as ConsignmentDraft, orderDraft);
        await writeSnapshot(
          ctx,
          expediente,
          actor,
          "remesa",
          number,
          { ...effective, expeditionDate: effective.expeditionDate ?? expeditionDate, number, sequence: remesa.sequence },
          now,
          remesa._id
        );
      }
    }
  } else {
    preparedConsignmentNumbers.push(...consignmentNumbers);
  }

  let assignmentData: Record<string, unknown> | undefined;

  if (targets.assignment && !latestAssignmentSnapshot) {
    const [driver, secondDriver, vehicle, trailer] = await Promise.all([
      expediente.driverId ? ctx.db.get("drivers", expediente.driverId) : null,
      expediente.secondDriverId ? ctx.db.get("drivers", expediente.secondDriverId) : null,
      expediente.vehicleId ? ctx.db.get("vehicles", expediente.vehicleId) : null,
      expediente.trailerId ? ctx.db.get("trailers", expediente.trailerId) : null
    ]);

    if (!driver || !vehicle) {
      throw new ConvexError({ code: "VALIDATION", message: "La asignación de vehículo y conductor ya no está disponible" });
    }

    const holderDocument = vehicle.possessorDocument ?? vehicle.ownerDocument;
    const vehicleHolder = holderDocument
      ? await ctx.db.query("thirdParties").withIndex("by_organization_and_document", (q) => q.eq("organizationId", expediente.organizationId).eq("document", holderDocument)).unique()
      : null;
    assignmentData = {
      driver: pickSnapshotFields(driver),
      secondDriver: pickSnapshotFields(secondDriver),
      vehicle: pickSnapshotFields(vehicle),
      vehicleHolder: pickSnapshotFields(vehicleHolder),
      trailer: pickSnapshotFields(trailer)
    };
  }

  if (targets.order && preparedOrderNumber && orderDraft && !snapshotHasExpeditionDate(latestOrderSnapshot) && !isAuthorizedState(orderState)) {
    await writeSnapshot(
      ctx,
      expediente,
      actor,
      "orden_cargue",
      preparedOrderNumber,
      { ...orderDraft, orderNumber: preparedOrderNumber, expeditionDate },
      now
    );
  }
  if (targets.manifest && preparedManifestNumber && expediente.manifestDraft && !latestManifestSnapshot && !isAuthorizedState(manifestState)) {
    await writeSnapshot(
      ctx,
      expediente,
      actor,
      "manifiesto",
      preparedManifestNumber,
      { ...expediente.manifestDraft, manifestNumber: preparedManifestNumber },
      now
    );
  }
  if (assignmentData) {
    await writeSnapshot(ctx, expediente, actor, "asignacion", undefined, assignmentData, now);
  }

  await ctx.db.patch("expedientes", expediente._id, {
    status: "in_progress",
    loadingOrderDraft: targets.order && orderDraft && preparedOrderNumber
      ? { ...orderDraft, orderNumber: preparedOrderNumber, expeditionDate }
      : orderDraft,
    manifestDraft: targets.manifest && expediente.manifestDraft && preparedManifestNumber
      ? { ...expediente.manifestDraft, manifestNumber: preparedManifestNumber }
      : expediente.manifestDraft,
    manifestNumber: preparedManifestNumber,
    cargoNumber: preparedOrderNumber,
    tripNumber: preparedTripNumber,
    updatedBy: actor._id,
    updatedAt: now
  });
  await ctx.db.insert("expedienteEvents", {
    organizationId: expediente.organizationId,
    expedienteId: expediente._id,
    eventType: "dispatch_prepared",
    title: `Documento preparado para emisión: ${args.scope}`,
    details: preparationDetails(args.scope, preparedOrderNumber, preparedConsignmentNumbers, preparedManifestNumber),
    occurredAt: now,
    actorId: actor._id
  });
  await appendAudit(ctx, {
    organizationId: expediente.organizationId,
    actorType: "user",
    actorId: actor._id,
    action: "dispatch.emission_prepared",
    entityType: "expediente",
    entityId: expediente._id,
    detailsJson: JSON.stringify({ scope: args.scope, variant, orderNumber: preparedOrderNumber, consignmentNumbers: preparedConsignmentNumbers, manifestNumber: preparedManifestNumber }),
    createdAt: now
  });
  await refreshDispatchSearchText(ctx, expediente._id);
  return {
    code: expediente.code,
    scope: args.scope,
    orderNumber: preparedOrderNumber,
    consignmentNumbers: preparedConsignmentNumbers,
    tripNumber: preparedTripNumber,
    manifestNumber: preparedManifestNumber,
    alreadyPrepared: false
  };
}

function isAuthorizedState(state: OfficialDocumentState): boolean {
  return state === "authorized" || state === "fulfilled";
}

function snapshotHasExpeditionDate(snapshot: Doc<"dispatchSnapshots"> | undefined): boolean {
  if (!snapshot) {
    return false;
  }

  try {
    const payload = JSON.parse(snapshot.payloadJson) as { expeditionDate?: unknown };
    return typeof payload.expeditionDate === "string" && payload.expeditionDate.length > 0;
  } catch {
    return false;
  }
}

function preparationDetails(
  scope: EmissionScope,
  orderNumber: string | undefined,
  consignmentNumbers: string[],
  manifestNumber: string | undefined
): string {
  if (scope === "orden") {
    return `Orden ${orderNumber}`;
  }
  if (scope === "remesas") {
    return `Remesas ${consignmentNumbers.join(", ")}`;
  }
  if (scope === "manifiesto") {
    return `Manifiesto ${manifestNumber}`;
  }
  return `${orderNumber ? `Orden ${orderNumber}, ` : ""}${consignmentNumbers.length ? `remesas ${consignmentNumbers.join(", ")}, ` : ""}manifiesto ${manifestNumber ?? ""}`;
}

export const emissionInputs = query({
  args: { actorToken: v.optional(v.string()), expedienteId: v.id("expedientes") },
  returns: v.union(
    v.null(),
    v.object({
      organizationId: v.id("organizations"),
      workflowVariant: v.optional(v.union(v.literal("standard"), v.literal("remesa_without_order"), v.literal("empty_manifest"), v.literal("transshipment"))),
      code: v.string(),
      status: v.string(),
      tripNumber: v.optional(v.string()),
      tripEmitted: v.boolean(),
      order: v.object({
        number: v.optional(v.string()),
        payloadJson: v.optional(v.string()),
        documentId: v.optional(v.id("documents")),
        officialState: v.string()
      }),
      consignments: v.array(
        v.object({
          remesaId: v.id("expedienteRemesas"),
          number: v.optional(v.string()),
          payloadJson: v.optional(v.string()),
          documentId: v.optional(v.id("documents")),
          officialState: v.string()
        })
      ),
      manifest: v.object({
        number: v.optional(v.string()),
        payloadJson: v.optional(v.string()),
        documentId: v.optional(v.id("documents")),
        officialState: v.string()
      }),
      assignmentJson: v.optional(v.string()),
      operations: v.array(v.object({ operationType: v.string(), status: v.string() }))
    })
  ),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    const expediente = await ctx.db.get("expedientes", args.expedienteId);

    if (!expediente) {
      return null;
    }

    requireSameOrganization(actor, expediente.organizationId);
    const [remesas, documents, snapshots, operations] = await Promise.all([
      ctx.db
        .query("expedienteRemesas")
        .withIndex("by_expediente_and_sequence", (q) => q.eq("expedienteId", expediente._id))
        .collect(),
      ctx.db.query("documents").withIndex("by_expediente", (q) => q.eq("expedienteId", expediente._id)).collect(),
      ctx.db
        .query("dispatchSnapshots")
        .withIndex("by_expediente_and_taken_at", (q) => q.eq("expedienteId", expediente._id))
        .order("desc")
        .take(200),
      ctx.db
        .query("rndcOperations")
        .withIndex("by_expediente_and_created_at", (q) => q.eq("expedienteId", expediente._id))
        .order("desc")
        .take(200)
    ]);
    const latestByKind = new Map<string, string>();
    const latestByRemesa = new Map<string, string>();

    for (const snapshot of snapshots) {
      if (snapshot.kind === "remesa" && snapshot.remesaId) {
        if (!latestByRemesa.has(snapshot.remesaId)) {
          latestByRemesa.set(snapshot.remesaId, snapshot.payloadJson);
        }
      } else if (!latestByKind.has(snapshot.kind)) {
        latestByKind.set(snapshot.kind, snapshot.payloadJson);
      }
    }

    const documentFor = (kind: string) =>
      documents
        .filter((document) => document.kind === kind)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const orderDocument = documentFor("orden_cargue");
    const manifestDocument = expediente.manifestDocumentId
      ? documents.find((document) => document._id === expediente.manifestDocumentId)
      : documentFor("manifiesto");
    const tripEmitted = operations.some(
      (operation) =>
        operation.operationType === "emit_trip" &&
        operation.status === "succeeded" &&
        expediente.tripNumber !== undefined &&
        readTripNumber(operation.payloadJson) === expediente.tripNumber
    );

    return {
      organizationId: expediente.organizationId,
      workflowVariant: expediente.workflowVariant,
      code: expediente.code,
      status: expediente.status,
      tripNumber: expediente.tripNumber,
      tripEmitted,
      order: {
        number: expediente.loadingOrderDraft?.orderNumber ?? expediente.cargoNumber,
        payloadJson: latestByKind.get("orden_cargue"),
        documentId: orderDocument?._id,
        officialState: orderDocument?.officialState ?? "draft"
      },
      consignments: remesas.map((remesa) => ({
        remesaId: remesa._id,
        number: remesa.number,
        payloadJson: latestByRemesa.get(remesa._id),
        documentId: remesa.documentId,
        officialState: remesa.officialState
      })),
      manifest: {
        number: expediente.manifestDraft?.manifestNumber ?? expediente.manifestNumber,
        payloadJson: latestByKind.get("manifiesto"),
        documentId: manifestDocument?._id,
        officialState: manifestDocument?.officialState ?? "draft"
      },
      assignmentJson: latestByKind.get("asignacion"),
      operations: operations.map((operation) => ({
        operationType: operation.operationType,
        status: operation.status
      }))
    };
  }
});

function readTripNumber(payloadJson: string): string | undefined {
  try {
    const parsed = JSON.parse(payloadJson) as { tripNumber?: unknown };
    return typeof parsed.tripNumber === "string" ? parsed.tripNumber : undefined;
  } catch {
    return undefined;
  }
}

function eventTimestamps(site: {
  arrival?: { occurredAt: number };
  entry?: { occurredAt: number };
  start?: { occurredAt: number };
  end?: { occurredAt: number };
  exit?: { occurredAt: number };
}) {
  return {
    arrival: site.arrival?.occurredAt,
    entry: site.entry?.occurredAt,
    start: site.start?.occurredAt,
    end: site.end?.occurredAt,
    exit: site.exit?.occurredAt
  };
}

export const stage = query({
  args: { actorToken: v.optional(v.string()), expedienteId: v.id("expedientes") },
  returns: v.union(v.null(), v.object({ stage: stageValidator, blockers: v.array(v.string()) })),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    const expediente = await ctx.db.get("expedientes", args.expedienteId);

    if (!expediente) {
      return null;
    }

    requireSameOrganization(actor, expediente.organizationId);
    const remesas = await ctx.db
      .query("expedienteRemesas")
      .withIndex("by_expediente_and_sequence", (q) => q.eq("expedienteId", expediente._id))
      .collect();
    const projection = await buildProjection(ctx, expediente, remesas);
    return deriveDispatchStage(projection);
  }
});

export const seedCounterRange = mutation({
  args: {
    actorToken: v.optional(v.string()),
    agencyCode: v.optional(v.string()),
    documentType: v.string(),
    prefix: v.string(),
    padding: v.number(),
    nextValue: v.number(),
    endValue: v.optional(v.number())
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin"]);

    if (!Number.isSafeInteger(args.nextValue) || args.nextValue < 1 || !Number.isSafeInteger(args.padding) || args.padding < 0) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Rango de consecutivos inválido" });
    }

    const agencyCode = args.agencyCode?.trim() ?? "";
    const now = Date.now();
    const existing = await ctx.db
      .query("counterRanges")
      .withIndex("by_organization_agency_and_type", (q) =>
        q.eq("organizationId", actor.organizationId).eq("agencyCode", agencyCode).eq("documentType", args.documentType)
      )
      .collect();
    const active = existing.find((row) => row.status === "active");

    if (active) {
      if (args.nextValue < active.nextValue) {
        throw new ConvexError({ code: "INVALID_INPUT", message: "El rango no puede retroceder consecutivos ya usados" });
      }
      await ctx.db.patch("counterRanges", active._id, {
        prefix: args.prefix,
        padding: args.padding,
        nextValue: args.nextValue,
        endValue: args.endValue,
        updatedAt: now
      });
    } else {
      await ctx.db.insert("counterRanges", {
        organizationId: actor.organizationId,
        agencyCode,
        documentType: args.documentType,
        prefix: args.prefix,
        padding: args.padding,
        nextValue: args.nextValue,
        endValue: args.endValue,
        status: "active",
        createdAt: now,
        updatedAt: now
      });
    }

    await appendAudit(ctx, {
      organizationId: actor.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "counter_range.seeded",
      entityType: "counter_range",
      entityId: `${agencyCode}:${args.documentType}`,
      detailsJson: JSON.stringify({ prefix: args.prefix, padding: args.padding, nextValue: args.nextValue, endValue: args.endValue }),
      createdAt: now
    });
    return null;
  }
});

async function requireExpediente(ctx: QueryCtx, expedienteId: Id<"expedientes">): Promise<Doc<"expedientes">> {
  const expediente = await ctx.db.get("expedientes", expedienteId);

  if (!expediente) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Expediente no encontrado" });
  }

  return expediente;
}

async function requireEditableExpediente(
  ctx: QueryCtx,
  actor: Doc<"users">,
  expedienteId: Id<"expedientes">
): Promise<Doc<"expedientes">> {
  const expediente = await requireExpediente(ctx, expedienteId);
  requireSameOrganization(actor, expediente.organizationId);

  if (expediente.status === "completed" || expediente.status === "cancelled") {
    throw new ConvexError({ code: "INVALID_STATE", message: "Un despacho cerrado no puede editarse" });
  }

  return expediente;
}

function guardEdit(check: () => void): void {
  try {
    check();
  } catch (error) {
    throw new ConvexError({ code: "INVALID_STATE", message: error instanceof Error ? error.message : String(error) });
  }
}

async function officialStateFor(
  ctx: QueryCtx,
  expediente: Doc<"expedientes">,
  kind: "orden_cargue" | "manifiesto"
): Promise<OfficialDocumentState> {
  const documents = await ctx.db
    .query("documents")
    .withIndex("by_expediente", (q) => q.eq("expedienteId", expediente._id))
    .collect();
  const match = documents
    .filter((document) => document.kind === kind)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const state = match?.officialState ?? match?.status;
  return state === "authorized" || state === "fulfilled" || state === "annulled" || state === "pending" ? state : "draft";
}

async function buildProjection(
  ctx: QueryCtx,
  expediente: Doc<"expedientes">,
  remesas: Doc<"expedienteRemesas">[]
): Promise<DispatchProjection> {
  const orderDraft = (expediente.loadingOrderDraft ?? null) as LoadingOrderDraft | null;
  const [cargoInfoState, manifestState] = await Promise.all([
    officialStateFor(ctx, expediente, "orden_cargue"),
    officialStateFor(ctx, expediente, "manifiesto")
  ]);
  const manifestDocuments = await ctx.db
    .query("documents")
    .withIndex("by_expediente", (q) => q.eq("expedienteId", expediente._id))
    .collect();
  const manifestDocument = manifestDocuments
    .filter((document) => document.kind === "manifiesto")
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const logistics = expediente.logisticsTimes;
  const siteComplete = (site: typeof logistics extends undefined ? never : NonNullable<typeof logistics>["origin"]) =>
    !!site && !!site.arrival && !!site.entry && !!site.start && !!site.end && !!site.exit;

  return {
    annulled: expediente.status === "cancelled",
    workflowVariant: expediente.workflowVariant,
    loadingOrder: orderDraft
      ? { missingFields: loadingOrderMissingFields(orderDraft), officialState: cargoInfoState }
      : cargoInfoState !== "draft" ? { missingFields: [], officialState: cargoInfoState } : null,
    consignments: remesas.map((remesa) => ({
      missingFields: consignmentMissingFields((remesa.draft ?? null) as ConsignmentDraft | null, orderDraft),
      officialState: remesa.officialState,
      fulfillmentState: remesa.fulfillmentState
    })),
    assignment: { vehicleAssigned: !!expediente.vehicleId, driverAssigned: !!expediente.driverId },
    manifest: expediente.manifestDraft
      ? {
          missingFields: manifestMissingFields(expediente.manifestDraft),
          officialState: manifestState,
          fulfillmentState: manifestDocument?.fulfillmentState ?? "not_requested"
        }
      : manifestDocument ? { missingFields: [], officialState: manifestState, fulfillmentState: manifestDocument.fulfillmentState ?? "not_requested" } : null,
    cargoInfoState,
    logistics: {
      originComplete: siteComplete(logistics?.origin),
      destinationComplete: siteComplete(logistics?.destination),
      finalDeliveryRecorded: !!logistics?.finalDelivery
    }
  };
}

async function claimConsecutive(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  agencyCode: string,
  documentType: string,
  now: number
): Promise<string> {
  const defaults = consecutiveDefaults[documentType] ?? { prefix: "", padding: 6 };
  let range = await findActiveRange(ctx, organizationId, agencyCode, documentType);

  if (!range && agencyCode !== "") {
    range = await findActiveRange(ctx, organizationId, "", documentType);
  }

  if (!range) {
    const rangeId = await ctx.db.insert("counterRanges", {
      organizationId,
      agencyCode: "",
      documentType,
      prefix: defaults.prefix,
      padding: defaults.padding,
      nextValue: 1,
      status: "active",
      createdAt: now,
      updatedAt: now
    });
    range = await ctx.db.get("counterRanges", rangeId);
  }

  if (!range) {
    throw new ConvexError({ code: "INTEGRITY_ERROR", message: "No fue posible reservar el consecutivo" });
  }

  let claim;

  try {
    claim = claimNextConsecutive(range);
  } catch (error) {
    throw new ConvexError({
      code: "RANGE_EXHAUSTED",
      message: error instanceof Error ? error.message : String(error)
    });
  }

  await ctx.db.patch("counterRanges", range._id, { nextValue: claim.nextValue, updatedAt: now });
  return claim.formatted;
}

async function findActiveRange(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  agencyCode: string,
  documentType: string
): Promise<Doc<"counterRanges"> | null> {
  const rows = await ctx.db
    .query("counterRanges")
    .withIndex("by_organization_agency_and_type", (q) =>
      q.eq("organizationId", organizationId).eq("agencyCode", agencyCode).eq("documentType", documentType)
    )
    .collect();
  return rows.find((row) => row.status === "active") ?? null;
}

async function writeSnapshot(
  ctx: MutationCtx,
  expediente: Doc<"expedientes">,
  actor: Doc<"users">,
  kind: SnapshotKind,
  documentNumber: string | undefined,
  data: unknown,
  takenAt: number,
  remesaId?: Id<"expedienteRemesas">
): Promise<void> {
  const snapshot = buildDispatchSnapshot(kind, data, { takenAt });
  await ctx.db.insert("dispatchSnapshots", {
    organizationId: expediente.organizationId,
    expedienteId: expediente._id,
    remesaId,
    kind,
    documentNumber,
    payloadJson: snapshot.payloadJson,
    fingerprint: snapshot.fingerprint,
    takenAt,
    takenBy: actor._id
  });
}

function pickSnapshotFields(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) {
    return null;
  }

  const { _id, _creationTime, createdAt, updatedAt, ...rest } = row as {
    _id: unknown;
    _creationTime: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
  } & Record<string, unknown>;
  return rest;
}

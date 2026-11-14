import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { appendAudit, requireActor, requireSameOrganization } from "./model/access";
import { resolveConsignmentNumberClaim } from "./model/consecutiveRange";
import { assertStageEditable, deriveDispatchStage, effectiveConsignment, type LoadingOrderDraft } from "./model/dispatchWorkflow";
import { initialDocumentLifecycle } from "./model/documentLifecycle";
import { formatLoadingOrderNumber, normalizeLoadingOrderReservationToken, resolveLoadingOrderReservation } from "./model/loadingOrderReservation";
import {
  consignmentDraftValidator,
  fulfillmentDraftValidator,
  loadingOrderDraftValidator,
  manifestDraftValidator,
  manifestFulfillmentDraftValidator,
  moneyLimitsValidator
} from "./model/draftValidators";
import { manifestMoneyReview, resolveMoneyConfirmation, resolveMoneyLimits } from "./model/moneyChecks";
import { loadMoneyLimits } from "./model/moneyLimits";
import { validateEntryTimes, validateFulfillmentQuantities } from "./model/fulfillmentWorkflow";
import { normalizeSearchText } from "./model/dispatchSearch";
import { refreshDispatchSearchText } from "./model/dispatchSearchProjection";
import {
  stageValidator,
  emissionScopeValidator,
  preparationResultValidator,
  prepareForEmissionHandler,
  masterSyncRequirementValidator,
  collectMasterSyncRequirements,
  readTripNumber,
  requireExpediente,
  requireEditableExpediente,
  guardEdit,
  officialStateFor,
  buildProjection,
  claimConsecutive
} from "./model/dispatchRecords";
import { currentManifestDocument } from "./model/currentManifest";
import { isMerchandiseCode, rememberMerchandiseProduct } from "./model/merchandiseProducts";
import { completeCargoClassification } from "./model/merchandiseCatalog";

export const reserveLoadingOrderNumber = mutation({
  args: { actorToken: v.optional(v.string()), token: v.string() },
  returns: v.object({ reservationId: v.id("loadingOrderReservations"), number: v.string() }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const token = normalizeLoadingOrderReservationToken(args.token);
    const existing = await ctx.db
      .query("loadingOrderReservations")
      .withIndex("by_organization_and_token", (q) => q.eq("organizationId", actor.organizationId).eq("token", token))
      .unique();

    if (existing) {
      resolveLoadingOrderReservation(existing, {
        organizationId: actor.organizationId,
        actorId: actor._id,
        token
      });
      return { reservationId: existing._id, number: existing.number };
    }

    const now = Date.now();
    const number = formatLoadingOrderNumber(await claimConsecutive(ctx, actor.organizationId, "", "orden_cargue", now));
    const numberOwner = await ctx.db
      .query("loadingOrderReservations")
      .withIndex("by_organization_and_number", (q) => q.eq("organizationId", actor.organizationId).eq("number", number))
      .unique();

    if (numberOwner) {
      throw new ConvexError({ code: "CONFLICT", message: `El consecutivo ${number} ya está reservado` });
    }

    const reservationId = await ctx.db.insert("loadingOrderReservations", {
      organizationId: actor.organizationId,
      token,
      number,
      status: "reserved",
      reservedBy: actor._id,
      reservedAt: now
    });
    await appendAudit(ctx, {
      organizationId: actor.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "loading_order.number_reserved",
      entityType: "loading_order_reservation",
      entityId: reservationId,
      detailsJson: JSON.stringify({ number }),
      createdAt: now
    });
    return { reservationId, number };
  }
});

export const createDraft = mutation({
  args: {
    actorToken: v.optional(v.string()),
    serviceOrderId: v.id("serviceOrders"),
    orderReservationId: v.id("loadingOrderReservations"),
    orderReservationToken: v.string(),
    agencyCode: v.optional(v.string()),
    notes: v.optional(v.string())
  },
  returns: v.object({ expedienteId: v.id("expedientes"), code: v.string() }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const order = await ctx.db.get("serviceOrders", args.serviceOrderId);
    const reservation = await ctx.db.get("loadingOrderReservations", args.orderReservationId);

    if (!order || order.organizationId !== actor.organizationId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Orden de servicio no encontrada" });
    }
    if (!reservation) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Reserva de consecutivo no encontrada" });
    }

    let reservationState;
    try {
      reservationState = resolveLoadingOrderReservation(reservation, {
        organizationId: actor.organizationId,
        actorId: actor._id,
        token: args.orderReservationToken
      });
    } catch (error) {
      throw new ConvexError({ code: "FORBIDDEN", message: error instanceof Error ? error.message : String(error) });
    }

    if (reservationState.kind === "consumed") {
      const existing = await ctx.db.get(reservationState.expedienteId as Id<"expedientes">);
      if (!existing || existing.organizationId !== actor.organizationId) {
        throw new ConvexError({ code: "INTEGRITY_ERROR", message: "El despacho de la reserva no está disponible" });
      }
      return { expedienteId: existing._id, code: existing.code };
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
      orderNumber: reservationState.number,
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
      cargoNumber: reservationState.number,
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
    await ctx.db.patch(reservation._id, {
      status: "consumed",
      expedienteId,
      consumedAt: now
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
    const draft = await completeCargoClassification(ctx, expediente.organizationId, args.draft);
    await ctx.db.patch("expedientes", expediente._id, {
      loadingOrderDraft: draft,
      agencyCode: draft.agencyCode ?? expediente.agencyCode,
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
    if (draft.cargoDescription && isMerchandiseCode(draft.merchandiseCode)) {
      await rememberMerchandiseProduct(
        ctx,
        expediente.organizationId,
        {
          name: draft.cargoDescription,
          code: draft.merchandiseCode,
          natureCode: draft.natureOfCargo,
          packagingCode: draft.packagingCode
        },
        "tms"
      );
    }
    return null;
  }
});

export const ensureConsignmentDraft = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
    sequence: v.number()
  },
  returns: v.object({ remesaId: v.id("expedienteRemesas"), number: v.string() }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const expediente = await requireEditableExpediente(ctx, actor, args.expedienteId);
    const existing = await ctx.db
      .query("expedienteRemesas")
      .withIndex("by_expediente_and_sequence", (q) => q.eq("expedienteId", expediente._id).eq("sequence", args.sequence))
      .unique();
    const resolution = resolveConsignmentNumberClaim(
      existing ? { expedienteId: existing.expedienteId, sequence: existing.sequence, number: existing.number } : null,
      { expedienteId: expediente._id, sequence: args.sequence }
    );

    if (resolution.kind === "reuse" && existing) {
      return { remesaId: existing._id, number: resolution.number };
    }
    if (existing) {
      guardEdit(() => assertStageEditable("remesa", { officialState: existing.officialState }));
    }
    if (expediente.workflowVariant === "empty_manifest") {
      throw new ConvexError({ code: "INVALID_STATE", message: "El manifiesto vacío no usa remesas" });
    }

    const now = Date.now();
    const number = await claimConsecutive(ctx, expediente.organizationId, expediente.agencyCode ?? "", "remesa", now);
    const numberOwner = await ctx.db
      .query("expedienteRemesas")
      .withIndex("by_organization_and_number", (q) => q.eq("organizationId", expediente.organizationId).eq("number", number))
      .unique();
    if (numberOwner && numberOwner._id !== existing?._id) {
      throw new ConvexError({ code: "CONFLICT", message: `El consecutivo de remesa ${number} ya está en uso` });
    }

    let remesaId: Id<"expedienteRemesas">;
    if (existing) {
      await ctx.db.patch("expedienteRemesas", existing._id, { number, updatedBy: actor._id, updatedAt: now });
      remesaId = existing._id;
    } else {
      const serviceOrder = await ctx.db.get("serviceOrders", expediente.serviceOrderId);
      const orderDraft = expediente.loadingOrderDraft;
      remesaId = await ctx.db.insert("expedienteRemesas", {
        organizationId: expediente.organizationId,
        expedienteId: expediente._id,
        sequence: args.sequence,
        number,
        cargoDescription: orderDraft?.cargoDescription ?? "",
        cargoUnit: orderDraft?.cargoUnit,
        draft: {
          consignmentClass: "terrestre_carga",
          operationType: "general",
          cashConsignment: false,
          cashOnDelivery: false,
          policyHolder: "transport_company",
          serviceOrderTransporter: serviceOrder?.code
        },
        ...initialDocumentLifecycle(),
        createdBy: actor._id,
        updatedBy: actor._id,
        createdAt: now,
        updatedAt: now
      });
    }

    await appendAudit(ctx, {
      organizationId: expediente.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: resolution.kind === "create" ? "consignment.draft_created" : "consignment.number_assigned",
      entityType: "expediente_remesa",
      entityId: remesaId,
      detailsJson: JSON.stringify({ number, sequence: args.sequence }),
      createdAt: now
    });
    await refreshDispatchSearchText(ctx, expediente._id);
    return { remesaId, number };
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
    draft: manifestDraftValidator,
    moneyConfirmedKey: v.optional(v.string())
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const expediente = await requireEditableExpediente(ctx, actor, args.expedienteId);
    const manifestState = await officialStateFor(ctx, expediente, "manifiesto");
    guardEdit(() => assertStageEditable("manifiesto", { officialState: manifestState }));
    const now = Date.now();
    const review = manifestMoneyReview(args.draft, await loadMoneyLimits(ctx, expediente.organizationId));
    if (review.blockers.length > 0) {
      throw new ConvexError({ code: "INVALID_MONEY", message: review.blockers[0] });
    }
    const previous = expediente.manifestDraft?.moneyConfirmation;
    const moneyConfirmation = resolveMoneyConfirmation(review, args.moneyConfirmedKey, previous, (key) => ({ key, confirmedBy: actor._id, confirmedAt: now }));
    await ctx.db.patch("expedientes", expediente._id, {
      manifestDraft: { ...args.draft, moneyConfirmation },
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
    if (moneyConfirmation && moneyConfirmation !== previous) {
      await appendAudit(ctx, {
        organizationId: expediente.organizationId,
        actorType: "user",
        actorId: actor._id,
        action: "dispatch.manifest_money_confirmed",
        entityType: "expediente",
        entityId: expediente._id,
        detailsJson: JSON.stringify({
          freightTotal: args.draft.freightTotal,
          advance: args.draft.advance,
          warnings: review.warnings.map((warning) => `${warning.label}: ${warning.message}`)
        }),
        createdAt: now
      });
    }
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

    const errors = [...validateFulfillmentQuantities(args.draft), ...validateEntryTimes(args.draft, Date.now())];

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

export const prepareForEmission = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
    scope: emissionScopeValidator
  },
  returns: preparationResultValidator,
  handler: prepareForEmissionHandler
});

export const masterSyncRequirements = query({
  args: { actorToken: v.optional(v.string()), expedienteId: v.id("expedientes"), scope: emissionScopeValidator },
  returns: v.array(masterSyncRequirementValidator),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    const expediente = await ctx.db.get("expedientes", args.expedienteId);
    if (!expediente) return [];
    requireSameOrganization(actor, expediente.organizationId);
    const remesas = await ctx.db
      .query("expedienteRemesas")
      .withIndex("by_expediente_and_sequence", (q) => q.eq("expedienteId", expediente._id))
      .collect();
    return await collectMasterSyncRequirements(ctx, expediente, remesas, args.scope);
  }
});

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
    const manifestDocument = currentManifestDocument(expediente, documents);
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

export const setMoneyLimits = mutation({
  args: { actorToken: v.optional(v.string()), limits: moneyLimitsValidator },
  returns: moneyLimitsValidator,
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin"]);
    const limits = resolveMoneyLimits(args.limits);
    if (limits.freightMin !== args.limits.freightMin || limits.freightMax !== args.limits.freightMax || limits.advanceMaxPercent !== args.limits.advanceMaxPercent) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Topes inválidos: el flete máximo debe superar al mínimo y el anticipo no puede pasar de 100 %" });
    }
    const now = Date.now();
    await ctx.db.patch("organizations", actor.organizationId, { moneyLimits: limits, updatedAt: now });
    await appendAudit(ctx, {
      organizationId: actor.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "organization.money_limits_updated",
      entityType: "organization",
      entityId: actor.organizationId,
      detailsJson: JSON.stringify(limits),
      createdAt: now
    });
    return limits;
  }
});

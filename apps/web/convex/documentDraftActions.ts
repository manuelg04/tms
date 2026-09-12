import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { claimConsecutive } from "./dispatches";
import {
  appendAudit,
  requireActor,
  requireSameOrganization,
} from "./model/access";
import { initialDocumentLifecycle } from "./model/documentLifecycle";
import { bogotaDate } from "./model/dispatchWorkflow";
import { refreshDispatchSearchText } from "./model/dispatchSearchProjection";
import { formatLoadingOrderNumber } from "./model/loadingOrderReservation";

export const ensureManifestDraft = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
  },
  returns: v.object({ manifestNumber: v.string() }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, [
      "admin",
      "operator",
    ]);
    const expediente = await ctx.db.get("expedientes", args.expedienteId);
    if (!expediente)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Despacho no encontrado",
      });
    requireSameOrganization(actor, expediente.organizationId);
    if (!["draft", "ready", "in_progress"].includes(expediente.status)) {
      throw new ConvexError({
        code: "INVALID_STATE",
        message: "El despacho está cerrado y no admite un nuevo manifiesto",
      });
    }
    const tripId = expediente.tripId;
    const [directDocuments, tripDocuments, operations] = await Promise.all([
      ctx.db
        .query("documents")
        .withIndex("by_expediente", (q) => q.eq("expedienteId", expediente._id))
        .collect(),
      tripId
        ? ctx.db
            .query("documents")
            .withIndex("by_trip", (q) => q.eq("tripId", tripId))
            .collect()
        : [],
      ctx.db
        .query("rndcOperations")
        .withIndex("by_expediente_and_created_at", (q) =>
          q.eq("expedienteId", expediente._id),
        )
        .collect(),
    ]);
    const documents = [...directDocuments, ...tripDocuments].filter(
      (document) =>
        !document.organizationId ||
        document.organizationId === actor.organizationId,
    );
    if (
      operations.some(
        (operation) =>
          operation.operationType === "emit_manifest" &&
          ["queued", "claimed", "uncertain", "reconciling"].includes(
            operation.status,
          ),
      ) ||
      documents.some(
        (document) =>
          document.kind === "manifiesto" &&
          (document.officialState ?? document.status) !== "draft",
      )
    ) {
      throw new ConvexError({
        code: "INVALID_STATE",
        message: "Este despacho ya tiene un manifiesto en emisión o emitido",
      });
    }
    const existingNumber =
      expediente.manifestDraft?.manifestNumber ?? expediente.manifestNumber;
    const now = Date.now();
    const manifestNumber =
      existingNumber ||
      (await claimDifferent(
        ctx,
        actor.organizationId,
        expediente.agencyCode ?? "",
        "manifiesto",
        now,
        [],
      ));
    if (
      expediente.manifestNumber === manifestNumber &&
      expediente.manifestDraft?.manifestNumber === manifestNumber
    ) {
      return { manifestNumber };
    }
    await ctx.db.patch("expedientes", expediente._id, {
      manifestNumber,
      manifestDraft: {
        ...expediente.manifestDraft,
        manifestNumber,
        issueDate: expediente.manifestDraft?.issueDate ?? bogotaDate(now),
      },
      updatedBy: actor._id,
      updatedAt: now,
    });
    await appendAudit(ctx, {
      organizationId: actor.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "manifest.draft_prepared",
      entityType: "expediente",
      entityId: expediente._id,
      detailsJson: JSON.stringify({ manifestNumber }),
      createdAt: now,
    });
    await refreshDispatchSearchText(ctx, expediente._id);
    return { manifestNumber };
  },
});

export const duplicateManifest = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
    requestId: v.string(),
  },
  returns: v.object({
    expedienteId: v.id("expedientes"),
    manifestNumber: v.string(),
    code: v.string(),
  }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, [
      "admin",
      "operator",
    ]);
    const source = await ctx.db.get("expedientes", args.expedienteId);
    if (!source)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Manifiesto no encontrado",
      });
    requireSameOrganization(actor, source.organizationId);
    const requestId = args.requestId.trim();
    if (requestId.length < 8 || requestId.length > 100) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Identificador de duplicación inválido",
      });
    }
    const token = `duplicate:${source._id}:${requestId}`;
    const previous = await ctx.db
      .query("loadingOrderReservations")
      .withIndex("by_organization_and_token", (q) =>
        q.eq("organizationId", actor.organizationId).eq("token", token),
      )
      .unique();
    if (previous) {
      if (previous.reservedBy !== actor._id)
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "La duplicación pertenece a otro operador",
        });
      const existing = previous.expedienteId
        ? await ctx.db.get("expedientes", previous.expedienteId)
        : null;
      if (
        !existing ||
        existing.organizationId !== actor.organizationId ||
        !existing.manifestNumber
      ) {
        throw new ConvexError({
          code: "INVALID_STATE",
          message: "La copia anterior ya no está disponible",
        });
      }
      return {
        expedienteId: existing._id,
        manifestNumber: existing.manifestNumber,
        code: existing.code,
      };
    }
    if (!source.manifestDraft) {
      throw new ConvexError({
        code: "INVALID_STATE",
        message:
          "Este manifiesto no tiene los datos de preparación necesarios para duplicarlo",
      });
    }
    const [serviceOrder, remesas, vehicle, driver, secondDriver, trailer] =
      await Promise.all([
        ctx.db.get("serviceOrders", source.serviceOrderId),
        ctx.db
          .query("expedienteRemesas")
          .withIndex("by_expediente_and_sequence", (q) =>
            q.eq("expedienteId", source._id),
          )
          .collect(),
        source.vehicleId ? ctx.db.get("vehicles", source.vehicleId) : null,
        source.driverId ? ctx.db.get("drivers", source.driverId) : null,
        source.secondDriverId
          ? ctx.db.get("drivers", source.secondDriverId)
          : null,
        source.trailerId ? ctx.db.get("trailers", source.trailerId) : null,
      ]);
    if (
      !serviceOrder ||
      serviceOrder.organizationId !== actor.organizationId ||
      remesas.some((remesa) => remesa.organizationId !== actor.organizationId)
    ) {
      throw new ConvexError({
        code: "INTEGRITY_ERROR",
        message: "Los datos del manifiesto no pertenecen al espacio de trabajo",
      });
    }
    const now = Date.now();
    const date = bogotaDate(now);
    const agency = source.agencyCode ?? "";
    const code = await claimDifferent(
      ctx,
      source.organizationId,
      agency,
      "expediente",
      now,
      [source.code],
    );
    const manifestNumber = await claimDifferent(
      ctx,
      source.organizationId,
      agency,
      "manifiesto",
      now,
      [source.manifestNumber, source.manifestDraft.manifestNumber],
    );
    const orderNumber = source.loadingOrderDraft
      ? formatLoadingOrderNumber(
          await claimDifferent(
            ctx,
            source.organizationId,
            "",
            "orden_cargue",
            now,
            [source.cargoNumber, source.loadingOrderDraft.orderNumber],
          ),
        )
      : undefined;
    const {
      _id: serviceId,
      _creationTime: serviceCreationTime,
      ...serviceData
    } = serviceOrder;
    const serviceOrderId = await ctx.db.insert("serviceOrders", {
      ...serviceData,
      code: `OS-${code}`,
      status: "draft",
      scheduledLoadingAt: undefined,
      scheduledUnloadingAt: undefined,
      createdBy: actor._id,
      updatedBy: actor._id,
      createdAt: now,
      updatedAt: now,
    });
    const tripId = await ctx.db.insert("trips", {
      organizationId: actor.organizationId,
      code,
      status: "borrador",
      originCity: source.manifestDraft.originCityName,
      destinationCity: source.manifestDraft.destinationCityName,
      vehiclePlate:
        vehicle?.organizationId === actor.organizationId
          ? vehicle.plate
          : undefined,
      driverName:
        driver?.organizationId === actor.organizationId
          ? driver.name
          : undefined,
      createdAt: now,
      updatedAt: now,
    });
    const loadingOrderDraft = source.loadingOrderDraft
      ? {
          ...source.loadingOrderDraft,
          orderNumber,
          expeditionDate: date,
          loading: clearAppointment(source.loadingOrderDraft.loading),
          unloading: clearAppointment(source.loadingOrderDraft.unloading),
          minLoadingDate: undefined,
          maxLoadingDate: undefined,
          printedAt: undefined,
        }
      : undefined;
    const expedienteId = await ctx.db.insert("expedientes", {
      organizationId: actor.organizationId,
      serviceOrderId,
      tripId,
      code,
      status: "draft",
      agencyCode: source.agencyCode,
      workflowVariant:
        source.workflowVariant === "transshipment"
          ? "standard"
          : source.workflowVariant,
      driverId:
        driver?.organizationId === actor.organizationId
          ? source.driverId
          : undefined,
      vehicleId:
        vehicle?.organizationId === actor.organizationId
          ? source.vehicleId
          : undefined,
      secondDriverId:
        secondDriver?.organizationId === actor.organizationId
          ? source.secondDriverId
          : undefined,
      trailerId:
        trailer?.organizationId === actor.organizationId
          ? source.trailerId
          : undefined,
      notes: source.notes,
      cargoNumber: orderNumber,
      manifestNumber,
      loadingOrderDraft,
      manifestDraft: {
        ...source.manifestDraft,
        manifestNumber,
        issueDate: date,
        estimatedDeliveryDate: undefined,
        paymentDate: undefined,
        sourceManifestNumber: undefined,
        printedAt: undefined,
      },
      createdBy: actor._id,
      updatedBy: actor._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch("trips", tripId, { expedienteId });
    for (const remesa of remesas) {
      const number = await claimDifferent(
        ctx,
        source.organizationId,
        agency,
        "remesa",
        now,
        remesas.map((candidate) => candidate.number),
      );
      await ctx.db.insert("expedienteRemesas", {
        organizationId: actor.organizationId,
        expedienteId,
        sequence: remesa.sequence,
        number,
        cargoDescription: remesa.cargoDescription,
        cargoQuantity: remesa.cargoQuantity,
        cargoUnit: remesa.cargoUnit,
        cargoWeightKg: remesa.cargoWeightKg,
        consigneeName: remesa.consigneeName,
        consigneeDocument: remesa.consigneeDocument,
        draft: remesa.draft
          ? {
              ...remesa.draft,
              expeditionDate: date,
              loading: clearAppointment(remesa.draft.loading),
              unloading: clearAppointment(remesa.draft.unloading),
              printedAt: undefined,
            }
          : undefined,
        ...initialDocumentLifecycle(),
        createdBy: actor._id,
        updatedBy: actor._id,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.insert("loadingOrderReservations", {
      organizationId: actor.organizationId,
      token,
      number: orderNumber ?? `manifiesto:${manifestNumber}`,
      status: "consumed",
      expedienteId,
      reservedBy: actor._id,
      reservedAt: now,
      consumedAt: now,
    });
    await ctx.db.insert("expedienteEvents", {
      organizationId: actor.organizationId,
      expedienteId,
      eventType: "manifest_duplicated",
      title: "Manifiesto duplicado como borrador",
      details: `Origen: ${source.manifestDraft.manifestNumber ?? source.manifestNumber ?? source.code}`,
      occurredAt: now,
      actorId: actor._id,
    });
    await appendAudit(ctx, {
      organizationId: actor.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "manifest.duplicated",
      entityType: "expediente",
      entityId: expedienteId,
      detailsJson: JSON.stringify({
        sourceExpedienteId: source._id,
        manifestNumber,
        requestId,
      }),
      createdAt: now,
    });
    await refreshDispatchSearchText(ctx, expedienteId);
    return { expedienteId, manifestNumber, code };
  },
});

function clearAppointment<T extends { appointmentAt?: number }>(
  site: T | undefined,
): T | undefined {
  return site ? { ...site, appointmentAt: undefined } : undefined;
}

async function claimDifferent(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  agency: string,
  kind: "expediente" | "orden_cargue" | "remesa" | "manifiesto",
  now: number,
  sourceNumbers: (string | undefined)[],
): Promise<string> {
  const normalize = (value: string) => value.replace(/^0+(?=\d)/, "");
  const excluded = new Set(
    sourceNumbers
      .filter((value): value is string => Boolean(value))
      .map(normalize),
  );
  if (kind === "remesa") {
    const drafts = await ctx.db
      .query("expedienteRemesas")
      .withIndex("by_organization_and_number", (q) =>
        q.eq("organizationId", organizationId),
      )
      .collect();
    for (const draft of drafts)
      if (draft.number) excluded.add(normalize(draft.number));
  } else if (kind !== "expediente") {
    const expedientes = await ctx.db
      .query("expedientes")
      .withIndex("by_organization_and_updated_at", (q) =>
        q.eq("organizationId", organizationId),
      )
      .collect();
    for (const expediente of expedientes) {
      const numbers =
        kind === "manifiesto"
          ? [
              expediente.manifestNumber,
              expediente.manifestDraft?.manifestNumber,
            ]
          : [expediente.cargoNumber, expediente.loadingOrderDraft?.orderNumber];
      for (const number of numbers) if (number) excluded.add(normalize(number));
    }
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const number = await claimConsecutive(
      ctx,
      organizationId,
      agency,
      kind,
      now,
    );
    if (excluded.has(normalize(number))) continue;
    const existing =
      kind === "expediente"
        ? await ctx.db
            .query("expedientes")
            .withIndex("by_organization_and_code", (q) =>
              q.eq("organizationId", organizationId).eq("code", number),
            )
            .first()
        : await ctx.db
            .query("documents")
            .withIndex("by_organization_kind_and_number", (q) =>
              q
                .eq("organizationId", organizationId)
                .eq("kind", kind)
                .eq("number", number),
            )
            .first();
    if (!existing) return number;
  }
  throw new ConvexError({
    code: "CONFLICT",
    message:
      "El rango de consecutivos necesita actualización antes de duplicar",
  });
}

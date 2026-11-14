import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { appendAudit, requireActor, requireSameOrganization } from "./access";
import { claimNextConsecutive } from "./consecutiveRange";
import { loadMoneyLimits } from "./moneyLimits";
import { buildDispatchSnapshot, snapshotDataMatches, snapshotDataOf, type SnapshotKind } from "./dispatchSnapshot";
import {
  bogotaDate,
  consignmentMissingFields,
  emissionDependencyBlockers,
  emissionScopeTargets,
  effectiveConsignment,
  loadingOrderMissingFields,
  manifestMissingFields,
  type ConsignmentDraft,
  type DispatchProjection,
  type EmissionScope,
  type LoadingOrderDraft,
  type PartyDraft
} from "./dispatchWorkflow";
import { type OfficialDocumentState } from "./documentLifecycle";
import { refreshDispatchSearchText } from "./dispatchSearchProjection";
import { masterSyncSummary } from "./masterSync";
import { completeCargoClassification } from "./merchandiseCatalog";
import { currentManifestDocument } from "./currentManifest";

export const stageValidator = v.union(
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

export const emissionScopeValidator = v.union(
  v.literal("orden"),
  v.literal("remesas"),
  v.literal("manifiesto"),
  v.literal("todo")
);

export const consecutiveDefaults: Record<string, { prefix: string; padding: number }> = {
  expediente: { prefix: "DSP-", padding: 6 },
  orden_cargue: { prefix: "", padding: 9 },
  remesa: { prefix: "", padding: 5 },
  viaje: { prefix: "", padding: 7 },
  manifiesto: { prefix: "", padding: 7 }
};

export const preparationResultValidator = v.object({
  code: v.string(),
  scope: emissionScopeValidator,
  orderNumber: v.optional(v.string()),
  consignmentNumbers: v.array(v.string()),
  tripNumber: v.optional(v.string()),
  manifestNumber: v.optional(v.string()),
  alreadyPrepared: v.boolean()
});

export async function prepareForEmissionHandler(
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
  const storedOrderDraft = expediente.loadingOrderDraft;
  const completedOrderDraft = storedOrderDraft ? await completeCargoClassification(ctx, expediente.organizationId, storedOrderDraft) : undefined;
  if (storedOrderDraft && completedOrderDraft !== storedOrderDraft) {
    await ctx.db.patch("expedientes", expediente._id, { loadingOrderDraft: completedOrderDraft });
  }
  for (const remesa of remesas) {
    const remesaDraft = remesa.draft as ConsignmentDraft | undefined;
    if (!remesaDraft || isAuthorizedState(remesa.officialState)) continue;
    const effective = effectiveConsignment(remesaDraft, completedOrderDraft);
    const completed = await completeCargoClassification(
      ctx,
      expediente.organizationId,
      { merchandiseCode: effective.merchandiseCode, natureOfCargo: effective.natureOfCargo, packagingCode: effective.packagingCode },
      completedOrderDraft?.cargoDescription ?? effective.remissions?.[0]?.description
    );
    if (completed.merchandiseCode && (completed.merchandiseCode !== effective.merchandiseCode || completed.natureOfCargo !== effective.natureOfCargo)) {
      const nextDraft = { ...remesa.draft, merchandiseCode: completed.merchandiseCode, natureOfCargo: completed.natureOfCargo };
      await ctx.db.patch("expedienteRemesas", remesa._id, { draft: nextDraft });
      remesa.draft = nextDraft;
    }
  }
  const orderDraft = completedOrderDraft as (LoadingOrderDraft & { customerId?: Id<"customers"> }) | undefined;
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

  const manifestState = await officialStateFor(ctx, expediente, "manifiesto");
  const now = Date.now();
  const orderExpeditionDate = orderDraft?.expeditionDate ?? snapshotExpeditionDateOf(latestOrderSnapshot) ?? bogotaDate(now);
  const consignmentCandidate = (remesa: Doc<"expedienteRemesas">, number: string): Record<string, unknown> => {
    const effective = effectiveConsignment((remesa.draft ?? {}) as ConsignmentDraft, orderDraft);
    return {
      ...effective,
      expeditionDate: effective.expeditionDate ?? snapshotExpeditionDateOf(latestRemesaSnapshots.get(remesa._id)) ?? orderExpeditionDate,
      number,
      sequence: remesa.sequence
    };
  };

  // Un documento cuenta como preparado sólo si su fotografía coincide con el
  // borrador actual: una fotografía vieja tras editar (p. ej. al corregir un
  // rechazo RNDC) debe re-tomarse, nunca reemitirse.
  const orderPrepared = !targets.order || Boolean(
    orderNumber && (
      isAuthorizedState(orderState) ||
      (orderDraft && snapshotDataMatches(latestOrderSnapshot?.payloadJson, { ...orderDraft, orderNumber, expeditionDate: orderExpeditionDate }))
    )
  );
  const consignmentsPrepared = !targets.consignments || (
    remesas.length > 0 && remesas.every((remesa) =>
      Boolean(remesa.number && (
        isAuthorizedState(remesa.officialState) ||
        snapshotDataMatches(latestRemesaSnapshots.get(remesa._id)?.payloadJson, consignmentCandidate(remesa, remesa.number))
      ))
    )
  );
  const manifestPrepared = !targets.manifest || Boolean(
    manifestNumber && (
      isAuthorizedState(manifestState) ||
      (expediente.manifestDraft && snapshotDataMatches(latestManifestSnapshot?.payloadJson, { ...expediente.manifestDraft, manifestNumber }))
    )
  );
  const tripPrepared = !targets.trip || Boolean(expediente.tripNumber);
  const scopeDocumentsAuthorized =
    (!targets.order || isAuthorizedState(orderState)) &&
    (!targets.consignments || (remesas.length > 0 && remesas.every((remesa) => isAuthorizedState(remesa.officialState)))) &&
    (!targets.manifest || isAuthorizedState(manifestState));
  let assignmentData: Record<string, unknown> | undefined;

  if (targets.assignment && !scopeDocumentsAuthorized && expediente.driverId && expediente.vehicleId) {
    const [driver, secondDriver, vehicle, trailer] = await Promise.all([
      ctx.db.get("drivers", expediente.driverId),
      expediente.secondDriverId ? ctx.db.get("drivers", expediente.secondDriverId) : null,
      ctx.db.get("vehicles", expediente.vehicleId),
      expediente.trailerId ? ctx.db.get("trailers", expediente.trailerId) : null
    ]);

    if (driver && vehicle) {
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
  }

  const assignmentPrepared = !targets.assignment || scopeDocumentsAuthorized || (
    assignmentData !== undefined && snapshotDataMatches(latestAssignmentSnapshot?.payloadJson, assignmentData)
  );

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
    blockers.push(...manifestMissingFields(expediente.manifestDraft, remesas.length, await loadMoneyLimits(ctx, expediente.organizationId)));
  }
  if (targets.assignment && !scopeDocumentsAuthorized && assignmentData === undefined) {
    if (!expediente.driverId) {
      blockers.push("Falta asignar el conductor");
    }
    if (!expediente.vehicleId) {
      blockers.push("Falta asignar el vehículo");
    }
    if (expediente.driverId && expediente.vehicleId) {
      blockers.push("La asignación de vehículo y conductor ya no está disponible");
    }
  }

  if (blockers.length > 0) {
    throw new ConvexError({
      code: "VALIDATION",
      message: "El documento tiene datos pendientes y no puede prepararse",
      data: { scope: args.scope, blockers }
    });
  }

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
      if (!isAuthorizedState(remesa.officialState)) {
        const candidate = consignmentCandidate(remesa, number);

        if (!snapshotDataMatches(latestSnapshot?.payloadJson, candidate)) {
          await writeSnapshot(ctx, expediente, actor, "remesa", number, candidate, now, remesa._id);
        }
      }
    }
  } else {
    preparedConsignmentNumbers.push(...consignmentNumbers);
  }

  if (targets.order && preparedOrderNumber && orderDraft && !isAuthorizedState(orderState)) {
    const candidate = { ...orderDraft, orderNumber: preparedOrderNumber, expeditionDate: orderExpeditionDate };

    if (!snapshotDataMatches(latestOrderSnapshot?.payloadJson, candidate)) {
      await writeSnapshot(ctx, expediente, actor, "orden_cargue", preparedOrderNumber, candidate, now);
    }
  }
  if (targets.manifest && preparedManifestNumber && expediente.manifestDraft && !isAuthorizedState(manifestState)) {
    const candidate = { ...expediente.manifestDraft, manifestNumber: preparedManifestNumber };

    if (!snapshotDataMatches(latestManifestSnapshot?.payloadJson, candidate)) {
      await writeSnapshot(ctx, expediente, actor, "manifiesto", preparedManifestNumber, candidate, now);
    }
  }
  if (assignmentData && !snapshotDataMatches(latestAssignmentSnapshot?.payloadJson, assignmentData)) {
    await writeSnapshot(ctx, expediente, actor, "asignacion", undefined, assignmentData, now);
  }

  await ctx.db.patch("expedientes", expediente._id, {
    status: "in_progress",
    loadingOrderDraft: targets.order && orderDraft && preparedOrderNumber
      ? { ...orderDraft, orderNumber: preparedOrderNumber, expeditionDate: orderExpeditionDate }
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

export function isAuthorizedState(state: OfficialDocumentState): boolean {
  return state === "authorized" || state === "fulfilled";
}

export function snapshotExpeditionDateOf(snapshot: Doc<"dispatchSnapshots"> | undefined): string | undefined {
  const data = snapshotDataOf(snapshot?.payloadJson);
  const value = data?.expeditionDate;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function preparationDetails(
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

export const masterSyncRequirementValidator = v.object({
  kind: v.union(v.literal("driver"), v.literal("vehicle"), v.literal("party")),
  key: v.string(),
  label: v.string(),
  state: v.union(v.literal("pending"), v.literal("registered"), v.literal("rejected")),
  error: v.optional(v.string())
});

export async function collectMasterSyncRequirements(
  ctx: QueryCtx,
  expediente: Doc<"expedientes">,
  remesas: Doc<"expedienteRemesas">[],
  scope: EmissionScope
): Promise<Array<{ kind: "driver" | "vehicle" | "party"; key: string; label: string; state: "pending" | "registered" | "rejected"; error?: string }>> {
  const targets = emissionScopeTargets(scope, expediente.workflowVariant ?? "standard");
  const organizationId = expediente.organizationId;
  const orderDraft = (expediente.loadingOrderDraft ?? null) as LoadingOrderDraft | null;
  const results: Array<{ kind: "driver" | "vehicle" | "party"; key: string; label: string; state: "pending" | "registered" | "rejected"; error?: string }> = [];
  const seen = new Set<string>();
  const push = (entry: { kind: "driver" | "vehicle" | "party"; key: string; label: string; state: "pending" | "registered" | "rejected"; error?: string }) => {
    const id = `${entry.kind}:${entry.key}`;
    if (seen.has(id)) return;
    seen.add(id);
    results.push(entry);
  };

  if (targets.assignment && expediente.driverId) {
    const driver = await ctx.db.get("drivers", expediente.driverId);
    if (driver) {
      const mirror = await ctx.db.query("thirdParties").withIndex("by_organization_and_document", (q) => q.eq("organizationId", organizationId).eq("document", driver.document)).unique();
      const summary = driver.rndcSync ? masterSyncSummary(driver) : masterSyncSummary(mirror ? { rndcRegisteredAt: mirror.rndcRegisteredAt, source: mirror.source } : null);
      push({ kind: "driver", key: driver.document, label: `Conductor ${driver.name ?? driver.document}`, state: summary.state, error: summary.error });
    }
  }
  if (targets.assignment && expediente.vehicleId) {
    const vehicle = await ctx.db.get("vehicles", expediente.vehicleId);
    if (vehicle) {
      const summary = masterSyncSummary(vehicle);
      push({ kind: "vehicle", key: vehicle.plate, label: `Vehículo ${vehicle.plate}`, state: summary.state, error: summary.error });
    }
  }
  if (targets.order || targets.consignments) {
    const parties: Array<PartyDraft | undefined> = [];
    if (targets.order) parties.push(orderDraft?.sender, orderDraft?.recipient);
    if (targets.consignments) {
      for (const remesa of remesas) {
        if (isAuthorizedState(remesa.officialState)) continue;
        const effective = effectiveConsignment((remesa.draft ?? {}) as ConsignmentDraft, orderDraft);
        parties.push(effective.sender, effective.recipient);
      }
    }
    for (const party of parties) {
      const document = party?.identificationNumber?.trim();
      if (!document || seen.has(`party:${document}`)) continue;
      const row = await ctx.db.query("thirdParties").withIndex("by_organization_and_document", (q) => q.eq("organizationId", organizationId).eq("document", document)).unique();
      if (!row) {
        push({ kind: "party", key: document, label: `Tercero ${party?.name ?? document}`, state: "rejected", error: `El tercero ${party?.name ?? document} no existe en maestros` });
        continue;
      }
      const summary = masterSyncSummary(row);
      push({ kind: "party", key: document, label: `Tercero ${row.name}`, state: summary.state, error: summary.error });
    }
  }
  return results;
}

export function readTripNumber(payloadJson: string): string | undefined {
  try {
    const parsed = JSON.parse(payloadJson) as { tripNumber?: unknown };
    return typeof parsed.tripNumber === "string" ? parsed.tripNumber : undefined;
  } catch {
    return undefined;
  }
}

export async function requireExpediente(ctx: QueryCtx, expedienteId: Id<"expedientes">): Promise<Doc<"expedientes">> {
  const expediente = await ctx.db.get("expedientes", expedienteId);

  if (!expediente) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Expediente no encontrado" });
  }

  return expediente;
}

export async function requireEditableExpediente(
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

export function guardEdit(check: () => void): void {
  try {
    check();
  } catch (error) {
    throw new ConvexError({ code: "INVALID_STATE", message: error instanceof Error ? error.message : String(error) });
  }
}

export async function officialStateFor(
  ctx: QueryCtx,
  expediente: Doc<"expedientes">,
  kind: "orden_cargue" | "manifiesto"
): Promise<OfficialDocumentState> {
  const documents = await ctx.db
    .query("documents")
    .withIndex("by_expediente", (q) => q.eq("expedienteId", expediente._id))
    .collect();
  const match = kind === "manifiesto"
    ? currentManifestDocument(expediente, documents)
    : documents
        .filter((document) => document.kind === kind)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const state = match?.officialState ?? match?.status;
  return state === "authorized" || state === "fulfilled" || state === "annulled" || state === "pending" ? state : "draft";
}

export async function buildProjection(
  ctx: QueryCtx,
  expediente: Doc<"expedientes">,
  remesas: Doc<"expedienteRemesas">[]
): Promise<DispatchProjection> {
  const orderDraft = (expediente.loadingOrderDraft ?? null) as LoadingOrderDraft | null;
  const [cargoInfoState, manifestState, moneyLimits] = await Promise.all([
    officialStateFor(ctx, expediente, "orden_cargue"),
    officialStateFor(ctx, expediente, "manifiesto"),
    loadMoneyLimits(ctx, expediente.organizationId)
  ]);
  const manifestDocuments = await ctx.db
    .query("documents")
    .withIndex("by_expediente", (q) => q.eq("expedienteId", expediente._id))
    .collect();
  const manifestDocument = currentManifestDocument(expediente, manifestDocuments);

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
          missingFields: manifestMissingFields(expediente.manifestDraft, remesas.length, moneyLimits),
          officialState: manifestState,
          fulfillmentState: manifestDocument?.fulfillmentState ?? "not_requested"
        }
      : manifestDocument ? { missingFields: [], officialState: manifestState, fulfillmentState: manifestDocument.fulfillmentState ?? "not_requested" } : null,
    cargoInfoState
  };
}

export async function claimConsecutive(
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

export async function findActiveRange(
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

export async function writeSnapshot(
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

export function pickSnapshotFields(row: Record<string, unknown> | null): Record<string, unknown> | null {
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

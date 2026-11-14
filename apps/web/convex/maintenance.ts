import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { rememberMerchandiseProduct } from "./model/merchandiseProducts";
import { appendAudit } from "./model/access";
import { archivedKey, rejectionUnlockProblem } from "./model/rejectionUnlock";

export const TEST_ORDER_CODE = /^OS-(GUIDED|ASYNC|EARLY|TMP|REM|MAN|UI|SMOKE|E2E|TEST)-\d+$/i;

async function deleteByIndex(ctx: MutationCtx, table: string, index: string, expedienteId: Id<"expedientes">): Promise<number> {
  const rows = await (ctx.db.query(table as never) as never as { withIndex: (name: string, fn: (q: { eq: (field: string, value: unknown) => unknown }) => unknown) => { collect: () => Promise<Array<{ _id: Id<never> }>> } })
    .withIndex(index, (q) => q.eq("expedienteId", expedienteId))
    .collect();
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}

export const purgeTestDispatches = internalMutation({
  args: { limit: v.optional(v.number()), dryRun: v.optional(v.boolean()) },
  returns: v.object({ matched: v.number(), deleted: v.number(), remaining: v.number(), dependents: v.number() }),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
    const expedientes = await ctx.db.query("expedientes").collect();
    const targets: Array<{ expedienteId: Id<"expedientes">; tripId?: Id<"trips">; serviceOrderId: Id<"serviceOrders"> }> = [];
    for (const expediente of expedientes) {
      const order = await ctx.db.get("serviceOrders", expediente.serviceOrderId);
      if (order && TEST_ORDER_CODE.test(order.code)) targets.push({ expedienteId: expediente._id, tripId: expediente.tripId ?? undefined, serviceOrderId: order._id });
    }
    if (args.dryRun) return { matched: targets.length, deleted: 0, remaining: targets.length, dependents: 0 };

    let deleted = 0;
    let dependents = 0;
    for (const target of targets.slice(0, limit)) {
      for (const [table, index] of [
        ["expedienteRemesas", "by_expediente_and_sequence"],
        ["documents", "by_expediente"],
        ["complianceChecks", "by_expediente_and_checked_at"],
        ["expedienteEvents", "by_expediente_and_occurred_at"],
        ["expedienteNovelties", "by_expediente_and_opened_at"],
        ["deliveryEvidence", "by_expediente_and_captured_at"],
        ["evidenceArtifacts", "by_expediente_and_created_at"],
        ["dispatchExceptions", "by_expediente_and_created_at"],
        ["rndcOperations", "by_expediente_and_created_at"],
        ["dispatchSnapshots", "by_expediente_and_taken_at"]
      ] as const) {
        dependents += await deleteByIndex(ctx, table, index, target.expedienteId);
      }
      if (target.tripId && (await ctx.db.get("trips", target.tripId))) await ctx.db.delete("trips", target.tripId);
      await ctx.db.delete("expedientes", target.expedienteId);
      const order = await ctx.db.get("serviceOrders", target.serviceOrderId);
      if (order) {
        const customer = await ctx.db.get("customers", order.customerId);
        await ctx.db.delete("serviceOrders", order._id);
        if (customer && /^(Cliente|Destinatario) (GUIDED|ASYNC|EARLY|TMP|REM|MAN|UI|SMOKE|E2E|TEST)-\d+$/i.test(customer.name)) {
          const locations = await ctx.db.query("customerLocations").withIndex("by_customer_and_code", (q) => q.eq("customerId", customer._id)).collect();
          for (const location of locations) await ctx.db.delete("customerLocations", location._id);
          await ctx.db.delete("customers", customer._id);
        }
      }
      deleted += 1;
    }
    return { matched: targets.length, deleted, remaining: targets.length - deleted, dependents };
  }
});

const demoTransactionalTables = [
  "pendingEmissions",
  "pendingEmissionTicker",
  "operacionesDeliveries",
  "operacionesLinks",
  "notifications",
  "rndcRequestKeys",
  "rndcAttempts",
  "rndcOperations",
  "dispatchSnapshots",
  "dispatchExceptions",
  "dispatchRoutePlans",
  "routePlans",
  "deliveryEvidence",
  "evidenceArtifacts",
  "complianceChecks",
  "expedienteEvents",
  "expedienteNovelties",
  "expedienteRemesas",
  "documents",
  "loadingOrderReservations",
  "expedientes",
  "trips",
  "serviceOrders",
  "trackingPositions",
  "trackingReports",
  "trackingCheckpoints",
  "trackingNotes",
  "trackingDispatches",
  "monitoringReports",
  "monitoringTrips",
  "securityStudies",
  "driverDossiers",
  "masterAttachments"
] as const;

const demoAuditEntityTypes = [
  "expediente",
  "evidence_artifact",
  "rndc_operation",
  "document",
  "service_order",
  "loading_order_reservation",
  "expediente_remesa",
  "compliance_check",
  "novelty",
  "monitoringTrip",
  "securityStudy"
] as const;

const qaDriverDocuments = ["1000000001", "799000001", "1070383330", "1083687438", "1018545517", "1039869754"];
const qaVehiclePlates = ["Q26523", "AAE829", "LYL744", "DLK168", "DEM001", "TST712"];
const qaTrailerPlates = ["UIR001", "UIR002", "UIR003", "TRL001", "R99898", "R92544", "R26523", "R54714"];
const qaThirdPartyDocuments = ["1018545517", "9007990003", "900816529", "799000001", "9003964798", "1070383330", "900743434", "9007990001", "9003421562", "799000002", "1039869754", "1083687438"];
const operacionesFixture = {
  drivers: ["1083687438"],
  vehicles: ["AAE829"],
  trailers: ["R99898"],
  thirdParties: ["1083687438", "9003421562"]
};
const qaName = /prueba|demo|\bqa\b/i;

type AnyRow = { _id: Id<never>; [key: string]: unknown };
type LooseDb = {
  query: (table: string) => {
    take: (count: number) => Promise<AnyRow[]>;
    collect: () => Promise<AnyRow[]>;
    withIndex: (name: string, range: (q: { eq: (field: string, value: unknown) => { eq: (field: string, value: unknown) => unknown } }) => unknown) => { take: (count: number) => Promise<AnyRow[]>; collect: () => Promise<AnyRow[]> };
  };
  delete: (id: Id<never>) => Promise<void>;
};

export const purgeDemoData = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    qaMasters: v.optional(v.union(v.literal("keep"), v.literal("keep_operaciones"), v.literal("delete")))
  },
  returns: v.object({
    dryRun: v.boolean(),
    blocked: v.optional(v.string()),
    counts: v.record(v.string(), v.number()),
    total: v.number(),
    remaining: v.boolean()
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun !== false;
    const qaMasters = args.qaMasters ?? "keep";
    const db = ctx.db as unknown as LooseDb;
    const counts: Record<string, number> = {};
    let budget = Math.min(Math.max(args.limit ?? 1500, 1), 3000);
    const add = (table: string, amount: number) => {
      if (amount > 0) counts[table] = (counts[table] ?? 0) + amount;
    };
    const done = (remaining: boolean, blocked?: string) => ({
      dryRun,
      blocked,
      counts,
      total: Object.values(counts).reduce((sum, value) => sum + value, 0),
      remaining
    });

    const [documents, operations, attempts] = await Promise.all([
      ctx.db.query("documents").collect(),
      ctx.db.query("rndcOperations").collect(),
      ctx.db.query("rndcAttempts").collect()
    ]);
    const live = documents.filter((row) => row.mode === "live").length + operations.filter((row) => row.mode === "live").length + attempts.filter((row) => row.mode === "live").length;
    if (live > 0) {
      return done(true, `Hay ${live} registros transmitidos en vivo al RNDC; la limpieza de demo no borra documentos oficiales.`);
    }

    const remove = async (table: string, rows: AnyRow[]) => {
      for (const row of rows) {
        if (!dryRun) {
          if ((table === "evidenceArtifacts" || table === "masterAttachments") && row.storageId) {
            await ctx.storage.delete(row.storageId as Id<"_storage">).catch(() => undefined);
          }
          await db.delete(row._id);
        }
      }
      add(table, rows.length);
      budget -= rows.length;
    };

    for (const table of demoTransactionalTables) {
      const rows = dryRun ? await db.query(table).collect() : await db.query(table).take(budget);
      await remove(table, rows);
      if (!dryRun && budget <= 0) return done(true);
    }

    for (const entityType of demoAuditEntityTypes) {
      const scoped = db.query("auditEvents").withIndex("by_entity_and_created_at", (q) => q.eq("entityType", entityType));
      const rows = dryRun ? await scoped.collect() : await scoped.take(budget);
      await remove("auditEvents", rows);
      if (!dryRun && budget <= 0) return done(true);
    }

    const users = await ctx.db.query("users").collect();
    const linkedCustomers = new Set(users.flatMap((user) => (user.customerId ? [user.customerId as string] : [])));
    const customers = (await db.query("customers").collect()).filter((row) => row.source !== "avansat" && !linkedCustomers.has(row._id as string));
    for (const customer of customers) {
      const locations = await db.query("customerLocations").withIndex("by_customer_and_code", (q) => q.eq("customerId", customer._id)).collect();
      await remove("customerLocations", locations);
      await remove("customers", [customer]);
      if (!dryRun && budget <= 0) return done(true);
    }

    if (qaMasters !== "keep") {
      const kept = qaMasters === "keep_operaciones" ? operacionesFixture : { drivers: [], vehicles: [], trailers: [], thirdParties: [] };
      const wanted = (values: string[], keep: string[]) => values.filter((value) => !keep.includes(value));

      for (const document of wanted(qaDriverDocuments, kept.drivers)) {
        const rows = (await db.query("drivers").withIndex("by_document", (q) => q.eq("document", document)).collect()).filter((row) => qaName.test(String(row.name ?? "")));
        for (const driver of rows) {
          await remove("driverVehicles", await db.query("driverVehicles").withIndex("by_driver", (q) => q.eq("driverId", driver._id)).collect());
        }
        await remove("drivers", rows);
      }

      for (const plate of wanted(qaVehiclePlates, kept.vehicles)) {
        const rows = (await db.query("vehicles").withIndex("by_plate", (q) => q.eq("plate", plate)).collect()).filter((row) => row.source !== "rndc-maestro");
        for (const vehicle of rows) {
          await remove("driverVehicles", await db.query("driverVehicles").withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicle._id)).collect());
        }
        await remove("vehicles", rows);
      }

      const trailerPlates = wanted(qaTrailerPlates, kept.trailers);
      await remove("trailers", (await db.query("trailers").collect()).filter((row) => trailerPlates.includes(String(row.plate))));

      const thirdPartyDocuments = wanted(qaThirdPartyDocuments, kept.thirdParties);
      const organizations = await ctx.db.query("organizations").collect();
      for (const organization of organizations) {
        for (const document of thirdPartyDocuments) {
          const rows = (await db.query("thirdParties").withIndex("by_organization_and_document", (q) => q.eq("organizationId", organization._id).eq("document", document)).collect()).filter((row) => row.source !== "rndc-maestro" && qaName.test(String(row.name ?? "")));
          for (const thirdParty of rows) {
            await remove("thirdPartySites", await db.query("thirdPartySites").withIndex("by_third_party", (q) => q.eq("thirdPartyId", thirdParty._id)).collect());
          }
          await remove("thirdParties", rows);
        }
      }
    }

    return done(false);
  }
});

export const importMerchandiseProducts = internalMutation({
  args: {
    rows: v.array(
      v.object({
        name: v.string(),
        code: v.string(),
        natureCode: v.optional(v.string()),
        packagingCode: v.optional(v.string()),
        uses: v.optional(v.number())
      })
    )
  },
  returns: v.object({ created: v.number(), updated: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    const organizations = await ctx.db.query("organizations").collect();
    if (organizations.length !== 1) {
      throw new Error("La importación de productos espera una sola organización");
    }
    const result = { created: 0, updated: 0, skipped: 0 };
    for (const row of args.rows.slice(0, 1000)) {
      const outcome = await rememberMerchandiseProduct(ctx, organizations[0]._id, row, "rndc");
      if (outcome === "created") result.created += 1;
      else if (outcome === "updated") result.updated += 1;
      else result.skipped += 1;
    }
    return result;
  }
});

export const purgeUnlinkedSyncRecords = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  returns: v.object({ dryRun: v.boolean(), documents: v.number(), trips: v.number(), attempts: v.number(), notifications: v.number(), evidence: v.number() }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun !== false;
    const result = { dryRun, documents: 0, trips: 0, attempts: 0, notifications: 0, evidence: 0 };
    const documents = (await ctx.db.query("documents").collect()).filter((row) => !row.expedienteId && row.mode !== "live");
    const tripIds = new Set<Id<"trips">>();

    for (const document of documents) {
      const trip = await ctx.db.get("trips", document.tripId);
      if (trip && !trip.expedienteId) tripIds.add(trip._id);
      const attempts = await ctx.db.query("rndcAttempts").withIndex("by_document", (q) => q.eq("documentId", document._id)).collect();
      const evidence = await ctx.db.query("evidenceArtifacts").withIndex("by_document", (q) => q.eq("documentId", document._id)).collect();
      result.attempts += attempts.length;
      result.evidence += evidence.length;
      result.documents += 1;
      if (!dryRun) {
        for (const attempt of attempts) await ctx.db.delete("rndcAttempts", attempt._id);
        for (const artifact of evidence) {
          await ctx.storage.delete(artifact.storageId).catch(() => undefined);
          await ctx.db.delete("evidenceArtifacts", artifact._id);
        }
        await ctx.db.delete("documents", document._id);
      }
    }

    const documentIds = new Set<string>(documents.map((document) => document._id));
    const notifications = (await ctx.db.query("notifications").collect()).filter(
      (row) => (row.relatedDocumentId && documentIds.has(row.relatedDocumentId)) || (row.relatedTripId && tripIds.has(row.relatedTripId))
    );
    result.notifications = notifications.length;
    result.trips = tripIds.size;
    if (!dryRun) {
      for (const notification of notifications) await ctx.db.delete("notifications", notification._id);
      for (const tripId of tripIds) await ctx.db.delete("trips", tripId);
    }
    return result;
  }
});

export const releaseOperacionesRequest = internalMutation({
  args: { expedienteCode: v.string(), dryRun: v.optional(v.boolean()) },
  returns: v.object({ dryRun: v.boolean(), released: v.number(), operacionesExpedienteIds: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun !== false;
    const expedientes = (await ctx.db.query("expedientes").collect()).filter((row) => row.code === args.expedienteCode);
    if (expedientes.length !== 1) {
      throw new Error(`Se esperaba un solo viaje con el código ${args.expedienteCode}`);
    }
    const links = await ctx.db.query("operacionesLinks").withIndex("by_expediente", (q) => q.eq("expedienteId", expedientes[0]._id)).collect();
    if (!dryRun) {
      for (const link of links) await ctx.db.delete("operacionesLinks", link._id);
    }
    return { dryRun, released: links.length, operacionesExpedienteIds: links.map((link) => link.operacionesExpedienteId) };
  }
});

export const mergeCustomers = internalMutation({
  args: { keepId: v.id("customers"), removeId: v.id("customers"), dryRun: v.optional(v.boolean()) },
  returns: v.object({
    dryRun: v.boolean(),
    kept: v.string(),
    removed: v.string(),
    locationsMoved: v.number(),
    locationsDropped: v.number(),
    serviceOrders: v.number(),
    users: v.number(),
    monitoringTrips: v.number(),
    securityStudies: v.number(),
    expedientes: v.number(),
    snapshots: v.number(),
    fieldsFilled: v.array(v.string()),
    rndcThirdParties: v.array(v.string())
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun !== false;
    if (args.keepId === args.removeId) throw new Error("Los dos clientes son el mismo registro");
    const keep = await ctx.db.get("customers", args.keepId);
    const remove = await ctx.db.get("customers", args.removeId);
    if (!keep || !remove) throw new Error("No se encontró alguno de los dos clientes");
    if (keep.organizationId !== remove.organizationId) throw new Error("Los clientes son de organizaciones distintas");
    const organizationId = keep.organizationId;
    const now = Date.now();

    const orders = await ctx.db.query("serviceOrders").withIndex("by_customer", (q) => q.eq("customerId", remove._id)).collect();
    const usedLocations = new Set<string>(orders.flatMap((order) => [order.loadingLocationId, order.unloadingLocationId]));
    const locations = await ctx.db.query("customerLocations").withIndex("by_organization_and_customer", (q) => q.eq("organizationId", organizationId).eq("customerId", remove._id)).collect();
    let locationsMoved = 0;
    let locationsDropped = 0;
    for (const location of locations) {
      const clash = await ctx.db.query("customerLocations").withIndex("by_customer_and_code", (q) => q.eq("customerId", keep._id).eq("code", location.code)).first();
      if (clash && !usedLocations.has(location._id)) {
        locationsDropped += 1;
        if (!dryRun) await ctx.db.delete("customerLocations", location._id);
        continue;
      }
      locationsMoved += 1;
      if (!dryRun) {
        await ctx.db.patch("customerLocations", location._id, {
          customerId: keep._id,
          code: clash ? `${location.code}-${remove.code}` : location.code,
          updatedAt: now
        });
      }
    }

    if (!dryRun) for (const order of orders) await ctx.db.patch("serviceOrders", order._id, { customerId: keep._id, updatedAt: now });

    const users = (await ctx.db.query("users").collect()).filter((user) => user.customerId === remove._id);
    if (!dryRun) for (const user of users) await ctx.db.patch("users", user._id, { customerId: keep._id });

    const trips = await ctx.db.query("monitoringTrips").withIndex("by_org_customer", (q) => q.eq("organizationId", organizationId).eq("customerId", remove._id)).collect();
    if (!dryRun) for (const trip of trips) await ctx.db.patch("monitoringTrips", trip._id, { customerId: keep._id });

    const studies = await ctx.db.query("securityStudies").withIndex("by_org_customer", (q) => q.eq("organizationId", organizationId).eq("customerId", remove._id)).collect();
    if (!dryRun) for (const study of studies) await ctx.db.patch("securityStudies", study._id, { customerId: keep._id });

    const expedientes = (await ctx.db.query("expedientes").collect()).filter((row) => row.loadingOrderDraft?.customerId === remove._id);
    if (!dryRun) {
      for (const row of expedientes) {
        if (row.loadingOrderDraft) await ctx.db.patch("expedientes", row._id, { loadingOrderDraft: { ...row.loadingOrderDraft, customerId: keep._id } });
      }
    }

    const snapshots = await ctx.db.query("avansatCustomerSnapshots").withIndex("by_customer", (q) => q.eq("customerId", remove._id)).collect();
    if (!dryRun) for (const snapshot of snapshots) await ctx.db.patch("avansatCustomerSnapshots", snapshot._id, { customerId: keep._id });

    const filled: { identificationType?: string; identificationNumber?: string; email?: string; phone?: string } = {};
    if (!keep.identificationNumber && remove.identificationNumber) {
      filled.identificationNumber = remove.identificationNumber;
      filled.identificationType = remove.identificationType;
    }
    if (!keep.email && remove.email) filled.email = remove.email;
    if (!keep.phone && remove.phone) filled.phone = remove.phone;

    const documents = [...new Set([keep.identificationNumber, remove.identificationNumber].filter((value): value is string => Boolean(value)))];
    const rndcThirdParties: string[] = [];
    for (const document of documents) {
      const parties = await ctx.db.query("thirdParties").withIndex("by_organization_and_document", (q) => q.eq("organizationId", organizationId).eq("document", document)).take(3);
      for (const party of parties) rndcThirdParties.push(`${party.documentType} ${party.document} ${party.name}`);
    }

    if (!dryRun) {
      if (Object.keys(filled).length > 0) await ctx.db.patch("customers", keep._id, { ...filled, updatedAt: now });
      await ctx.db.delete("customers", remove._id);
      await ctx.db.insert("auditEvents", {
        organizationId,
        actorType: "system",
        action: "customer.merged",
        entityType: "customer",
        entityId: keep._id,
        reason: "Cliente duplicado",
        detailsJson: JSON.stringify({ removedId: remove._id, removedCode: remove.code, removedName: remove.name, removedIdentification: remove.identificationNumber }),
        createdAt: now
      });
    }

    return {
      dryRun,
      kept: `${keep.identificationNumber ?? "sin documento"} ${keep.name}`,
      removed: `${remove.identificationNumber ?? "sin documento"} ${remove.name}`,
      locationsMoved,
      locationsDropped,
      serviceOrders: orders.length,
      users: users.length,
      monitoringTrips: trips.length,
      securityStudies: studies.length,
      expedientes: expedientes.length,
      snapshots: snapshots.length,
      fieldsFilled: Object.keys(filled),
      rndcThirdParties
    };
  }
});

export const unlockRejectedRemesa = internalMutation({
  args: { operationId: v.id("rndcOperations"), actorId: v.id("users") },
  returns: v.object({ remesaNumber: v.optional(v.string()), documentNumber: v.optional(v.string()), businessKey: v.string() }),
  handler: async (ctx, args) => {
    const operation = await ctx.db.get("rndcOperations", args.operationId);
    if (!operation) throw new ConvexError("No existe la operación");
    const remesa = operation.expedienteRemesaId ? await ctx.db.get("expedienteRemesas", operation.expedienteRemesaId) : null;
    const document = operation.documentId ? await ctx.db.get("documents", operation.documentId) : null;
    const problem = rejectionUnlockProblem(operation, remesa, document);
    if (problem || !document) throw new ConvexError(problem ?? "No se encontró el documento");
    if (operation.operationType === "emit_manifest") {
      const expediente = operation.expedienteId ? await ctx.db.get("expedientes", operation.expedienteId) : null;
      if (!expediente || expediente.manifestDocumentId !== document._id) throw new ConvexError("El documento no es el manifiesto del despacho");
    }
    const actor = await ctx.db.get("users", args.actorId);
    if (!actor || actor.organizationId !== operation.organizationId) throw new ConvexError("Usuario inválido");
    const now = Date.now();
    const businessKey = archivedKey(operation.businessKey, operation._id);
    const requestKey = archivedKey(operation.requestKey, operation._id);
    await ctx.db.patch("rndcOperations", operation._id, { businessKey, requestKey, updatedAt: now });
    const keys = await ctx.db
      .query("rndcRequestKeys")
      .withIndex("by_organization_and_request_key", (q) => q.eq("organizationId", operation.organizationId).eq("requestKey", operation.requestKey))
      .collect();
    for (const key of keys) {
      if (key.operationId === operation._id) await ctx.db.patch("rndcRequestKeys", key._id, { requestKey });
    }
    if (remesa) await ctx.db.patch("expedienteRemesas", remesa._id, { officialState: "draft", updatedBy: actor._id, updatedAt: now });
    await ctx.db.patch("documents", document._id, { officialState: "draft", status: "draft", updatedAt: now });
    await appendAudit(ctx, {
      organizationId: operation.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "rndc_operation.rejection_unlocked",
      entityType: remesa ? "expediente_remesa" : "document",
      entityId: remesa ? remesa._id : document._id,
      reason: remesa ? "Rechazo del RNDC: se reabre la remesa para corregir y reenviar" : "Rechazo del RNDC: se reabre el manifiesto para corregir y reenviar",
      detailsJson: JSON.stringify({ operationId: operation._id, previousBusinessKey: operation.businessKey, businessKey }),
      createdAt: now
    });
    return { remesaNumber: remesa?.number, documentNumber: document.number, businessKey };
  }
});

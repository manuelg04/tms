import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { rememberMerchandiseProduct } from "./model/merchandiseProducts";

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

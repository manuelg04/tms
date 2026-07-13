import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { listRowValidator, toListRow } from "./expedientes";
import { requireActor } from "./model/access";
import {
  applyDispatchFilters,
  normalizeDispatchFilters,
  normalizeSearchText,
  type DispatchFilters
} from "./model/dispatchSearch";
import { syntheticDispatch, volumeCustomers, volumeRoutes } from "./model/volumeFixtures";

const filtersValidator = v.object({
  search: v.optional(v.string()),
  customer: v.optional(v.string()),
  plate: v.optional(v.string()),
  driver: v.optional(v.string()),
  origin: v.optional(v.string()),
  destination: v.optional(v.string()),
  stage: v.optional(v.string()),
  status: v.optional(v.string()),
  from: v.optional(v.string()),
  to: v.optional(v.string())
});

const paginationResultValidator = v.object({
  page: v.array(listRowValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
  splitCursor: v.optional(v.union(v.string(), v.null())),
  pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null()))
});

export const page = query({
  args: { actorToken: v.optional(v.string()), paginationOpts: paginationOptsValidator, filters: filtersValidator },
  returns: paginationResultValidator,
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    return await searchPage(ctx, actor.organizationId, args.paginationOpts, args.filters);
  }
});

export const exportPage = query({
  args: { actorToken: v.optional(v.string()), paginationOpts: paginationOptsValidator, filters: filtersValidator },
  returns: v.object({
    page: v.array(v.any()),
    isDone: v.boolean(),
    continueCursor: v.string()
  }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    const result = await searchPage(ctx, actor.organizationId, args.paginationOpts, args.filters);
    const records = await Promise.all(result.page.map((row) => toExportRecord(ctx, row.expediente, row)));
    return { page: records, isDone: result.isDone, continueCursor: result.continueCursor };
  }
});

export const rebuildSearchPage = mutation({
  args: { actorToken: v.optional(v.string()), cursor: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.object({ processed: v.number(), nextCursor: v.union(v.string(), v.null()), done: v.boolean() }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin"]);
    const result = await ctx.db
      .query("expedientes")
      .withIndex("by_organization_and_updated_at", (q) => q.eq("organizationId", actor.organizationId))
      .paginate({ cursor: args.cursor ?? null, numItems: Math.min(Math.max(args.limit ?? 100, 1), 200) });

    for (const expediente of result.page) {
      const row = await toListRow(ctx, expediente);
      await ctx.db.patch("expedientes", expediente._id, { searchText: searchTextForRow(row) });
    }

    return { processed: result.page.length, nextCursor: result.isDone ? null : result.continueCursor, done: result.isDone };
  }
});

export const seedVolumeBatch = mutation({
  args: {
    actorToken: v.optional(v.string()),
    batchId: v.string(),
    offset: v.number(),
    count: v.number(),
    baseTimestamp: v.number()
  },
  returns: v.object({ inserted: v.number(), existing: v.number() }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin"]);

    if (!Number.isInteger(args.offset) || args.offset < 0 || !Number.isInteger(args.count) || args.count < 1 || args.count > 200) {
      throw new Error("Offset and count must describe a batch of 1 to 200 rows");
    }

    const masters = await ensureVolumeMasters(ctx, actor.organizationId, actor._id, args.baseTimestamp);
    let inserted = 0;
    let existing = 0;

    for (let position = 0; position < args.count; position += 1) {
      const index = args.offset + position;
      const fixture = syntheticDispatch(args.batchId, index, args.baseTimestamp);
      const found = await ctx.db
        .query("expedientes")
        .withIndex("by_organization_and_code", (q) => q.eq("organizationId", actor.organizationId).eq("code", fixture.code))
        .unique();

      if (found) {
        existing += 1;
        continue;
      }

      const master = masters.get(`${index % volumeCustomers.length}:${index % volumeRoutes.length}`);

      if (!master) {
        throw new Error("Synthetic master data is incomplete");
      }

      const tripId = await ctx.db.insert("trips", {
        organizationId: actor.organizationId,
        code: fixture.code,
        status: fixture.status,
        originCity: fixture.originCity,
        destinationCity: fixture.destinationCity,
        vehiclePlate: fixture.vehiclePlate,
        driverName: fixture.driverName,
        createdAt: fixture.updatedAt,
        updatedAt: fixture.updatedAt
      });
      const expedienteId = await ctx.db.insert("expedientes", {
        organizationId: actor.organizationId,
        serviceOrderId: master.serviceOrderId,
        tripId,
        code: fixture.code,
        status: fixture.status,
        cargoNumber: fixture.orderNumber,
        manifestNumber: fixture.manifestNumber,
        agencyCode: "VOL",
        searchText: normalizeSearchText(fixture.searchText),
        loadingOrderDraft: {
          orderNumber: fixture.orderNumber,
          agencyCode: "VOL",
          customerId: master.customerId,
          sender: { name: fixture.customerName },
          recipient: { name: `Destino ${fixture.destinationCity}` },
          loading: { siteName: `Bodega ${fixture.originCity}`, address: "Dato sintético", cityName: fixture.originCity },
          unloading: { siteName: `Bodega ${fixture.destinationCity}`, address: "Dato sintético", cityName: fixture.destinationCity },
          cargoDescription: "Carga sintética de volumen",
          cargoQuantity: "1",
          cargoUnit: "UN",
          weightTons: "10",
          packagingCode: "PAQUETE",
          merchandiseCode: "SINTETICA",
          natureOfCargo: "Carga normal",
          driverFreight: "1000000",
          generatesConsignment: true
        },
        manifestDraft: {
          manifestNumber: fixture.manifestNumber,
          issueDate: day(fixture.updatedAt),
          estimatedDeliveryDate: day(fixture.updatedAt + 86_400_000),
          operationScope: "intermunicipal",
          manifestType: "General",
          agencyCode: "VOL",
          originCityName: fixture.originCity,
          destinationCityName: fixture.destinationCity,
          freightTotal: "1000000",
          advance: "300000",
          netPayable: "700000",
          paymentResponsible: "MTM"
        },
        createdBy: actor._id,
        updatedBy: actor._id,
        createdAt: fixture.updatedAt,
        updatedAt: fixture.updatedAt
      });
      await ctx.db.patch("trips", tripId, { expedienteId });
      inserted += 1;
    }

    return { inserted, existing };
  }
});

export const cleanupVolumeBatch = mutation({
  args: { actorToken: v.optional(v.string()), batchId: v.string(), limit: v.optional(v.number()), shard: v.optional(v.number()) },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin"]);
    const normalizedBatch = args.batchId.replace(/[^a-z0-9]/gi, "").toUpperCase() || "VOLUME";
    const prefix = `VOL-${normalizedBatch}-`;
    const shard = args.shard;

    if (shard !== undefined && (!Number.isInteger(shard) || shard < 0 || shard > 99)) {
      throw new Error("Cleanup shard must be an integer between 0 and 99");
    }

    const start = shard === undefined ? prefix : `${prefix}${String(shard).padStart(2, "0")}`;
    const end = shard === undefined || shard === 99 ? `${prefix}~` : `${prefix}${String(shard + 1).padStart(2, "0")}`;
    const selected = await ctx.db
      .query("expedientes")
      .withIndex("by_organization_and_code", (q) => q.eq("organizationId", actor.organizationId).gte("code", start).lt("code", end))
      .take(Math.min(Math.max(args.limit ?? 500, 1), 500));

    await Promise.all(selected.flatMap((expediente) => [
      ctx.db.delete("expedientes", expediente._id),
      ...(expediente.tripId ? [ctx.db.delete("trips", expediente.tripId)] : [])
    ]));

    return { deleted: selected.length };
  }
});

async function searchPage(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
  paginationOpts: { cursor: string | null; numItems: number },
  rawFilters: DispatchFilters
) {
  const filters = normalizeDispatchFilters(rawFilters);
  const searchQuery = normalizeSearchText([
    filters.search,
    filters.customer,
    filters.plate,
    filters.driver,
    filters.origin,
    filters.destination
  ].filter(Boolean).join(" "));
  const result = searchQuery
    ? await ctx.db
        .query("expedientes")
        .withSearchIndex("search_dispatches", (q) => q.search("searchText", searchQuery).eq("organizationId", organizationId))
        .paginate(paginationOpts)
    : await ctx.db
        .query("expedientes")
        .withIndex("by_organization_and_updated_at", (q) => q.eq("organizationId", organizationId))
        .order("desc")
        .paginate(paginationOpts);
  const rows = await Promise.all(result.page.map((expediente) => toListRow(ctx, expediente)));
  const filtered = applyDispatchFilters(rows.map((row) => ({
    ...row,
    id: row.expediente._id,
    code: row.expediente.code,
    updatedAt: row.expediente.updatedAt,
    searchText: searchTextForRow(row)
  })), filters);

  return { ...result, page: filtered.map(({ id, code, updatedAt, searchText, ...row }) => row) };
}

export function searchTextForRow(row: Awaited<ReturnType<typeof toListRow>>): string {
  return normalizeSearchText([
    row.expediente.code,
    row.serviceOrderCode,
    row.orderNumber,
    row.remesaNumbers.join(" "),
    row.manifestNumber,
    row.customerName,
    row.vehiclePlate,
    row.driverName,
    row.originCity,
    row.destinationCity,
    row.agencyCode
  ].filter(Boolean).join(" "));
}

async function toExportRecord(
  ctx: QueryCtx,
  expediente: Doc<"expedientes">,
  row: Awaited<ReturnType<typeof toListRow>>
) {
  const [remesas, documents, driver, vehicle, trailer] = await Promise.all([
    ctx.db.query("expedienteRemesas").withIndex("by_expediente_and_sequence", (q) => q.eq("expedienteId", expediente._id)).collect(),
    ctx.db.query("documents").withIndex("by_expediente", (q) => q.eq("expedienteId", expediente._id)).collect(),
    expediente.driverId ? ctx.db.get("drivers", expediente.driverId) : null,
    expediente.vehicleId ? ctx.db.get("vehicles", expediente.vehicleId) : null,
    expediente.trailerId ? ctx.db.get("trailers", expediente.trailerId) : null
  ]);
  const latestDocument = (kind: string) => documents
    .filter((document) => document.kind === kind)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  const orderDocument = latestDocument("orden_cargue");
  const manifestDocument = latestDocument("manifiesto");
  const order = expediente.loadingOrderDraft;
  const manifest = expediente.manifestDraft;
  const status = (document: Doc<"documents"> | undefined) => document?.officialState ?? document?.status ?? "draft";

  return {
    dispatchCode: expediente.code,
    updatedAt: expediente.updatedAt,
    customerName: row.customerName,
    originCity: row.originCity,
    destinationCity: row.destinationCity,
    agencyCode: expediente.agencyCode,
    order: order ? {
      number: order.orderNumber ?? expediente.cargoNumber,
      issuedAt: order.minLoadingDate,
      vehiclePlate: vehicle?.plate,
      agencyCity: order.loading?.cityName,
      senderName: order.sender?.name,
      cargoDescription: order.cargoDescription,
      localStatus: status(orderDocument),
      printStatus: order.printedAt ? "Impreso" : "Sin imprimir",
      createdAt: dateTime(expediente.createdAt),
      annulledAt: orderDocument?.officialState === "annulled" ? dateTime(orderDocument.updatedAt) : ""
    } : undefined,
    consignments: remesas.map((remesa) => {
      const document = remesa.documentId ? documents.find((candidate) => candidate._id === remesa.documentId) : undefined;
      const effective = remesa.draft;
      return {
        number: remesa.number,
        reference: effective?.remissions?.map((item) => item.remissionNumber).filter(Boolean).join(", "),
        rndcNumber: document?.rndcRadicado,
        orderNumber: order?.orderNumber ?? expediente.cargoNumber,
        pickupAppointment: effective?.loading?.appointmentAt ? dateTime(effective.loading.appointmentAt) : undefined,
        deliveryAppointment: effective?.unloading?.appointmentAt ? dateTime(effective.unloading.appointmentAt) : undefined,
        quantity: effective?.remissions?.map((item) => item.quantity).filter(Boolean).join(", ") ?? String(remesa.cargoQuantity ?? ""),
        weightKg: remesa.cargoWeightKg === undefined ? undefined : String(remesa.cargoWeightKg),
        declaredValue: effective?.declaredValue,
        insurancePolicy: effective?.policyNumber,
        localStatus: remesa.officialState,
        printStatus: effective?.printedAt ? "Impreso" : "Sin imprimir",
        loadingRadicado: document?.rndcRadicado,
        unloadingRadicado: document?.fulfillmentState === "fulfilled" ? document.issuanceRadicado ?? document.rndcRadicado : undefined,
        driverDocument: driver?.document,
        driverPhone: driver?.cellphone ?? driver?.phone1
      };
    }),
    manifest: manifest ? {
      internalNumber: manifest.manifestNumber ?? expediente.manifestNumber,
      rndcNumber: manifestDocument?.rndcRadicado,
      type: manifest.manifestType,
      issuedAt: manifest.issueDate,
      dueAt: manifest.estimatedDeliveryDate,
      route: `${manifest.originCityName ?? row.originCity} → ${manifest.destinationCityName ?? row.destinationCity}`,
      originCode: manifest.originMunicipalityCode,
      destinationCode: manifest.destinationMunicipalityCode,
      vehiclePlate: vehicle?.plate,
      trailerPlate: trailer?.plate,
      consignmentNumbers: remesas.flatMap((remesa) => remesa.number ? [remesa.number] : []),
      freight: manifest.freightTotal,
      advance: manifest.advance,
      netPay: manifest.netPayable,
      localStatus: status(manifestDocument),
      printStatus: manifest.printedAt ? "Impreso" : "Sin imprimir",
      filingNumber: manifestDocument?.issuanceRadicado ?? manifestDocument?.rndcRadicado,
      annulmentNumber: manifestDocument?.officialState === "annulled" ? manifestDocument.rndcRadicado : undefined,
      fulfillmentNumber: manifestDocument?.fulfillmentState === "fulfilled" ? manifestDocument.rndcRadicado : undefined,
      driverDocument: driver?.document,
      driverPhone: driver?.cellphone ?? driver?.phone1,
      driverLicense: driver?.licenseNumber,
      vehicleSoat: undefined
    } : undefined
  };
}

async function ensureVolumeMasters(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  actorId: Id<"users">,
  now: number
): Promise<Map<string, { customerId: Id<"customers">; serviceOrderId: Id<"serviceOrders"> }>> {
  const masters = new Map<string, { customerId: Id<"customers">; serviceOrderId: Id<"serviceOrders"> }>();

  for (let customerIndex = 0; customerIndex < volumeCustomers.length; customerIndex += 1) {
    const customerCode = `VOL-CUST-${customerIndex}`;
    let customer = await ctx.db
      .query("customers")
      .withIndex("by_organization_and_code", (q) => q.eq("organizationId", organizationId).eq("code", customerCode))
      .unique();

    if (!customer) {
      const customerId = await ctx.db.insert("customers", {
        organizationId,
        code: customerCode,
        name: volumeCustomers[customerIndex],
        status: "active",
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: now,
        updatedAt: now
      });
      customer = await ctx.db.get("customers", customerId);
    }

    if (!customer) {
      throw new Error("Could not create synthetic customer");
    }

    for (let routeIndex = 0; routeIndex < volumeRoutes.length; routeIndex += 1) {
      const [originCity, destinationCity] = volumeRoutes[routeIndex];
      const loading = await ensureLocation(ctx, organizationId, customer._id, actorId, `VOL-O-${routeIndex}`, originCity, "loading", now);
      const unloading = await ensureLocation(ctx, organizationId, customer._id, actorId, `VOL-D-${routeIndex}`, destinationCity, "unloading", now);
      const orderCode = `VOL-SO-${customerIndex}-${routeIndex}`;
      let order = await ctx.db
        .query("serviceOrders")
        .withIndex("by_organization_and_code", (q) => q.eq("organizationId", organizationId).eq("code", orderCode))
        .unique();

      if (!order) {
        const orderId = await ctx.db.insert("serviceOrders", {
          organizationId,
          code: orderCode,
          customerId: customer._id,
          loadingLocationId: loading,
          unloadingLocationId: unloading,
          status: "confirmed",
          cargoDescription: "Carga sintética de volumen",
          cargoQuantity: 1,
          cargoUnit: "UN",
          cargoWeightKg: 10_000,
          agreedRate: 1_000_000,
          currency: "COP",
          createdBy: actorId,
          updatedBy: actorId,
          createdAt: now,
          updatedAt: now
        });
        order = await ctx.db.get("serviceOrders", orderId);
      }

      if (!order) {
        throw new Error("Could not create synthetic service order");
      }

      masters.set(`${customerIndex}:${routeIndex}`, { customerId: customer._id, serviceOrderId: order._id });
    }
  }

  return masters;
}

async function ensureLocation(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  customerId: Id<"customers">,
  actorId: Id<"users">,
  code: string,
  city: string,
  kind: "loading" | "unloading",
  now: number
): Promise<Id<"customerLocations">> {
  const existing = await ctx.db
    .query("customerLocations")
    .withIndex("by_customer_and_code", (q) => q.eq("customerId", customerId).eq("code", code))
    .unique();

  if (existing) {
    return existing._id;
  }

  return await ctx.db.insert("customerLocations", {
    organizationId,
    customerId,
    code,
    name: `Bodega ${city}`,
    kind,
    address: "Dato sintético",
    city,
    status: "active",
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: now,
    updatedAt: now
  });
}

function day(value: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(value);
}

function dateTime(value: number): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(value);
}

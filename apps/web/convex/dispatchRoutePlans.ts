import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  appendAudit,
  requireActor,
  requireSameOrganization,
} from "./model/access";
import { dispatchPlanDoc } from "./model/routeValidators";
import { operationalRouteStops, routeSchedule } from "./model/routes";
import { automaticRouteChoice, bogotaDeparture, tripRouteCandidates } from "./model/routePlanAutomation";
import { readMasterAttachments, storeMasterAttachment } from "./model/fleetRecords";
import { expedienteRoute } from "./model/tripRouteRecords";

const readers = ["admin", "operator", "auditor"] as const;
const writers = ["admin", "operator"] as const;
const optionLimit = 60;

const cityKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, "")
    .trim()
    .toUpperCase();

const routeOption = v.object({
  _id: v.id("operationalRoutes"),
  code: v.string(),
  origin: v.string(),
  destination: v.string(),
  via: v.string(),
  revision: v.number(),
  stopCount: v.number(),
});

const sheet = v.object({
  organizationName: v.string(),
  dispatchCode: v.string(),
  manifestNumber: v.string(),
  origin: v.string(),
  destination: v.string(),
  vehicle: v.object({
    plate: v.string(),
    make: v.string(),
    modelYear: v.string(),
    color: v.string(),
    bodyType: v.string(),
    line: v.string(),
    trailerPlate: v.string(),
  }),
  driver: v.object({
    name: v.string(),
    document: v.string(),
    licenseNumber: v.string(),
    licenseCategory: v.string(),
    phone: v.string(),
  }),
});

export const forDispatch = query({
  args: { expedienteId: v.id("expedientes") },
  returns: v.union(
    v.null(),
    v.object({
      plan: v.union(dispatchPlanDoc, v.null()),
      sheet,
      canAssign: v.boolean(),
      photos: v.object({
        vehicle: v.union(v.string(), v.null()),
        driver: v.union(v.string(), v.null()),
        hasVehicle: v.boolean(),
        hasDriver: v.boolean(),
      }),
    }),
  ),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...readers]);
    const expediente = await ctx.db.get("expedientes", args.expedienteId);
    if (!expediente) return null;
    requireSameOrganization(actor, expediente.organizationId);
    const order = await ctx.db.get("serviceOrders", expediente.serviceOrderId);
    const [organization, loading, unloading, driver, vehicle, trailer, plan] =
      await Promise.all([
        ctx.db.get("organizations", expediente.organizationId),
        order ? ctx.db.get("customerLocations", order.loadingLocationId) : null,
        order
          ? ctx.db.get("customerLocations", order.unloadingLocationId)
          : null,
        expediente.driverId ? ctx.db.get("drivers", expediente.driverId) : null,
        expediente.vehicleId
          ? ctx.db.get("vehicles", expediente.vehicleId)
          : null,
        expediente.trailerId
          ? ctx.db.get("trailers", expediente.trailerId)
          : null,
        ctx.db
          .query("dispatchRoutePlans")
          .withIndex("by_expediente", (q) =>
            q.eq("expedienteId", expediente._id),
          )
          .order("desc")
          .first(),
      ]);
    const tripNow = await currentRoute(ctx, expediente, loading, unloading);
    const driverName =
      driver?.name ||
      [driver?.firstNames, driver?.firstLastName, driver?.secondLastName]
        .filter(Boolean)
        .join(" ");
    const [vehiclePhotos, driverPhotos] = await Promise.all([
      vehicle ? readMasterAttachments(ctx, expediente.organizationId, "vehicle", vehicle._id) : [],
      driver ? readMasterAttachments(ctx, expediente.organizationId, "driver", driver._id) : [],
    ]);
    const vehiclePhoto =
      ["front", "left", "right", "rear"]
        .map((slot) => vehiclePhotos.find((photo) => photo.slot === slot))
        .find(Boolean)?.url ?? null;
    const driverPhoto = driverPhotos.find((photo) => photo.slot === "profile")?.url ?? null;
    return {
      plan,
      photos: {
        vehicle: vehiclePhoto,
        driver: driverPhoto,
        hasVehicle: Boolean(vehicle),
        hasDriver: Boolean(driver),
      },
      canAssign: actor.roles.some((role) =>
        writers.includes(role as (typeof writers)[number]),
      ),
      sheet: {
        organizationName: organization?.name ?? "",
        dispatchCode: expediente.code,
        manifestNumber: expediente.manifestNumber ?? "",
        origin: plan?.origin ?? tripNow.origin.city ?? "",
        destination: plan?.destination ?? tripNow.destination.city ?? "",
        vehicle: {
          plate: vehicle?.plate ?? "",
          make: vehicle?.make ?? "",
          modelYear: vehicle?.modelYear ?? "",
          color: vehicle?.color ?? "",
          bodyType: vehicle?.bodyType ?? "",
          line: vehicle?.line ?? "",
          trailerPlate: trailer?.plate ?? vehicle?.trailer ?? "",
        },
        driver: {
          name: driverName,
          document: driver?.document ?? "",
          licenseNumber: driver?.licenseNumber ?? driver?.document ?? "",
          licenseCategory: driver?.licenseCategory ?? "",
          phone: driver?.cellphone ?? driver?.phone1 ?? "",
        },
      },
    };
  },
});

export const routeOptions = query({
  args: { origin: v.string(), destination: v.string(), search: v.string() },
  returns: v.object({
    routes: v.array(routeOption),
    matchesTrip: v.boolean(),
    truncated: v.boolean(),
    suggestedRouteId: v.union(v.id("operationalRoutes"), v.null()),
  }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...readers]);
    const routes = (
      await ctx.db
        .query("operationalRoutes")
        .withIndex("by_org_code", (q) =>
          q.eq("organizationId", actor.organizationId),
        )
        .collect()
    ).filter((route) => route.active);
    const search = cityKey(args.search);
    const forTrip = tripRouteCandidates(routes, args.origin, args.destination);
    const lastUsed = forTrip.length > 1 ? await lastUsedRouteId(ctx, actor.organizationId, forTrip) : null;
    const matchesTrip = !search && forTrip.length > 0;
    const selected = search
      ? routes.filter((route) =>
          cityKey(
            `${route.code} ${route.origin} ${route.destination} ${route.via}`,
          ).includes(search),
        )
      : matchesTrip
        ? forTrip
        : routes;
    return {
      matchesTrip,
      suggestedRouteId: matchesTrip ? automaticRouteChoice(forTrip, lastUsed).suggestedRouteId : null,
      truncated: selected.length > optionLimit,
      routes: selected.slice(0, optionLimit).map((route) => ({
        _id: route._id,
        code: route.code,
        origin: route.origin,
        destination: route.destination,
        via: route.via,
        revision: route.revision,
        stopCount: route.stops.length,
      })),
    };
  },
});

export const assign = mutation({
  args: {
    expedienteId: v.id("expedientes"),
    routeId: v.id("operationalRoutes"),
    departureAt: v.string(),
    expectedRouteRevision: v.number(),
    requestKey: v.string(),
  },
  returns: v.id("dispatchRoutePlans"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...writers]);
    const [expediente, route] = await Promise.all([
      ctx.db.get("expedientes", args.expedienteId),
      ctx.db.get("operationalRoutes", args.routeId),
    ]);
    if (!expediente || !route)
      throw new ConvexError("Ruta o despacho no disponibles.");
    requireSameOrganization(actor, expediente.organizationId);
    requireSameOrganization(actor, route.organizationId);
    const requestKey = args.requestKey.trim();
    if (!requestKey || requestKey.length > 100)
      throw new ConvexError("Solicitud inválida.");
    const previous = await ctx.db
      .query("dispatchRoutePlans")
      .withIndex("by_expediente", (q) => q.eq("expedienteId", expediente._id))
      .collect();
    const replay = previous.find((plan) => plan.requestKey === requestKey);
    if (replay) {
      if (
        replay.routeId !== route._id ||
        replay.departureAt !== args.departureAt
      )
        throw new ConvexError("La solicitud ya fue usada para otro plan.");
      return replay._id;
    }
    if (route.revision !== args.expectedRouteRevision)
      throw new ConvexError(
        "La ruta cambió. Actualiza la pantalla antes de asignarla.",
      );
    if (!route.active) throw new ConvexError("La ruta debe estar activa.");
    const id = await createPlan(ctx, {
      expediente,
      route,
      departureAt: args.departureAt,
      createdBy: actor._id,
      requestKey,
      previous,
    });
    await appendAudit(ctx, {
      organizationId: actor.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "dispatch.route.plan.assigned",
      entityType: "dispatchRoutePlans",
      entityId: id,
    });
    return id;
  },
});

export const attachPhoto = mutation({
  args: {
    expedienteId: v.id("expedientes"),
    target: v.union(v.literal("vehicle"), v.literal("driver")),
    photo: v.object({ storageId: v.id("_storage"), fileName: v.string() }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...writers]);
    const expediente = await ctx.db.get("expedientes", args.expedienteId);
    if (!expediente) throw new ConvexError("Despacho no disponible.");
    requireSameOrganization(actor, expediente.organizationId);
    const resourceId = args.target === "vehicle" ? expediente.vehicleId : expediente.driverId;
    if (!resourceId)
      throw new ConvexError(
        args.target === "vehicle" ? "El despacho no tiene vehículo asignado." : "El despacho no tiene conductor asignado.",
      );
    await storeMasterAttachment(
      ctx,
      actor,
      args.target,
      resourceId,
      args.target === "vehicle" ? "front" : "profile",
      args.photo,
      Date.now(),
    );
    await appendAudit(ctx, {
      organizationId: actor.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "dispatch.route.plan.photo_attached",
      entityType: args.target,
      entityId: resourceId,
    });
    return null;
  },
});

export const ensureAutomatic = mutation({
  args: { expedienteId: v.id("expedientes") },
  returns: v.object({
    status: v.union(
      v.literal("created"),
      v.literal("exists"),
      v.literal("needs_choice"),
      v.literal("no_route"),
      v.literal("not_ready"),
      v.literal("blocked"),
    ),
    message: v.string(),
  }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...writers]);
    const expediente = await ctx.db.get("expedientes", args.expedienteId);
    if (!expediente) throw new ConvexError("Despacho no disponible.");
    requireSameOrganization(actor, expediente.organizationId);
    const previous = await ctx.db
      .query("dispatchRoutePlans")
      .withIndex("by_expediente", (q) => q.eq("expedienteId", expediente._id))
      .collect();
    if (previous.length)
      return { status: "exists" as const, message: "El despacho ya tiene plan de ruta." };
    const documents = await ctx.db
      .query("documents")
      .withIndex("by_expediente", (q) => q.eq("expedienteId", expediente._id))
      .take(100);
    const official = (kind: string) =>
      documents.some(
        (document) =>
          document.kind === kind &&
          (document.officialState === "authorized" || document.officialState === "fulfilled"),
      );
    if (!official("remesa") || !official("manifiesto"))
      return { status: "not_ready" as const, message: "El plan de ruta se genera cuando la remesa y el manifiesto están aceptados." };
    const order = await ctx.db.get("serviceOrders", expediente.serviceOrderId);
    const [loading, unloading] = await Promise.all([
      order ? ctx.db.get("customerLocations", order.loadingLocationId) : null,
      order ? ctx.db.get("customerLocations", order.unloadingLocationId) : null,
    ]);
    const routes = (
      await ctx.db
        .query("operationalRoutes")
        .withIndex("by_org_code", (q) => q.eq("organizationId", actor.organizationId))
        .collect()
    ).filter((route) => route.active);
    const tripNow = await currentRoute(ctx, expediente, loading, unloading);
    const candidates = tripRouteCandidates(
      routes,
      { city: tripNow.origin.city ?? "", code: tripNow.origin.code },
      { city: tripNow.destination.city ?? "", code: tripNow.destination.code },
    );
    const choice = automaticRouteChoice(candidates, null);
    if (choice.status === "none")
      return { status: "no_route" as const, message: "No hay una ruta activa para el origen y destino del despacho." };
    if (choice.status === "several")
      return { status: "needs_choice" as const, message: "Hay varias rutas para este trayecto; elige una en el despacho." };
    const route = candidates[0];
    try {
      await createPlan(ctx, {
        expediente,
        route,
        departureAt: bogotaDeparture(Date.now()),
        createdBy: actor._id,
        requestKey: `auto:${expediente._id}`,
        previous,
      });
    } catch (error) {
      return {
        status: "blocked" as const,
        message: error instanceof ConvexError && typeof error.data === "string" ? error.data : "La ruta tiene datos incompletos.",
      };
    }
    await appendAudit(ctx, {
      organizationId: actor.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "dispatch.route.plan.generated",
      entityType: "expediente",
      entityId: expediente._id,
      detailsJson: JSON.stringify({ routeCode: route.code }),
    });
    return { status: "created" as const, message: `Plan de ruta generado con la ruta ${route.code}.` };
  },
});

async function lastUsedRouteId(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
  candidates: Doc<"operationalRoutes">[],
): Promise<Id<"operationalRoutes"> | null> {
  const ids = new Set(candidates.map((route) => route._id));
  const recent = await ctx.db
    .query("dispatchRoutePlans")
    .withIndex("by_organization_and_created_at", (q) => q.eq("organizationId", organizationId))
    .order("desc")
    .take(300);
  return recent.find((plan) => ids.has(plan.routeId))?.routeId ?? null;
}

async function createPlan(
  ctx: MutationCtx,
  input: {
    expediente: Doc<"expedientes">;
    route: Doc<"operationalRoutes">;
    departureAt: string;
    createdBy: Id<"users">;
    requestKey: string;
    previous: Doc<"dispatchRoutePlans">[];
  },
): Promise<Id<"dispatchRoutePlans">> {
  const { expediente, route } = input;
  let operationalStops;
  try {
    operationalStops = operationalRouteStops(route.stops, route.source);
    routeSchedule(input.departureAt, 0);
  } catch (error) {
    throw new ConvexError(
      `Revisa la salida y los tiempos de la ruta antes de asignarla: ${error instanceof Error ? error.message : "Datos incompletos."}`,
    );
  }
  const stops = [];
  for (const stop of operationalStops) {
    const point =
      stop.pointCode === "9999"
        ? null
        : await ctx.db
            .query("operationalPoints")
            .withIndex("by_org_code", (q) =>
              q.eq("organizationId", expediente.organizationId).eq("code", stop.pointCode),
            )
            .unique();
    if (stop.pointCode !== "9999" && (!point || !point.active))
      throw new ConvexError(`El puesto ${stop.pointCode} no está activo.`);
    stops.push({
      key: stop.key,
      code: stop.pointCode,
      label: point?.name ?? "Lugar Entrega",
      kind: point
        ? point.virtual
          ? ("virtual" as const)
          : ("physical" as const)
        : ("delivery" as const),
      minutes: stop.minutes,
      kilometers: stop.kilometers,
      scheduledAt: routeSchedule(input.departureAt, stop.minutes),
      controller: point?.controller ?? "",
      address: point?.address ?? "",
      phone: point?.phone ?? "",
    });
  }
  for (const plan of input.previous) await ctx.db.delete("dispatchRoutePlans", plan._id);
  return await ctx.db.insert("dispatchRoutePlans", {
    organizationId: expediente.organizationId,
    expedienteId: expediente._id,
    routeId: route._id,
    routeCode: route.code,
    routeRevision: route.revision,
    origin: route.origin,
    originCode: route.originCode,
    destination: route.destination,
    destinationCode: route.destinationCode,
    via: route.via,
    departureAt: input.departureAt,
    stops,
    createdAt: Date.now(),
    createdBy: input.createdBy,
    requestKey: input.requestKey,
  });
}

async function currentRoute(
  ctx: Pick<QueryCtx, "db">,
  expediente: Doc<"expedientes">,
  loading: Doc<"customerLocations"> | null,
  unloading: Doc<"customerLocations"> | null,
) {
  const remesas = await ctx.db
    .query("expedienteRemesas")
    .withIndex("by_expediente_and_sequence", (q) => q.eq("expedienteId", expediente._id))
    .collect();
  return expedienteRoute(expediente, remesas, { loading, unloading });
}

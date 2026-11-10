import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  appendAudit,
  requireActor,
  requireSameOrganization,
} from "./model/access";
import { dispatchPlanDoc } from "./model/routeValidators";
import { operationalRouteStops, routeSchedule } from "./model/routes";

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
    const driverName =
      driver?.name ||
      [driver?.firstNames, driver?.firstLastName, driver?.secondLastName]
        .filter(Boolean)
        .join(" ");
    return {
      plan,
      canAssign: actor.roles.some((role) =>
        writers.includes(role as (typeof writers)[number]),
      ),
      sheet: {
        organizationName: organization?.name ?? "",
        dispatchCode: expediente.code,
        manifestNumber: expediente.manifestNumber ?? "",
        origin: plan?.origin ?? loading?.city ?? "",
        destination: plan?.destination ?? unloading?.city ?? "",
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
    const origin = cityKey(args.origin.split(",")[0] ?? "");
    const destination = cityKey(args.destination.split(",")[0] ?? "");
    const forTrip =
      origin && destination
        ? routes.filter(
            (route) =>
              cityKey(route.origin).includes(origin) &&
              cityKey(route.destination).includes(destination),
          )
        : [];
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
    let operationalStops;
    try {
      operationalStops = operationalRouteStops(route.stops, route.source);
      routeSchedule(args.departureAt, 0);
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
                q
                  .eq("organizationId", actor.organizationId)
                  .eq("code", stop.pointCode),
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
        scheduledAt: routeSchedule(args.departureAt, stop.minutes),
        controller: point?.controller ?? "",
        address: point?.address ?? "",
        phone: point?.phone ?? "",
      });
    }
    for (const plan of previous)
      await ctx.db.delete("dispatchRoutePlans", plan._id);
    const id = await ctx.db.insert("dispatchRoutePlans", {
      organizationId: actor.organizationId,
      expedienteId: expediente._id,
      routeId: route._id,
      routeCode: route.code,
      routeRevision: route.revision,
      origin: route.origin,
      originCode: route.originCode,
      destination: route.destination,
      destinationCode: route.destinationCode,
      via: route.via,
      departureAt: args.departureAt,
      stops,
      createdAt: Date.now(),
      createdBy: actor._id,
      requestKey,
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

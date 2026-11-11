import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  appendAudit,
  requireActor,
  requireSameOrganization,
} from "./model/access";
import {
  pointDoc,
  pointInput,
  routeDoc,
  routeInput,
  planDoc,
} from "./model/routeValidators";
import {
  operationalRouteStops,
  routeName,
  routeSchedule,
  validateRouteStops,
} from "./model/routes";

const readers = ["admin", "operator", "auditor"] as const;
const writers = ["admin", "operator"] as const;
const source = v.union(v.literal("avansat"), v.literal("tms"));
function required(value: string, label: string) {
  const text = value.trim();
  if (!text || text.length > 250)
    throw new ConvexError(`${label}: indica entre 1 y 250 caracteres.`);
  return text;
}
function sourceText(value: string, label: string, source: "avansat" | "tms") {
  const normalized = required(value, label);
  return source === "avansat" ? value : normalized;
}
function revision(existing: { revision: number } | null, expected: number) {
  if ((existing?.revision ?? 0) !== expected)
    throw new ConvexError(
      "El registro cambió. Actualiza la pantalla antes de guardar.",
    );
}
async function audit(
  ctx: MutationCtx,
  actor: Doc<"users">,
  action: string,
  entityType: string,
  entityId: string,
) {
  await appendAudit(ctx, {
    organizationId: actor.organizationId,
    actorType: "user",
    actorId: actor._id,
    action,
    entityType,
    entityId,
  });
}

export const catalogue = query({
  args: {},
  returns: v.object({
    points: v.array(pointDoc),
    routes: v.array(routeDoc),
    canEdit: v.boolean(),
  }),
  handler: async (ctx) => {
    const actor = await requireActor(ctx, undefined, [...readers]);
    const [points, routes] = await Promise.all([
      ctx.db
        .query("operationalPoints")
        .withIndex("by_org_code", (q) =>
          q.eq("organizationId", actor.organizationId),
        )
        .collect(),
      ctx.db
        .query("operationalRoutes")
        .withIndex("by_org_code", (q) =>
          q.eq("organizationId", actor.organizationId),
        )
        .collect(),
    ]);
    return {
      points,
      routes,
      canEdit: actor.roles.some((r) =>
        writers.includes(r as (typeof writers)[number]),
      ),
    };
  },
});

function canWrite(actor: Doc<"users">) {
  return actor.roles.some((r) =>
    writers.includes(r as (typeof writers)[number]),
  );
}

export const routeSummaries = query({
  args: {},
  returns: v.object({
    routes: v.array(
      v.object({
        _id: v.id("operationalRoutes"),
        code: v.string(),
        origin: v.string(),
        destination: v.string(),
        via: v.string(),
        active: v.boolean(),
        source,
        stopCount: v.number(),
      }),
    ),
    canEdit: v.boolean(),
  }),
  handler: async (ctx) => {
    const actor = await requireActor(ctx, undefined, [...readers]);
    const routes = await ctx.db
      .query("operationalRoutes")
      .withIndex("by_org_code", (q) =>
        q.eq("organizationId", actor.organizationId),
      )
      .collect();
    return {
      routes: routes.map((r) => ({
        _id: r._id,
        code: r.code,
        origin: r.origin,
        destination: r.destination,
        via: r.via,
        active: r.active,
        source: r.source,
        stopCount: r.stops.length,
      })),
      canEdit: canWrite(actor),
    };
  },
});

export const points = query({
  args: {},
  returns: v.object({ points: v.array(pointDoc), canEdit: v.boolean() }),
  handler: async (ctx) => {
    const actor = await requireActor(ctx, undefined, [...readers]);
    const points = await ctx.db
      .query("operationalPoints")
      .withIndex("by_org_code", (q) =>
        q.eq("organizationId", actor.organizationId),
      )
      .collect();
    return { points, canEdit: canWrite(actor) };
  },
});

export const route = query({
  args: { routeId: v.id("operationalRoutes") },
  returns: v.union(routeDoc, v.null()),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...readers]);
    const route = await ctx.db.get("operationalRoutes", args.routeId);
    if (!route || route.organizationId !== actor.organizationId) return null;
    return route;
  },
});

export const savePoint = mutation({
  args: { ...pointInput, expectedRevision: v.number(), source },
  returns: v.id("operationalPoints"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...writers]);
    const code = required(args.code, "Código");
    if (code === "9999" || code === "-")
      throw new ConvexError("9999 está reservado para Lugar Entrega.");
    for (const [value, min, max, label] of [
      [args.latitude, -90, 90, "Latitud"],
      [args.longitude, -180, 180, "Longitud"],
      [args.altitude, -500, 10000, "Altitud"],
      [args.temperature, -100, 100, "Temperatura"],
    ] as const) {
      if (
        typeof value === "string" &&
        args.source === "avansat" &&
        value.length <= 80
      )
        continue;
      if (
        value !== undefined &&
        (typeof value !== "number" ||
          !Number.isFinite(value) ||
          value < min ||
          value > max)
      )
        throw new ConvexError(`${label} fuera de rango.`);
    }
    if (
      args.source === "tms" &&
      (args.latitude === undefined) !== (args.longitude === undefined)
    )
      throw new ConvexError("Indica ambas coordenadas o deja ambas vacías.");
    const existing = await ctx.db
      .query("operationalPoints")
      .withIndex("by_org_code", (q) =>
        q.eq("organizationId", actor.organizationId).eq("code", code),
      )
      .unique();
    revision(existing, args.expectedRevision);
    if (existing && existing.source !== args.source)
      throw new ConvexError("Conserva la fuente original del puesto.");
    const { expectedRevision, ...input } = args;
    const data = {
      ...input,
      code,
      name: sourceText(args.name, "Nombre", args.source),
      city:
        args.source === "avansat" ? args.city : required(args.city, "Ciudad"),
      cityCode:
        args.source === "avansat"
          ? args.cityCode
          : required(args.cityCode, "Código de ciudad"),
      organizationId: actor.organizationId,
      revision: expectedRevision + 1,
      updatedAt: Date.now(),
    };
    const id = existing
      ? existing._id
      : await ctx.db.insert("operationalPoints", data);
    if (existing) await ctx.db.replace("operationalPoints", id, data);
    await audit(ctx, actor, "route.point.saved", "operationalPoints", id);
    return id;
  },
});

export const saveRoute = mutation({
  args: { ...routeInput, expectedRevision: v.number(), source },
  returns: v.id("operationalRoutes"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...writers]);
    const code = required(args.code, "Código");
    validateRouteStops(args.stops, args.source);
    for (const stop of args.stops) {
      if (stop.pointCode === "9999") continue;
      const point = await ctx.db
        .query("operationalPoints")
        .withIndex("by_org_code", (q) =>
          q
            .eq("organizationId", actor.organizationId)
            .eq("code", stop.pointCode),
        )
        .unique();
      if (!point)
        throw new ConvexError(
          `No existe el puesto ${stop.pointCode} en esta empresa.`,
        );
    }
    const existing = await ctx.db
      .query("operationalRoutes")
      .withIndex("by_org_code", (q) =>
        q.eq("organizationId", actor.organizationId).eq("code", code),
      )
      .unique();
    revision(existing, args.expectedRevision);
    if (existing && existing.source !== args.source)
      throw new ConvexError("Conserva la fuente original de la ruta.");
    const { expectedRevision, ...input } = args;
    const data = {
      ...input,
      code,
      origin: sourceText(args.origin, "Origen", args.source),
      originCode:
        args.source === "avansat"
          ? args.originCode
          : required(args.originCode, "Código origen"),
      destination: sourceText(args.destination, "Destino", args.source),
      destinationCode:
        args.source === "avansat"
          ? args.destinationCode
          : required(args.destinationCode, "Código destino"),
      organizationId: actor.organizationId,
      revision: expectedRevision + 1,
      updatedAt: Date.now(),
    };
    const id = existing
      ? existing._id
      : await ctx.db.insert("operationalRoutes", data);
    if (existing) await ctx.db.replace("operationalRoutes", id, data);
    await audit(ctx, actor, "route.saved", "operationalRoutes", id);
    return id;
  },
});

export const plan = query({
  args: { dispatchId: v.id("trackingDispatches") },
  returns: v.union(planDoc, v.null()),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...readers]);
    const dispatch = await ctx.db.get("trackingDispatches", args.dispatchId);
    if (!dispatch) throw new ConvexError("Despacho no disponible.");
    requireSameOrganization(actor, dispatch.organizationId);
    return dispatch.routePlanId
      ? await ctx.db.get("routePlans", dispatch.routePlanId)
      : null;
  },
});

export const assignPlan = mutation({
  args: {
    dispatchId: v.id("trackingDispatches"),
    routeId: v.id("operationalRoutes"),
    departureAt: v.string(),
    expectedRevision: v.number(),
    expectedRouteRevision: v.number(),
    requestKey: v.string(),
  },
  returns: v.id("routePlans"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...writers]);
    const dispatch = await ctx.db.get("trackingDispatches", args.dispatchId),
      route = await ctx.db.get("operationalRoutes", args.routeId);
    if (!dispatch || !route)
      throw new ConvexError("Ruta o despacho no disponibles.");
    requireSameOrganization(actor, dispatch.organizationId);
    requireSameOrganization(actor, route.organizationId);
    const plans = await ctx.db
      .query("routePlans")
      .withIndex("by_dispatch", (q) => q.eq("dispatchId", dispatch._id))
      .collect();
    const replay = plans.find((p) => p.requestKey === args.requestKey);
    if (replay) {
      if (
        replay.routeId !== route._id ||
        replay.departureAt !== args.departureAt ||
        replay.routeRevision !== args.expectedRouteRevision
      )
        throw new ConvexError("La solicitud ya fue usada para otro plan.");
      return replay._id;
    }
    required(args.requestKey, "Solicitud");
    revision(dispatch, args.expectedRevision);
    revision(route, args.expectedRouteRevision);
    if (!route.active || dispatch.queue === "arrived")
      throw new ConvexError("La ruta debe estar activa y el despacho abierto.");
    const cityKey = (value: string) =>
      value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\([^)]*\)/g, "")
        .trim()
        .toUpperCase();
    const matchesCity = (actual: string, name: string, code: string) =>
      !actual ||
      cityKey(actual) === cityKey(name) ||
      actual.replace(/^0+/, "") === code.replace(/^0+/, "");
    if (
      !matchesCity(dispatch.summary.origin, route.origin, route.originCode) ||
      !matchesCity(
        dispatch.summary.destination,
        route.destination,
        route.destinationCode,
      )
    )
      throw new ConvexError(
        "La ruta debe coincidir con el origen y destino del despacho.",
      );
    const [checkpoints, reports] = await Promise.all([
      ctx.db
        .query("trackingCheckpoints")
        .withIndex("by_dispatch", (q) => q.eq("dispatchId", dispatch._id))
        .collect(),
      ctx.db
        .query("trackingReports")
        .withIndex("by_dispatch", (q) => q.eq("dispatchId", dispatch._id))
        .collect(),
    ]);
    if (
      checkpoints.some((c) => c.completed) ||
      reports.some((r) => r.checkpointId)
    )
      throw new ConvexError(
        "El plan ya tiene controles reportados; conserva su historial.",
      );
    const stops = [];
    let operationalStops;
    try {
      operationalStops = operationalRouteStops(route.stops, route.source);
    } catch (error) {
      throw new ConvexError(
        `Revisa los tiempos y el cierre de la ruta antes de asignarla: ${error instanceof Error ? error.message : "Datos incompletos."}`,
      );
    }
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
    const id = await ctx.db.insert("routePlans", {
      organizationId: actor.organizationId,
      dispatchId: dispatch._id,
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
      requestKey: args.requestKey,
    });
    for (const checkpoint of checkpoints)
      await ctx.db.delete("trackingCheckpoints", checkpoint._id);
    for (const [order, stop] of stops.entries())
      await ctx.db.insert("trackingCheckpoints", {
        organizationId: actor.organizationId,
        dispatchId: dispatch._id,
        key: `${id}:${stop.key}`,
        code: stop.code,
        label: stop.label,
        kind: stop.kind,
        scheduledAt: stop.scheduledAt,
        order,
        completed: false,
      });
    const fields = new Map(dispatch.information.map((f) => [f.label, f.value]));
    fields.set("Ruta", routeName(route));
    fields.set("Fecha Salida", args.departureAt.replace("T", " "));
    fields.set("Fecha Planeada Llegada", stops.at(-1)!.scheduledAt);
    await ctx.db.patch("trackingDispatches", dispatch._id, {
      routePlanId: id,
      summary: {
        ...dispatch.summary,
        origin: route.origin,
        destination: route.destination,
        departureDate: args.departureAt.slice(0, 10),
      },
      information: Array.from(fields, ([label, value]) => ({ label, value })),
      revision: dispatch.revision + 1,
      updatedAt: Date.now(),
    });
    await audit(ctx, actor, "route.plan.assigned", "routePlans", id);
    return id;
  },
});

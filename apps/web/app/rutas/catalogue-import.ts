import type { Infer } from "convex/values";
import { v } from "convex/values";
import { pointInput, routeInput } from "../../convex/model/routeValidators";
import { validateRouteStops } from "../../convex/model/routes";

export type PointInput = Infer<ReturnType<typeof pointValidator>>;
export type RouteInput = Infer<ReturnType<typeof routeValidator>>;
function pointValidator() {
  return v.object(pointInput);
}
function routeValidator() {
  return v.object(routeInput);
}
export type CatalogueImport = {
  version: 1;
  points: PointInput[];
  routes: RouteInput[];
};

export function parseCatalogueImport(text: string): CatalogueImport {
  const data = JSON.parse(text) as unknown;
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("El archivo debe contener un catálogo JSON.");
  const file = data as Record<string, unknown>;
  if (
    file.version !== 1 ||
    !Array.isArray(file.points) ||
    !Array.isArray(file.routes) ||
    file.points.length > 10000 ||
    file.routes.length > 10000
  )
    throw new Error("Usa el formato versión 1 con points y routes.");
  const points = file.points as PointInput[],
    routes = file.routes as RouteInput[];
  const codes = new Set<string>();
  for (const point of points) {
    if (
      !point ||
      typeof point !== "object" ||
      typeof point.code !== "string" ||
      !point.code.trim() ||
      codes.has(point.code) ||
      point.code === "9999" ||
      point.code === "-" ||
      typeof point.name !== "string" ||
      typeof point.city !== "string" ||
      typeof point.cityCode !== "string" ||
      typeof point.virtual !== "boolean" ||
      typeof point.active !== "boolean"
    )
      throw new Error(
        "Los puestos necesitan código único, nombre, ciudad, tipo y estado.",
      );
    if (
      [point.controller, point.address, point.phone].some(
        (value) => typeof value !== "string",
      )
    )
      throw new Error(
        "Incluye encargado, dirección y teléfono, aunque estén vacíos.",
      );
    for (const key of Object.keys(point))
      if (!Object.keys(pointInput).includes(key) || key === "photoId")
        throw new Error(`Campo de puesto no permitido: ${key}`);
    codes.add(point.code);
  }
  codes.clear();
  for (const route of routes) {
    if (
      !route ||
      typeof route !== "object" ||
      typeof route.code !== "string" ||
      !route.code.trim() ||
      codes.has(route.code) ||
      [
        route.origin,
        route.originCode,
        route.destination,
        route.destinationCode,
        route.via,
      ].some((value) => typeof value !== "string") ||
      typeof route.active !== "boolean" ||
      !Array.isArray(route.stops)
    )
      throw new Error("Ruta inválida o código de ruta repetido.");
    for (const key of Object.keys(route))
      if (!Object.keys(routeInput).includes(key))
        throw new Error(`Campo de ruta no permitido: ${key}`);
    validateRouteStops(route.stops, "avansat");
    codes.add(route.code);
  }
  return { version: 1, points, routes };
}

export function sameCatalogueRecord(
  current: Record<string, unknown>,
  input: Record<string, unknown>,
) {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, entry]) => [key, canonical(entry)]),
          )
        : value;
  return Object.entries(input).every(
    ([key, value]) =>
      JSON.stringify(canonical(current[key])) ===
      JSON.stringify(canonical(value)),
  );
}

export function validateRouteStops(
  stops: {
    key: string;
    pointCode: string;
    minutes: number | string;
    kilometers?: number | string;
    active?: boolean;
    assigned?: boolean;
  }[],
  source: "avansat" | "tms" | "operational" = "tms",
) {
  if ((source !== "avansat" && !stops.length) || stops.length > 100)
    throw new Error("La ruta necesita entre 1 y 100 puestos.");
  const keys = new Set<string>();
  let minutes = -1,
    kilometers = -1;
  for (const [index, stop] of stops.entries()) {
    if (
      !stop ||
      typeof stop.key !== "string" ||
      !stop.key.trim() ||
      keys.has(stop.key)
    )
      throw new Error("Cada posición necesita una identidad diferente.");
    if (
      typeof stop.pointCode !== "string" ||
      !["number", "string"].includes(typeof stop.minutes) ||
      (stop.kilometers !== undefined &&
        !["number", "string"].includes(typeof stop.kilometers)) ||
      [stop.active, stop.assigned].some(
        (value) => value !== undefined && typeof value !== "boolean",
      )
    )
      throw new Error(
        "La posición tiene un código, tiempo, distancia o estado inválido.",
      );
    keys.add(stop.key);
    if (source === "avansat") {
      if (!stop.pointCode.trim())
        throw new Error(
          "Cada posición necesita el código original del puesto.",
        );
      for (const value of [stop.minutes, stop.kilometers])
        if (
          value !== undefined &&
          ((typeof value === "number" && !Number.isFinite(value)) ||
            (typeof value === "string" && value.length > 80))
        )
          throw new Error("Valor original de tiempo o distancia inválido.");
      continue;
    }
    if (
      !stop.pointCode.trim() ||
      typeof stop.minutes !== "number" ||
      !Number.isSafeInteger(stop.minutes) ||
      stop.minutes < minutes ||
      stop.minutes < 0 ||
      stop.minutes > 43200
    )
      throw new Error(
        "Los minutos deben ser acumulados, enteros y no decrecientes.",
      );
    minutes = stop.minutes;
    if (stop.kilometers !== undefined) {
      if (
        typeof stop.kilometers !== "number" ||
        !Number.isFinite(stop.kilometers) ||
        stop.kilometers < 0 ||
        stop.kilometers < kilometers
      )
        throw new Error(
          "Las distancias deben ser acumuladas y no decrecientes.",
        );
      kilometers = stop.kilometers;
    }
    if (stop.pointCode === "9999" && index !== stops.length - 1)
      throw new Error("Lugar Entrega debe cerrar la ruta.");
  }
  if (source === "tms" && stops.at(-1)?.pointCode !== "9999")
    throw new Error("Agrega Lugar Entrega al final de la ruta.");
}

export function operationalRouteStops<
  T extends {
    key: string;
    pointCode: string;
    minutes: number | string;
    kilometers?: number | string;
    active?: boolean;
    assigned?: boolean;
  },
>(stops: T[], source: "avansat" | "tms" = "tms") {
  const selected = stops.filter(
    (s) => s.active !== false && s.assigned !== false,
  );
  const numeric = selected.map((s) => {
    const minutes =
      typeof s.minutes === "number"
        ? s.minutes
        : s.minutes.trim()
          ? Number(s.minutes)
          : NaN;
    const kilometers =
      s.kilometers === undefined || s.kilometers === ""
        ? undefined
        : Number(s.kilometers);
    return { ...s, minutes, kilometers };
  });
  validateRouteStops(numeric, source === "avansat" ? "operational" : "tms");
  return numeric;
}

export function routeSchedule(departureAt: string, minutes: number): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(departureAt))
    throw new Error("Indica una fecha y hora de salida válidas.");
  const departure = new Date(`${departureAt}:00-05:00`);
  if (!Number.isFinite(departure.getTime()))
    throw new Error("La fecha de salida es inválida.");
  const local = new Date(departure.getTime() - 5 * 3600000);
  if (local.toISOString().slice(0, 16) !== departureAt)
    throw new Error("La fecha de salida es inválida.");
  return new Date(local.getTime() + minutes * 60000)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
}

export function routeName(route: {
  origin: string;
  destination: string;
  via: string;
}) {
  return `${route.origin} — ${route.destination}${route.via ? ` VÍA ${route.via}` : ""}`;
}

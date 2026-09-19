export const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;
export const DEFAULT_INTERVAL_MINUTES = 180;
export const NOVELTY_TYPES = [
  "Retraso en ruta",
  "Desvío de ruta",
  "Parada autorizada",
  "Falla mecánica",
  "Vía cerrada / clima",
  "Sin contacto con el conductor",
  "Accidente / siniestro",
  "Inspección de autoridad",
  "Otra novedad",
] as const;
export const SCHEDULE_REASONS = [
  "Pernocta / descanso del conductor",
  "Descanso reglamentario en ruta",
  "Espera de cargue o descargue",
  "Zona sin cobertura de señal",
  "Instrucción del cliente",
  "Zona de riesgo: reforzar control",
  "Otro motivo",
] as const;
export const MAX_SCHEDULE_AHEAD_HOURS = 24;
export const DELIVERY_DOCUMENTS = [
  "Remesa firmada por el cliente",
  "Ticket de báscula",
  "Acta / planilla de descargue",
  "Registro fotográfico de la carga",
] as const;

export function normalizeMonitoringText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim();
}

export function bogotaLocalInput(ms: number): string {
  return new Date(ms - BOGOTA_OFFSET_MS).toISOString().slice(0, 16);
}

export function parseBogotaLocalInput(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Indica una fecha y hora válidas.");
  const ms = Date.parse(`${value}:00-05:00`);
  if (!Number.isFinite(ms)) throw new Error("Indica una fecha y hora válidas.");
  return ms;
}

export function formatTripCode(sequence: number): string {
  return `BM-${String(sequence).padStart(5, "0")}`;
}

export function nextDueAt(lastAt: number, intervalMinutes: number): number {
  return lastAt + intervalMinutes * 60 * 1000;
}

export function describeReport(input: {
  location: string;
  hasNovelty: boolean;
  noveltyType?: string;
  kind: string;
}): string {
  if (input.kind === "entrega") return `Entrega en ${input.location}`;
  if (input.kind === "entrega_parcial") return `Entrega parcial en ${input.location}`;
  if (input.kind === "inicio") return `Inicio de viaje en ${input.location}`;
  return input.hasNovelty
    ? `${input.noveltyType ?? "Novedad"} · ${input.location}`
    : `Sin novedad · ${input.location}`;
}

export function routeProgress(
  route: string[],
  reportLocations: string[],
): boolean[] {
  const visited = reportLocations.map(normalizeMonitoringText);
  return route.map((stop) => {
    const key = normalizeMonitoringText(stop.split(",")[0])
      .replace(/\bd\.?c\.?$/i, "")
      .replace(/[^a-z0-9 ]/g, "")
      .trim();
    return visited.some((v) => v.includes(key) || (v.length >= 4 && key.includes(v)));
  });
}

export function validateTripInput(input: {
  origin: string;
  destination: string;
  waypoints: string[];
  plate: string;
  driverName: string;
  driverPhone: string;
  customer: string;
  cargo: string;
  intervalMinutes: number;
}): void {
  const required: Array<[string, string]> = [
    [input.origin, "El origen"],
    [input.destination, "El destino"],
    [input.plate, "La placa"],
    [input.driverName, "El nombre del conductor"],
    [input.driverPhone, "El celular del conductor"],
    [input.customer, "El cliente"],
    [input.cargo, "La mercancía"],
  ];
  for (const [value, label] of required)
    if (!value.trim()) throw new Error(`${label} es obligatorio.`);
  if (
    !Number.isInteger(input.intervalMinutes) ||
    input.intervalMinutes < 30 ||
    input.intervalMinutes > 720
  )
    throw new Error("La frecuencia de reporte debe estar entre 30 y 720 minutos.");
  if (input.waypoints.some((w) => !w.trim()))
    throw new Error("Los puntos intermedios no pueden estar vacíos.");
}

export function validateScheduleChange(input: {
  now: number;
  nextDueAt: number;
  intervalMinutes: number;
  reasonType: string;
  reason: string;
  tripStatus: string;
}): void {
  if (input.tripStatus !== "en_ruta") throw new Error("El viaje ya fue entregado; no admite ajustes de frecuencia.");
  if (!Number.isFinite(input.nextDueAt)) throw new Error("Indica la hora del próximo reporte.");
  if (input.nextDueAt < input.now - 5 * 60 * 1000) throw new Error("El próximo reporte no puede quedar en el pasado.");
  if (input.nextDueAt > input.now + MAX_SCHEDULE_AHEAD_HOURS * 60 * 60 * 1000)
    throw new Error(`El próximo reporte no puede programarse a más de ${MAX_SCHEDULE_AHEAD_HOURS} horas.`);
  if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 30 || input.intervalMinutes > 720)
    throw new Error("La frecuencia de reporte debe estar entre 30 y 720 minutos.");
  if (!input.reasonType.trim()) throw new Error("Selecciona el motivo del ajuste.");
  if (input.reason.trim().length < 10) throw new Error("Explica el motivo del ajuste (mínimo 10 caracteres).");
  if (input.reason.length > 500) throw new Error("La justificación no puede superar 500 caracteres.");
}

export const COMPLIANCE_TOLERANCE_MINUTES = 15;

export type ComplianceRow = {
  gapMinutes: number | null;
  onTime: boolean | null;
  expectedAt: number | null;
  adjusted: boolean;
};

export type ScheduleChangeLike = { at: number; intervalMinutes: number; nextDueAt: number; previousIntervalMinutes?: number };

export function intervalInEffect(at: number, baseInterval: number, changes: ScheduleChangeLike[]): number {
  let interval = baseInterval;
  for (const change of [...changes].sort((a, b) => a.at - b.at)) {
    if (change.at <= at) interval = change.intervalMinutes;
  }
  return interval;
}

export function reportCompliance(
  reports: Array<{ at: number; kind: string }>,
  intervalMinutes: number,
  scheduleChanges: ScheduleChangeLike[] = [],
): { rows: ComplianceRow[]; onTime: number; late: number; maxGapMinutes: number; averageGapMinutes: number; adjusted: number } {
  const sorted = [...reports].sort((a, b) => a.at - b.at);
  const changes = [...scheduleChanges].sort((a, b) => a.at - b.at);
  const initialInterval = changes.length ? findInitialInterval(intervalMinutes, changes) : intervalMinutes;
  const tolerance = COMPLIANCE_TOLERANCE_MINUTES * 60000;
  let onTime = 0,
    late = 0,
    maxGap = 0,
    totalGap = 0,
    gaps = 0,
    adjusted = 0;
  const rows = sorted.map((report, index) => {
    if (index === 0) return { gapMinutes: null, onTime: null, expectedAt: null, adjusted: false };
    const previous = sorted[index - 1];
    const gap = Math.round((report.at - previous.at) / 60000);
    const between = changes.filter((c) => c.at > previous.at && c.at <= report.at);
    const explicit = between.length ? between[between.length - 1] : undefined;
    const expectedAt = explicit ? explicit.nextDueAt : previous.at + intervalInEffect(previous.at, initialInterval, changes) * 60000;
    const ok = report.at <= expectedAt + tolerance;
    if (ok) onTime++;
    else late++;
    if (explicit) adjusted++;
    maxGap = Math.max(maxGap, gap);
    totalGap += gap;
    gaps++;
    return { gapMinutes: gap, onTime: ok, expectedAt, adjusted: Boolean(explicit) };
  });
  return { rows, onTime, late, maxGapMinutes: maxGap, averageGapMinutes: gaps ? Math.round(totalGap / gaps) : 0, adjusted };
}

function findInitialInterval(currentInterval: number, changes: Array<{ intervalMinutes: number; previousIntervalMinutes?: number }>): number {
  const first = changes[0] as { previousIntervalMinutes?: number };
  return first.previousIntervalMinutes ?? currentInterval;
}

export function composeLocation(municipality: string, reference?: string): string {
  const town = municipality.split(",")[0].trim();
  const detail = reference?.trim();
  return detail ? `${town} · ${detail}` : town;
}

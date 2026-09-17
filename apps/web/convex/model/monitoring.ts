export const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;
export const DEFAULT_INTERVAL_MINUTES = 180;
export const NOVELTY_TYPES = [
  "Retraso en ruta",
  "Parada autorizada",
  "Falla mecánica",
  "Vía cerrada / clima",
  "Sin contacto con el conductor",
  "Accidente / siniestro",
  "Inspección de autoridad",
  "Otra novedad",
] as const;
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

export const COMPLIANCE_TOLERANCE_MINUTES = 15;

export type ComplianceRow = {
  gapMinutes: number | null;
  onTime: boolean | null;
};

export function reportCompliance(
  reports: Array<{ at: number; kind: string }>,
  intervalMinutes: number,
): { rows: ComplianceRow[]; onTime: number; late: number; maxGapMinutes: number; averageGapMinutes: number } {
  const sorted = [...reports].sort((a, b) => a.at - b.at);
  const limit = intervalMinutes + COMPLIANCE_TOLERANCE_MINUTES;
  let onTime = 0,
    late = 0,
    maxGap = 0,
    totalGap = 0,
    gaps = 0;
  const rows = sorted.map((report, index) => {
    if (index === 0) return { gapMinutes: null, onTime: null };
    const gap = Math.round((report.at - sorted[index - 1].at) / 60000);
    const ok = gap <= limit;
    if (ok) onTime++;
    else late++;
    maxGap = Math.max(maxGap, gap);
    totalGap += gap;
    gaps++;
    return { gapMinutes: gap, onTime: ok };
  });
  return { rows, onTime, late, maxGapMinutes: maxGap, averageGapMinutes: gaps ? Math.round(totalGap / gaps) : 0 };
}

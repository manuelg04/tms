import type { Doc } from "../_generated/dataModel";

export type TrackingDispatch = Doc<"trackingDispatches">;
export type TrackingColumn =
  | "nem"
  | "externalCode"
  | "time"
  | "manifest"
  | "manifestType"
  | "origin"
  | "destination"
  | "plate"
  | "cargo"
  | "affiliation"
  | "bodyType"
  | "departureDate"
  | "driver"
  | "rating"
  | "customer"
  | "phone"
  | "lastReportedAt"
  | "lastCheckpoint"
  | "incident";
export const trackingColumns: Array<{
  key: TrackingColumn;
  label: string;
  filter: boolean;
}> = [
  { key: "nem", label: "NEM", filter: false },
  { key: "externalCode", label: "Despacho", filter: true },
  { key: "time", label: "Tiempo", filter: true },
  { key: "manifest", label: "Manifiesto", filter: true },
  { key: "manifestType", label: "Tipo Manifiesto", filter: true },
  { key: "origin", label: "Origen", filter: true },
  { key: "destination", label: "Destino", filter: true },
  { key: "plate", label: "Placa", filter: true },
  { key: "cargo", label: "Mercancía", filter: true },
  { key: "affiliation", label: "Vinculación", filter: true },
  { key: "bodyType", label: "Carrocería", filter: true },
  { key: "departureDate", label: "Fecha de Salida", filter: true },
  { key: "driver", label: "Conductor", filter: true },
  { key: "rating", label: "Calificación", filter: false },
  { key: "customer", label: "Cliente", filter: true },
  { key: "phone", label: "Celular", filter: true },
  { key: "lastReportedAt", label: "Fecha Novedad", filter: true },
  { key: "lastCheckpoint", label: "Último P/C", filter: true },
  { key: "incident", label: "Novedad", filter: true },
];
export type TrackingFilters = Partial<Record<TrackingColumn, string>>;
export type TrackingSort = { key: TrackingColumn; direction: "asc" | "desc" };
export const normalizeTrackingText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim();
export const cellValue = (
  row: TrackingDispatch,
  key: TrackingColumn,
): string =>
  key === "externalCode" ? row.externalCode : (row.summary[key] ?? "");
export const queueColumns = (queue: "en_route" | "pending_arrival") =>
  trackingColumns.filter(
    (c) => queue === "en_route" || !["nem", "time"].includes(c.key),
  );
export function filterTracking(
  rows: TrackingDispatch[],
  filters: TrackingFilters,
  search = "",
  columns = trackingColumns,
): TrackingDispatch[] {
  const needle = normalizeTrackingText(search);
  return rows.filter(
    (row) =>
      trackingColumns
        .filter((c) => c.filter)
        .every(
          (c) =>
            !filters[c.key] ||
            normalizeTrackingText(cellValue(row, c.key)).includes(
              normalizeTrackingText(filters[c.key]!),
            ),
        ) &&
      (!needle ||
        columns.some((c) =>
          normalizeTrackingText(cellValue(row, c.key)).includes(needle),
        )),
  );
}
export function sortTracking(
  rows: TrackingDispatch[],
  sort: TrackingSort,
): TrackingDispatch[] {
  return [...rows].sort((a, b) => {
    const av = cellValue(a, sort.key),
      bv = cellValue(b, sort.key);
    if (!av || !bv)
      return av === bv
        ? a.externalCode.localeCompare(b.externalCode, "es", { numeric: true })
        : av
          ? -1
          : 1;
    const numeric =
      sort.key === "time"
        ? Number(av.replace(/,/g, "")) - Number(bv.replace(/,/g, ""))
        : NaN;
    const order = Number.isFinite(numeric)
      ? numeric
      : av.localeCompare(bv, "es", { numeric: true, sensitivity: "base" });
    return (
      (order ||
        a.externalCode.localeCompare(b.externalCode, "es", { numeric: true })) *
      (sort.direction === "asc" ? 1 : -1)
    );
  });
}
export function incidentLabel(
  incident: Pick<
    Doc<"trackingIncidents">,
    | "code"
    | "name"
    | "generatesAlert"
    | "requestsTime"
    | "special"
    | "maintainsAlarm"
  >,
): string {
  return `${incident.code}-${incident.name.toLocaleUpperCase("es")}${incident.generatesAlert ? "(GA)" : ""}${incident.special ? "(NE)" : ""}${incident.requestsTime ? "(ST)" : ""}${incident.maintainsAlarm ? "(MA)" : ""}`;
}
export function bogotaDateTime(now = Date.now()): string {
  return new Date(now - 5 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
}
export function validateRequestedTime(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value))
    throw new Error("Indica una fecha y hora válidas.");
  const date = new Date(`${value.replace(" ", "T")}:00-05:00`);
  if (
    !Number.isFinite(date.getTime()) ||
    bogotaDateTime(date.getTime()) !== value
  )
    throw new Error("Indica una fecha y hora válidas.");
}
export function normalizeAlarm(input: {
  name: string;
  minutes: string | number;
  color: string;
}) {
  const name = input.name.trim(),
    value = String(input.minutes).trim(),
    color = input.color.trim().replace(/^#/, "").toUpperCase();
  if (!name || name.length > 10)
    throw new Error("El nombre debe tener entre 1 y 10 caracteres.");
  if (!/^\d{1,3}$/.test(value))
    throw new Error("El tiempo debe ser un número entero entre 0 y 999.");
  if (!/^[0-9A-F]{6}$/.test(color))
    throw new Error("El color debe tener seis caracteres hexadecimales.");
  return { name, minutes: Number(value), color };
}
export function readableColor(hex: string): string {
  const channels = [0, 2, 4]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 >
    0.179
    ? "#17202e"
    : "#ffffff";
}

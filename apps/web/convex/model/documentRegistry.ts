import type { Id } from "../_generated/dataModel";
import { normalizeSearchText } from "./dispatchSearch";

export type RegistryKind = "orden_cargue" | "remesa" | "manifiesto";

export type RegistryRow = {
  key: string;
  kind: RegistryKind;
  number: string;
  date: string;
  plate: string;
  customer: string;
  agency: string;
  origin: string;
  destination: string;
  status: string;
  statusLabel: string;
  createdBy: string;
  createdAt: number;
  createdAtLabel: string;
  expedienteId?: Id<"expedientes">;
  remesaId?: Id<"expedienteRemesas">;
  documentId?: Id<"documents">;
  pdfUrl?: string;
  pdfArtifactId?: Id<"evidenceArtifacts">;
};

export type RegistryFilters = Partial<
  Record<
    | "number"
    | "date"
    | "dateFrom"
    | "dateTo"
    | "plate"
    | "customer"
    | "agency"
    | "origin"
    | "destination"
    | "status"
    | "createdBy"
    | "createdAtLabel",
    string
  >
> & { numberExact?: boolean };

const textFields = [
  "number",
  "date",
  "plate",
  "customer",
  "agency",
  "origin",
  "destination",
  "createdBy",
  "createdAtLabel",
] as const;

const statusLabels: Record<string, string> = {
  draft: "Borrador",
  pending: "Pendiente",
  sent: "Enviado",
  authorized: "Autorizado",
  rejected: "Rechazado",
  fulfilled: "Cumplido",
  annulled: "Anulado",
  cancelled: "Anulado",
};

export function registryStatusLabel(status: string): string {
  return statusLabels[status] ?? status;
}

export function registryCreatedAtLabel(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

function normalizedNumber(value: string): string {
  const normalized = normalizeSearchText(value);
  return /^\d+$/.test(normalized)
    ? normalized.replace(/^0+(?=\d)/, "")
    : normalized;
}

export function filterRegistryRows(
  rows: readonly RegistryRow[],
  filters: RegistryFilters = {},
): RegistryRow[] {
  return rows
    .filter((row) => {
      if (
        filters.numberExact &&
        filters.number?.trim() &&
        normalizedNumber(row.number) !== normalizedNumber(filters.number)
      )
        return false;
      if (filters.dateFrom && row.date < filters.dateFrom) return false;
      if (filters.dateTo && row.date > filters.dateTo) return false;
      if (
        filters.status?.trim() &&
        !normalizeSearchText(`${row.status} ${row.statusLabel}`).includes(
          normalizeSearchText(filters.status),
        )
      )
        return false;
      return textFields.every((field) => {
        const filter = filters[field]?.trim();
        if (!filter || (field === "number" && filters.numberExact)) return true;
        const value = normalizeSearchText(row[field]);
        return value.includes(normalizeSearchText(filter));
      });
    })
    .sort(
      (left, right) =>
        right.date.localeCompare(left.date) ||
        right.createdAt - left.createdAt ||
        right.key.localeCompare(left.key),
    );
}

export function paginateRegistryRows(
  rows: readonly RegistryRow[],
  page = 1,
  pageSize = 50,
) {
  const size = Math.min(Math.max(Math.floor(pageSize) || 50, 1), 200);
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const currentPage = Math.min(Math.max(Math.floor(page) || 1, 1), pageCount);
  return {
    rows: rows.slice((currentPage - 1) * size, currentPage * size),
    total: rows.length,
    page: currentPage,
    pageSize: size,
    pageCount,
  };
}

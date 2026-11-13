export const apiBase = "/api/rndc";

export const kindLabels: Record<string, string> = {
  orden_cargue: "Orden de cargue",
  remesa: "Remesa",
  manifiesto: "Manifiesto",
  cumplido: "Cumplido",
  anulacion: "Anulación"
};

export const statusLabels: Record<string, string> = {
  draft: "Borrador",
  pending: "Pendiente",
  sent: "Enviado",
  authorized: "Autorizado",
  rejected: "Rechazado",
  fulfilled: "Cumplido",
  annulled: "Anulado"
};

export function documentStatusLabel(kind: string | undefined, status: string): string {
  if (kind === "orden_cargue" && (status === "authorized" || status === "fulfilled")) return "Lista";
  return statusLabels[status] ?? status;
}

const dateFormatter = new Intl.DateTimeFormat("es-CO", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit"
});

export function formatTimestamp(value: number): string {
  return dateFormatter.format(new Date(value));
}

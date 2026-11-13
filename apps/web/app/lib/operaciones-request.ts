export type OperacionesRequest = {
  expedienteId: string;
  status: string;
  statusLabel: string;
  updatedAt: number;
  requestedAt?: number;
  requestedBy?: string;
  dispatcherName?: string;
  isPortTrip: boolean;
  driver: { name?: string; document?: string; phone?: string };
  owner: { name?: string; document?: string };
  vehicle: { plate?: string; trailer?: string };
  customerName?: string;
  route?: string;
  origin?: string;
  destination?: string;
  product?: string;
  weightText?: string;
  packaging?: string;
  freightText?: string;
  advanceText?: string;
  freightValue?: number;
  freightTons?: number;
  advanceValue?: number;
  remesaObservations?: string;
  policy?: string;
  odc?: string;
  manifestNumber?: string;
  remesaNumber?: string;
  ticketApproved: boolean;
  termsAccepted: boolean;
  documents: { loadingOrder: boolean; officialManifest: boolean; officialRemesa: boolean };
};

export function isOperacionesRequest(value: unknown): value is OperacionesRequest {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.expedienteId === "string" && typeof record.status === "string" && typeof record.vehicle === "object" && record.vehicle !== null;
}

export function splitRoute(request: Pick<OperacionesRequest, "route" | "origin" | "destination">): { origin?: string; destination?: string } {
  const origin = clean(request.origin);
  const destination = clean(request.destination);
  if (origin && destination) return { origin, destination };
  const parts = (request.route ?? "")
    .split(/\s+-\s+|\s*[–—>/]\s*|\s+a\s+/i)
    .map((part) => clean(part))
    .filter((part): part is string => Boolean(part));
  return { origin: origin ?? parts[0], destination: destination ?? (parts.length > 1 ? parts[parts.length - 1] : undefined) };
}

export function parseTons(text: string | undefined): string | undefined {
  const match = (text ?? "").match(/\d[\d.,]*/);
  if (!match) return undefined;
  const amount = parseLocalNumber(match[0]);
  if (amount === undefined || amount <= 0) return undefined;
  const isKilograms = /kg|kilo/i.test(text ?? "") || amount >= 1000;
  const tons = isKilograms ? amount / 1000 : amount;
  return String(Math.round(tons * 1000) / 1000);
}

export function parseMoney(text: string | undefined): number | undefined {
  const match = (text ?? "").match(/\d[\d.,]*/);
  if (!match) return undefined;
  const amount = parseLocalNumber(match[0].replace(/[.,]\d{2}$/, (decimals) => (/[.,]\d{3}[.,]\d{2}$/.test(match[0]) ? "" : decimals)));
  if (amount === undefined || amount <= 0) return undefined;
  return Math.round(amount);
}

export function requestObservations(request: OperacionesRequest): string | undefined {
  const lines = [
    request.remesaObservations,
    request.odc ? `ODC: ${request.odc}` : undefined,
    request.policy ? `Póliza: ${request.policy}` : undefined
  ].filter((line): line is string => Boolean(clean(line)));
  return lines.length > 0 ? lines.join(" · ") : undefined;
}

export function pickByPlate<Row extends { plate: string }>(rows: Row[] | undefined, plate: string | undefined): Row | null {
  const wanted = plateKey(plate);
  if (!wanted || !rows) return null;
  return rows.find((row) => plateKey(row.plate) === wanted) ?? null;
}

export function pickByName<Row extends { name: string }>(rows: Row[] | undefined, name: string | undefined): Row | null {
  const wanted = nameKey(name);
  if (!wanted || !rows || rows.length === 0) return null;
  const exact = rows.filter((row) => nameKey(row.name) === wanted);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const close = rows.filter((row) => {
    const candidate = nameKey(row.name);
    return candidate.startsWith(wanted) || wanted.startsWith(candidate);
  });
  return close.length === 1 ? close[0] : null;
}

export function pickMunicipality<Row extends { name: string; isMunicipality: boolean; municipalityName: string }>(rows: Row[] | undefined, city: string | undefined): Row | null {
  const wanted = nameKey(city);
  if (!wanted || !rows) return null;
  const municipalities = rows.filter((row) => row.isMunicipality && nameKey(row.name) === wanted);
  return municipalities.length === 1 ? municipalities[0] : null;
}

export function pickPackaging<Row extends { code: string; description: string }>(rows: Row[] | undefined, text: string | undefined): Row | null {
  const wanted = nameKey(text);
  if (!wanted || !rows) return null;
  const exact = rows.filter((row) => nameKey(row.description) === wanted);
  if (exact.length === 1) return exact[0];
  const close = rows.filter((row) => nameKey(row.description).includes(wanted) || wanted.includes(nameKey(row.description)));
  return close.length === 1 ? close[0] : null;
}

function parseLocalNumber(text: string): number | undefined {
  const grouped = /^\d{1,3}([.,]\d{3})+$/.test(text);
  const normalized = grouped ? text.replace(/[.,]/g, "") : text.replace(/,/g, ".");
  const result = Number(normalized);
  return Number.isFinite(result) ? result : undefined;
}

function clean(text: string | undefined): string | undefined {
  const result = (text ?? "").trim();
  return result || undefined;
}

function plateKey(text: string | undefined): string {
  return (text ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function nameKey(text: string | undefined): string {
  return (text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\b(S A S|SAS|S A|SA|LTDA)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

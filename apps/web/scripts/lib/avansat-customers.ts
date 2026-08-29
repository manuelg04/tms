import { createHash } from "node:crypto";
import {
  canonicalizeAvansatCustomerBatch,
  canonicalizeAvansatCustomerPayload
} from "../../convex/model/avansatCustomers.js";

export type AvansatCustomerStatus = "Habilitado" | "Inhabilitado";

export type AvansatCustomerListRow = {
  document: string;
  name: string;
  phone: string;
  address: string;
  status: string;
};

export type AvansatCustomerDetail = {
  identificationType: string;
  identification: string;
  name: string;
  shortName: string;
  city: string;
  address: string;
  phone: string;
  taxRegime: string;
  economicActivity: string;
  observations: string;
  legalRepresentative: string;
  primaryContact: string;
  logisticsContact: string;
  securityContact: string;
  commercialContact: string;
  administrativeContact: string;
  siteName: string;
  siteCity: string;
  siteAddress: string;
  contactPhone: string;
  contactName: string;
  fax: string;
  website: string;
  email: string;
  accessRestrictions: string;
  instructions: string;
  isoCertified: boolean;
  bascCertified: boolean;
  selfWithholding: boolean;
  vatSelfWithholding: boolean;
  rawFields: Record<string, string | boolean>;
};

export type AvansatRawCustomer = {
  list: AvansatCustomerListRow;
  detail: AvansatCustomerDetail;
};

export type AvansatCustomerArtifact = {
  capturedAt: string;
  expectedTotal: number;
  customers: AvansatRawCustomer[];
};

export type PreparedAvansatCustomer = {
  customer: {
    code: string;
    name: string;
    identificationType: string;
    identificationNumber: string;
    email?: string;
    phone?: string;
    status: "active" | "inactive";
  };
  location?: {
    code: "PRINCIPAL";
    name: "Principal";
    kind: "both";
    address: string;
    city: string;
    contactName?: string;
    contactPhone?: string;
    status: "active" | "inactive";
  };
  source: {
    shortName?: string;
    city?: string;
    address?: string;
    taxRegime?: string;
    economicActivity?: string;
    observations?: string;
    legalRepresentative?: string;
    primaryContact?: string;
    logisticsContact?: string;
    securityContact?: string;
    commercialContact?: string;
    administrativeContact?: string;
    siteName?: string;
    fax?: string;
    website?: string;
    accessRestrictions?: string;
    instructions?: string;
    isoCertified: boolean;
    bascCertified: boolean;
    selfWithholding: boolean;
    vatSelfWithholding: boolean;
    rawFields: Record<string, string | boolean>;
  };
  capturedAt: string;
  contentHash: string;
  sourceJson: string;
};

export type CertifiedAvansatCustomerArtifact = {
  rows: PreparedAvansatCustomer[];
  manifestHash: string;
  stats: {
    total: number;
    active: number;
    inactive: number;
    withEmail: number;
    withLocation: number;
  };
};

export type AvansatCustomerReadback = {
  document: string;
  code: string;
  name: string;
  identificationType?: string;
  email?: string;
  phone?: string;
  status: "active" | "inactive";
  sourceContentHash?: string;
  sourceCapturedAt?: string;
  location: PreparedAvansatCustomer["location"] | null;
};

export function normalizeAvansatCustomer(raw: AvansatRawCustomer, capturedAt: string): PreparedAvansatCustomer {
  assertCapturedAt(capturedAt);
  const document = required(raw.list.document, "La identificación del listado");
  const detailIdentification = required(raw.detail.identification, "La identificación del detalle");
  if (detailIdentification !== document && !detailIdentification.startsWith(`${document} -`)) {
    throw new Error(`La identificación del detalle no coincide con el listado para ${document}`);
  }
  const name = required(raw.detail.name || raw.list.name, `El nombre de ${document}`);
  const identificationType = required(raw.detail.identificationType, `El tipo de identificación de ${document}`).toUpperCase();
  const status = normalizeStatus(raw.list.status);
  const email = clean(raw.detail.email)?.toLowerCase();
  const phone = clean(raw.detail.phone) ?? clean(raw.list.phone);
  const locationAddress = clean(raw.detail.siteAddress) ?? clean(raw.detail.address) ?? clean(raw.list.address);
  const locationCity = clean(raw.detail.siteCity) ?? clean(raw.detail.city);
  const location = locationAddress && locationCity
    ? compact({
        code: "PRINCIPAL" as const,
        name: "Principal" as const,
        kind: "both" as const,
        address: locationAddress,
        city: locationCity,
        contactName: clean(raw.detail.contactName),
        contactPhone: clean(raw.detail.contactPhone) ?? phone,
        status
      })
    : undefined;
  const source = compact({
    shortName: clean(raw.detail.shortName),
    city: clean(raw.detail.city),
    address: clean(raw.detail.address),
    taxRegime: clean(raw.detail.taxRegime),
    economicActivity: clean(raw.detail.economicActivity),
    observations: clean(raw.detail.observations),
    legalRepresentative: clean(raw.detail.legalRepresentative),
    primaryContact: clean(raw.detail.primaryContact),
    logisticsContact: clean(raw.detail.logisticsContact),
    securityContact: clean(raw.detail.securityContact),
    commercialContact: clean(raw.detail.commercialContact),
    administrativeContact: clean(raw.detail.administrativeContact),
    siteName: clean(raw.detail.siteName),
    fax: clean(raw.detail.fax),
    website: clean(raw.detail.website),
    accessRestrictions: clean(raw.detail.accessRestrictions),
    instructions: clean(raw.detail.instructions),
    isoCertified: Boolean(raw.detail.isoCertified),
    bascCertified: Boolean(raw.detail.bascCertified),
    selfWithholding: Boolean(raw.detail.selfWithholding),
    vatSelfWithholding: Boolean(raw.detail.vatSelfWithholding),
    rawFields: stableValue(raw.detail.rawFields) as Record<string, string | boolean>
  });
  const customer = compact({
    code: document,
    name,
    identificationType,
    identificationNumber: document,
    email,
    phone,
    status
  });
  const sourceJson = stableJson({ list: normalizedList(raw.list), detail: stableValue(raw.detail) });
  const contentHash = sha256(canonicalizeAvansatCustomerPayload({ customer, location: location ?? null, source: { sourceJson } }));
  return { customer, location, source, capturedAt, contentHash, sourceJson };
}

export function certifyAvansatCustomerArtifact(artifact: AvansatCustomerArtifact): CertifiedAvansatCustomerArtifact {
  assertCapturedAt(artifact.capturedAt);
  if (!Number.isInteger(artifact.expectedTotal) || artifact.expectedTotal < 1) {
    throw new Error("El total esperado de clientes no es válido");
  }
  if (artifact.customers.length !== artifact.expectedTotal) {
    throw new Error(`Se esperaban ${artifact.expectedTotal} clientes y se recibieron ${artifact.customers.length}`);
  }
  const rows = artifact.customers.map((raw) => normalizeAvansatCustomer(raw, artifact.capturedAt));
  const byDocument = new Map<string, PreparedAvansatCustomer>();
  for (const row of rows) {
    const document = row.customer.identificationNumber;
    if (byDocument.has(document)) throw new Error(`La identificación ${document} está duplicada`);
    byDocument.set(document, row);
  }
  const sortedRows = [...rows].sort((left, right) => left.customer.identificationNumber.localeCompare(right.customer.identificationNumber));
  const manifestHash = sha256(stableJson(sortedRows.map((row) => [row.customer.identificationNumber, row.contentHash])));
  return {
    rows: sortedRows,
    manifestHash,
    stats: {
      total: sortedRows.length,
      active: sortedRows.filter((row) => row.customer.status === "active").length,
      inactive: sortedRows.filter((row) => row.customer.status === "inactive").length,
      withEmail: sortedRows.filter((row) => row.customer.email).length,
      withLocation: sortedRows.filter((row) => row.location).length
    }
  };
}

export function chunkAvansatCustomers<T>(rows: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1 || size > 200) {
    throw new Error("El tamaño del lote debe estar entre 1 y 200");
  }
  const batches: T[][] = [];
  for (let index = 0; index < rows.length; index += size) batches.push(rows.slice(index, index + size));
  return batches;
}

export function deterministicAvansatCustomerRunId(manifestHash: string): string {
  if (!/^[0-9a-f]{64}$/.test(manifestHash)) throw new Error("El hash del manifiesto no es válido");
  const bytes = Buffer.from(manifestHash.slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function hashAvansatCustomerBatch(batchIndex: number, rows: PreparedAvansatCustomer[]): string {
  return sha256(canonicalizeAvansatCustomerBatch(
    batchIndex,
    rows.map((row) => ({ document: row.customer.identificationNumber, contentHash: row.contentHash }))
  ));
}

export function verifyAvansatCustomerReadback(
  expectedRows: PreparedAvansatCustomer[],
  storedRows: AvansatCustomerReadback[]
): { expected: number; stored: number; matched: number; extras: number } {
  const expected = uniqueByDocument(expectedRows.map((row) => [row.customer.identificationNumber, row] as const), "entrada");
  const stored = new Map<string, AvansatCustomerReadback[]>();
  for (const row of storedRows) {
    const matches = stored.get(row.document) ?? [];
    matches.push(row);
    stored.set(row.document, matches);
  }
  let matched = 0;
  for (const [document, row] of expected) {
    const candidates = stored.get(document) ?? [];
    if (candidates.length === 0) throw new Error(`La lectura de clientes no contiene la identificación ${document}`);
    if (candidates.length > 1) throw new Error(`La lectura de clientes contiene la identificación duplicada ${document}`);
    const found = candidates[0];
    const expectedValue = {
      document,
      code: row.customer.code,
      name: row.customer.name,
      identificationType: row.customer.identificationType,
      email: row.customer.email,
      phone: row.customer.phone,
      status: row.customer.status,
      sourceContentHash: row.contentHash,
      sourceCapturedAt: row.capturedAt,
      location: row.location ?? null
    };
    if (stableJson(found) !== stableJson(expectedValue)) {
      throw new Error(`La lectura de la identificación ${document} contiene información diferente`);
    }
    matched += 1;
  }
  return { expected: expected.size, stored: storedRows.length, matched, extras: storedRows.length - expected.size };
}

function normalizedList(row: AvansatCustomerListRow) {
  return {
    document: required(row.document, "La identificación del listado"),
    name: required(row.name, "El nombre del listado"),
    phone: clean(row.phone) ?? "",
    address: clean(row.address) ?? "",
    status: normalizeRawStatus(row.status)
  };
}

function normalizeStatus(value: string): "active" | "inactive" {
  return normalizeRawStatus(value) === "Habilitado" ? "active" : "inactive";
}

function normalizeRawStatus(value: string): AvansatCustomerStatus {
  const normalized = required(value, "El estado del cliente").toLocaleLowerCase("es-CO");
  if (normalized === "habilitado") return "Habilitado";
  if (normalized === "inhabilitado") return "Inhabilitado";
  throw new Error(`El estado de cliente ${value} no es reconocido`);
}

function assertCapturedAt(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error("La fecha de captura no es válida");
  }
}

function required(value: string | undefined, label: string): string {
  const normalized = clean(value);
  if (!normalized) throw new Error(`${label} es obligatoria`);
  return normalized;
}

function clean(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/[\s\u00a0]+/g, " ");
  return normalized || undefined;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  const serialized = JSON.stringify(stableValue(value));
  if (serialized === undefined) throw new Error("El contenido de clientes no se puede serializar");
  return serialized;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)])
    );
  }
  return value;
}

function uniqueByDocument<T>(rows: ReadonlyArray<readonly [string, T]>, label: string): Map<string, T> {
  const unique = new Map<string, T>();
  for (const [document, row] of rows) {
    if (unique.has(document)) throw new Error(`La lectura ${label} contiene la identificación duplicada ${document}`);
    unique.set(document, row);
  }
  return unique;
}

import { consignmentMissingFields, type ConsignmentDraft } from "./dispatchWorkflow";

export type AdvancedExceptionType =
  | "remesa_without_order"
  | "empty_manifest"
  | "transshipment"
  | "correction"
  | "annulment"
  | "reconciliation";

export type AdvancedDocument = {
  id?: string;
  kind: "orden_cargue" | "remesa" | "manifiesto";
  officialState: string;
  fulfillmentState?: string;
  remesaIds?: string[];
};

const capabilities: AdvancedExceptionType[] = [
  "remesa_without_order",
  "empty_manifest",
  "transshipment",
  "correction",
  "annulment",
  "reconciliation"
];

export function advancedCapabilities(role: string): AdvancedExceptionType[] {
  return role === "admin" ? [...capabilities] : [];
}

export function validateExceptionRequest(input: Record<string, unknown>): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!text(input.reason)) errors.push("Motivo requerido");
  if (!text(input.observation)) errors.push("Observación requerida");
  if (input.confirmed !== true) errors.push("Confirmación explícita requerida");

  return { ok: errors.length === 0, errors };
}

export function buildCorrectionComparison(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Array<{ field: string; before: unknown; after: unknown }> {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .filter((field) => stable(before[field]) !== stable(after[field]))
    .map((field) => ({ field, before: before[field], after: after[field] }));
}

export function buildAnnulmentPlan(input: {
  target?: AdvancedDocument;
  documents: AdvancedDocument[];
  wholeSet?: boolean;
}): { ok: boolean; steps: string[]; blockers: string[] } {
  if (input.wholeSet) {
    const manifests = input.documents.filter((document) => document.kind === "manifiesto" && active(document));
    const remesas = input.documents.filter((document) => document.kind === "remesa" && active(document));
    const orders = input.documents.filter((document) => document.kind === "orden_cargue" && active(document));
    const steps = [
      ...manifests.filter(fulfilled).map((document) => `annul_manifest_fulfillment:${document.id ?? "unknown"}`),
      ...remesas.filter(fulfilled).map((document) => `annul_remesa_fulfillment:${document.id ?? "unknown"}`),
      ...manifests.map((document) => `annul_manifest:${document.id ?? "unknown"}`),
      ...remesas.map((document) => `annul_remesa:${document.id ?? "unknown"}`),
      ...(manifests.length > 0 ? ["annul_trip"] : []),
      ...orders.map((document) => `annul_cargo:${document.id ?? "unknown"}`)
    ];
    return { ok: steps.length > 0, steps, blockers: steps.length > 0 ? [] : ["No hay documentos oficiales anulables"] };
  }

  const target = input.target;

  if (!target || !active(target)) {
    return { ok: false, steps: [], blockers: ["El documento no está en un estado anulable"] };
  }

  if (target.kind === "remesa") {
    const dependent = input.documents.find((document) =>
      document.kind === "manifiesto" && active(document) && document.remesaIds?.includes(target.id ?? "")
    );

    if (dependent) {
      return { ok: false, steps: [], blockers: [`Anula o libera primero el manifiesto ${dependent.id ?? "asociado"}`] };
    }
  }

  if (target.kind === "orden_cargue") {
    const pending = input.documents.filter((document) => document.kind === "remesa" && active(document));

    if (pending.length > 0) {
      return { ok: false, steps: [], blockers: ["Anula primero las remesas asociadas"] };
    }
  }

  const prefix = target.kind === "manifiesto" ? "manifest" : target.kind === "remesa" ? "remesa" : "cargo";
  const steps = fulfilled(target) && target.kind !== "orden_cargue"
    ? [`annul_${prefix}_fulfillment`, `annul_${prefix}`]
    : [`annul_${prefix}`];
  return { ok: true, steps, blockers: [] };
}

export function documentIdsForRemesas(remesas: Array<{ documentId?: string }>): string[] {
  return remesas.flatMap((remesa) => remesa.documentId ? [remesa.documentId] : []);
}

export function buildTransshipmentPlan(input: {
  sourceManifest?: { number?: string; officialState: string; fulfillmentState?: string; suspended?: boolean };
  beforeAssignment?: Record<string, unknown>;
  afterAssignment?: Record<string, unknown>;
  releasedRemesaIds?: string[];
  reasonCode?: string;
  municipalityCode?: string;
}): {
  ok: boolean;
  blockers: string[];
  sourceManifestNumber?: string;
  beforeAssignment?: Record<string, unknown>;
  afterAssignment?: Record<string, unknown>;
} {
  const blockers: string[] = [];
  const source = input.sourceManifest;
  const eligibleSource = source?.officialState === "annulled"
    || (source?.officialState === "fulfilled" && source.fulfillmentState === "fulfilled" && source.suspended === true);

  if (!source?.number || !eligibleSource) blockers.push("El manifiesto anterior debe estar anulado o cumplido con suspensión");
  if (!input.releasedRemesaIds?.length) blockers.push("Libera al menos una remesa del manifiesto anterior");
  if (!input.beforeAssignment || !input.afterAssignment || stable(input.beforeAssignment) === stable(input.afterAssignment)) {
    blockers.push("La flota de reemplazo debe ser diferente a la asignación anterior");
  }
  if (!input.reasonCode || !["A", "V", "S"].includes(input.reasonCode)) blockers.push("El motivo de transbordo debe ser Accidente, Varada o Siniestro");
  if (!text(input.municipalityCode)) blockers.push("Municipio de transbordo requerido");

  return {
    ok: blockers.length === 0,
    blockers,
    sourceManifestNumber: source?.number,
    beforeAssignment: input.beforeAssignment,
    afterAssignment: input.afterAssignment
  };
}

export function validateEmptyManifest(input: {
  manifestType?: unknown;
  remesaIds?: unknown;
  payload?: unknown;
}): { ok: boolean; errors: string[]; payload: Record<string, unknown> } {
  const errors: string[] = [];
  const remesaIds = Array.isArray(input.remesaIds) ? input.remesaIds : [];

  if (input.manifestType !== "W") errors.push("El manifiesto vacío debe usar el tipo Viaje Vacío");
  if (remesaIds.length > 0) errors.push("Un manifiesto vacío no puede asociar remesas");

  return { ok: errors.length === 0, errors, payload: stripTracking(isRecord(input.payload) ? input.payload : {}) };
}

export function validateRemesaWithoutOrder(input: Record<string, unknown>): { ok: boolean; errors: string[] } {
  const errors = consignmentMissingFields(input as ConsignmentDraft, null);
  return { ok: errors.length === 0, errors };
}

export function resolveManualReconciliation(input: {
  expected?: { kind?: string; number?: string };
  returned?: { kind?: string; number?: string };
  reportedStatus?: string;
}): { status: string; identityMatched: boolean } {
  const identityMatched = Boolean(
    input.expected?.kind
    && input.expected.number
    && input.expected.kind === input.returned?.kind
    && input.expected.number === input.returned?.number
  );

  if (!identityMatched) return { status: "mismatch", identityMatched: false };
  if (input.reportedStatus === "authorized" || input.reportedStatus === "fulfilled" || input.reportedStatus === "annulled") {
    return { status: input.reportedStatus, identityMatched: true };
  }
  return { status: "pending", identityMatched: true };
}

function active(document: AdvancedDocument): boolean {
  return document.officialState === "authorized" || document.officialState === "fulfilled";
}

function fulfilled(document: AdvancedDocument): boolean {
  return document.officialState === "fulfilled" || document.fulfillmentState === "fulfilled";
}

function stripTracking(payload: Record<string, unknown>): Record<string, unknown> {
  const blocked = new Set(["gpsOperator", "gpsCredentials", "trackingRequired", "trackingProvider", "controlTraffic", "remesaIds", "manifestRemesas", "remesaNumber"]);
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !blocked.has(key)));
}

function stable(value: unknown): string {
  return JSON.stringify(value, Object.keys(isRecord(value) ? value : {}).sort());
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

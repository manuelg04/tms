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

export const manifestAnnulmentReasons = ["D", "S", "R", "T", "G", "C", "V"] as const;
export const replacementAnnulmentReasons = ["R", "T", "G", "C", "V"] as const;

export function needsReplacementManifest(reasonCode: string | undefined): boolean {
  return (replacementAnnulmentReasons as readonly string[]).includes(reasonCode ?? "");
}

export function annulmentReasonAllowed(kind: AdvancedDocument["kind"], reasonCode: string | undefined): boolean {
  if (!reasonCode) return false;
  return kind === "manifiesto"
    ? (manifestAnnulmentReasons as readonly string[]).includes(reasonCode)
    : reasonCode === "D" || reasonCode === "S";
}

export type RndcFulfillmentFinding = "found" | "none" | "unknown";

export type RndcRemesaFulfillment = { initial?: RndcFulfillmentFinding; final?: RndcFulfillmentFinding };

export type AnnulmentPlan = { ok: boolean; steps: string[]; blockers: string[]; optionalSteps: string[] };

export function buildAnnulmentPlan(input: {
  target?: AdvancedDocument;
  documents: AdvancedDocument[];
  wholeSet?: boolean;
  reasonCode?: string;
  rndcFulfillment?: Record<string, RndcRemesaFulfillment>;
  tripRegistered?: boolean;
}): AnnulmentPlan {
  const replacement = needsReplacementManifest(input.reasonCode);
  const converted = input.documents.some((document) => document.kind === "remesa" && everOfficial(document));
  const blocked = (blocker: string): AnnulmentPlan => ({ ok: false, steps: [], blockers: [blocker], optionalSteps: [] });
  const finding = (document: AdvancedDocument): RndcRemesaFulfillment => (document.id ? input.rndcFulfillment?.[document.id] : undefined) ?? {};
  const fulfilledOutside = (document: AdvancedDocument) => document.kind === "remesa" && active(document) && !fulfilled(document) && finding(document).final === "found";
  const initialFound = (document: AdvancedDocument) => finding(document).initial === "found";
  const outside = (input.wholeSet || input.target?.kind !== "remesa" ? input.documents : input.target ? [input.target] : []).filter(fulfilledOutside);

  if (outside.length > 0) {
    return blocked("El RNDC tiene un cumplido de remesa registrado fuera del TMS. El TMS todavía no puede anular ese cumplido: anúlalo en el sistema donde se registró o en el portal del RNDC y vuelve a intentar");
  }

  const initialPossible = (document: AdvancedDocument) => fulfilled(document) || initialFound(document) || finding(document).initial === "unknown";
  const tripSteps = input.tripRegistered === true ? ["annul_trip"] : [];

  if (input.wholeSet) {
    if (replacement) {
      return blocked("El reemplazo aplica solo al manifiesto; anúlalo sin marcar el conjunto completo");
    }

    const manifests = input.documents.filter((document) => document.kind === "manifiesto" && active(document));
    const remesas = input.documents.filter((document) => document.kind === "remesa" && active(document));
    const orders = converted ? [] : input.documents.filter((document) => document.kind === "orden_cargue" && active(document));
    const initialSteps = remesas.filter(initialPossible);
    const steps = [
      ...manifests.filter(fulfilled).map((document) => `annul_manifest_fulfillment:${document.id ?? "unknown"}`),
      ...remesas.filter(fulfilled).map((document) => `annul_remesa_fulfillment:${document.id ?? "unknown"}`),
      ...initialSteps.map((document) => `annul_remesa_initial_fulfillment:${document.id ?? "unknown"}`),
      ...manifests.map((document) => `annul_manifest:${document.id ?? "unknown"}`),
      ...remesas.map((document) => `annul_remesa:${document.id ?? "unknown"}`),
      ...(manifests.length > 0 ? tripSteps : []),
      ...orders.map((document) => `annul_cargo:${document.id ?? "unknown"}`)
    ];
    const optionalSteps = initialSteps.filter((document) => !initialFound(document)).map((document) => `annul_remesa_initial_fulfillment:${document.id ?? "unknown"}`);
    return { ok: steps.length > 0, steps, blockers: steps.length > 0 ? [] : ["No hay documentos oficiales anulables"], optionalSteps };
  }

  const target = input.target;

  if (!target || !active(target)) {
    return blocked("El documento no está en un estado anulable");
  }

  if (replacement && target.kind !== "manifiesto") {
    return blocked("El motivo con reemplazo solo aplica al manifiesto");
  }

  if (target.kind === "manifiesto") {
    const linked = input.documents.filter((document) => document.kind === "remesa" && target.remesaIds?.includes(document.id ?? ""));

    if (linked.some(fulfilled)) {
      return blocked("El manifiesto tiene remesas cumplidas; anula primero esos cumplidos o usa el conjunto completo");
    }

    if (replacement && fulfilled(target)) {
      return blocked("Un manifiesto cumplido no se reemplaza; anula primero su cumplido");
    }

    const initialSteps = linked.filter((document) => active(document) && (initialFound(document) || finding(document).initial === "unknown"));
    const steps = [
      ...initialSteps.map((document) => `annul_remesa_initial_fulfillment:${document.id ?? "unknown"}`),
      ...(fulfilled(target) ? ["annul_manifest_fulfillment"] : []),
      "annul_manifest",
      ...(replacement ? tripSteps : [])
    ];
    const optionalSteps = [
      ...initialSteps.filter((document) => !initialFound(document)).map((document) => `annul_remesa_initial_fulfillment:${document.id ?? "unknown"}`),
      ...(replacement ? tripSteps : [])
    ];
    return { ok: true, steps, blockers: [], optionalSteps };
  }

  if (target.kind === "remesa") {
    const dependent = input.documents.find((document) =>
      document.kind === "manifiesto" && active(document) && document.remesaIds?.includes(target.id ?? "")
    );

    if (dependent) {
      return blocked(`Anula o libera primero el manifiesto ${dependent.id ?? "asociado"}`);
    }

    const steps = [
      ...(fulfilled(target) ? ["annul_remesa_fulfillment"] : []),
      ...(initialPossible(target) ? ["annul_remesa_initial_fulfillment"] : []),
      "annul_remesa"
    ];
    return { ok: true, steps, blockers: [], optionalSteps: initialPossible(target) && !initialFound(target) ? ["annul_remesa_initial_fulfillment"] : [] };
  }

  const pending = input.documents.filter((document) => document.kind === "remesa" && active(document));

  if (pending.length > 0) {
    return blocked("Anula primero las remesas asociadas");
  }

  if (converted) {
    return blocked("La orden ya se convirtió en remesa; el RNDC la conserva como registro histórico y no permite anularla");
  }

  return { ok: true, steps: ["annul_cargo"], blockers: [], optionalSteps: [] };
}

const ANNULMENT_STEP_LABELS: Record<string, string> = {
  annul_manifest_fulfillment: "Anular el cumplido del manifiesto",
  annul_remesa_fulfillment: "Anular el cumplido de la remesa",
  annul_remesa_initial_fulfillment: "Anular el cumplido inicial de la remesa",
  annul_manifest: "Anular el manifiesto",
  annul_remesa: "Anular la remesa",
  annul_trip: "Anular la información del viaje",
  annul_cargo: "Anular la orden de cargue"
};

export function annulmentStepLabel(step: string): string {
  return ANNULMENT_STEP_LABELS[step.split(":")[0]] ?? step;
}

export type AnnulmentQuota = {
  issued: number;
  annulled: number;
  limitPercent: number;
  allowed: number;
  remaining: number;
  exceeded: boolean;
};

export function manifestAnnulmentQuota(input: { issued: number; annulled: number }): AnnulmentQuota {
  const issued = Math.max(0, Math.floor(input.issued));
  const annulled = Math.max(0, Math.floor(input.annulled));
  const limitPercent = issued > 2000 ? 10 : issued >= 500 ? 20 : 30;
  const allowed = Math.floor((issued * limitPercent) / 100);
  return { issued, annulled, limitPercent, allowed, remaining: Math.max(0, allowed - annulled), exceeded: annulled + 1 > allowed };
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

function everOfficial(document: AdvancedDocument): boolean {
  return active(document) || document.officialState === "annulled";
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

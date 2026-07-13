export type DocumentKind = "orden_cargue" | "remesa" | "manifiesto" | "cumplido" | "anulacion";

export type DocumentStage = "orden_cargue" | "remesas" | "manifiesto" | "cumplido_inicial";

export type DispatchEntryStage = DocumentStage | "vehiculo_conductor" | "envio_rndc" | "cargue_descargue" | "cumplido_final";

export type ProtectedDocumentAction = "correct" | "annul" | "reconcile";

export type DocumentSection = {
  slug: "todos" | "ordenes" | "remesas" | "manifiestos" | "cumplidos";
  label: string;
  singular: string;
  description: string;
  kind?: DocumentKind;
  stage?: DocumentStage;
  actionLabel: string;
};

export const documentSections: DocumentSection[] = [
  {
    slug: "todos",
    label: "Todos los documentos",
    singular: "Documento",
    description: "Historial completo de documentos emitidos y pendientes.",
    actionLabel: "Abrir documento"
  },
  {
    slug: "ordenes",
    label: "Órdenes de cargue",
    singular: "Orden de cargue",
    description: "Solicitudes de salida, rutas, carga y preparación documental.",
    kind: "orden_cargue",
    stage: "orden_cargue",
    actionLabel: "Abrir orden"
  },
  {
    slug: "remesas",
    label: "Remesas",
    singular: "Remesa",
    description: "Carga, destinatarios, pólizas y documentos vinculados al viaje.",
    kind: "remesa",
    stage: "remesas",
    actionLabel: "Abrir remesa"
  },
  {
    slug: "manifiestos",
    label: "Manifiestos",
    singular: "Manifiesto",
    description: "Vehículo, conductor, liquidación y documento oficial del viaje.",
    kind: "manifiesto",
    stage: "manifiesto",
    actionLabel: "Abrir manifiesto"
  },
  {
    slug: "cumplidos",
    label: "Cumplidos",
    singular: "Cumplido",
    description: "Cierre documental de remesas y manifiestos.",
    kind: "cumplido",
    stage: "cumplido_inicial",
    actionLabel: "Abrir cumplimiento"
  }
];

const stageByKind: Partial<Record<DocumentKind, DocumentStage>> = {
  orden_cargue: "orden_cargue",
  remesa: "remesas",
  manifiesto: "manifiesto",
  cumplido: "cumplido_inicial"
};

const dispatchEntryStages = new Set<DispatchEntryStage>([
  "orden_cargue",
  "remesas",
  "vehiculo_conductor",
  "manifiesto",
  "envio_rndc",
  "cargue_descargue",
  "cumplido_inicial",
  "cumplido_final"
]);

const protectedActions = new Set<ProtectedDocumentAction>(["correct", "annul", "reconcile"]);

export function resolveDocumentSection(slug: string): DocumentSection | undefined {
  return documentSections.find((section) => section.slug === slug);
}

export function documentDetailHref(input: { expedienteId?: string; kind: string }): string | undefined {
  if (!input.expedienteId) return undefined;
  const stage = stageByKind[input.kind as DocumentKind];
  if (!stage) return `/expedientes/${input.expedienteId}`;
  return `/expedientes/${input.expedienteId}?stage=${stage}#centro-documental`;
}

export function correctionDetailHref(expedienteId: string, action?: ProtectedDocumentAction): string {
  const actionParam = action ? `&action=${action}` : "";
  return `/expedientes/${expedienteId}?panel=correcciones${actionParam}#correcciones`;
}

export function resolveDispatchEntry(input: { stage?: string | null; panel?: string | null; action?: string | null }): {
  stage?: DispatchEntryStage;
  showCorrections: boolean;
  action?: ProtectedDocumentAction;
} {
  return {
    stage: input.stage && dispatchEntryStages.has(input.stage as DispatchEntryStage) ? input.stage as DispatchEntryStage : undefined,
    showCorrections: input.panel === "correcciones",
    action: input.action && protectedActions.has(input.action as ProtectedDocumentAction) ? input.action as ProtectedDocumentAction : undefined
  };
}

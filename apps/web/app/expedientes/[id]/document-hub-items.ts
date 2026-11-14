import type { Id } from "../../../convex/_generated/dataModel";
import { emissionDependencyBlockers } from "../../../convex/model/dispatchWorkflow";
import {
  consignmentBlockers,
  loadingOrderBlockers,
  manifestBlockers as manifestDraftBlockers,
} from "../../../convex/model/emissionChecks";
import type { OfficialDocumentState } from "../../../convex/model/documentLifecycle";
import type { DocumentHubItem } from "../components/document-hub";
import type { Detail } from "./detail-types";
import { currentManifestDocument } from "../../../convex/model/currentManifest";

export function buildDocumentHubItems(input: {
  detail: Detail;
  evidence: Array<{
    _id: Id<"evidenceArtifacts">;
    documentId?: Id<"documents">;
    kind: string;
    createdAt: number;
  }>;
  isEditable: boolean;
}): DocumentHubItem[] {
  const { detail, evidence, isEditable } = input;
  const orderDocument = latestDocument(detail, "orden_cargue");
  const manifestDocument = currentManifestDocument(detail.expediente, detail.documents);
  const remesaDocuments = detail.documents.filter(
    (document) => document.kind === "remesa",
  );
  const orderState = documentState(orderDocument);
  const manifestState = documentState(manifestDocument);
  const remesaState = aggregateOfficialState(
    detail.remesas.map((remesa) => remesa.officialState),
  );
  const assignmentBlockers = [
    ...(!detail.vehicle ? ["Falta asignar el vehículo"] : []),
    ...(!detail.driver ? ["Falta asignar el conductor"] : []),
  ];
  const dependencyInput = {
    workflowVariant: detail.expediente.workflowVariant,
    orderOfficialState: orderState,
    consignmentOfficialStates: detail.remesas.map(
      (remesa) => remesa.officialState,
    ),
  };
  const orderBlockers = isOfficial(orderState)
    ? []
    : unique([
        ...loadingOrderBlockers(detail.expediente.loadingOrderDraft),
        ...detail.route.blockers,
        ...assignmentBlockers,
        ...emissionDependencyBlockers("orden", dependencyInput),
      ]);
  const remesaBlockers = isOfficial(remesaState)
    ? []
    : unique([
        ...(detail.remesas.length === 0
          ? ["Agrega al menos una remesa"]
          : detail.remesas.flatMap((remesa) =>
              remesa.officialState === "draft" || remesa.officialState === "pending"
                ? consignmentBlockers(
                    remesa.draft,
                    detail.expediente.loadingOrderDraft,
                  ).map((blocker) => `Remesa ${remesa.sequence}: ${blocker}`)
                : [],
            )),
        ...detail.route.blockers,
        ...emissionDependencyBlockers("remesas", dependencyInput),
      ]);
  const manifestBlockers = isOfficial(manifestState)
    ? []
    : unique([
        ...manifestDraftBlockers(
          detail.expediente.manifestDraft,
          detail.remesas.length,
          detail.moneyLimits,
          { origin: detail.route.origin, destination: detail.route.destination },
        ),
        ...assignmentBlockers,
        ...emissionDependencyBlockers("manifiesto", dependencyInput),
      ]);
  const fulfillmentComplete =
    manifestDocument?.fulfillmentState === "fulfilled" &&
    detail.remesas.every((remesa) => remesa.fulfillmentState === "fulfilled");
  const fulfillmentState = fulfillmentComplete
    ? "fulfilled"
    : isOfficial(manifestState)
      ? "pending"
      : "draft";
  const fulfilledRemesas = detail.remesas.filter(
    (remesa) => remesa.fulfillmentState === "fulfilled",
  ).length;

  return [
    {
      key: "order",
      title: "Orden de cargue",
      description: "Documento de salida",
      number:
        detail.expediente.loadingOrderDraft?.orderNumber ??
        detail.expediente.cargoNumber,
      state: orderState,
      stage: "orden_cargue",
      scope: "orden",
      blockers: orderBlockers,
      canEdit: isEditable && orderState === "draft",
      pdfHref: pdfHref(evidence, orderDocument ? [orderDocument._id] : []),
    },
    {
      key: "consignments",
      title: "Remesas",
      description: `${detail.remesas.length} vinculadas`,
      number:
        detail.remesas
          .flatMap((remesa) => (remesa.number ? [remesa.number] : []))
          .join(", ") || undefined,
      state: remesaState,
      stage: "remesas",
      scope: "remesas",
      blockers: remesaBlockers,
      canEdit:
        isEditable &&
        (detail.remesas.length === 0 ||
          detail.remesas.some((remesa) => remesa.officialState === "draft")),
      pdfHref: pdfHref(
        evidence,
        remesaDocuments.map((document) => document._id),
      ),
    },
    {
      key: "assignment",
      title: "Vehículo y conductor",
      description: "Recursos del viaje",
      number:
        [detail.vehicle?.plate, detail.driver?.name ?? detail.driver?.document]
          .filter(Boolean)
          .join(" · ") || undefined,
      state: assignmentBlockers.length === 0 ? "completed" : "draft",
      stage: "vehiculo_conductor",
      blockers: assignmentBlockers,
      canEdit: isEditable,
    },
    {
      key: "manifest",
      title: "Manifiesto",
      description: detail.expediente.manifestDraft?.sourceManifestNumber
        ? `Reemplaza al manifiesto ${detail.expediente.manifestDraft.sourceManifestNumber}`
        : "Documento del viaje",
      number:
        detail.expediente.manifestDraft?.manifestNumber ??
        detail.expediente.manifestNumber,
      state: manifestState,
      stage: "manifiesto",
      scope: "manifiesto",
      blockers: manifestBlockers,
      canEdit: isEditable && manifestState === "draft",
      pdfHref: pdfHref(
        evidence,
        manifestDocument ? [manifestDocument._id] : [],
      ),
    },
    {
      key: "fulfillment",
      title: "Cumplidos",
      description: "Cierre documental",
      number: `${fulfilledRemesas}/${detail.remesas.length} remesas`,
      state: fulfillmentState,
      stage: fulfillmentComplete ? "cumplido" : "cumplido_inicial",
      blockers: isOfficial(manifestState)
        ? []
        : ["Requiere manifiesto autorizado"],
      canEdit: isOfficial(manifestState) && !fulfillmentComplete,
    },
  ];
}

function latestDocument(detail: Detail, kind: string) {
  return detail.documents
    .filter((document) => document.kind === kind)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
}

export function documentState(
  document: Detail["documents"][number] | undefined,
): OfficialDocumentState {
  const state = document?.officialState ?? document?.status;
  return state === "authorized" ||
    state === "fulfilled" ||
    state === "annulled" ||
    state === "pending"
    ? state
    : "draft";
}

function aggregateOfficialState(
  states: OfficialDocumentState[],
): OfficialDocumentState {
  if (states.length === 0) return "draft";
  if (states.every((state) => state === "fulfilled")) return "fulfilled";
  if (states.every(isOfficial)) return "authorized";
  if (states.some((state) => state === "pending")) return "pending";
  if (states.every((state) => state === "annulled")) return "annulled";
  return "draft";
}

function isOfficial(state: OfficialDocumentState): boolean {
  return state === "authorized" || state === "fulfilled";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function blockerMessage(blockers: unknown): string | undefined {
  if (!Array.isArray(blockers)) return undefined;
  const values = blockers.flatMap((blocker) => {
    if (typeof blocker === "string") return [blocker];
    if (!blocker || typeof blocker !== "object") return [];
    const missingFields = (blocker as { missingFields?: unknown })
      .missingFields;
    return Array.isArray(missingFields)
      ? missingFields.filter(
          (field): field is string => typeof field === "string",
        )
      : [];
  });
  return values.length > 0 ? `Completa: ${values.join(", ")}` : undefined;
}

function pdfHref(
  evidence: Array<{
    _id: Id<"evidenceArtifacts">;
    documentId?: Id<"documents">;
    kind: string;
    createdAt: number;
  }>,
  documentIds: Id<"documents">[],
): string | undefined {
  const artifact = evidence
    .filter(
      (item) =>
        item.kind === "pdf" &&
        item.documentId &&
        documentIds.includes(item.documentId),
    )
    .sort((left, right) => right.createdAt - left.createdAt)[0];
  return artifact ? `/api/evidence/${artifact._id}` : undefined;
}

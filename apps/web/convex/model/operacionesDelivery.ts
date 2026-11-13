import { currentManifestDocument } from "./currentManifest";

export type OperacionesDeliveryKind = "loading_order" | "manifest_numbers" | "official_manifest" | "official_remesa";

export type DeliveryDocument = {
  _id: string;
  kind: string;
  number?: string;
  officialState?: string;
  updatedAt: number;
};

export type DeliveryPlanItem = {
  kind: OperacionesDeliveryKind;
  deliveryKey: string;
  label: string;
  number?: string;
  documentId?: string;
  manifestNumber?: string;
  remesaNumber?: string;
  fileName?: string;
};

export function buildOperacionesDeliveryPlan(input: {
  code: string;
  expediente: {
    manifestDocumentId?: string;
    sourceManifestDocumentId?: string;
    manifestNumber?: string;
    manifestDraft?: { manifestNumber?: string } | null;
  };
  documents: DeliveryDocument[];
}): DeliveryPlanItem[] {
  const official = (document: DeliveryDocument | undefined) =>
    Boolean(document && (document.officialState === "authorized" || document.officialState === "fulfilled"));
  const latest = (kind: string) =>
    input.documents
      .filter((document) => document.kind === kind && official(document))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  const items: DeliveryPlanItem[] = [];
  const order = latest("orden_cargue")[0];
  const remesa = latest("remesa").sort((left, right) => (left.number ?? "").localeCompare(right.number ?? ""))[0];
  const manifestCandidate = currentManifestDocument(input.expediente, input.documents);
  const manifest = official(manifestCandidate) ? manifestCandidate : undefined;

  if (order?.number) {
    items.push({
      kind: "loading_order",
      deliveryKey: `${input.code}:orden:${order.number}`,
      label: "Orden de cargue",
      number: order.number,
      documentId: order._id,
      fileName: `orden-cargue-${fileToken(order.number)}.pdf`
    });
  }

  if (manifest?.number && remesa?.number) {
    items.push({
      kind: "manifest_numbers",
      deliveryKey: `${input.code}:numeros:${manifest.number}:${remesa.number}`,
      label: "Números de manifiesto y remesa",
      number: `${manifest.number} / ${remesa.number}`,
      manifestNumber: manifest.number,
      remesaNumber: remesa.number
    });
  }

  if (remesa?.number) {
    items.push({
      kind: "official_remesa",
      deliveryKey: `${input.code}:remesa:${remesa.number}`,
      label: "Remesa",
      number: remesa.number,
      documentId: remesa._id,
      fileName: `remesa-${fileToken(remesa.number)}.pdf`
    });
  }

  if (manifest?.number) {
    items.push({
      kind: "official_manifest",
      deliveryKey: `${input.code}:manifiesto:${manifest.number}`,
      label: "Manifiesto",
      number: manifest.number,
      documentId: manifest._id,
      fileName: `manifiesto-${fileToken(manifest.number)}.pdf`
    });
  }

  return items;
}

function fileToken(value: string): string {
  return value.replace(/[^A-Za-z0-9-]+/g, "-");
}

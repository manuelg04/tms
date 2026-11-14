import { changedDraftFields, currentRevision, formIsStale } from "../../convex/model/draftRevision";

export const STALE_FORM_MESSAGE = "Este documento cambió desde que abriste el formulario: otra persona u otra pestaña lo guardó. Recarga los datos antes de guardar o emitir.";

type Draft = Record<string, unknown> | null | undefined;

export type StaleSource = {
  expediente: { loadingOrderDraft?: Draft; manifestDraft?: Draft; loadingOrderRevision?: number; manifestRevision?: number };
  remesas: ReadonlyArray<{ _id: string; number?: string; sequence: number; draft?: Draft; draftRevision?: number }>;
};

export type OpenedForm = {
  key: string;
  order: number;
  manifest: number;
  remesas: Record<string, number>;
  drafts: { order: Draft; manifest: Draft; remesas: Record<string, Draft> };
};

const ORDER_LABELS: Record<string, string> = {
  sender: "remitente",
  recipient: "destinatario",
  loading: "sitio y cita de cargue",
  unloading: "sitio y cita de descargue",
  cargoDescription: "mercancía",
  merchandiseCode: "mercancía",
  weightTons: "peso",
  cargoQuantity: "cantidad",
  packagingCode: "empaque",
  natureOfCargo: "naturaleza de la carga",
  driverFreight: "flete del conductor",
  observations: "observaciones",
  expeditionDate: "fecha",
  minLoadingDate: "fechas de cargue",
  maxLoadingDate: "fechas de cargue"
};

const REMESA_LABELS: Record<string, string> = {
  sender: "remitente y sede",
  recipient: "destinatario y sede",
  loading: "sitio de cargue",
  unloading: "sitio de descargue",
  remissions: "remisiones",
  declaredValue: "valor declarado",
  consignmentValue: "valor de la remesa",
  policyNumber: "póliza",
  policyExpiresOn: "póliza",
  insurerNit: "póliza",
  packagingCode: "empaque",
  merchandiseCode: "mercancía",
  natureOfCargo: "naturaleza de la carga",
  generalObservations: "observaciones",
  transporterObservations: "observaciones",
  expeditionDate: "fecha",
  consignmentClass: "tipo de remesa"
};

const MANIFEST_LABELS: Record<string, string> = {
  freightTotal: "flete",
  advance: "anticipo",
  netPayable: "neto a pagar",
  withholdingSource: "retenciones",
  withholdingIca: "retenciones",
  observations: "observaciones",
  issueDate: "fechas",
  estimatedDeliveryDate: "fechas",
  paymentDate: "fechas",
  manifestType: "tipo de manifiesto",
  operationScope: "alcance",
  monitoringCompanyNit: "empresa de monitoreo",
  paymentResponsible: "responsable de pago",
  originMunicipalityCode: "origen",
  originCityName: "origen",
  destinationMunicipalityCode: "destino",
  destinationCityName: "destino"
};

export function captureOpenedForm(key: string, source: StaleSource): OpenedForm {
  return {
    key,
    order: currentRevision(source.expediente.loadingOrderRevision),
    manifest: currentRevision(source.expediente.manifestRevision),
    remesas: Object.fromEntries(source.remesas.map((remesa) => [remesa._id, currentRevision(remesa.draftRevision)])),
    drafts: {
      order: source.expediente.loadingOrderDraft,
      manifest: source.expediente.manifestDraft,
      remesas: Object.fromEntries(source.remesas.map((remesa) => [remesa._id, remesa.draft]))
    }
  };
}

function named(prefix: string, fields: string[]): string[] {
  return (fields.length > 0 ? fields : ["datos guardados"]).map((field) => `${prefix}: ${field}`);
}

export function staleFormChanges(stage: string | null, opened: OpenedForm, live: StaleSource): string[] | null {
  const changes: string[] = [];
  const orderStale = formIsStale(opened.order, live.expediente.loadingOrderRevision);
  if ((stage === "orden_cargue" || stage === "remesas") && orderStale) {
    changes.push(...named("orden de cargue", changedDraftFields(opened.drafts.order, live.expediente.loadingOrderDraft, ORDER_LABELS)));
  }
  if (stage === "remesas") {
    for (const remesa of live.remesas) {
      const openedRevision = opened.remesas[remesa._id];
      if (openedRevision === undefined || !formIsStale(openedRevision, remesa.draftRevision)) continue;
      changes.push(...named(`remesa ${remesa.number ?? remesa.sequence}`, changedDraftFields(opened.drafts.remesas[remesa._id], remesa.draft, REMESA_LABELS)));
    }
  }
  if (stage === "manifiesto" && formIsStale(opened.manifest, live.expediente.manifestRevision)) {
    changes.push(...named("manifiesto", changedDraftFields(opened.drafts.manifest, live.expediente.manifestDraft, MANIFEST_LABELS)));
  }
  return changes.length > 0 ? [...new Set(changes)] : null;
}

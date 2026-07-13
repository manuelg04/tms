import type { FulfillmentState, OfficialDocumentState } from "./documentLifecycle";

export type EmissionScope = "orden" | "remesas" | "manifiesto" | "todo";

export function bogotaDate(epochMs: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(epochMs);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export type DispatchWorkflowVariant = "standard" | "remesa_without_order" | "empty_manifest" | "transshipment";

export type EmissionScopeTargets = {
  order: boolean;
  consignments: boolean;
  manifest: boolean;
  trip: boolean;
  assignment: boolean;
};

export function emissionScopeTargets(
  scope: EmissionScope,
  workflowVariant: DispatchWorkflowVariant = "standard"
): EmissionScopeTargets {
  const order = (scope === "orden" || scope === "todo") && (workflowVariant === "standard" || workflowVariant === "transshipment");
  const consignments = (scope === "remesas" || scope === "todo") && workflowVariant !== "empty_manifest";
  const manifest = scope === "manifiesto" || scope === "todo";
  const trip = manifest && (workflowVariant === "standard" || workflowVariant === "transshipment");
  return { order, consignments, manifest, trip, assignment: order || manifest };
}

export function emissionDependencyBlockers(
  scope: EmissionScope,
  input: {
    workflowVariant?: DispatchWorkflowVariant;
    orderOfficialState: OfficialDocumentState;
    consignmentOfficialStates: OfficialDocumentState[];
  }
): string[] {
  const variant = input.workflowVariant ?? "standard";

  if (scope === "todo") {
    return [];
  }

  if (scope === "orden" && (variant === "remesa_without_order" || variant === "empty_manifest")) {
    return ["Este flujo no usa orden de cargue"];
  }

  if (scope === "remesas") {
    if (variant === "empty_manifest") {
      return ["El manifiesto vacío no usa remesas"];
    }
    if ((variant === "standard" || variant === "transshipment") && !officiallyAuthorized(input.orderOfficialState)) {
      return ["Requiere orden de cargue autorizada"];
    }
  }

  if (
    scope === "manifiesto" &&
    variant !== "empty_manifest" &&
    (input.consignmentOfficialStates.length === 0 || input.consignmentOfficialStates.some((state) => !officiallyAuthorized(state)))
  ) {
    return ["Requiere todas las remesas autorizadas"];
  }

  return [];
}

function officiallyAuthorized(state: OfficialDocumentState): boolean {
  return state === "authorized" || state === "fulfilled";
}

export type DispatchStage =
  | "orden_cargue"
  | "remesas"
  | "vehiculo_conductor"
  | "manifiesto"
  | "envio_rndc"
  | "cargue_descargue"
  | "cumplido_inicial"
  | "cumplido_final"
  | "cumplido"
  | "anulado";

export type ConsignmentProjection = {
  missingFields: string[];
  officialState: OfficialDocumentState;
  fulfillmentState: FulfillmentState;
};

export type DispatchProjection = {
  annulled: boolean;
  workflowVariant?: DispatchWorkflowVariant;
  loadingOrder: { missingFields: string[]; officialState: OfficialDocumentState } | null;
  consignments: ConsignmentProjection[];
  assignment: { vehicleAssigned: boolean; driverAssigned: boolean };
  manifest: { missingFields: string[]; officialState: OfficialDocumentState; fulfillmentState: FulfillmentState } | null;
  cargoInfoState: OfficialDocumentState;
  logistics: { originComplete: boolean; destinationComplete: boolean; finalDeliveryRecorded: boolean };
};

export type DispatchStageResult = {
  stage: DispatchStage;
  blockers: string[];
};

export function deriveDispatchStage(projection: DispatchProjection): DispatchStageResult {
  if (projection.annulled) {
    return { stage: "anulado", blockers: [] };
  }

  const legacyAuthorizedChain = projection.consignments.length > 0
    && projection.consignments.every((consignment) => !editableOfficialState(consignment.officialState))
    && Boolean(projection.manifest && !editableOfficialState(projection.manifest.officialState));

  if (projection.workflowVariant !== "remesa_without_order" && projection.workflowVariant !== "empty_manifest" && (!projection.loadingOrder || projection.loadingOrder.missingFields.length > 0) && editableOfficialState(projection.cargoInfoState) && !legacyAuthorizedChain) {
    return { stage: "orden_cargue", blockers: projection.loadingOrder?.missingFields ?? ["Orden de cargue sin iniciar"] };
  }

  if (projection.workflowVariant !== "empty_manifest" && projection.consignments.length === 0) {
    return { stage: "remesas", blockers: ["El despacho no tiene remesas"] };
  }

  const consignmentBlockers = projection.consignments.flatMap((consignment, index) =>
    editableOfficialState(consignment.officialState) ? consignment.missingFields.map((field) => `Remesa ${index + 1}: ${field}`) : []
  );

  if (consignmentBlockers.length > 0) {
    return { stage: "remesas", blockers: consignmentBlockers };
  }

  if (!projection.assignment.vehicleAssigned || !projection.assignment.driverAssigned) {
    const blockers = [];
    if (!projection.assignment.vehicleAssigned) {
      blockers.push("Falta asignar el vehículo");
    }
    if (!projection.assignment.driverAssigned) {
      blockers.push("Falta asignar el conductor");
    }
    return { stage: "vehiculo_conductor", blockers };
  }

  if (!projection.manifest || (projection.manifest.missingFields.length > 0 && editableOfficialState(projection.manifest.officialState))) {
    return { stage: "manifiesto", blockers: projection.manifest?.missingFields ?? ["Manifiesto sin preparar"] };
  }

  const officialStates = [
    ...(legacyAuthorizedChain ? [] : [projection.cargoInfoState]),
    ...projection.consignments.map((consignment) => consignment.officialState),
    projection.manifest.officialState
  ];

  if (officialStates.some((state) => state === "draft" || state === "pending")) {
    return { stage: "envio_rndc", blockers: [] };
  }

  if (
    !projection.logistics.originComplete ||
    !projection.logistics.destinationComplete ||
    !projection.logistics.finalDeliveryRecorded
  ) {
    return { stage: "cargue_descargue", blockers: [] };
  }

  if (projection.workflowVariant !== "empty_manifest" && !canFulfillManifest(projection.consignments)) {
    return { stage: "cumplido_inicial", blockers: [] };
  }

  if (projection.manifest.fulfillmentState !== "fulfilled") {
    return { stage: "cumplido_final", blockers: [] };
  }

  return { stage: "cumplido", blockers: [] };
}

function editableOfficialState(state: OfficialDocumentState): boolean {
  return state === "draft" || state === "pending";
}

export function canFulfillManifest(consignments: ConsignmentProjection[]): boolean {
  return consignments.length > 0 && consignments.every((consignment) => consignment.fulfillmentState === "fulfilled");
}

export type PartyDraft = {
  name?: string;
  identificationType?: string;
  identificationNumber?: string;
  siteCode?: string;
  address?: string;
  cityName?: string;
  municipalityCode?: string;
  phone?: string;
  cellphone?: string;
};

export type SiteAppointmentDraft = {
  siteName?: string;
  address?: string;
  cityName?: string;
  municipalityCode?: string;
  latitude?: string;
  longitude?: string;
  appointmentAt?: number;
  agreedHours?: string;
};

export type LoadingOrderDraft = {
  orderNumber?: string;
  expeditionDate?: string;
  agencyCode?: string;
  customerId?: string;
  customerReference?: string;
  sender?: PartyDraft;
  recipient?: PartyDraft;
  loading?: SiteAppointmentDraft;
  unloading?: SiteAppointmentDraft;
  cargoDescription?: string;
  cargoQuantity?: string;
  cargoUnit?: string;
  weightTons?: string;
  volumeM3?: string;
  packagingCode?: string;
  merchandiseCode?: string;
  natureOfCargo?: string;
  minLoadingDate?: string;
  maxLoadingDate?: string;
  driverFreight?: string;
  sealNumbers?: string;
  loadingConditions?: string;
  specialPackaging?: string;
  observations?: string;
  generatesConsignment?: boolean;
  printedAt?: number;
};

export type RemissionLineDraft = {
  remissionNumber?: string;
  quantity?: string;
  packagingClass?: string;
  description?: string;
  weightTons?: string;
  volumeM3?: string;
};

export type ConsignmentDraft = {
  expeditionDate?: string;
  consignmentClass?: "municipal" | "terrestre_carga";
  agencyCode?: string;
  sender?: PartyDraft;
  recipient?: PartyDraft;
  loading?: SiteAppointmentDraft;
  unloading?: SiteAppointmentDraft;
  declaredValue?: string;
  consignmentValue?: string;
  insurancePercent?: string;
  policyNumber?: string;
  insurerName?: string;
  insurerNit?: string;
  policyExpiresOn?: string;
  remissions?: RemissionLineDraft[];
  unitOfMeasure?: string;
  packagingCode?: string;
  natureOfCargo?: string;
  merchandiseCode?: string;
  transporterObservations?: string;
  generalObservations?: string;
  printedAt?: number;
};

export type ManifestDraft = {
  manifestNumber?: string;
  issueDate?: string;
  estimatedDeliveryDate?: string;
  operationScope?: "municipal" | "intermunicipal";
  manifestType?: string;
  agencyCode?: string;
  originCityName?: string;
  originMunicipalityCode?: string;
  destinationCityName?: string;
  destinationMunicipalityCode?: string;
  freightTotal?: string;
  advance?: string;
  withholdingSource?: string;
  withholdingIca?: string;
  fopatContribution?: string;
  adjustments?: string;
  netPayable?: string;
  paymentResponsible?: string;
  loadingResponsible?: string;
  unloadingResponsible?: string;
  paymentDate?: string;
  observations?: string;
  sourceManifestNumber?: string;
  emptyManifestReason?: string;
  printedAt?: number;
};

function present(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

function partyComplete(party: PartyDraft | undefined): boolean {
  return !!party && present(party.name) && present(party.identificationNumber);
}

function siteComplete(site: SiteAppointmentDraft | undefined): boolean {
  return !!site && present(site.address) && present(site.cityName) && site.appointmentAt !== undefined;
}

export function loadingOrderMissingFields(draft: LoadingOrderDraft | null | undefined): string[] {
  const missing: string[] = [];

  if (!draft) {
    return ["Orden de cargue sin iniciar"];
  }

  if (!draft.customerId) {
    missing.push("Cliente");
  }
  if (!partyComplete(draft.sender)) {
    missing.push("Remitente con identificación");
  } else if (!present(draft.sender?.identificationType) || !present(draft.sender?.siteCode) || !present(draft.sender?.municipalityCode)) {
    missing.push("Datos RNDC del remitente");
  }
  if (!partyComplete(draft.recipient)) {
    missing.push("Destinatario con identificación");
  } else if (!present(draft.recipient?.identificationType) || !present(draft.recipient?.siteCode) || !present(draft.recipient?.municipalityCode)) {
    missing.push("Datos RNDC del destinatario");
  }
  if (!siteComplete(draft.loading)) {
    missing.push("Sitio y cita de cargue");
  }
  if (!siteComplete(draft.unloading)) {
    missing.push("Sitio y cita de descargue");
  }
  if (!present(draft.cargoDescription)) {
    missing.push("Mercancía");
  }
  if (!present(draft.weightTons)) {
    missing.push("Peso (TN)");
  }
  if (!present(draft.packagingCode)) {
    missing.push("Tipo de empaque");
  }
  if (!present(draft.merchandiseCode)) {
    missing.push("Código de mercancía");
  }
  if (!present(draft.natureOfCargo)) {
    missing.push("Naturaleza de la carga");
  }

  return missing;
}

export function consignmentMissingFields(
  draft: ConsignmentDraft | null | undefined,
  order: LoadingOrderDraft | null | undefined
): string[] {
  const missing: string[] = [];

  if (!draft) {
    return ["Remesa sin datos"];
  }

  if (!draft.consignmentClass) {
    missing.push("Clase de remesa");
  }
  if (!partyComplete(draft.sender) && !partyComplete(order?.sender)) {
    missing.push("Remitente");
  }
  if (!partyComplete(draft.recipient) && !partyComplete(order?.recipient)) {
    missing.push("Destinatario");
  }
  if (!siteComplete(draft.loading) && !siteComplete(order?.loading)) {
    missing.push("Sitio y cita de cargue");
  }
  if (!siteComplete(draft.unloading) && !siteComplete(order?.unloading)) {
    missing.push("Sitio y cita de descargue");
  }
  if (!present(draft.declaredValue)) {
    missing.push("Valor declarado");
  }
  if (!present(draft.policyNumber) || !present(draft.policyExpiresOn) || !present(draft.insurerNit)) {
    missing.push("Póliza de la carga");
  }

  const sender = draft.sender ?? order?.sender;
  const recipient = draft.recipient ?? order?.recipient;
  if (!present(sender?.identificationType) || !present(sender?.siteCode) || !present(sender?.municipalityCode)) {
    missing.push("Datos RNDC del remitente");
  }
  if (!present(recipient?.identificationType) || !present(recipient?.siteCode) || !present(recipient?.municipalityCode)) {
    missing.push("Datos RNDC del destinatario");
  }
  if (!present(draft.merchandiseCode ?? order?.merchandiseCode) || !present(draft.natureOfCargo ?? order?.natureOfCargo) || !present(draft.packagingCode ?? order?.packagingCode)) {
    missing.push("Clasificación RNDC de la carga");
  }

  const remissions = draft.remissions ?? [];
  const remissionsComplete =
    remissions.length > 0 &&
    remissions.every((line) => present(line.quantity) && present(line.description) && present(line.weightTons));

  if (!remissionsComplete && !(present(order?.cargoDescription) && present(order?.weightTons))) {
    missing.push("Remisiones con cantidad, descripción y peso");
  }

  return missing;
}

export function manifestMissingFields(draft: ManifestDraft | null | undefined): string[] {
  const missing: string[] = [];

  if (!draft) {
    return ["Manifiesto sin preparar"];
  }

  if (!present(draft.issueDate)) {
    missing.push("Fecha de expedición");
  }
  if (!present(draft.estimatedDeliveryDate)) {
    missing.push("Entrega estimada");
  }
  if (!draft.operationScope) {
    missing.push("Alcance de la operación");
  }
  if (!present(draft.manifestType)) {
    missing.push("Tipo de manifiesto");
  }
  if (!present(draft.freightTotal)) {
    missing.push("Flete total");
  }
  if (!present(draft.paymentResponsible)) {
    missing.push("Responsable de pago");
  }

  return missing;
}

export function effectiveConsignment(
  draft: ConsignmentDraft,
  order: LoadingOrderDraft | null | undefined
): ConsignmentDraft {
  const remissions = draft.remissions ?? [];
  const inheritedRemissions = remissions.length === 0
    ? order && present(order.cargoDescription)
      ? [{
          quantity: order.cargoQuantity,
          description: order.cargoDescription,
          weightTons: order.weightTons,
          volumeM3: order.volumeM3,
          packagingClass: order.packagingCode
        }]
      : remissions
    : remissions.map((line) => ({
        ...line,
        quantity: present(line.quantity) ? line.quantity : order?.cargoQuantity,
        description: present(line.description) ? line.description : order?.cargoDescription,
        weightTons: present(line.weightTons) ? line.weightTons : order?.weightTons,
        volumeM3: present(line.volumeM3) ? line.volumeM3 : order?.volumeM3,
        packagingClass: present(line.packagingClass) ? line.packagingClass : order?.packagingCode
      }));

  return {
    ...draft,
    expeditionDate: draft.expeditionDate ?? order?.expeditionDate,
    agencyCode: draft.agencyCode ?? order?.agencyCode,
    sender: partyComplete(draft.sender) ? draft.sender : order?.sender ?? draft.sender,
    recipient: partyComplete(draft.recipient) ? draft.recipient : order?.recipient ?? draft.recipient,
    loading: siteComplete(draft.loading) ? draft.loading : order?.loading ?? draft.loading,
    unloading: siteComplete(draft.unloading) ? draft.unloading : order?.unloading ?? draft.unloading,
    packagingCode: draft.packagingCode ?? order?.packagingCode,
    merchandiseCode: draft.merchandiseCode ?? order?.merchandiseCode,
    natureOfCargo: draft.natureOfCargo ?? order?.natureOfCargo,
    remissions: inheritedRemissions
  };
}

export type EditableStage = "orden_cargue" | "remesa" | "manifiesto" | "asignacion";

export function assertStageEditable(
  stage: EditableStage,
  state: { officialState: OfficialDocumentState; cargoInfoState?: OfficialDocumentState }
): void {
  if (stage === "orden_cargue" && state.cargoInfoState !== undefined && state.cargoInfoState !== "draft") {
    throw new Error("La orden de cargue ya tiene una transmisión RNDC asociada y no puede editarse");
  }

  if (state.officialState !== "draft") {
    throw new Error("Un documento oficial no puede editarse; use corregir o anular");
  }
}

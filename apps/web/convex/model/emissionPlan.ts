import type { OfficialDocumentState } from "./documentLifecycle";
import {
  emissionDependencyBlockers,
  emissionScopeTargets,
  type ConsignmentDraft,
  type DispatchWorkflowVariant,
  type EmissionScope,
  type LoadingOrderDraft,
  type ManifestDraft
} from "./dispatchWorkflow";

export type { EmissionScope } from "./dispatchWorkflow";

export type AssignmentSnapshotData = {
  driver: { document?: string; documentType?: string; name?: string; cellphone?: string; phone1?: string; address?: string; city?: string; cityCode?: string; licenseNumber?: string; licenseCategory?: string; licenseExpiresAt?: string } | null;
  secondDriver: { document?: string; documentType?: string; name?: string } | null;
  vehicle: {
    plate?: string;
    trailer?: string;
    make?: string;
    line?: string;
    modelYear?: string;
    color?: string;
    configuration?: string;
    emptyWeightTn?: string;
    capacityTn?: string;
    insurerNit?: string;
    soatExpiresAt?: string;
    soatNumber?: string;
    possessorDocument?: string;
    possessorName?: string;
    possessorCellphone?: string;
    possessorPhone?: string;
    ownerDocument?: string;
    ownerName?: string;
  } | null;
  vehicleHolder?: { documentType?: string; document?: string; name?: string; phone?: string; address?: string; cityCode?: string; cityName?: string } | null;
  trailer: { plate?: string } | null;
};

export type EmissionPlanInput = {
  workflowVariant?: DispatchWorkflowVariant;
  order: { number?: string; snapshot: (LoadingOrderDraft & Record<string, unknown>) | null; officialState: OfficialDocumentState };
  consignments: Array<{
    remesaId: string;
    number?: string;
    snapshot: (ConsignmentDraft & Record<string, unknown>) | null;
    officialState: OfficialDocumentState;
  }>;
  manifest: { number?: string; snapshot: (ManifestDraft & Record<string, unknown>) | null; officialState: OfficialDocumentState };
  assignment: AssignmentSnapshotData | null;
  tripNumber?: string;
  tripEmitted: boolean;
  operationsInFlight: Array<{ operationType: string; status: string }>;
};

export type EmissionStepAction = "emit_loading_order" | "emit_remesa" | "register_trip" | "issue_manifest";

export type EmissionPlanStep = {
  key: string;
  action: EmissionStepAction;
  documentKind: "orden_cargue" | "remesa" | "manifiesto";
  documentNumber: string;
  remesaId?: string;
  state: "pending" | "authorized" | "blocked";
  payload: Record<string, unknown>;
  missingFields: string[];
};

export type EmissionPlanResult =
  | { ok: false; reason: "uncertain" | "in_flight" | "not_prepared"; blockers: string[] }
  | { ok: true; steps: EmissionPlanStep[] };

const emissionOperationTypes = new Set(["emit_cargo", "emit_trip", "emit_remesa", "emit_manifest"]);

const emptyAssignment: AssignmentSnapshotData = {
  driver: null,
  secondDriver: null,
  vehicle: null,
  trailer: null
};

const idTypeCodes: Record<string, string> = {
  C: "C",
  N: "N",
  E: "E",
  P: "P",
  CC: "C",
  "C.C": "C",
  "C.C.": "C",
  CEDULA: "C",
  "CEDULA DE CIUDADANIA": "C",
  NIT: "N",
  "N.I.T": "N",
  "N.I.T.": "N",
  CE: "E",
  "C.E": "E",
  "CEDULA DE EXTRANJERIA": "E",
  PASAPORTE: "P"
};

export function buildEmissionPlan(input: EmissionPlanInput, scope: EmissionScope = "todo"): EmissionPlanResult {
  const uncertain = input.operationsInFlight.filter(
    (operation) => emissionOperationTypes.has(operation.operationType) && operation.status === "uncertain"
  );

  if (uncertain.length > 0) {
    return {
      ok: false,
      reason: "uncertain",
      blockers: ["Hay una operación RNDC con resultado incierto; concíliela antes de continuar"]
    };
  }

  const inFlight = input.operationsInFlight.filter(
    (operation) =>
      emissionOperationTypes.has(operation.operationType) &&
      (operation.status === "queued" || operation.status === "claimed" || operation.status === "reconciling")
  );

  if (inFlight.length > 0) {
    return {
      ok: false,
      reason: "in_flight",
      blockers: ["Hay una emisión en curso para este despacho; espere a que termine"]
    };
  }

  const notPrepared: string[] = [];
  const variant = input.workflowVariant ?? "standard";
  const targets = emissionScopeTargets(scope, variant);
  const includesOrder = targets.order;
  const includesConsignments = targets.consignments;
  const includesManifest = targets.manifest;
  const dependencies = emissionDependencyBlockers(scope, {
    workflowVariant: variant,
    orderOfficialState: input.order.officialState,
    consignmentOfficialStates: input.consignments.map((consignment) => consignment.officialState)
  });

  if (dependencies.length > 0) {
    return { ok: false, reason: "not_prepared", blockers: dependencies };
  }

  if (includesOrder && (!input.order.number || (!input.order.snapshot && !isAuthorized(input.order.officialState)))) {
    notPrepared.push("Falta la fotografía de la orden de cargue");
  }
  if (includesConsignments && input.consignments.length === 0) {
    notPrepared.push("El despacho no tiene remesas");
  }
  if (includesConsignments) {
    for (const consignment of input.consignments) {
      if (!consignment.number || (!consignment.snapshot && !isAuthorized(consignment.officialState))) {
        notPrepared.push(`Falta la fotografía de la remesa ${consignment.number ?? consignment.remesaId}`);
      }
    }
  }
  if (includesManifest && (!input.manifest.number || (!input.manifest.snapshot && !isAuthorized(input.manifest.officialState)))) {
    notPrepared.push("Falta la fotografía del manifiesto");
  }
  if (targets.assignment && !input.assignment) {
    notPrepared.push("Falta la fotografía de la asignación de vehículo y conductor");
  }
  if (targets.trip && !input.tripNumber) {
    notPrepared.push("Falta el consecutivo de información de viaje");
  }
  if (targets.trip && !input.order.number) {
    notPrepared.push("Falta el número de la orden de cargue autorizada");
  }

  if (notPrepared.length > 0) {
    return { ok: false, reason: "not_prepared", blockers: notPrepared };
  }

  const order = input.order.snapshot ?? {};
  const orderNumber = input.order.number;
  const manifest = input.manifest.snapshot ?? {};
  const manifestNumber = input.manifest.number;
  const assignment = input.assignment ?? emptyAssignment;
  const tripNumber = input.tripNumber;
  const steps: EmissionPlanStep[] = [];

  if (includesOrder && orderNumber) {
    steps.push(
      finishStep(
        {
          key: `cargo:${orderNumber}`,
          action: "emit_loading_order",
          documentKind: "orden_cargue",
          documentNumber: orderNumber
        },
        buildCargoPayload(orderNumber, order, assignment),
        isAuthorized(input.order.officialState)
      )
    );
  }

  if (includesConsignments) {
    for (const consignment of input.consignments) {
      const snapshot = consignment.snapshot ?? {};
      steps.push(
        finishStep(
          {
            key: `remesa:${consignment.number!}`,
            action: "emit_remesa",
            documentKind: "remesa",
            documentNumber: consignment.number!,
            remesaId: consignment.remesaId
          },
          buildConsignmentPayload(consignment.number!, orderNumber, snapshot, assignment, variant),
          isAuthorized(consignment.officialState)
        )
      );
    }
  }

  if (targets.trip && tripNumber && orderNumber && manifestNumber) {
    steps.push(
      finishStep(
        {
          key: `viaje:${tripNumber}`,
          action: "register_trip",
          documentKind: "manifiesto",
          documentNumber: manifestNumber
        },
        buildTripPayload(tripNumber, orderNumber, order, manifest, assignment),
        input.tripEmitted
      )
    );
  }

  if (includesManifest && manifestNumber) {
    steps.push(
      finishStep(
        {
          key: `manifiesto:${manifestNumber}`,
          action: "issue_manifest",
          documentKind: "manifiesto",
          documentNumber: manifestNumber
        },
        buildManifestPayload(manifestNumber, tripNumber, orderNumber, input.consignments, order, manifest, assignment, variant),
        isAuthorized(input.manifest.officialState)
      )
    );
  }

  return { ok: true, steps };
}

type PayloadDraft = {
  payload: Record<string, unknown>;
  missingFields: string[];
};

function finishStep(
  base: Omit<EmissionPlanStep, "state" | "payload" | "missingFields">,
  draft: PayloadDraft,
  authorized: boolean
): EmissionPlanStep {
  return {
    ...base,
    payload: draft.payload,
    missingFields: draft.missingFields,
    state: authorized ? "authorized" : draft.missingFields.length > 0 ? "blocked" : "pending"
  };
}

function isAuthorized(state: OfficialDocumentState): boolean {
  return state === "authorized" || state === "fulfilled";
}

function buildCargoPayload(orderNumber: string, order: LoadingOrderDraft, assignment: AssignmentSnapshotData): PayloadDraft {
  const missing: string[] = [];
  const sender = partyPayload(order.sender, "sender", missing);
  const recipient = partyPayload(order.recipient, "recipient", missing);
  const loadingDate = appointmentDate(order.loading?.appointmentAt, "loadingAppointment", missing);
  const unloadingDate = appointmentDate(order.unloading?.appointmentAt, "unloadingAppointment", missing);
  const payload: Record<string, unknown> = {
    cargoNumber: orderNumber,
    expeditionDate: requireField(order.expeditionDate, "expeditionDate", missing),
    loadingAppointmentDate: loadingDate?.date,
    loadingAppointmentTime: loadingDate?.time,
    unloadingAppointmentDate: unloadingDate?.date,
    unloadingAppointmentTime: unloadingDate?.time,
    sender,
    recipient,
    driver: driverPayload(assignment, []),
    vehicle: vehiclePayload(assignment, []),
    cargo: cargoPayload(
      {
        shortDescription: order.cargoDescription,
        merchandiseCode: order.merchandiseCode,
        packageCode: order.packagingCode,
        natureCode: order.natureOfCargo,
        weightTons: order.weightTons,
        declaredValue: undefined
      },
      missing
    ),
    observations: order.observations
  };
  return { payload: prune(payload), missingFields: missing };
}

function buildConsignmentPayload(
  remesaNumber: string,
  cargoNumber: string | undefined,
  snapshot: ConsignmentDraft,
  assignment: AssignmentSnapshotData,
  workflowVariant: EmissionPlanInput["workflowVariant"]
): PayloadDraft {
  const missing: string[] = [];
  const sender = partyPayload(snapshot.sender, "sender", missing);
  const recipient = partyPayload(snapshot.recipient, "recipient", missing);
  const loadingDate = appointmentDate(snapshot.loading?.appointmentAt, "loadingAppointment", missing);
  const unloadingDate = appointmentDate(snapshot.unloading?.appointmentAt, "unloadingAppointment", missing);
  const firstRemission = snapshot.remissions?.[0];
  const payload: Record<string, unknown> = {
    remesaNumber,
    cargoNumber,
    workflowVariant,
    expeditionDate: requireField(snapshot.expeditionDate, "expeditionDate", missing),
    loadingAppointmentDate: loadingDate?.date,
    loadingAppointmentTime: loadingDate?.time,
    unloadingAppointmentDate: unloadingDate?.date,
    unloadingAppointmentTime: unloadingDate?.time,
    sender,
    recipient,
    driver: driverPayload(assignment, []),
    vehicle: vehiclePayload(assignment, []),
    cargo: cargoPayload(
      {
        shortDescription: firstRemission?.description,
        merchandiseCode: snapshot.merchandiseCode,
        packageCode: snapshot.packagingCode ?? firstRemission?.packagingClass,
        natureCode: snapshot.natureOfCargo,
        weightTons: firstRemission?.weightTons,
        declaredValue: snapshot.declaredValue
      },
      missing
    ),
    cargoPolicy: policyPayload(snapshot, missing),
    observations: snapshot.generalObservations
  };
  return { payload: prune(payload), missingFields: missing };
}

function buildTripPayload(
  tripNumber: string,
  cargoNumber: string,
  order: LoadingOrderDraft,
  manifest: ManifestDraft,
  assignment: AssignmentSnapshotData
): PayloadDraft {
  const missing: string[] = [];
  const payload: Record<string, unknown> = {
    tripNumber,
    cargoNumber,
    driver: driverPayload(assignment, missing),
    vehicle: vehiclePayload(assignment, missing),
    sender: { cityCode: requireField(originCityCode(order, manifest), "sender.cityCode", missing) },
    recipient: { cityCode: requireField(destinationCityCode(order, manifest), "recipient.cityCode", missing) },
    money: { freightValue: requireMoney(manifest.freightTotal, "money.freightValue", missing) }
  };
  return { payload: prune(payload), missingFields: missing };
}

function buildManifestPayload(
  manifestNumber: string,
  tripNumber: string | undefined,
  cargoNumber: string | undefined,
  consignments: EmissionPlanInput["consignments"],
  order: LoadingOrderDraft,
  manifest: ManifestDraft,
  assignment: AssignmentSnapshotData,
  workflowVariant: EmissionPlanInput["workflowVariant"]
): PayloadDraft {
  const missing: string[] = [];
  const remesaNumbers = consignments.map((item) => item.number!).filter(Boolean);
  const holderId = assignment.vehicleHolder?.document ?? assignment.vehicle?.possessorDocument ?? assignment.vehicle?.ownerDocument;
  const payload: Record<string, unknown> = {
    manifestNumber,
    tripNumber,
    cargoNumber,
    workflowVariant,
    remesaNumber: remesaNumbers[0],
    manifestRemesas: remesaNumbers.length > 0 ? consignments.map((item) => consignmentSummary(item)) : undefined,
    manifestType: manifest.manifestType,
    sourceManifestNumber: manifest.sourceManifestNumber,
    expeditionDate: requireField(manifest.issueDate, "expeditionDate", missing),
    balancePaymentDate: requireField(manifest.paymentDate ?? manifest.estimatedDeliveryDate, "balancePaymentDate", missing),
    driver: driverPayload(assignment, missing),
    vehicle: vehiclePayload(assignment, missing),
    vehicleHolder: holderPayload(assignment, holderId, missing),
    sender: { ...displayParty(order.sender, order.loading), cityCode: requireField(originCityCode(order, manifest), "sender.cityCode", missing) },
    recipient: { ...displayParty(order.recipient, order.unloading), cityCode: requireField(destinationCityCode(order, manifest), "recipient.cityCode", missing) },
    money: {
      freightValue: requireMoney(manifest.freightTotal, "money.freightValue", missing),
      advanceValue: requireMoney(manifest.advance ?? "0", "money.advanceValue", missing),
      icaRetentionPerMille: requireMoney(manifest.withholdingIca, "money.icaRetentionPerMille", missing)
    },
    observations: manifest.observations
  };
  return { payload: prune(payload), missingFields: missing };
}

function partyPayload(
  party: LoadingOrderDraft["sender"],
  prefix: string,
  missing: string[]
): Record<string, unknown> {
  return {
    idType: mapIdType(party?.identificationType, `${prefix}.idType`, missing),
    id: requireField(party?.identificationNumber, `${prefix}.id`, missing),
    siteCode: requireField((party as Record<string, unknown> | undefined)?.siteCode as string | undefined, `${prefix}.siteCode`, missing),
    cityCode: requireField(party?.municipalityCode, `${prefix}.cityCode`, missing),
    name: party?.name,
    address: party?.address,
    cityName: party?.cityName
  };
}

function driverPayload(assignment: AssignmentSnapshotData, missing: string[]): Record<string, unknown> {
  return {
    idType: mapIdType(assignment.driver?.documentType, "driver.idType", missing),
    id: requireField(assignment.driver?.document, "driver.id", missing),
    fullName: assignment.driver?.name,
    phone: assignment.driver?.cellphone ?? assignment.driver?.phone1,
    address: assignment.driver?.address,
    cityName: assignment.driver?.city,
    cityCode: assignment.driver?.cityCode,
    licenseNumber: assignment.driver?.licenseNumber,
    licenseCategory: assignment.driver?.licenseCategory,
    licenseExpirationDate: assignment.driver?.licenseExpiresAt
  };
}

function vehiclePayload(assignment: AssignmentSnapshotData, missing: string[]): Record<string, unknown> {
  return {
    plate: requireField(assignment.vehicle?.plate, "vehicle.plate", missing),
    trailerPlate: assignment.trailer?.plate ?? assignment.vehicle?.trailer,
    brand: assignment.vehicle?.make,
    lineCode: assignment.vehicle?.line,
    modelYear: assignment.vehicle?.modelYear,
    colorCode: assignment.vehicle?.color,
    configuration: assignment.vehicle?.configuration,
    rndcConfigurationCode: assignment.vehicle?.configuration,
    emptyWeightKg: positiveTons(assignment.vehicle?.emptyWeightTn),
    capacityKg: positiveTons(assignment.vehicle?.capacityTn),
    insurerNit: assignment.vehicle?.insurerNit,
    soatExpirationDate: assignment.vehicle?.soatExpiresAt,
    soatNumber: assignment.vehicle?.soatNumber
  };
}

function cargoPayload(
  cargo: {
    shortDescription?: string;
    merchandiseCode?: string;
    packageCode?: string;
    natureCode?: string;
    weightTons?: string;
    declaredValue?: string;
  },
  missing: string[]
): Record<string, unknown> {
  return {
    shortDescription: requireField(cargo.shortDescription, "cargo.shortDescription", missing),
    productName: cargo.shortDescription,
    merchandiseCode: requireField(cargo.merchandiseCode, "cargo.merchandiseCode", missing),
    packageCode: requireField(cargo.packageCode, "cargo.packageCode", missing),
    packageName: cargo.packageCode,
    natureCode: requireField(cargo.natureCode, "cargo.natureCode", missing),
    nature: cargo.natureCode,
    quantityKg: tonsToKg(cargo.weightTons, missing),
    declaredValue: cargo.declaredValue !== undefined ? parseMoney(cargo.declaredValue) : undefined
  };
}

function holderPayload(assignment: AssignmentSnapshotData, holderId: string | undefined, missing: string[]) {
  const holder = assignment.vehicleHolder;
  return {
    idType: holder?.documentType ? mapIdType(holder.documentType, "vehicleHolder.idType", missing) : holderId ? "C" : requireField(undefined, "vehicleHolder.idType", missing),
    id: requireField(holderId, "vehicleHolder.id", missing),
    fullName: holder?.name ?? assignment.vehicle?.possessorName ?? assignment.vehicle?.ownerName,
    phone: holder?.phone ?? assignment.vehicle?.possessorCellphone ?? assignment.vehicle?.possessorPhone,
    address: holder?.address,
    cityCode: holder?.cityCode,
    cityName: holder?.cityName
  };
}

function displayParty(party: LoadingOrderDraft["sender"], site: LoadingOrderDraft["loading"]) {
  return { name: party?.name, address: site?.address ?? party?.address, cityName: site?.cityName ?? party?.cityName };
}

function consignmentSummary(item: EmissionPlanInput["consignments"][number]) {
  const snapshot = item.snapshot ?? {};
  const remission = snapshot.remissions?.[0];
  return {
    number: item.number,
    quantityKg: positiveTons(remission?.weightTons),
    nature: snapshot.natureOfCargo,
    productName: remission?.description,
    packageName: snapshot.packagingCode ?? remission?.packagingClass,
    senderName: snapshot.sender?.name,
    recipientName: snapshot.recipient?.name
  };
}

function positiveTons(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 1000) : undefined;
}

function policyPayload(snapshot: ConsignmentDraft, missing: string[]): Record<string, unknown> {
  const insurerNit = (snapshot as Record<string, unknown>).insurerNit as string | undefined;
  return {
    number: requireField(snapshot.policyNumber, "cargoPolicy.number", missing),
    expirationDate: requireField(snapshot.policyExpiresOn, "cargoPolicy.expirationDate", missing),
    insurerNit: requireField(insurerNit, "cargoPolicy.insurerNit", missing)
  };
}

function originCityCode(order: LoadingOrderDraft, manifest: ManifestDraft): string | undefined {
  return manifest.originMunicipalityCode ?? order.loading?.municipalityCode ?? order.sender?.municipalityCode;
}

function destinationCityCode(order: LoadingOrderDraft, manifest: ManifestDraft): string | undefined {
  return manifest.destinationMunicipalityCode ?? order.unloading?.municipalityCode ?? order.recipient?.municipalityCode;
}

function mapIdType(value: string | undefined, field: string, missing: string[]): string | undefined {
  if (!value || !value.trim()) {
    addMissing(field, missing);
    return undefined;
  }

  const mapped = idTypeCodes[value.trim().toUpperCase()];

  if (!mapped) {
    addMissing(field, missing);
    return undefined;
  }

  return mapped;
}

function appointmentDate(
  epochMs: number | undefined,
  field: string,
  missing: string[]
): { date: string; time: string } | undefined {
  if (epochMs === undefined) {
    addMissing(`${field}Date`, missing);
    return undefined;
  }

  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", dateStyle: "short" }).format(epochMs);
  const time = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(epochMs);
  return { date, time };
}

function tonsToKg(weightTons: string | undefined, missing: string[]): number | undefined {
  if (weightTons === undefined || weightTons.trim() === "") {
    addMissing("cargo.quantityKg", missing);
    return undefined;
  }

  const parsed = Number(weightTons.trim().replace(",", "."));

  if (!Number.isFinite(parsed) || parsed <= 0) {
    addMissing("cargo.quantityKg", missing);
    return undefined;
  }

  return Math.round(parsed * 1000);
}

function requireMoney(value: string | undefined, field: string, missing: string[]): number | undefined {
  if (value === undefined || value.trim() === "") {
    addMissing(field, missing);
    return undefined;
  }

  const parsed = parseMoney(value);

  if (parsed === undefined) {
    addMissing(field, missing);
    return undefined;
  }

  return parsed;
}

function parseMoney(value: string): number | undefined {
  const parsed = Number(value.trim().replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function requireField(value: string | undefined, field: string, missing: string[]): string | undefined {
  if (value === undefined || value.trim() === "") {
    addMissing(field, missing);
    return undefined;
  }

  return value.trim();
}

function addMissing(field: string, missing: string[]): void {
  if (!missing.includes(field)) {
    missing.push(field);
  }
}

function prune(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) {
      continue;
    }

    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      result[key] = prune(entry as Record<string, unknown>);
      continue;
    }

    result[key] = entry;
  }

  return result;
}

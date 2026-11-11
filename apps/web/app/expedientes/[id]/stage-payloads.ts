import { compactConsignmentOverrides } from "../../../convex/model/dispatchWorkflow";
import { parseBogotaLocalInput } from "../../../convex/model/monitoring";
import { FormValidationError } from "../../components/fields/form-validation";
import { loadingWindowEnd, required, timestamp, value } from "../../lib/form-data";
import type { Detail } from "./detail-types";




export function loadingOrderDraftFromForm(
  data: FormData,
  previous: Detail["expediente"]["loadingOrderDraft"],
) {
  return {
    ...previous,
    expeditionDate: required(data, "expeditionDate"),
    agencyCode: value(data, "agencyCode"),
    customerReference: value(data, "customerReference"),
    sender: {
      ...previous?.sender,
      name: required(data, "senderName"),
      identificationType: required(data, "senderIdType"),
      identificationNumber: required(data, "senderId"),
      siteCode: required(data, "senderSiteCode"),
      municipalityCode: required(data, "loadingMunicipality"),
      address: required(data, "loadingAddress"),
      cityName: required(data, "loadingCity"),
      phone: required(data, "senderPhone"),
      cellphone: value(data, "senderCellphone"),
    },
    recipient: {
      ...previous?.recipient,
      name: required(data, "recipientName"),
      identificationType: required(data, "recipientIdType"),
      identificationNumber: required(data, "recipientId"),
      siteCode: required(data, "recipientSiteCode"),
      municipalityCode: required(data, "unloadingMunicipality"),
      address: required(data, "unloadingAddress"),
      cityName: required(data, "unloadingCity"),
      phone: required(data, "recipientPhone"),
      cellphone: value(data, "recipientCellphone"),
    },
    loading: {
      ...previous?.loading,
      siteName: required(data, "loadingName"),
      cityName: required(data, "loadingCity"),
      address: required(data, "loadingAddress"),
      municipalityCode: value(data, "loadingMunicipality"),
      appointmentAt: timestamp(data, "loadingAppointment"),
    },
    unloading: {
      ...previous?.unloading,
      siteName: required(data, "unloadingName"),
      cityName: required(data, "unloadingCity"),
      address: required(data, "unloadingAddress"),
      municipalityCode: value(data, "unloadingMunicipality"),
      appointmentAt: timestamp(data, "unloadingAppointment"),
    },
    cargoDescription: required(data, "cargoDescription"),
    cargoQuantity: value(data, "cargoQuantity"),
    cargoUnit: value(data, "cargoUnit"),
    weightTons: required(data, "weightTons"),
    volumeM3: value(data, "volumeM3"),
    packagingCode: required(data, "packagingCode"),
    merchandiseCode: value(data, "merchandiseCode"),
    natureOfCargo: value(data, "natureOfCargo") ?? previous?.natureOfCargo,
    driverFreight: value(data, "driverFreight"),
    sealNumbers: value(data, "sealNumbers"),
    loadingConditions: value(data, "loadingConditions"),
    specialPackaging: value(data, "specialPackaging"),
    observations: value(data, "observations"),
    minLoadingDate: required(data, "minLoadingDate"),
    maxLoadingDate: loadingWindowEnd(data),
    generatesConsignment: data.get("generatesConsignment") === "on",
  };
}

export function consignmentUpsertsFromForm(data: FormData, detail: Detail) {
  const editableRows =
    detail.remesas.length > 0
      ? detail.remesas.filter((remesa) => remesa.officialState === "draft")
      : [null];
  return editableRows.map((remesa, index) => {
    const key = remesa?._id ?? "new";
    const candidate = {
      ...remesa?.draft,
      expeditionDate: required(data, `${key}_expeditionDate`),
      consignmentClass: (value(data, `${key}_class`) ?? "terrestre_carga") as
        | "municipal"
        | "terrestre_carga",
      operationType: "general" as const,
      consolidatedType: value(data, `${key}_consolidatedType`),
      gpsOperator: value(data, `${key}_gpsOperator`),
      agencyCode: required(data, `${key}_agencyCode`),
      sender: partyFromForm(
        data,
        `${key}_sender`,
        `${key}_loadingAddress`,
        `${key}_loadingCity`,
        `${key}_loadingMunicipality`,
      ),
      recipient: partyFromForm(
        data,
        `${key}_recipient`,
        `${key}_unloadingAddress`,
        `${key}_unloadingCity`,
        `${key}_unloadingMunicipality`,
      ),
      loading: siteFromForm(data, `${key}_loading`),
      unloading: siteFromForm(data, `${key}_unloading`),
      cashConsignment: data.get(`${key}_cashConsignment`) === "on",
      cashOnDelivery: data.get(`${key}_cashOnDelivery`) === "on",
      declaredValue: required(data, `${key}_declaredValue`),
      consignmentValue: required(data, `${key}_consignmentValue`),
      insurancePercent: value(data, `${key}_insurancePercent`),
      policyHolder: "transport_company" as const,
      policyNumber: required(data, `${key}_policyNumber`),
      policyExpiresOn: required(data, `${key}_policyExpiresOn`),
      insurerNit: required(data, `${key}_insurerNit`),
      remissions: remissionRows(data, key),
      unitOfMeasure: required(data, `${key}_unitOfMeasure`),
      merchandiseCode: required(data, `${key}_merchandiseCode`),
      packagingCode: required(data, `${key}_packagingCode`),
      natureOfCargo: required(data, `${key}_natureOfCargo`),
      packagingGroup: value(data, `${key}_packagingGroup`),
      serviceOrderTransporter: value(data, `${key}_serviceOrderTransporter`),
      transporterObservations: value(data, `${key}_transporterObservations`),
      generalObservations: value(data, `${key}_observations`),
    };
    return {
      remesaId: remesa?._id,
      sequence: remesa?.sequence ?? index + 1,
      draft: compactConsignmentOverrides(
        candidate,
        detail.expediente.loadingOrderDraft,
      ),
    };
  });
}

export function manifestDraftFromForm(data: FormData, detail: Detail) {
  return {
    ...detail.expediente.manifestDraft,
    issueDate: required(data, "issueDate"),
    estimatedDeliveryDate: required(data, "estimatedDeliveryDate"),
    operationScope: required(data, "operationScope") as
      | "municipal"
      | "intermunicipal",
    manifestType: required(data, "manifestType"),
    agencyCode: detail.expediente.agencyCode,
    originCityName:
      detail.remesas[0]?.draft?.loading?.cityName ??
      detail.loadingLocation.city,
    originMunicipalityCode:
      detail.remesas[0]?.draft?.loading?.municipalityCode ??
      detail.expediente.manifestDraft?.originMunicipalityCode,
    destinationCityName:
      detail.remesas[0]?.draft?.unloading?.cityName ??
      detail.unloadingLocation.city,
    destinationMunicipalityCode:
      detail.remesas[0]?.draft?.unloading?.municipalityCode ??
      detail.expediente.manifestDraft?.destinationMunicipalityCode,
    freightTotal: required(data, "freightTotal"),
    advance: value(data, "advance"),
    withholdingSource: value(data, "withholdingSource"),
    withholdingIca: value(data, "withholdingIca"),
    fopatContribution: value(data, "fopatContribution"),
    adjustments: value(data, "adjustments"),
    netPayable: required(data, "netPayable"),
    paymentResponsible: required(data, "paymentResponsible"),
    loadingResponsible: value(data, "loadingResponsible"),
    unloadingResponsible: value(data, "unloadingResponsible"),
    paymentDate: value(data, "paymentDate"),
    paymentAgencyCode: value(data, "paymentAgencyCode"),
    contractNumber: value(data, "contractNumber"),
    requiresTracking: data.get("requiresTracking") === "on",
    observations: value(data, "observations"),
  };
}

export function remesaFulfillmentDraftFromForm(
  data: FormData,
  remesa: Detail["remesas"][number],
) {
  return {
    deliveredQuantity: required(data, `${remesa._id}_delivered`),
    missingQuantity: value(data, `${remesa._id}_missing`),
    surplusQuantity: value(data, `${remesa._id}_surplus`),
    returnedQuantity: value(data, `${remesa._id}_returned`),
    unit: remesa.cargoUnit ?? "kg",
    observation: value(data, `${remesa._id}_observation`),
    loadingEntryAt: bogotaTimestamp(data, `${remesa._id}_loadingEntryAt`),
    unloadingEntryAt: bogotaTimestamp(data, `${remesa._id}_unloadingEntryAt`),
  };
}

export function manifestFulfillmentDraftFromForm(data: FormData) {
  return {
    documentsDeliveryDate: required(data, "documentsDeliveryDate"),
    observation: value(data, "observation"),
  };
}

export function remesaWithoutOrderPayload(data: FormData) {
  return {
    consignmentClass: "terrestre_carga",
    sender: {
      name: required(data, "senderName"),
      identificationType: required(data, "senderIdType"),
      identificationNumber: required(data, "senderId"),
      siteCode: required(data, "senderSiteCode"),
      municipalityCode: required(data, "loadingMunicipality"),
    },
    recipient: {
      name: required(data, "recipientName"),
      identificationType: required(data, "recipientIdType"),
      identificationNumber: required(data, "recipientId"),
      siteCode: required(data, "recipientSiteCode"),
      municipalityCode: required(data, "unloadingMunicipality"),
    },
    loading: {
      address: required(data, "loadingAddress"),
      cityName: required(data, "loadingCity"),
      municipalityCode: required(data, "loadingMunicipality"),
      appointmentAt: timestamp(data, "loadingAppointment"),
    },
    unloading: {
      address: required(data, "unloadingAddress"),
      cityName: required(data, "unloadingCity"),
      municipalityCode: required(data, "unloadingMunicipality"),
      appointmentAt: timestamp(data, "unloadingAppointment"),
    },
    declaredValue: required(data, "declaredValue"),
    packagingCode: required(data, "packagingCode"),
    merchandiseCode: required(data, "merchandiseCode"),
    natureOfCargo: required(data, "natureOfCargo"),
    policyNumber: required(data, "policyNumber"),
    policyExpiresOn: required(data, "policyExpiresOn"),
    insurerNit: required(data, "insurerNit"),
    remissions: [
      {
        quantity: required(data, "quantity"),
        description: required(data, "cargoDescription"),
        weightTons: required(data, "weightTons"),
        packagingClass: required(data, "packagingCode"),
      },
    ],
  };
}

export function emptyManifestPayload(data: FormData) {
  return {
    manifestType: "W",
    issueDate: required(data, "issueDate"),
    estimatedDeliveryDate: required(data, "estimatedDeliveryDate"),
    operationScope: "intermunicipal",
    freightTotal: required(data, "freightTotal"),
    netPayable: required(data, "freightTotal"),
    paymentResponsible: required(data, "paymentResponsible"),
    emptyManifestReason: required(data, "emptyManifestReason"),
    observations: required(data, "emptyManifestReason"),
  };
}

export function appointmentBefore(
  value: number | undefined,
  remesaNumber: string | undefined,
) {
  const date = value ? new Date(value) : null;
  return {
    remesaNumber,
    appointmentDate: date?.toISOString().slice(0, 10),
    appointmentTime: date?.toTimeString().slice(0, 5),
  };
}


function bogotaTimestamp(data: FormData, key: string): number {
  try {
    return parseBogotaLocalInput(required(data, key).slice(0, 16));
  } catch (cause) {
    if (cause instanceof FormValidationError) throw cause;
    throw new FormValidationError(key, "Selecciona una fecha y hora válidas.");
  }
}

function definedEntries<T extends Record<string, unknown>>(
  source: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(source).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

function partyFromForm(
  data: FormData,
  prefix: string,
  addressKey: string,
  cityKey: string,
  municipalityKey: string,
) {
  const party = definedEntries({
    name: value(data, `${prefix}Name`),
    identificationType: value(data, `${prefix}IdType`),
    identificationNumber: value(data, `${prefix}Id`),
    siteCode: value(data, `${prefix}SiteCode`),
    address: value(data, addressKey),
    cityName: value(data, cityKey),
    municipalityCode: value(data, municipalityKey),
    phone: value(data, `${prefix}Phone`),
    cellphone: value(data, `${prefix}Cellphone`),
  });
  return Object.keys(party).length > 0 ? party : undefined;
}

function siteFromForm(data: FormData, prefix: string) {
  const appointment = value(data, `${prefix}Appointment`);
  const site = definedEntries({
    siteName: value(data, `${prefix}SiteName`),
    address: value(data, `${prefix}Address`),
    cityName: value(data, `${prefix}City`),
    municipalityCode: value(data, `${prefix}Municipality`),
    latitude: value(data, `${prefix}Latitude`),
    longitude: value(data, `${prefix}Longitude`),
    agreedHours: value(data, `${prefix}Hours`),
    appointmentAt: appointment
      ? timestamp(data, `${prefix}Appointment`)
      : undefined,
  });
  return Object.keys(site).length > 0 ? site : undefined;
}

function remissionRows(data: FormData, key: string) {
  const count = Number(value(data, `${key}_remCount`) ?? "1");
  const rows = Array.from({ length: count }, (_, index) => ({
    remissionNumber: value(data, `${key}_rem${index}_number`),
    quantity: value(data, `${key}_rem${index}_quantity`),
    packagingClass: value(data, `${key}_rem${index}_packagingClass`),
    description: value(data, `${key}_rem${index}_description`),
    weightTons: value(data, `${key}_rem${index}_weightTons`),
    volumeM3: value(data, `${key}_rem${index}_volumeM3`),
  })).filter((row) => Object.values(row).some(Boolean));
  return rows.length > 0 ? rows : undefined;
}

import { v } from "convex/values";

export const consignmentClassValidator = v.union(v.literal("municipal"), v.literal("terrestre_carga"));

export const operationScopeValidator = v.union(v.literal("municipal"), v.literal("intermunicipal"));

export const partyDraftValidator = v.object({
  name: v.optional(v.string()),
  identificationType: v.optional(v.string()),
  identificationNumber: v.optional(v.string()),
  address: v.optional(v.string()),
  cityName: v.optional(v.string()),
  municipalityCode: v.optional(v.string()),
  phone: v.optional(v.string()),
  cellphone: v.optional(v.string())
});

export const siteAppointmentDraftValidator = v.object({
  siteName: v.optional(v.string()),
  address: v.optional(v.string()),
  cityName: v.optional(v.string()),
  municipalityCode: v.optional(v.string()),
  latitude: v.optional(v.string()),
  longitude: v.optional(v.string()),
  appointmentAt: v.optional(v.number()),
  agreedHours: v.optional(v.string())
});

export const loadingOrderDraftValidator = v.object({
  orderNumber: v.optional(v.string()),
  agencyCode: v.optional(v.string()),
  customerId: v.optional(v.id("customers")),
  customerReference: v.optional(v.string()),
  sender: v.optional(partyDraftValidator),
  recipient: v.optional(partyDraftValidator),
  loading: v.optional(siteAppointmentDraftValidator),
  unloading: v.optional(siteAppointmentDraftValidator),
  cargoDescription: v.optional(v.string()),
  cargoQuantity: v.optional(v.string()),
  cargoUnit: v.optional(v.string()),
  weightTons: v.optional(v.string()),
  volumeM3: v.optional(v.string()),
  packagingCode: v.optional(v.string()),
  merchandiseCode: v.optional(v.string()),
  minLoadingDate: v.optional(v.string()),
  maxLoadingDate: v.optional(v.string()),
  driverFreight: v.optional(v.string()),
  sealNumbers: v.optional(v.string()),
  loadingConditions: v.optional(v.string()),
  specialPackaging: v.optional(v.string()),
  observations: v.optional(v.string()),
  generatesConsignment: v.optional(v.boolean()),
  printedAt: v.optional(v.number())
});

export const remissionLineDraftValidator = v.object({
  remissionNumber: v.optional(v.string()),
  quantity: v.optional(v.string()),
  packagingClass: v.optional(v.string()),
  description: v.optional(v.string()),
  weightTons: v.optional(v.string()),
  volumeM3: v.optional(v.string())
});

export const consignmentDraftValidator = v.object({
  consignmentClass: v.optional(consignmentClassValidator),
  agencyCode: v.optional(v.string()),
  sender: v.optional(partyDraftValidator),
  recipient: v.optional(partyDraftValidator),
  loading: v.optional(siteAppointmentDraftValidator),
  unloading: v.optional(siteAppointmentDraftValidator),
  declaredValue: v.optional(v.string()),
  consignmentValue: v.optional(v.string()),
  insurancePercent: v.optional(v.string()),
  policyNumber: v.optional(v.string()),
  insurerName: v.optional(v.string()),
  policyExpiresOn: v.optional(v.string()),
  remissions: v.optional(v.array(remissionLineDraftValidator)),
  unitOfMeasure: v.optional(v.string()),
  packagingCode: v.optional(v.string()),
  natureOfCargo: v.optional(v.string()),
  merchandiseCode: v.optional(v.string()),
  transporterObservations: v.optional(v.string()),
  generalObservations: v.optional(v.string()),
  printedAt: v.optional(v.number())
});

export const manifestDraftValidator = v.object({
  manifestNumber: v.optional(v.string()),
  issueDate: v.optional(v.string()),
  estimatedDeliveryDate: v.optional(v.string()),
  operationScope: v.optional(operationScopeValidator),
  manifestType: v.optional(v.string()),
  agencyCode: v.optional(v.string()),
  originCityName: v.optional(v.string()),
  originMunicipalityCode: v.optional(v.string()),
  destinationCityName: v.optional(v.string()),
  destinationMunicipalityCode: v.optional(v.string()),
  freightTotal: v.optional(v.string()),
  advance: v.optional(v.string()),
  withholdingSource: v.optional(v.string()),
  withholdingIca: v.optional(v.string()),
  fopatContribution: v.optional(v.string()),
  adjustments: v.optional(v.string()),
  netPayable: v.optional(v.string()),
  paymentResponsible: v.optional(v.string()),
  loadingResponsible: v.optional(v.string()),
  unloadingResponsible: v.optional(v.string()),
  paymentDate: v.optional(v.string()),
  observations: v.optional(v.string()),
  printedAt: v.optional(v.number())
});

export const logisticsEventRecordValidator = v.object({
  occurredAt: v.number(),
  recordedAt: v.number(),
  recordedBy: v.id("users"),
  observation: v.optional(v.string())
});

export const logisticsSiteTimesValidator = v.object({
  arrival: v.optional(logisticsEventRecordValidator),
  entry: v.optional(logisticsEventRecordValidator),
  start: v.optional(logisticsEventRecordValidator),
  end: v.optional(logisticsEventRecordValidator),
  exit: v.optional(logisticsEventRecordValidator)
});

export const logisticsTimesDraftValidator = v.object({
  origin: v.optional(logisticsSiteTimesValidator),
  destination: v.optional(logisticsSiteTimesValidator),
  finalDelivery: v.optional(logisticsEventRecordValidator)
});

export const snapshotKindValidator = v.union(
  v.literal("orden_cargue"),
  v.literal("remesa"),
  v.literal("manifiesto"),
  v.literal("cumplido_remesa"),
  v.literal("cumplido_manifiesto"),
  v.literal("asignacion")
);

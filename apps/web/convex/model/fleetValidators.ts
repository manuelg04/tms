import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { masterSyncValidator } from "./schemaValidators";


export const masterSyncKindValidator = v.union(v.literal("driver"), v.literal("vehicle"), v.literal("party"));

export const masterSyncStateValidator = v.union(v.literal("pending"), v.literal("registered"), v.literal("rejected"));

export const masterSyncSummaryValidator = v.object({
  state: masterSyncStateValidator,
  updatedAt: v.optional(v.number()),
  error: v.optional(v.string())
});

export const thirdPartyRoleValidator = v.union(
  v.literal("driver"),
  v.literal("owner"),
  v.literal("possessor"),
  v.literal("holder"),
  v.literal("sender"),
  v.literal("recipient"),
  v.literal("insured"),
  v.literal("insurance_company"),
  v.literal("transport_company"),
  v.literal("legal_representative"),
  v.literal("commercial"),
  v.literal("consignee"),
  v.literal("employee"),
  v.literal("logistics_operator"),
  v.literal("fiscal_reviewer"),
  v.literal("other")
);

export const creationOutcomeValidator = v.union(
  v.literal("created"),
  v.literal("enriched"),
  v.literal("unchanged")
);

export type CreationOutcome = "created" | "enriched" | "unchanged";

export type MasterUploadInput = {
  storageId: Id<"_storage">;
  fileName: string;
};

export type MasterResourceType = "driver" | "third_party" | "trailer" | "vehicle";

export type MasterAttachmentSlot = "profile" | "front" | "left" | "right" | "rear";

export type MasterWorkReference = {
  company: string;
  contactName?: string;
  phone?: string;
  position?: string;
  trips?: string;
  tenure?: string;
  city?: string;
  cityCode?: string;
  merchandise?: string;
};

export const masterWorkReferenceValidator = v.object({
  company: v.string(),
  contactName: v.optional(v.string()),
  phone: v.optional(v.string()),
  position: v.optional(v.string()),
  trips: v.optional(v.string()),
  tenure: v.optional(v.string()),
  city: v.optional(v.string()),
  cityCode: v.optional(v.string()),
  merchandise: v.optional(v.string())
});

export const uploadInputValidator = v.object({
  storageId: v.id("_storage"),
  fileName: v.string()
});

export const vehiclePhotoInputValidator = v.object({
  slot: v.union(v.literal("front"), v.literal("left"), v.literal("right"), v.literal("rear")),
  storageId: v.id("_storage"),
  fileName: v.string()
});

export const masterAttachmentDetailValidator = v.object({
  slot: v.union(v.literal("profile"), v.literal("front"), v.literal("left"), v.literal("right"), v.literal("rear")),
  fileName: v.string(),
  contentType: v.string(),
  size: v.number(),
  url: v.union(v.string(), v.null())
});

export const driverMasterInputValidator = v.object({
  documentType: v.string(),
  document: v.string(),
  firstNames: v.string(),
  firstLastName: v.string(),
  secondLastName: v.optional(v.string()),
  birthDate: v.optional(v.string()),
  sex: v.optional(v.string()),
  bloodType: v.optional(v.string()),
  address: v.string(),
  city: v.optional(v.string()),
  cityCode: v.string(),
  phone1: v.optional(v.string()),
  phone2: v.optional(v.string()),
  cellphone: v.string(),
  mobileOperator: v.optional(v.string()),
  rating: v.optional(v.string()),
  licenseNumber: v.string(),
  licenseCategory: v.string(),
  licenseExpiresAt: v.string(),
  eps: v.optional(v.string()),
  arp: v.optional(v.string()),
  pensionFund: v.optional(v.string()),
  crewCardNumber: v.optional(v.string()),
  crewCardExpiresAt: v.optional(v.string()),
  hazmatCourse: v.optional(v.string()),
  hazmatCourseExpiresAt: v.optional(v.string()),
  emergencyContact: v.optional(v.object({ name: v.string(), phone: v.string() })),
  workReferences: v.optional(v.array(masterWorkReferenceValidator)),
  activities: v.object({ owner: v.boolean(), possessor: v.boolean(), employee: v.boolean() }),
  observations: v.optional(v.string())
});

export const thirdPartyMasterInputValidator = v.object({
  personType: v.union(v.literal("natural"), v.literal("legal")),
  documentType: v.string(),
  document: v.string(),
  firstNames: v.optional(v.string()),
  firstLastName: v.optional(v.string()),
  secondLastName: v.optional(v.string()),
  legalName: v.optional(v.string()),
  verificationDigit: v.optional(v.string()),
  abbreviation: v.optional(v.string()),
  address: v.optional(v.string()),
  city: v.optional(v.string()),
  cityCode: v.optional(v.string()),
  phone1: v.optional(v.string()),
  phone2: v.optional(v.string()),
  cellphone: v.optional(v.string()),
  fax: v.optional(v.string()),
  website: v.optional(v.string()),
  email: v.optional(v.string()),
  taxRegime: v.optional(v.string()),
  roles: v.array(thirdPartyRoleValidator),
  observations: v.optional(v.string())
});

export const trailerMasterInputValidator = v.object({
  plate: v.string(),
  linkedVehicleId: v.optional(v.id("vehicles")),
  trailerType: v.optional(v.string()),
  make: v.optional(v.string()),
  modelYear: v.optional(v.string()),
  configuration: v.optional(v.string()),
  capacityKg: v.number(),
  emptyWeightKg: v.number(),
  widthM: v.number(),
  heightM: v.number(),
  lengthM: v.number(),
  rearVolumeM3: v.optional(v.number()),
  ownerThirdPartyId: v.id("thirdParties"),
  bodyType: v.optional(v.string()),
  procedureType: v.optional(v.string()),
  chassisSerial: v.optional(v.string()),
  color: v.optional(v.string()),
  observations: v.optional(v.string()),
  status: v.union(v.literal("available"), v.literal("assigned"), v.literal("maintenance"), v.literal("inactive"))
});

export const vehicleMasterInputValidator = v.object({
  plate: v.string(),
  make: v.optional(v.string()),
  line: v.optional(v.string()),
  lineName: v.optional(v.string()),
  modelYear: v.string(),
  repoweredModelYear: v.optional(v.string()),
  color: v.optional(v.string()),
  bodyType: v.optional(v.string()),
  configuration: v.optional(v.string()),
  linkType: v.optional(v.string()),
  engineNumber: v.optional(v.string()),
  serialNumber: v.optional(v.string()),
  capacityTn: v.string(),
  emptyWeightTn: v.string(),
  affiliatedTo: v.optional(v.string()),
  technicalInspectionNumber: v.optional(v.string()),
  technicalInspectionExpiresAt: v.optional(v.string()),
  emissionsCertificateExpiresAt: v.optional(v.string()),
  cargoRegistryNumber: v.optional(v.string()),
  operationCardNumber: v.optional(v.string()),
  transitLicenseNumber: v.optional(v.string()),
  checkListExpress: v.optional(v.boolean()),
  rating: v.optional(v.string()),
  insurerNit: v.string(),
  insurerName: v.optional(v.string()),
  soatExpiresAt: v.string(),
  soatNumber: v.string(),
  liabilityPolicyNumber: v.optional(v.string()),
  liabilityInsurerNit: v.optional(v.string()),
  liabilityInsurerName: v.optional(v.string()),
  liabilityExpiresAt: v.optional(v.string()),
  ownerThirdPartyId: v.id("thirdParties"),
  possessorThirdPartyId: v.id("thirdParties"),
  driverId: v.id("drivers"),
  defaultTrailerId: v.optional(v.id("trailers")),
  transitAuthority: v.optional(v.string()),
  importDeclarationNumber: v.optional(v.string()),
  publicServiceEntryMethod: v.optional(v.string()),
  workReferences: v.optional(v.array(masterWorkReferenceValidator)),
  observations: v.optional(v.string()),
  gpsOperator: v.optional(v.string()),
  gpsUsername: v.optional(v.string()),
  vehicleKind: v.optional(v.string()),
  status: v.optional(v.string()),
  rndcMakeCode: v.optional(v.string()),
  rndcBodyTypeCode: v.optional(v.string()),
  rndcConfigurationCode: v.optional(v.string()),
  fuelType: v.optional(v.string()),
  rndcFuelCode: v.optional(v.string())
});

export const relationInputValidator = v.object({
  driverDocument: v.string(),
  vehiclePlate: v.string(),
  matchConfidence: v.optional(v.string()),
  matchBasis: v.optional(v.string()),
  roles: v.optional(v.array(v.string()))
});

export const driverRowValidator = v.object({
  _id: v.id("drivers"),
  _creationTime: v.number(),
  document: v.string(),
  name: v.optional(v.string()),
  documentType: v.optional(v.string()),
  phone: v.optional(v.string()),
  city: v.optional(v.string()),
  licenseCategory: v.optional(v.string()),
  vehicleCount: v.number(),
  rndcSyncSummary: masterSyncSummaryValidator,
  updatedAt: v.number()
});

export const vehicleRowValidator = v.object({
  _id: v.id("vehicles"),
  _creationTime: v.number(),
  plate: v.string(),
  make: v.optional(v.string()),
  line: v.optional(v.string()),
  modelYear: v.optional(v.string()),
  capacityTn: v.optional(v.string()),
  ownerDocument: v.optional(v.string()),
  ownerName: v.optional(v.string()),
  possessorDocument: v.optional(v.string()),
  possessorName: v.optional(v.string()),
  vehicleKind: v.optional(v.string()),
  status: v.optional(v.string()),
  configuration: v.optional(v.string()),
  soatExpiresAt: v.optional(v.string()),
  driverCount: v.number(),
  rndcSyncSummary: masterSyncSummaryValidator,
  updatedAt: v.number()
});

export const trailerRowValidator = v.object({
  _id: v.id("trailers"),
  _creationTime: v.number(),
  plate: v.string(),
  trailerType: v.optional(v.string()),
  make: v.optional(v.string()),
  modelYear: v.optional(v.string()),
  configuration: v.optional(v.string()),
  capacityKg: v.optional(v.number()),
  emptyWeightKg: v.optional(v.number()),
  ownerName: v.optional(v.string()),
  status: v.union(v.literal("available"), v.literal("assigned"), v.literal("maintenance"), v.literal("inactive")),
  updatedAt: v.number()
});

export const trailerDetailValidator = v.object({
  _id: v.id("trailers"),
  _creationTime: v.number(),
  plate: v.string(),
  trailerType: v.optional(v.string()),
  linkedVehicleId: v.optional(v.id("vehicles")),
  make: v.optional(v.string()),
  modelYear: v.optional(v.string()),
  configuration: v.optional(v.string()),
  capacityKg: v.optional(v.number()),
  emptyWeightKg: v.optional(v.number()),
  widthM: v.optional(v.number()),
  heightM: v.optional(v.number()),
  lengthM: v.optional(v.number()),
  rearVolumeM3: v.optional(v.number()),
  ownerThirdPartyId: v.optional(v.id("thirdParties")),
  ownerDocumentType: v.optional(v.string()),
  ownerDocument: v.optional(v.string()),
  ownerName: v.optional(v.string()),
  bodyType: v.optional(v.string()),
  procedureType: v.optional(v.string()),
  chassisSerial: v.optional(v.string()),
  color: v.optional(v.string()),
  observations: v.optional(v.string()),
  status: v.union(v.literal("available"), v.literal("assigned"), v.literal("maintenance"), v.literal("inactive")),
  createdAt: v.number(),
  updatedAt: v.number(),
  attachments: v.array(masterAttachmentDetailValidator)
});

export const driverDetailValidator = v.object({
  _id: v.id("drivers"),
  _creationTime: v.number(),
  document: v.string(),
  documentType: v.optional(v.string()),
  name: v.optional(v.string()),
  firstNames: v.optional(v.string()),
  firstLastName: v.optional(v.string()),
  secondLastName: v.optional(v.string()),
  status: v.optional(v.string()),
  birthDate: v.optional(v.string()),
  sex: v.optional(v.string()),
  bloodType: v.optional(v.string()),
  address: v.optional(v.string()),
  city: v.optional(v.string()),
  cityCode: v.optional(v.string()),
  phone1: v.optional(v.string()),
  phone2: v.optional(v.string()),
  cellphone: v.optional(v.string()),
  mobileOperator: v.optional(v.string()),
  rating: v.optional(v.string()),
  licenseNumber: v.optional(v.string()),
  licenseCategory: v.optional(v.string()),
  licenseExpiresAt: v.optional(v.string()),
  eps: v.optional(v.string()),
  arp: v.optional(v.string()),
  pensionFund: v.optional(v.string()),
  crewCardNumber: v.optional(v.string()),
  crewCardExpiresAt: v.optional(v.string()),
  hazmatCourse: v.optional(v.string()),
  hazmatCourseExpiresAt: v.optional(v.string()),
  emergencyContactName: v.optional(v.string()),
  emergencyContactPhone: v.optional(v.string()),
  workReferences: v.optional(v.array(masterWorkReferenceValidator)),
  observations: v.optional(v.string()),
  rndcSync: v.optional(masterSyncValidator),
  rndcSyncSummary: masterSyncSummaryValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
  attachments: v.array(masterAttachmentDetailValidator),
  vehicles: v.array(
    v.object({
      vehiclePlate: v.string(),
      make: v.optional(v.string()),
      line: v.optional(v.string()),
      modelYear: v.optional(v.string()),
      roles: v.optional(v.array(v.string()))
    })
  )
});

export const vehicleDetailValidator = v.object({
  _id: v.id("vehicles"),
  _creationTime: v.number(),
  plate: v.string(),
  make: v.optional(v.string()),
  line: v.optional(v.string()),
  modelYear: v.optional(v.string()),
  repoweredModelYear: v.optional(v.string()),
  color: v.optional(v.string()),
  bodyType: v.optional(v.string()),
  configuration: v.optional(v.string()),
  trailer: v.optional(v.string()),
  linkType: v.optional(v.string()),
  engineNumber: v.optional(v.string()),
  serialNumber: v.optional(v.string()),
  capacityTn: v.optional(v.string()),
  emptyWeightTn: v.optional(v.string()),
  affiliatedTo: v.optional(v.string()),
  technicalInspectionNumber: v.optional(v.string()),
  technicalInspectionExpiresAt: v.optional(v.string()),
  emissionsCertificateExpiresAt: v.optional(v.string()),
  cargoRegistryNumber: v.optional(v.string()),
  operationCardNumber: v.optional(v.string()),
  transitLicenseNumber: v.optional(v.string()),
  checkListExpress: v.optional(v.boolean()),
  rating: v.optional(v.string()),
  ownerThirdPartyId: v.optional(v.id("thirdParties")),
  ownerDocument: v.optional(v.string()),
  ownerName: v.optional(v.string()),
  ownerCellphone: v.optional(v.string()),
  ownerPhone: v.optional(v.string()),
  possessorThirdPartyId: v.optional(v.id("thirdParties")),
  possessorDocument: v.optional(v.string()),
  possessorName: v.optional(v.string()),
  possessorCellphone: v.optional(v.string()),
  possessorPhone: v.optional(v.string()),
  insurerNit: v.optional(v.string()),
  insurerName: v.optional(v.string()),
  soatExpiresAt: v.optional(v.string()),
  soatNumber: v.optional(v.string()),
  liabilityPolicyNumber: v.optional(v.string()),
  liabilityInsurerNit: v.optional(v.string()),
  liabilityInsurerName: v.optional(v.string()),
  liabilityExpiresAt: v.optional(v.string()),
  vehicleKind: v.optional(v.string()),
  status: v.optional(v.string()),
  configurationLabel: v.optional(v.string()),
  rndcConfigurationCode: v.optional(v.string()),
  lineName: v.optional(v.string()),
  rndcMakeCode: v.optional(v.string()),
  rndcBodyTypeCode: v.optional(v.string()),
  fuelType: v.optional(v.string()),
  rndcFuelCode: v.optional(v.string()),
  axles: v.optional(v.string()),
  ownerDocumentType: v.optional(v.string()),
  possessorDocumentType: v.optional(v.string()),
  rndcRegisteredAt: v.optional(v.string()),
  source: v.optional(v.string()),
  sourceCompanyNit: v.optional(v.string()),
  defaultTrailerId: v.optional(v.id("trailers")),
  transitAuthority: v.optional(v.string()),
  importDeclarationNumber: v.optional(v.string()),
  publicServiceEntryMethod: v.optional(v.string()),
  observations: v.optional(v.string()),
  gpsOperator: v.optional(v.string()),
  gpsUsername: v.optional(v.string()),
  workReferences: v.optional(v.array(masterWorkReferenceValidator)),
  rndcSync: v.optional(masterSyncValidator),
  rndcSyncSummary: masterSyncSummaryValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
  attachments: v.array(masterAttachmentDetailValidator),
  drivers: v.array(
    v.object({
      driverDocument: v.string(),
      name: v.optional(v.string()),
      roles: v.optional(v.array(v.string()))
    })
  )
});

export const pageResultFields = {
  isDone: v.boolean(),
  continueCursor: v.string(),
  splitCursor: v.optional(v.union(v.string(), v.null())),
  pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null()))
};

export const thirdPartyRowValidator = v.object({
  _id: v.id("thirdParties"),
  document: v.string(),
  documentType: v.string(),
  name: v.string(),
  phone: v.optional(v.string()),
  roles: v.array(thirdPartyRoleValidator),
  city: v.optional(v.string()),
  siteCount: v.optional(v.number()),
  rndcSyncSummary: masterSyncSummaryValidator,
  updatedAt: v.number()
});

export const driverInputValidator = v.object({
  document: v.string(),
  documentType: v.optional(v.string()),
  name: v.optional(v.string()),
  firstNames: v.optional(v.string()),
  firstLastName: v.optional(v.string()),
  secondLastName: v.optional(v.string()),
  status: v.optional(v.string()),
  birthDate: v.optional(v.string()),
  sex: v.optional(v.string()),
  bloodType: v.optional(v.string()),
  address: v.optional(v.string()),
  city: v.optional(v.string()),
  cityCode: v.optional(v.string()),
  phone1: v.optional(v.string()),
  phone2: v.optional(v.string()),
  cellphone: v.optional(v.string()),
  mobileOperator: v.optional(v.string()),
  rating: v.optional(v.string()),
  licenseNumber: v.optional(v.string()),
  licenseCategory: v.optional(v.string()),
  licenseExpiresAt: v.optional(v.string()),
  eps: v.optional(v.string()),
  arp: v.optional(v.string()),
  pensionFund: v.optional(v.string()),
  hazmatCourse: v.optional(v.string()),
  hazmatCourseExpiresAt: v.optional(v.string()),
  observations: v.optional(v.string())
});

export const vehicleInputValidator = v.object({
  plate: v.string(),
  make: v.optional(v.string()),
  line: v.optional(v.string()),
  modelYear: v.optional(v.string()),
  color: v.optional(v.string()),
  bodyType: v.optional(v.string()),
  configuration: v.optional(v.string()),
  trailer: v.optional(v.string()),
  linkType: v.optional(v.string()),
  capacityTn: v.optional(v.string()),
  emptyWeightTn: v.optional(v.string()),
  ownerDocument: v.optional(v.string()),
  ownerName: v.optional(v.string()),
  ownerCellphone: v.optional(v.string()),
  ownerPhone: v.optional(v.string()),
  possessorDocument: v.optional(v.string()),
  possessorName: v.optional(v.string()),
  possessorCellphone: v.optional(v.string()),
  possessorPhone: v.optional(v.string()),
  insurerNit: v.optional(v.string()),
  insurerName: v.optional(v.string()),
  soatExpiresAt: v.optional(v.string()),
  soatNumber: v.optional(v.string()),
  vehicleKind: v.optional(v.string()),
  status: v.optional(v.string()),
  configurationLabel: v.optional(v.string()),
  rndcConfigurationCode: v.optional(v.string()),
  lineName: v.optional(v.string()),
  rndcMakeCode: v.optional(v.string()),
  rndcBodyTypeCode: v.optional(v.string()),
  fuelType: v.optional(v.string()),
  rndcFuelCode: v.optional(v.string()),
  axles: v.optional(v.string()),
  ownerDocumentType: v.optional(v.string()),
  possessorDocumentType: v.optional(v.string()),
  rndcRegisteredAt: v.optional(v.string()),
  source: v.optional(v.string()),
  sourceCompanyNit: v.optional(v.string())
});

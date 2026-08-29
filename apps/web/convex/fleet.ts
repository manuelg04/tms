import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { appendAudit, requireActor } from "./model/access";
import {
  deriveDriverThirdPartyRoles,
  normalizeDriverInput,
  normalizeDriverMasterInput,
  normalizeThirdPartyInput,
  normalizeThirdPartyMasterInput,
  normalizeTrailerMasterInput,
  normalizeVehicleInput,
  normalizeVehicleMasterInput,
  type DriverMasterInput,
  type ThirdPartyInput,
  type ThirdPartyMasterInput,
  type ThirdPartyRole,
  type TrailerMasterInput,
  type VehicleMasterInput
} from "./model/masterData";

const thirdPartyRoleValidator = v.union(
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

const creationOutcomeValidator = v.union(
  v.literal("created"),
  v.literal("enriched"),
  v.literal("unchanged")
);

type CreationOutcome = "created" | "enriched" | "unchanged";

type MasterUploadInput = {
  storageId: Id<"_storage">;
  fileName: string;
};

type MasterResourceType = "driver" | "third_party" | "trailer" | "vehicle";

type MasterAttachmentSlot = "profile" | "front" | "left" | "right" | "rear";

type MasterWorkReference = {
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

const masterWorkReferenceValidator = v.object({
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

const uploadInputValidator = v.object({
  storageId: v.id("_storage"),
  fileName: v.string()
});

const vehiclePhotoInputValidator = v.object({
  slot: v.union(v.literal("front"), v.literal("left"), v.literal("right"), v.literal("rear")),
  storageId: v.id("_storage"),
  fileName: v.string()
});

const masterAttachmentDetailValidator = v.object({
  slot: v.union(v.literal("profile"), v.literal("front"), v.literal("left"), v.literal("right"), v.literal("rear")),
  fileName: v.string(),
  contentType: v.string(),
  size: v.number(),
  url: v.union(v.string(), v.null())
});

const thirdPartyInputValidator = v.object({
  documentType: v.string(),
  document: v.string(),
  name: v.string(),
  phone: v.optional(v.string()),
  address: v.optional(v.string()),
  cityCode: v.optional(v.string()),
  roles: v.array(thirdPartyRoleValidator)
});

const driverInputValidator = v.object({
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

const vehicleInputValidator = v.object({
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

const driverMasterInputValidator = v.object({
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

const thirdPartyMasterInputValidator = v.object({
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

const trailerMasterInputValidator = v.object({
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

const vehicleMasterInputValidator = v.object({
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

const relationInputValidator = v.object({
  driverDocument: v.string(),
  vehiclePlate: v.string(),
  matchConfidence: v.optional(v.string()),
  matchBasis: v.optional(v.string()),
  roles: v.optional(v.array(v.string()))
});

const driverRowValidator = v.object({
  _id: v.id("drivers"),
  _creationTime: v.number(),
  document: v.string(),
  name: v.optional(v.string()),
  documentType: v.optional(v.string()),
  phone: v.optional(v.string()),
  city: v.optional(v.string()),
  licenseCategory: v.optional(v.string()),
  vehicleCount: v.number(),
  updatedAt: v.number()
});

const vehicleRowValidator = v.object({
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
  updatedAt: v.number()
});

const trailerRowValidator = v.object({
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

const trailerDetailValidator = v.object({
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

const driverDetailValidator = v.object({
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

const vehicleDetailValidator = v.object({
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

export const upsertThirdParty = mutation({
  args: { input: thirdPartyInputValidator },
  returns: v.id("thirdParties"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, ["admin", "operator"]);
    const input = normalizeThirdPartyInput(args.input);
    const now = Date.now();
    const existing = await ctx.db.query("thirdParties").withIndex("by_organization_and_document", (q) => q.eq("organizationId", actor.organizationId).eq("document", input.document)).unique();
    const roles = [...new Set([...(existing?.roles ?? []), ...(input.roles ?? ["other" as const])])];
    const fields = { ...input, roles, organizationId: actor.organizationId, updatedBy: actor._id, updatedAt: now };
    const id = existing
      ? (await ctx.db.patch(existing._id, fields), existing._id)
      : await ctx.db.insert("thirdParties", { ...fields, createdBy: actor._id, createdAt: now });
    await appendAudit(ctx, { organizationId: actor.organizationId, actorType: "user", actorId: actor._id, action: existing ? "third_party.updated" : "third_party.created", entityType: "third_party", entityId: id, createdAt: now });
    return id;
  }
});

export const upsertDriver = mutation({
  args: { input: driverInputValidator },
  returns: v.id("drivers"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, ["admin", "operator"]);
    const normalized = normalizeDriverInput({
      documentType: args.input.documentType,
      document: args.input.document,
      name: args.input.name,
      phone: args.input.cellphone ?? args.input.phone1,
      address: args.input.address,
      cityCode: args.input.cityCode,
      licenseCategory: args.input.licenseCategory,
      licenseNumber: args.input.licenseNumber,
      licenseExpiresAt: args.input.licenseExpiresAt
    });
    const now = Date.now();
    const existing = await ctx.db.query("drivers").withIndex("by_organization_and_document", (q) => q.eq("organizationId", actor.organizationId).eq("document", normalized.document)).unique();
    const { phone, ...driverFields } = normalized;
    const fields = { ...args.input, ...driverFields, organizationId: actor.organizationId, cellphone: phone, status: args.input.status ?? "active", updatedAt: now };
    const id = existing
      ? (await ctx.db.patch(existing._id, fields), existing._id)
      : await ctx.db.insert("drivers", { ...fields, createdAt: now });
    await upsertPartyRecord(ctx, actor.organizationId, actor._id, { documentType: normalized.documentType, document: normalized.document, name: normalized.name, phone: normalized.phone, address: normalized.address, cityCode: normalized.cityCode, roles: ["driver"] }, now);
    await appendAudit(ctx, { organizationId: actor.organizationId, actorType: "user", actorId: actor._id, action: existing ? "driver.updated" : "driver.created", entityType: "driver", entityId: id, createdAt: now });
    return id;
  }
});

export const upsertVehicle = mutation({
  args: { input: vehicleInputValidator, driverDocument: v.optional(v.string()) },
  returns: v.id("vehicles"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, ["admin", "operator"]);
    const input = normalizeVehicleInput(args.input);
    const now = Date.now();
    const existing = await ctx.db.query("vehicles").withIndex("by_organization_and_plate", (q) => q.eq("organizationId", actor.organizationId).eq("plate", input.plate)).unique();
    const fields = { ...args.input, ...input, organizationId: actor.organizationId, updatedAt: now };
    const vehicleId = existing
      ? (await ctx.db.patch(existing._id, fields), existing._id)
      : await ctx.db.insert("vehicles", { ...fields, createdAt: now });
    const driverDocument = args.driverDocument?.trim();
    if (driverDocument) {
      const driver = await ctx.db.query("drivers").withIndex("by_organization_and_document", (q) => q.eq("organizationId", actor.organizationId).eq("document", driverDocument)).unique();
      if (!driver) throw new ConvexError({ code: "NOT_FOUND", message: "El conductor seleccionado no existe en maestros" });
      await assignPrimaryDriver(ctx, actor.organizationId, driver, vehicleId, input.plate, "manual", now);
    }
    await appendAudit(ctx, { organizationId: actor.organizationId, actorType: "user", actorId: actor._id, action: existing ? "vehicle.updated" : "vehicle.created", entityType: "vehicle", entityId: vehicleId, createdAt: now });
    return vehicleId;
  }
});

export const generateMasterUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireActor(ctx, undefined, ["admin", "operator"]);
    return await ctx.storage.generateUploadUrl();
  }
});

export const discardMasterUploads = mutation({
  args: { storageIds: v.array(v.id("_storage")) },
  returns: v.number(),
  handler: async (ctx, args) => {
    await requireActor(ctx, undefined, ["admin", "operator"]);
    const storageIds = [...new Set(args.storageIds)];
    if (storageIds.length > 4) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Solo se pueden descartar hasta cuatro cargas" });
    }
    let deleted = 0;
    for (const storageId of storageIds) {
      const attachment = await ctx.db
        .query("masterAttachments")
        .withIndex("by_storage_id", (q) => q.eq("storageId", storageId))
        .unique();
      if (attachment) continue;
      await ctx.storage.delete(storageId);
      deleted += 1;
    }
    return deleted;
  }
});

export const createDriverMaster = mutation({
  args: { input: driverMasterInputValidator, photo: v.optional(uploadInputValidator) },
  returns: v.object({ id: v.id("drivers"), outcome: creationOutcomeValidator }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, ["admin", "operator"]);
    validateDriverMasterRequired(args.input);
    const normalized = normalizeDriverMasterInput({
      ...args.input,
      emergencyContactName: args.input.emergencyContact?.name,
      emergencyContactPhone: args.input.emergencyContact?.phone
    } as DriverMasterInput);
    const workReferences = normalizeWorkReferences(args.input.workReferences);
    const now = Date.now();
    const existingParty = await ctx.db
      .query("thirdParties")
      .withIndex("by_organization_and_document", (q) => q.eq("organizationId", actor.organizationId).eq("document", normalized.document))
      .unique();
    const roles = deriveDriverThirdPartyRoles((existingParty?.roles ?? []) as ThirdPartyRole[], args.input.activities);
    let relatedChanged = false;
    if (existingParty) {
      const partyPatch = enrichmentPatch(existingParty as unknown as Record<string, unknown>, {
        personType: "natural",
        documentType: normalized.documentType,
        name: normalized.name,
        firstNames: normalized.firstNames,
        firstLastName: normalized.firstLastName,
        secondLastName: normalized.secondLastName,
        cellphone: normalized.cellphone,
        address: normalized.address,
        city: normalized.city,
        cityCode: normalized.cityCode
      }, "tercero conductor");
      if (!sameStringArray(existingParty.roles, roles)) {
        partyPatch.roles = roles;
      }
      if (hasFields(partyPatch)) {
        await ctx.db.patch(existingParty._id, { ...partyPatch, updatedBy: actor._id, updatedAt: now });
        relatedChanged = true;
      }
    } else {
      await ctx.db.insert("thirdParties", {
        organizationId: actor.organizationId,
        personType: "natural",
        documentType: normalized.documentType,
        document: normalized.document,
        name: normalized.name,
        firstNames: normalized.firstNames,
        firstLastName: normalized.firstLastName,
        secondLastName: normalized.secondLastName,
        cellphone: normalized.cellphone,
        address: normalized.address,
        city: normalized.city,
        cityCode: normalized.cityCode,
        roles,
        source: "manual",
        createdBy: actor._id,
        updatedBy: actor._id,
        createdAt: now,
        updatedAt: now
      });
      relatedChanged = true;
    }

    const existing = await ctx.db
      .query("drivers")
      .withIndex("by_organization_and_document", (q) => q.eq("organizationId", actor.organizationId).eq("document", normalized.document))
      .unique();
    const incoming = { ...normalized, workReferences };
    let id: Id<"drivers">;
    let outcome: CreationOutcome;
    if (existing) {
      const patch = enrichmentPatch(existing as unknown as Record<string, unknown>, incoming, "conductor");
      if (hasFields(patch)) {
        await ctx.db.patch(existing._id, { ...patch, updatedAt: now });
      }
      id = existing._id;
      outcome = hasFields(patch) || relatedChanged ? "enriched" : "unchanged";
    } else {
      id = await ctx.db.insert("drivers", {
        ...incoming,
        organizationId: actor.organizationId,
        status: "active",
        createdAt: now,
        updatedAt: now
      });
      outcome = "created";
    }
    if (args.photo) {
      const attachment = await storeMasterAttachment(ctx, actor, "driver", id, "profile", args.photo, now);
      if (outcome === "unchanged" && attachment.created) outcome = "enriched";
    }
    if (outcome !== "unchanged") {
      await appendAudit(ctx, {
        organizationId: actor.organizationId,
        actorType: "user",
        actorId: actor._id,
        action: outcome === "created" ? "driver.created" : "driver.enriched",
        entityType: "driver",
        entityId: id,
        createdAt: now
      });
    }
    return { id, outcome };
  }
});

export const createThirdPartyMaster = mutation({
  args: { input: thirdPartyMasterInputValidator },
  returns: v.object({ id: v.id("thirdParties"), outcome: creationOutcomeValidator }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, ["admin", "operator"]);
    validateThirdPartyMasterRequired(args.input);
    const normalized = normalizeThirdPartyMasterInput(args.input as ThirdPartyMasterInput);
    if (normalized.roles.length === 0) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Selecciona al menos una actividad para el tercero" });
    }
    const roles = normalized.roles;
    const now = Date.now();
    const existing = await ctx.db
      .query("thirdParties")
      .withIndex("by_organization_and_document", (q) => q.eq("organizationId", actor.organizationId).eq("document", normalized.document))
      .unique();
    let id: Id<"thirdParties">;
    let outcome: CreationOutcome;
    if (existing) {
      const { roles: _roles, ...fields } = normalized;
      const patch = enrichmentPatch(existing as unknown as Record<string, unknown>, fields, "tercero");
      const mergedRoles = [...new Set([...(existing.roles as ThirdPartyRole[]), ...roles])];
      if (!sameStringArray(existing.roles, mergedRoles)) patch.roles = mergedRoles;
      if (hasFields(patch)) {
        await ctx.db.patch(existing._id, { ...patch, updatedBy: actor._id, updatedAt: now });
        outcome = "enriched";
      } else {
        outcome = "unchanged";
      }
      id = existing._id;
    } else {
      id = await ctx.db.insert("thirdParties", {
        ...normalized,
        roles,
        organizationId: actor.organizationId,
        source: "manual",
        createdBy: actor._id,
        updatedBy: actor._id,
        createdAt: now,
        updatedAt: now
      });
      outcome = "created";
    }
    if (outcome !== "unchanged") {
      await appendAudit(ctx, {
        organizationId: actor.organizationId,
        actorType: "user",
        actorId: actor._id,
        action: outcome === "created" ? "third_party.created" : "third_party.enriched",
        entityType: "third_party",
        entityId: id,
        createdAt: now
      });
    }
    return { id, outcome };
  }
});

export const createTrailerMaster = mutation({
  args: { input: trailerMasterInputValidator, photo: v.optional(uploadInputValidator) },
  returns: v.object({ id: v.id("trailers"), outcome: creationOutcomeValidator }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, ["admin", "operator"]);
    validateTrailerMasterRequired(args.input);
    const [owner, linkedVehicle] = await Promise.all([
      ctx.db.get("thirdParties", args.input.ownerThirdPartyId),
      args.input.linkedVehicleId ? ctx.db.get("vehicles", args.input.linkedVehicleId) : null
    ]);
    requireOrganizationResource(owner, actor.organizationId, "El propietario seleccionado no existe en esta organizacion");
    if (args.input.linkedVehicleId) {
      requireOrganizationResource(linkedVehicle, actor.organizationId, "El vehiculo habitual no existe en esta organizacion");
    }
    const normalized = normalizeTrailerMasterInput(args.input as TrailerMasterInput);
    const now = Date.now();
    const ownerRolesChanged = await ensureAssignedThirdPartyRoles(ctx, actor, now, [
      { party: owner, role: "owner" }
    ]);
    const incoming = {
      ...normalized,
      linkedVehicleId: args.input.linkedVehicleId,
      ownerThirdPartyId: owner._id,
      ownerDocumentType: owner.documentType,
      ownerDocument: owner.document,
      ownerName: owner.name
    };
    const existing = await ctx.db
      .query("trailers")
      .withIndex("by_organization_and_plate", (q) => q.eq("organizationId", actor.organizationId).eq("plate", normalized.plate))
      .unique();
    let id: Id<"trailers">;
    let outcome: CreationOutcome;
    if (existing) {
      const patch = enrichmentPatch(existing as unknown as Record<string, unknown>, incoming, "remolque");
      if (hasFields(patch)) {
        await ctx.db.patch(existing._id, { ...patch, updatedBy: actor._id, updatedAt: now });
        outcome = "enriched";
      } else {
        outcome = ownerRolesChanged ? "enriched" : "unchanged";
      }
      id = existing._id;
    } else {
      id = await ctx.db.insert("trailers", {
        ...incoming,
        organizationId: actor.organizationId,
        createdBy: actor._id,
        updatedBy: actor._id,
        createdAt: now,
        updatedAt: now
      });
      outcome = "created";
    }
    if (linkedVehicle) {
      const relationshipChanged = await synchronizeTrailerVehicleRelationship(
        ctx,
        actor,
        { id, plate: normalized.plate, linkedVehicleId: args.input.linkedVehicleId ?? existing?.linkedVehicleId },
        linkedVehicle,
        now
      );
      if (relationshipChanged && outcome === "unchanged") outcome = "enriched";
    }
    if (args.photo) {
      const attachment = await storeMasterAttachment(ctx, actor, "trailer", id, "profile", args.photo, now);
      if (outcome === "unchanged" && attachment.created) outcome = "enriched";
    }
    if (outcome !== "unchanged") {
      await appendAudit(ctx, {
        organizationId: actor.organizationId,
        actorType: "user",
        actorId: actor._id,
        action: outcome === "created" ? "trailer.created" : "trailer.enriched",
        entityType: "trailer",
        entityId: id,
        createdAt: now
      });
    }
    return { id, outcome };
  }
});

export const createVehicleMaster = mutation({
  args: { input: vehicleMasterInputValidator, photos: v.optional(v.array(vehiclePhotoInputValidator)) },
  returns: v.object({ id: v.id("vehicles"), outcome: creationOutcomeValidator }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, ["admin", "operator"]);
    validateVehicleMasterRequired(args.input);
    const photos = args.photos ?? [];
    validateVehiclePhotos(photos);
    const [owner, possessor, driver, trailer] = await Promise.all([
      ctx.db.get("thirdParties", args.input.ownerThirdPartyId),
      ctx.db.get("thirdParties", args.input.possessorThirdPartyId),
      ctx.db.get("drivers", args.input.driverId),
      args.input.defaultTrailerId ? ctx.db.get("trailers", args.input.defaultTrailerId) : null
    ]);
    requireOrganizationResource(owner, actor.organizationId, "El propietario seleccionado no existe en esta organizacion");
    requireOrganizationResource(possessor, actor.organizationId, "El poseedor seleccionado no existe en esta organizacion");
    requireOrganizationResource(driver, actor.organizationId, "El conductor seleccionado no existe en esta organizacion");
    if (args.input.defaultTrailerId) {
      requireOrganizationResource(trailer, actor.organizationId, "El remolque seleccionado no existe en esta organizacion");
    }
    const catalogFields = await resolveVehicleCatalogFields(ctx, args.input);
    const normalized = normalizeVehicleMasterInput({ ...args.input, ...catalogFields } as VehicleMasterInput);
    const workReferences = normalizeWorkReferences(args.input.workReferences);
    const now = Date.now();
    const partyRolesChanged = await ensureAssignedThirdPartyRoles(ctx, actor, now, [
      { party: owner, role: "owner" },
      { party: possessor, role: "possessor" }
    ]);
    const incoming = {
      ...normalized,
      ...catalogFields,
      ownerThirdPartyId: owner._id,
      ownerDocumentType: owner.documentType,
      ownerDocument: owner.document,
      ownerName: owner.name,
      ownerCellphone: owner.cellphone,
      ownerPhone: owner.phone,
      possessorThirdPartyId: possessor._id,
      possessorDocumentType: possessor.documentType,
      possessorDocument: possessor.document,
      possessorName: possessor.name,
      possessorCellphone: possessor.cellphone,
      possessorPhone: possessor.phone,
      defaultTrailerId: args.input.defaultTrailerId,
      trailer: trailer?.plate,
      workReferences
    };
    const existing = await ctx.db
      .query("vehicles")
      .withIndex("by_organization_and_plate", (q) => q.eq("organizationId", actor.organizationId).eq("plate", normalized.plate))
      .unique();
    let id: Id<"vehicles">;
    let outcome: CreationOutcome;
    if (existing) {
      const patch = enrichmentPatch(existing as unknown as Record<string, unknown>, incoming, "vehiculo");
      if (hasFields(patch)) {
        await ctx.db.patch(existing._id, { ...patch, updatedAt: now });
        outcome = "enriched";
      } else {
        outcome = partyRolesChanged ? "enriched" : "unchanged";
      }
      id = existing._id;
    } else {
      id = await ctx.db.insert("vehicles", {
        ...incoming,
        organizationId: actor.organizationId,
        status: normalized.status ?? "active",
        source: "manual",
        createdAt: now,
        updatedAt: now
      });
      outcome = "created";
    }
    const driverRelationshipChanged = await assignPrimaryDriver(
      ctx,
      actor.organizationId,
      driver,
      id,
      normalized.plate,
      "manual_master_creation",
      now
    );
    if (driverRelationshipChanged && outcome === "unchanged") outcome = "enriched";
    if (trailer) {
      const trailerRelationshipChanged = await synchronizeTrailerVehicleRelationship(
        ctx,
        actor,
        { id: trailer._id, plate: trailer.plate, linkedVehicleId: trailer.linkedVehicleId },
        { ...existing, ...incoming, _id: id, organizationId: actor.organizationId } as Doc<"vehicles">,
        now
      );
      if (trailerRelationshipChanged && outcome === "unchanged") outcome = "enriched";
    }
    for (const photo of photos) {
      const attachment = await storeMasterAttachment(ctx, actor, "vehicle", id, photo.slot, photo, now);
      if (outcome === "unchanged" && attachment.created) outcome = "enriched";
    }
    if (outcome !== "unchanged") {
      await appendAudit(ctx, {
        organizationId: actor.organizationId,
        actorType: "user",
        actorId: actor._id,
        action: outcome === "created" ? "vehicle.created" : "vehicle.enriched",
        entityType: "vehicle",
        entityId: id,
        createdAt: now
      });
    }
    return { id, outcome };
  }
});

export const linkDriverVehicle = mutation({
  args: { plate: v.string(), document: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, ["admin", "operator"]);
    const plate = args.plate.trim().toUpperCase();
    const document = args.document.trim();
    if (!plate || !document) throw new ConvexError({ code: "INVALID", message: "Indica la placa y el documento del conductor" });
    const vehicle = await ctx.db.query("vehicles").withIndex("by_organization_and_plate", (q) => q.eq("organizationId", actor.organizationId).eq("plate", plate)).unique();
    if (!vehicle) throw new ConvexError({ code: "NOT_FOUND", message: `El vehículo ${plate} no existe en maestros` });
    const driver = await ctx.db.query("drivers").withIndex("by_organization_and_document", (q) => q.eq("organizationId", actor.organizationId).eq("document", document)).unique();
    if (!driver) throw new ConvexError({ code: "NOT_FOUND", message: `El conductor ${document} no existe en maestros` });
    const now = Date.now();
    await assignPrimaryDriver(ctx, actor.organizationId, driver, vehicle._id, plate, "manual", now);
    await appendAudit(ctx, { organizationId: actor.organizationId, actorType: "user", actorId: actor._id, action: "vehicle.driver_linked", entityType: "vehicle", entityId: vehicle._id, createdAt: now, detailsJson: JSON.stringify({ plate, document }) });
    return null;
  }
});

export const unlinkDriverVehicle = mutation({
  args: { plate: v.string(), document: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, ["admin", "operator"]);
    const plate = args.plate.trim().toUpperCase();
    const document = args.document.trim();
    const vehicle = await ctx.db.query("vehicles").withIndex("by_organization_and_plate", (q) => q.eq("organizationId", actor.organizationId).eq("plate", plate)).unique();
    if (!vehicle) throw new ConvexError({ code: "NOT_FOUND", message: `El vehículo ${plate} no existe en maestros` });
    const relations = await matchingDriverVehicleRelations(ctx, actor.organizationId, document, plate, undefined, vehicle._id);
    if (relations.length === 0) return null;
    for (const relation of relations) await ctx.db.delete(relation._id);
    await appendAudit(ctx, { organizationId: actor.organizationId, actorType: "user", actorId: actor._id, action: "vehicle.driver_unlinked", entityType: "vehicle", entityId: vehicle._id, createdAt: Date.now(), detailsJson: JSON.stringify({ plate, document }) });
    return null;
  }
});

export const listThirdParties = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    return await ctx.db.query("thirdParties").withIndex("by_organization_and_name", (q) => q.eq("organizationId", actor.organizationId)).order("asc").take(250);
  }
});

export const registrationBundle = query({
  args: { driverDocument: v.string(), vehiclePlate: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, ["admin", "operator"]);
    const driver = await ctx.db.query("drivers").withIndex("by_organization_and_document", (q) => q.eq("organizationId", actor.organizationId).eq("document", args.driverDocument.trim())).unique();
    const vehicle = await ctx.db.query("vehicles").withIndex("by_organization_and_plate", (q) => q.eq("organizationId", actor.organizationId).eq("plate", args.vehiclePlate.trim().toUpperCase())).unique();
    if (!driver || !vehicle?.ownerDocument || !vehicle.possessorDocument) return null;
    const [owner, possessor] = await Promise.all([
      ctx.db.query("thirdParties").withIndex("by_organization_and_document", (q) => q.eq("organizationId", actor.organizationId).eq("document", vehicle.ownerDocument!)).unique(),
      ctx.db.query("thirdParties").withIndex("by_organization_and_document", (q) => q.eq("organizationId", actor.organizationId).eq("document", vehicle.possessorDocument!)).unique()
    ]);
    if (!owner || !possessor) return null;
    return { organizationId: actor.organizationId, driver, vehicle, owner, possessor, version: Math.max(driver.updatedAt, vehicle.updatedAt, owner.updatedAt, possessor.updatedAt) };
  }
});

async function upsertPartyRecord(ctx: MutationCtx, organizationId: Id<"organizations">, actorId: Id<"users">, raw: ThirdPartyInput, now: number): Promise<Id<"thirdParties">> {
  const input = normalizeThirdPartyInput(raw);
  const existing = await ctx.db.query("thirdParties").withIndex("by_organization_and_document", (q) => q.eq("organizationId", organizationId).eq("document", input.document)).unique();
  const roles = [...new Set([...(existing?.roles ?? []), ...(input.roles ?? [])])];
  if (existing) {
    await ctx.db.patch(existing._id, { ...input, roles, updatedBy: actorId, updatedAt: now });
    return existing._id;
  }
  return await ctx.db.insert("thirdParties", { ...input, roles, organizationId, createdBy: actorId, updatedBy: actorId, createdAt: now, updatedAt: now });
}

export const upsertFleetBatch = mutation({
  args: {
    ingestKey: v.string(),
    organizationId: v.optional(v.id("organizations")),
    drivers: v.array(driverInputValidator),
    vehicles: v.array(vehicleInputValidator),
    relations: v.array(relationInputValidator)
  },
  returns: v.object({
    driversInserted: v.number(),
    driversUpdated: v.number(),
    vehiclesInserted: v.number(),
    vehiclesUpdated: v.number(),
    relationsInserted: v.number(),
    relationsUpdated: v.number(),
    relationsSkipped: v.array(
      v.object({ driverDocument: v.string(), vehiclePlate: v.string(), reason: v.string() })
    )
  }),
  handler: async (ctx, args) => {
    if (args.ingestKey !== process.env.RNDC_INGEST_KEY) {
      throw new ConvexError({ code: "UNAUTHORIZED", message: "Invalid ingest key" });
    }

    const now = Date.now();
    const result = {
      driversInserted: 0,
      driversUpdated: 0,
      vehiclesInserted: 0,
      vehiclesUpdated: 0,
      relationsInserted: 0,
      relationsUpdated: 0,
      relationsSkipped: [] as { driverDocument: string; vehiclePlate: string; reason: string }[]
    };

    for (const driver of args.drivers) {
      const existing = args.organizationId
        ? await ctx.db.query("drivers").withIndex("by_organization_and_document", (q) => q.eq("organizationId", args.organizationId).eq("document", driver.document)).first()
        : await ctx.db.query("drivers").withIndex("by_document", (q) => q.eq("document", driver.document)).first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          organizationId: args.organizationId ?? existing.organizationId,
          documentType: driver.documentType ?? existing.documentType,
          name: driver.name ?? existing.name,
          status: driver.status ?? existing.status,
          birthDate: driver.birthDate ?? existing.birthDate,
          sex: driver.sex ?? existing.sex,
          bloodType: driver.bloodType ?? existing.bloodType,
          address: driver.address ?? existing.address,
          city: driver.city ?? existing.city,
          phone1: driver.phone1 ?? existing.phone1,
          phone2: driver.phone2 ?? existing.phone2,
          cellphone: driver.cellphone ?? existing.cellphone,
          licenseNumber: driver.licenseNumber ?? existing.licenseNumber,
          licenseCategory: driver.licenseCategory ?? existing.licenseCategory,
          licenseExpiresAt: driver.licenseExpiresAt ?? existing.licenseExpiresAt,
          eps: driver.eps ?? existing.eps,
          arp: driver.arp ?? existing.arp,
          pensionFund: driver.pensionFund ?? existing.pensionFund,
          hazmatCourse: driver.hazmatCourse ?? existing.hazmatCourse,
          hazmatCourseExpiresAt: driver.hazmatCourseExpiresAt ?? existing.hazmatCourseExpiresAt,
          observations: driver.observations ?? existing.observations,
          updatedAt: now
        });
        result.driversUpdated += 1;
      } else {
        await ctx.db.insert("drivers", { ...driver, organizationId: args.organizationId, createdAt: now, updatedAt: now });
        result.driversInserted += 1;
      }
    }

    for (const vehicle of args.vehicles) {
      const existing = args.organizationId
        ? await ctx.db.query("vehicles").withIndex("by_organization_and_plate", (q) => q.eq("organizationId", args.organizationId).eq("plate", vehicle.plate)).first()
        : await ctx.db.query("vehicles").withIndex("by_plate", (q) => q.eq("plate", vehicle.plate)).first();

      if (existing) {
        const { plate: _plate, ...fields } = vehicle;
        const patch: Record<string, unknown> = { organizationId: args.organizationId ?? existing.organizationId, updatedAt: now };
        for (const [key, value] of Object.entries(fields)) {
          if (value !== undefined) {
            patch[key] = value;
          }
        }
        await ctx.db.patch(existing._id, patch);
        result.vehiclesUpdated += 1;
      } else {
        await ctx.db.insert("vehicles", { ...vehicle, organizationId: args.organizationId, createdAt: now, updatedAt: now });
        result.vehiclesInserted += 1;
      }
    }

    for (const relation of args.relations) {
      const driver = args.organizationId
        ? await ctx.db.query("drivers").withIndex("by_organization_and_document", (q) => q.eq("organizationId", args.organizationId).eq("document", relation.driverDocument)).first()
        : await ctx.db.query("drivers").withIndex("by_document", (q) => q.eq("document", relation.driverDocument)).first();
      const vehicle = args.organizationId
        ? await ctx.db.query("vehicles").withIndex("by_organization_and_plate", (q) => q.eq("organizationId", args.organizationId).eq("plate", relation.vehiclePlate)).first()
        : await ctx.db.query("vehicles").withIndex("by_plate", (q) => q.eq("plate", relation.vehiclePlate)).first();

      if (!driver || !vehicle) {
        result.relationsSkipped.push({
          driverDocument: relation.driverDocument,
          vehiclePlate: relation.vehiclePlate,
          reason: !driver ? "driver_not_found" : "vehicle_not_found"
        });
        continue;
      }

      const existing = args.organizationId
        ? (await matchingDriverVehicleRelations(ctx, args.organizationId, relation.driverDocument, relation.vehiclePlate, driver._id, vehicle._id))[0]
        : await ctx.db.query("driverVehicles").withIndex("by_document_and_plate", (q) => q.eq("driverDocument", relation.driverDocument).eq("vehiclePlate", relation.vehiclePlate)).first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          organizationId: args.organizationId ?? existing.organizationId,
          driverId: driver._id,
          vehicleId: vehicle._id,
          matchConfidence: relation.matchConfidence ?? existing.matchConfidence,
          matchBasis: relation.matchBasis ?? existing.matchBasis,
          roles: relation.roles ?? existing.roles,
          updatedAt: now
        });
        result.relationsUpdated += 1;
      } else {
        await ctx.db.insert("driverVehicles", {
          organizationId: args.organizationId,
          driverId: driver._id,
          vehicleId: vehicle._id,
          driverDocument: relation.driverDocument,
          vehiclePlate: relation.vehiclePlate,
          matchConfidence: relation.matchConfidence,
          matchBasis: relation.matchBasis,
          roles: relation.roles,
          createdAt: now,
          updatedAt: now
        });
        result.relationsInserted += 1;
      }
    }

    return result;
  }
});

const pageResultFields = {
  isDone: v.boolean(),
  continueCursor: v.string(),
  splitCursor: v.optional(v.union(v.string(), v.null())),
  pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null()))
};

const thirdPartyRowValidator = v.object({
  _id: v.id("thirdParties"),
  document: v.string(),
  documentType: v.string(),
  name: v.string(),
  phone: v.optional(v.string()),
  roles: v.array(thirdPartyRoleValidator),
  city: v.optional(v.string()),
  siteCount: v.optional(v.number()),
  updatedAt: v.number()
});

function prefixRange(prefix: string): { from: string; to: string } | null {
  return prefix === "" ? null : { from: prefix, to: prefix + "\uffff" };
}

export const driversPage = query({
  args: { paginationOpts: paginationOptsValidator, prefix: v.optional(v.string()) },
  returns: v.object({
    page: v.array(driverRowValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null()))
  }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const range = prefixRange((args.prefix ?? "").trim());
    const results = await ctx.db
      .query("drivers")
      .withIndex("by_organization_and_document", (q) => range ? q.eq("organizationId", actor.organizationId).gte("document", range.from).lt("document", range.to) : q.eq("organizationId", actor.organizationId))
      .order(range ? "asc" : "desc")
      .paginate(args.paginationOpts);
    const page = await Promise.all(results.page.map((driver) => toDriverRow(ctx, driver)));
    return { ...results, page };
  }
});

export const vehiclesPage = query({
  args: { paginationOpts: paginationOptsValidator, prefix: v.optional(v.string()) },
  returns: v.object({
    page: v.array(vehicleRowValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null()))
  }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const range = prefixRange((args.prefix ?? "").trim().toUpperCase());
    const results = await ctx.db
      .query("vehicles")
      .withIndex("by_organization_and_plate", (q) => range ? q.eq("organizationId", actor.organizationId).gte("plate", range.from).lt("plate", range.to) : q.eq("organizationId", actor.organizationId))
      .order(range ? "asc" : "desc")
      .paginate(args.paginationOpts);
    const page = await Promise.all(results.page.map((vehicle) => toVehicleRow(ctx, vehicle)));
    return { ...results, page };
  }
});

export const trailersPage = query({
  args: { paginationOpts: paginationOptsValidator, prefix: v.optional(v.string()) },
  returns: v.object({ page: v.array(trailerRowValidator), ...pageResultFields }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const range = prefixRange((args.prefix ?? "").trim().toUpperCase());
    const results = await ctx.db
      .query("trailers")
      .withIndex("by_organization_and_plate", (q) => range
        ? q.eq("organizationId", actor.organizationId).gte("plate", range.from).lt("plate", range.to)
        : q.eq("organizationId", actor.organizationId))
      .order(range ? "asc" : "desc")
      .paginate(args.paginationOpts);
    return { ...results, page: results.page.map(toTrailerRow) };
  }
});

export const thirdPartiesPage = query({
  args: { paginationOpts: paginationOptsValidator, prefix: v.optional(v.string()) },
  returns: v.object({ page: v.array(thirdPartyRowValidator), ...pageResultFields }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const range = prefixRange((args.prefix ?? "").trim());
    const results = await ctx.db
      .query("thirdParties")
      .withIndex("by_organization_and_document", (q) => range ? q.eq("organizationId", actor.organizationId).gte("document", range.from).lt("document", range.to) : q.eq("organizationId", actor.organizationId))
      .order(range ? "asc" : "desc")
      .paginate(args.paginationOpts);
    return {
      ...results,
      page: results.page.map((party) => ({
        _id: party._id,
        document: party.document,
        documentType: party.documentType,
        name: party.name,
        phone: party.cellphone ?? party.phone,
        roles: party.roles,
        city: party.city,
        siteCount: party.siteCount,
        updatedAt: party.updatedAt
      }))
    };
  }
});

export const driversSearch = query({
  args: { prefix: v.string() },
  returns: v.array(driverRowValidator),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const prefix = args.prefix.trim();
    if (prefix === "") {
      return [];
    }
    const drivers = await ctx.db
      .query("drivers")
      .withIndex("by_organization_and_document", (q) => q.eq("organizationId", actor.organizationId).gte("document", prefix).lt("document", prefix + "￿"))
      .take(25);
    return await Promise.all(drivers.map((driver) => toDriverRow(ctx, driver)));
  }
});

export const vehiclesSearch = query({
  args: { prefix: v.string() },
  returns: v.array(vehicleRowValidator),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const prefix = args.prefix.trim().toUpperCase();
    if (prefix === "") {
      return [];
    }
    const vehicles = await ctx.db
      .query("vehicles")
      .withIndex("by_organization_and_plate", (q) => q.eq("organizationId", actor.organizationId).gte("plate", prefix).lt("plate", prefix + "￿"))
      .take(25);
    return await Promise.all(vehicles.map((vehicle) => toVehicleRow(ctx, vehicle)));
  }
});

export const driverByDocument = query({
  args: { document: v.string() },
  returns: v.union(driverRowValidator, v.null()),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const document = args.document.trim();
    if (document === "") {
      return null;
    }

    const driver = await ctx.db
      .query("drivers")
      .withIndex("by_organization_and_document", (q) => q.eq("organizationId", actor.organizationId).eq("document", document))
      .first();

    return driver ? await toDriverRow(ctx, driver) : null;
  }
});

export const vehicleByPlate = query({
  args: { plate: v.string() },
  returns: v.union(vehicleRowValidator, v.null()),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const plate = args.plate.trim().toUpperCase();
    if (plate === "") {
      return null;
    }

    const vehicle = await ctx.db
      .query("vehicles")
      .withIndex("by_organization_and_plate", (q) => q.eq("organizationId", actor.organizationId).eq("plate", plate))
      .first();

    return vehicle ? await toVehicleRow(ctx, vehicle) : null;
  }
});

export const trailerDetail = query({
  args: { plate: v.string() },
  returns: v.union(trailerDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const plate = args.plate.trim().toUpperCase();
    if (!plate) return null;
    const trailer = await ctx.db
      .query("trailers")
      .withIndex("by_organization_and_plate", (q) => q.eq("organizationId", actor.organizationId).eq("plate", plate))
      .unique();
    if (!trailer) return null;
    const attachmentDetails = await readMasterAttachments(ctx, actor.organizationId, "trailer", trailer._id);
    return {
      _id: trailer._id,
      _creationTime: trailer._creationTime,
      plate: trailer.plate,
      trailerType: trailer.trailerType,
      linkedVehicleId: trailer.linkedVehicleId,
      make: trailer.make,
      modelYear: trailer.modelYear,
      configuration: trailer.configuration,
      capacityKg: trailer.capacityKg,
      emptyWeightKg: trailer.emptyWeightKg,
      widthM: trailer.widthM,
      heightM: trailer.heightM,
      lengthM: trailer.lengthM,
      rearVolumeM3: trailer.rearVolumeM3,
      ownerThirdPartyId: trailer.ownerThirdPartyId,
      ownerDocumentType: trailer.ownerDocumentType,
      ownerDocument: trailer.ownerDocument,
      ownerName: trailer.ownerName,
      bodyType: trailer.bodyType,
      procedureType: trailer.procedureType,
      chassisSerial: trailer.chassisSerial,
      color: trailer.color,
      observations: trailer.observations,
      status: trailer.status,
      createdAt: trailer.createdAt,
      updatedAt: trailer.updatedAt,
      attachments: attachmentDetails
    };
  }
});

export const driverDetail = query({
  args: { document: v.string() },
  returns: v.union(driverDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const document = args.document.trim();
    if (document === "") {
      return null;
    }

    const driver = await ctx.db
      .query("drivers")
      .withIndex("by_organization_and_document", (q) => q.eq("organizationId", actor.organizationId).eq("document", document))
      .first();

    if (!driver) {
      return null;
    }

    const relations = await ctx.db
      .query("driverVehicles")
      .withIndex("by_driver", (q) => q.eq("driverId", driver._id))
      .collect();
    const vehicles = await Promise.all(
      relations.map(async (rel) => {
        const vehicle = await ctx.db.get(rel.vehicleId);
        return {
          vehiclePlate: rel.vehiclePlate,
          make: vehicle?.make,
          line: vehicle?.line,
          modelYear: vehicle?.modelYear,
          roles: rel.roles
        };
      })
    );

    const attachments = await readMasterAttachments(ctx, actor.organizationId, "driver", driver._id);
    const { organizationId: _organizationId, ...safeDriver } = driver;
    return { ...safeDriver, attachments, vehicles };
  }
});

export const vehicleDetail = query({
  args: { plate: v.string() },
  returns: v.union(vehicleDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const plate = args.plate.trim().toUpperCase();
    if (plate === "") {
      return null;
    }

    const vehicle = await ctx.db
      .query("vehicles")
      .withIndex("by_organization_and_plate", (q) => q.eq("organizationId", actor.organizationId).eq("plate", plate))
      .first();

    if (!vehicle) {
      return null;
    }

    const relations = await ctx.db
      .query("driverVehicles")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicle._id))
      .collect();
    const drivers = await Promise.all(
      relations.map(async (rel) => {
        const driver = await ctx.db.get(rel.driverId);
        return {
          driverDocument: rel.driverDocument,
          name: driver?.name,
          roles: rel.roles
        };
      })
    );

    const attachments = await readMasterAttachments(ctx, actor.organizationId, "vehicle", vehicle._id);
    const { organizationId: _organizationId, ...safeVehicle } = vehicle;
    return { ...safeVehicle, attachments, drivers };
  }
});

async function toDriverRow(ctx: QueryCtx, driver: Doc<"drivers">) {
  const vehicles = await ctx.db
    .query("driverVehicles")
    .withIndex("by_driver", (q) => q.eq("driverId", driver._id))
    .collect();

  return {
    _id: driver._id,
    _creationTime: driver._creationTime,
    document: driver.document,
    name: driver.name,
    documentType: driver.documentType,
    phone: driver.cellphone ?? driver.phone1 ?? driver.phone2,
    city: driver.city,
    licenseCategory: driver.licenseCategory,
    vehicleCount: vehicles.length,
    updatedAt: driver.updatedAt
  };
}

async function toVehicleRow(ctx: QueryCtx, vehicle: Doc<"vehicles">) {
  const drivers = await ctx.db
    .query("driverVehicles")
    .withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicle._id))
    .collect();

  return {
    _id: vehicle._id,
    _creationTime: vehicle._creationTime,
    plate: vehicle.plate,
    make: vehicle.make,
    line: vehicle.line,
    modelYear: vehicle.modelYear,
    capacityTn: vehicle.capacityTn,
    ownerDocument: vehicle.ownerDocument,
    ownerName: vehicle.ownerName,
    possessorDocument: vehicle.possessorDocument,
    possessorName: vehicle.possessorName,
    vehicleKind: vehicle.vehicleKind,
    status: vehicle.status,
    configuration: vehicle.configuration,
    soatExpiresAt: vehicle.soatExpiresAt,
    driverCount: drivers.length,
    updatedAt: vehicle.updatedAt
  };
}

function toTrailerRow(trailer: Doc<"trailers">) {
  return {
    _id: trailer._id,
    _creationTime: trailer._creationTime,
    plate: trailer.plate,
    trailerType: trailer.trailerType,
    make: trailer.make,
    modelYear: trailer.modelYear,
    configuration: trailer.configuration,
    capacityKg: trailer.capacityKg,
    emptyWeightKg: trailer.emptyWeightKg,
    ownerName: trailer.ownerName,
    status: trailer.status,
    updatedAt: trailer.updatedAt
  };
}

async function readMasterAttachments(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
  resourceType: MasterResourceType,
  resourceId: string
) {
  const attachments = await ctx.db
    .query("masterAttachments")
    .withIndex("by_organization_resource_slot_and_created_at", (q) =>
      q.eq("organizationId", organizationId).eq("resourceType", resourceType).eq("resourceId", resourceId)
    )
    .collect();
  return await Promise.all(attachments.map(async (attachment) => ({
    slot: attachment.slot,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    size: attachment.size,
    url: await ctx.storage.getUrl(attachment.storageId)
  })));
}

function normalizeWorkReferences(input: MasterWorkReference[] | undefined): MasterWorkReference[] | undefined {
  if (input === undefined || input.length === 0) return undefined;
  if (input.length > 5) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "Solo se permiten hasta cinco referencias laborales" });
  }
  return input.map((reference, index) => {
    const company = reference.company.trim();
    if (!company) {
      throw new ConvexError({ code: "INVALID_INPUT", message: `La empresa de la referencia ${index + 1} es obligatoria` });
    }
    return compactRecord({
      company,
      contactName: trimmedOptional(reference.contactName),
      phone: trimmedOptional(reference.phone),
      position: trimmedOptional(reference.position),
      trips: trimmedOptional(reference.trips),
      tenure: trimmedOptional(reference.tenure),
      city: trimmedOptional(reference.city),
      cityCode: trimmedOptional(reference.cityCode),
      merchandise: trimmedOptional(reference.merchandise)
    }) as MasterWorkReference;
  });
}

function enrichmentPatch(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  resourceLabel: string
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    const current = existing[key];
    if (isBlankValue(current)) {
      patch[key] = value;
      continue;
    }
    if (!sameMasterValue(key, current, value)) {
      throw new ConvexError({
        code: "CONFLICT",
        message: `El ${resourceLabel} ya existe con un valor diferente en ${key}`
      });
    }
  }
  return patch;
}

function hasFields(value: Record<string, unknown>): boolean {
  return Object.keys(value).length > 0;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function isBlankValue(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right) || isPlainObject(left) || isPlainObject(right)) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return false;
}

function sameMasterValue(key: string, left: unknown, right: unknown): boolean {
  if (key === "status" && typeof left === "string" && typeof right === "string") {
    return normalizedResourceStatus(left) === normalizedResourceStatus(right);
  }
  return sameValue(left, right);
}

function normalizedResourceStatus(value: string): string {
  if (value === "activo") return "active";
  if (value === "archivado") return "inactive";
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimmedOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));
}

function requireOrganizationResource<T extends { organizationId?: Id<"organizations"> }>(
  resource: T | null,
  organizationId: Id<"organizations">,
  message: string
): asserts resource is T {
  if (!resource || resource.organizationId !== organizationId) {
    throw new ConvexError({ code: "NOT_FOUND", message });
  }
}

async function ensureAssignedThirdPartyRoles(
  ctx: MutationCtx,
  actor: Doc<"users">,
  now: number,
  assignments: Array<{ party: Doc<"thirdParties">; role: ThirdPartyRole }>
): Promise<boolean> {
  const grouped = new Map<Id<"thirdParties">, { party: Doc<"thirdParties">; roles: Set<ThirdPartyRole> }>();
  for (const assignment of assignments) {
    const current = grouped.get(assignment.party._id) ?? {
      party: assignment.party,
      roles: new Set(assignment.party.roles as ThirdPartyRole[])
    };
    current.roles.add(assignment.role);
    grouped.set(assignment.party._id, current);
  }
  let changed = false;
  for (const { party, roles } of grouped.values()) {
    const nextRoles = [...roles];
    if (sameStringArray(party.roles, nextRoles)) continue;
    await ctx.db.patch(party._id, { roles: nextRoles, updatedBy: actor._id, updatedAt: now });
    changed = true;
  }
  return changed;
}

async function assignPrimaryDriver(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  driver: Doc<"drivers">,
  vehicleId: Id<"vehicles">,
  vehiclePlate: string,
  matchBasis: string,
  now: number
): Promise<boolean> {
  const [selectedRelations, allVehicleRelations] = await Promise.all([
    matchingDriverVehicleRelations(ctx, organizationId, driver.document, vehiclePlate, driver._id, vehicleId),
    ctx.db
      .query("driverVehicles")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicleId))
      .collect()
  ]);
  const selectedRelation = selectedRelations[0];
  const vehicleRelations = allVehicleRelations.filter((relation) =>
    relation.organizationId === undefined || relation.organizationId === organizationId
  );
  let changed = false;
  for (const relation of vehicleRelations) {
    if (relation._id === selectedRelation?._id || !relation.roles?.includes("primary")) continue;
    const roles = relation.roles.filter((role) => role !== "primary");
    if (roles.length === 0) {
      await ctx.db.delete(relation._id);
    } else {
      await ctx.db.patch(relation._id, { organizationId, roles, updatedAt: now });
    }
    changed = true;
  }
  if (selectedRelation) {
    const roles = [...new Set([...(selectedRelation.roles ?? []), "primary"])];
    const identifiersChanged = selectedRelation.driverId !== driver._id || selectedRelation.vehicleId !== vehicleId;
    const rolesChanged = !sameStringArray(selectedRelation.roles ?? [], roles);
    const organizationChanged = selectedRelation.organizationId !== organizationId;
    if (organizationChanged || identifiersChanged || rolesChanged || selectedRelation.matchBasis !== matchBasis || selectedRelation.matchConfidence !== "confirmed") {
      await ctx.db.patch(selectedRelation._id, {
        organizationId,
        driverId: driver._id,
        vehicleId,
        matchBasis,
        matchConfidence: "confirmed",
        roles,
        updatedAt: now
      });
      changed = true;
    }
    return changed;
  }
  await ctx.db.insert("driverVehicles", {
    organizationId,
    driverId: driver._id,
    vehicleId,
    driverDocument: driver.document,
    vehiclePlate,
    matchConfidence: "confirmed",
    matchBasis,
    roles: ["primary"],
    createdAt: now,
    updatedAt: now
  });
  return true;
}

async function matchingDriverVehicleRelations(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  driverDocument: string,
  vehiclePlate: string,
  driverId?: Id<"drivers">,
  vehicleId?: Id<"vehicles">
): Promise<Doc<"driverVehicles">[]> {
  const relations = await ctx.db
    .query("driverVehicles")
    .withIndex("by_document_and_plate", (q) => q.eq("driverDocument", driverDocument).eq("vehiclePlate", vehiclePlate))
    .collect();
  return relations
    .filter((relation) => relation.organizationId === undefined || relation.organizationId === organizationId)
    .filter((relation) => driverId === undefined || relation.driverId === driverId)
    .filter((relation) => vehicleId === undefined || relation.vehicleId === vehicleId)
    .sort((left, right) => Number(right.organizationId === organizationId) - Number(left.organizationId === organizationId));
}

async function synchronizeTrailerVehicleRelationship(
  ctx: MutationCtx,
  actor: Doc<"users">,
  trailer: { id: Id<"trailers">; plate: string; linkedVehicleId?: Id<"vehicles"> },
  vehicle: { _id: Id<"vehicles">; organizationId?: Id<"organizations">; defaultTrailerId?: Id<"trailers">; trailer?: string },
  now: number
): Promise<boolean> {
  requireOrganizationResource(vehicle, actor.organizationId, "El vehiculo habitual no existe en esta organizacion");
  if (trailer.linkedVehicleId && trailer.linkedVehicleId !== vehicle._id) {
    throw new ConvexError({ code: "CONFLICT", message: "El remolque ya esta vinculado a otro vehiculo" });
  }
  if (vehicle.defaultTrailerId && vehicle.defaultTrailerId !== trailer.id) {
    throw new ConvexError({ code: "CONFLICT", message: "El vehiculo ya tiene otro remolque habitual" });
  }
  if (vehicle.trailer && vehicle.trailer.trim().toUpperCase() !== trailer.plate) {
    throw new ConvexError({ code: "CONFLICT", message: "La placa del remolque no coincide con la vinculacion existente del vehiculo" });
  }
  const linkedTrailers = await ctx.db
    .query("trailers")
    .withIndex("by_organization_and_linked_vehicle", (q) =>
      q.eq("organizationId", actor.organizationId).eq("linkedVehicleId", vehicle._id)
    )
    .collect();
  if (linkedTrailers.some((linkedTrailer) => linkedTrailer._id !== trailer.id)) {
    throw new ConvexError({ code: "CONFLICT", message: "El vehiculo ya tiene otro remolque vinculado" });
  }
  let changed = false;
  if (!trailer.linkedVehicleId) {
    await ctx.db.patch(trailer.id, { linkedVehicleId: vehicle._id, updatedBy: actor._id, updatedAt: now });
    changed = true;
  }
  const vehiclePatch: { defaultTrailerId?: Id<"trailers">; trailer?: string; updatedAt?: number } = {};
  if (!vehicle.defaultTrailerId) vehiclePatch.defaultTrailerId = trailer.id;
  if (!vehicle.trailer) vehiclePatch.trailer = trailer.plate;
  if (vehiclePatch.defaultTrailerId || vehiclePatch.trailer) {
    vehiclePatch.updatedAt = now;
    await ctx.db.patch(vehicle._id, vehiclePatch);
    changed = true;
  }
  return changed;
}

function validateDriverMasterRequired(input: {
  documentType: string;
  document: string;
  firstNames: string;
  firstLastName: string;
  birthDate?: string;
  bloodType?: string;
  address: string;
  cityCode: string;
  phone1?: string;
  cellphone: string;
  rating?: string;
  licenseNumber: string;
  licenseCategory: string;
  licenseExpiresAt: string;
}): void {
  requireMasterTextFields([
    [input.documentType, "tipo de documento"],
    [input.document, "numero de documento"],
    [input.firstNames, "nombres"],
    [input.firstLastName, "primer apellido"],
    [input.birthDate, "fecha de nacimiento"],
    [input.bloodType, "RH"],
    [input.address, "direccion"],
    [input.cityCode, "ciudad"],
    [input.phone1, "telefono 1"],
    [input.cellphone, "celular"],
    [input.rating, "calificacion"],
    [input.licenseNumber, "numero de licencia"],
    [input.licenseCategory, "categoria de licencia"],
    [input.licenseExpiresAt, "vencimiento de licencia"]
  ]);
}

function validateThirdPartyMasterRequired(input: {
  documentType: string;
  document: string;
  address?: string;
  cityCode?: string;
  phone1?: string;
  taxRegime?: string;
}): void {
  requireMasterTextFields([
    [input.documentType, "tipo de documento"],
    [input.document, "numero de documento"],
    [input.address, "direccion"],
    [input.cityCode, "ciudad"],
    [input.phone1, "telefono 1"],
    [input.taxRegime, "regimen"]
  ]);
}

function validateTrailerMasterRequired(input: {
  plate: string;
  make?: string;
  modelYear?: string;
  configuration?: string;
  bodyType?: string;
}): void {
  requireMasterTextFields([
    [input.plate, "numero de remolque"],
    [input.make, "marca"],
    [input.modelYear, "modelo"],
    [input.configuration, "configuracion"],
    [input.bodyType, "carroceria"]
  ]);
  if (!/^\d{4}$/.test(input.modelYear!.trim())) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "modelo debe tener cuatro digitos" });
  }
}

function requireMasterTextFields(fields: ReadonlyArray<readonly [string | undefined, string]>): void {
  for (const [value, label] of fields) {
    if (!value?.trim()) {
      throw new ConvexError({ code: "INVALID_INPUT", message: `${label} es obligatorio` });
    }
  }
}

function validateVehiclePhotos(
  photos: Array<MasterUploadInput & { slot: "front" | "left" | "right" | "rear" }>
): void {
  if (photos.length > 4) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "Solo se permite una foto por lado del vehiculo" });
  }
  const slots = new Set(photos.map((photo) => photo.slot));
  if (slots.size !== photos.length) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "No se puede repetir la posicion de una foto" });
  }
}

function validateVehicleMasterRequired(input: {
  plate: string;
  make?: string;
  line?: string;
  modelYear: string;
  color?: string;
  bodyType?: string;
  configuration?: string;
  linkType?: string;
  engineNumber?: string;
  capacityTn: string;
  emptyWeightTn: string;
  transitLicenseNumber?: string;
  rating?: string;
  insurerNit: string;
  soatExpiresAt: string;
  soatNumber: string;
  vehicleKind?: string;
  status?: string;
  rndcMakeCode?: string;
  rndcBodyTypeCode?: string;
  rndcConfigurationCode?: string;
  fuelType?: string;
  rndcFuelCode?: string;
}): void {
  const requiredFields = [
    [input.plate, "placa"],
    [input.make, "marca"],
    [input.line, "linea"],
    [input.modelYear, "modelo"],
    [input.color, "color"],
    [input.bodyType, "carroceria"],
    [input.configuration, "configuracion"],
    [input.linkType, "tipo de vinculacion"],
    [input.engineNumber, "numero de motor"],
    [input.capacityTn, "capacidad"],
    [input.emptyWeightTn, "peso vacio"],
    [input.transitLicenseNumber, "licencia de transito"],
    [input.rating, "calificacion"],
    [input.insurerNit, "aseguradora SOAT"],
    [input.soatExpiresAt, "vencimiento SOAT"],
    [input.soatNumber, "numero SOAT"],
    [input.vehicleKind, "tipo de vehiculo"],
    [input.status, "estado"],
    [input.rndcMakeCode, "codigo de marca RNDC"],
    [input.rndcBodyTypeCode, "codigo de carroceria RNDC"],
    [input.rndcConfigurationCode, "codigo de configuracion RNDC"],
    [input.fuelType, "combustible"],
    [input.rndcFuelCode, "codigo de combustible RNDC"]
  ] as const;
  requireMasterTextFields(requiredFields);
  if (!/^\d{4}$/.test(input.modelYear.trim())) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "modelo debe tener cuatro digitos" });
  }
  if (!["active", "maintenance", "inactive"].includes(input.status!)) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "El estado del vehiculo no es valido" });
  }
  if (!["rigido", "cabezote", "liviano"].includes(input.vehicleKind!)) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "El tipo de vehiculo no es valido" });
  }
  if (!/^\d{1,10}$/.test(input.rndcMakeCode!) || !/^\d{1,10}$/.test(input.rndcBodyTypeCode!)) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "Los codigos de marca y carroceria RNDC deben ser numericos" });
  }
  if (!/^\d{2}$/.test(input.rndcConfigurationCode!)) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "El codigo de configuracion RNDC debe tener dos digitos" });
  }
  const configurationsByKind: Record<string, string[]> = {
    rigido: ["50", "51", "52", "56"],
    cabezote: ["53", "54", "55"],
    liviano: ["45"]
  };
  if (!configurationsByKind[input.vehicleKind!]?.includes(input.rndcConfigurationCode!)) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "La configuracion RNDC no corresponde al tipo de vehiculo" });
  }
  if (!/^[1-5]$/.test(input.rndcFuelCode!)) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "El codigo de combustible RNDC no es valido" });
  }
  if (!/^\d{1,5}$/.test(input.color!)) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "El codigo de color RNDC debe ser numerico" });
  }
}

async function storeMasterAttachment(
  ctx: MutationCtx,
  actor: Doc<"users">,
  resourceType: MasterResourceType,
  resourceId: string,
  slot: MasterAttachmentSlot,
  input: MasterUploadInput,
  now: number
): Promise<{ id: Id<"masterAttachments">; created: boolean }> {
  const existingStorage = await ctx.db
    .query("masterAttachments")
    .withIndex("by_storage_id", (q) => q.eq("storageId", input.storageId))
    .unique();
  const fileName = input.fileName.trim();
  if (!fileName) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "El nombre del archivo es obligatorio" });
  }
  if (existingStorage) {
    if (
      existingStorage.organizationId !== actor.organizationId ||
      existingStorage.resourceType !== resourceType ||
      existingStorage.resourceId !== resourceId ||
      existingStorage.slot !== slot
    ) {
      throw new ConvexError({ code: "CONFLICT", message: "El archivo ya fue finalizado para otro recurso" });
    }
    return { id: existingStorage._id, created: false };
  }
  const metadata = await ctx.db.system.get(input.storageId);
  if (!metadata) {
    throw new ConvexError({ code: "NOT_FOUND", message: "No se encontro el archivo cargado" });
  }
  if (!metadata.contentType) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "El archivo cargado no declara un tipo de contenido" });
  }
  const contentType = metadata.contentType.toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "La imagen debe ser JPEG, PNG o WebP" });
  }
  if (metadata.size <= 0 || metadata.size > 2 * 1024 * 1024) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "La imagen no puede superar 2 MB" });
  }
  const existingSlot = await ctx.db
    .query("masterAttachments")
    .withIndex("by_organization_resource_slot_and_created_at", (q) =>
      q
        .eq("organizationId", actor.organizationId)
        .eq("resourceType", resourceType)
        .eq("resourceId", resourceId)
        .eq("slot", slot)
    )
    .order("desc")
    .first();
  if (existingSlot) {
    if (existingSlot.sha256 === metadata.sha256) {
      await ctx.storage.delete(input.storageId);
      return { id: existingSlot._id, created: false };
    }
    throw new ConvexError({ code: "CONFLICT", message: "El recurso ya tiene una imagen diferente en esa posicion" });
  }
  const id = await ctx.db.insert("masterAttachments", {
    organizationId: actor.organizationId,
    resourceType,
    resourceId,
    slot,
    storageId: input.storageId,
    fileName,
    contentType,
    size: metadata.size,
    sha256: metadata.sha256,
    createdBy: actor._id,
    createdAt: now
  });
  return { id, created: true };
}

async function resolveVehicleCatalogFields(ctx: MutationCtx, input: VehicleMasterInput) {
  const makeCode = trimmedOptional(input.rndcMakeCode);
  const lineCode = trimmedOptional(input.line);
  const bodyTypeCode = trimmedOptional(input.rndcBodyTypeCode);
  const insurerNit = trimmedOptional(input.insurerNit);
  const liabilityInsurerNit = trimmedOptional(input.liabilityInsurerNit);
  const [line, bodyType, insurer, liabilityInsurer] = await Promise.all([
    makeCode && lineCode
      ? ctx.db.query("rndcVehicleLines").withIndex("by_make_and_line", (q) => q.eq("makeCode", makeCode).eq("lineCode", lineCode)).unique()
      : null,
    bodyTypeCode
      ? ctx.db.query("rndcBodyTypes").withIndex("by_code", (q) => q.eq("code", bodyTypeCode)).unique()
      : null,
    insurerNit
      ? ctx.db.query("rndcInsurers").withIndex("by_nit", (q) => q.eq("insurerNit", insurerNit)).unique()
      : null,
    liabilityInsurerNit
      ? ctx.db.query("rndcInsurers").withIndex("by_nit", (q) => q.eq("insurerNit", liabilityInsurerNit)).unique()
      : null
  ]);
  if (makeCode && lineCode && !line) {
    throw new ConvexError({ code: "NOT_FOUND", message: "La marca y linea seleccionadas no existen en el catalogo RNDC" });
  }
  if (bodyTypeCode && !bodyType) {
    throw new ConvexError({ code: "NOT_FOUND", message: "La carroceria seleccionada no existe en el catalogo RNDC" });
  }
  if (insurerNit && !insurer) {
    throw new ConvexError({ code: "NOT_FOUND", message: "La aseguradora SOAT no existe en el catalogo RNDC" });
  }
  if (liabilityInsurerNit && !liabilityInsurer) {
    throw new ConvexError({ code: "NOT_FOUND", message: "La aseguradora de responsabilidad civil no existe en el catalogo RNDC" });
  }
  return compactRecord({
    make: line?.makeName ?? trimmedOptional(input.make),
    line: line?.lineCode ?? lineCode,
    lineName: line?.lineName ?? trimmedOptional(input.lineName),
    rndcMakeCode: line?.makeCode ?? makeCode,
    bodyType: bodyType?.description ?? trimmedOptional(input.bodyType),
    rndcBodyTypeCode: bodyType?.code ?? bodyTypeCode,
    insurerNit,
    insurerName: insurer?.name ?? trimmedOptional(input.insurerName),
    liabilityInsurerNit,
    liabilityInsurerName: liabilityInsurer?.name ?? trimmedOptional(input.liabilityInsurerName)
  });
}

export const organizationBySlug = query({
  args: { ingestKey: v.string(), slug: v.string() },
  returns: v.union(v.id("organizations"), v.null()),
  handler: async (ctx, args) => {
    if (args.ingestKey !== process.env.RNDC_INGEST_KEY) {
      throw new ConvexError({ code: "UNAUTHORIZED", message: "Invalid ingest key" });
    }
    const organization = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug.trim().toLowerCase()))
      .unique();
    return organization?._id ?? null;
  }
});

const thirdPartyBatchInputValidator = v.object({
  documentType: v.string(),
  document: v.string(),
  name: v.string(),
  phone: v.optional(v.string()),
  cellphone: v.optional(v.string()),
  address: v.optional(v.string()),
  city: v.optional(v.string()),
  cityCode: v.optional(v.string()),
  email: v.optional(v.string()),
  roles: v.array(thirdPartyRoleValidator),
  siteCount: v.number(),
  rndcRegisteredAt: v.optional(v.string()),
  source: v.string()
});

const thirdPartySiteInputValidator = v.object({
  document: v.string(),
  siteCode: v.string(),
  siteName: v.string(),
  address: v.optional(v.string()),
  city: v.optional(v.string()),
  cityCode: v.optional(v.string()),
  latitude: v.optional(v.string()),
  longitude: v.optional(v.string()),
  rndcRegisteredAt: v.optional(v.string())
});

export const upsertThirdPartyBatch = mutation({
  args: {
    ingestKey: v.string(),
    organizationId: v.id("organizations"),
    parties: v.array(thirdPartyBatchInputValidator),
    sites: v.array(thirdPartySiteInputValidator)
  },
  returns: v.object({
    partiesInserted: v.number(),
    partiesUpdated: v.number(),
    sitesInserted: v.number(),
    sitesUpdated: v.number(),
    sitesSkipped: v.array(v.object({ document: v.string(), siteCode: v.string(), reason: v.string() }))
  }),
  handler: async (ctx, args) => {
    if (args.ingestKey !== process.env.RNDC_INGEST_KEY) {
      throw new ConvexError({ code: "UNAUTHORIZED", message: "Invalid ingest key" });
    }
    const now = Date.now();
    const result = { partiesInserted: 0, partiesUpdated: 0, sitesInserted: 0, sitesUpdated: 0, sitesSkipped: [] as { document: string; siteCode: string; reason: string }[] };

    for (const party of args.parties) {
      const existing = await ctx.db
        .query("thirdParties")
        .withIndex("by_organization_and_document", (q) => q.eq("organizationId", args.organizationId).eq("document", party.document))
        .unique();
      if (existing) {
        const roles = [...new Set([...existing.roles, ...party.roles])];
        const patch: Record<string, unknown> = { roles, updatedAt: now };
        for (const [key, value] of Object.entries(party)) {
          if (key !== "roles" && value !== undefined) {
            patch[key] = value;
          }
        }
        await ctx.db.patch(existing._id, patch);
        result.partiesUpdated += 1;
      } else {
        await ctx.db.insert("thirdParties", { ...party, organizationId: args.organizationId, createdAt: now, updatedAt: now });
        result.partiesInserted += 1;
      }
    }

    for (const site of args.sites) {
      const party = await ctx.db
        .query("thirdParties")
        .withIndex("by_organization_and_document", (q) => q.eq("organizationId", args.organizationId).eq("document", site.document))
        .unique();
      if (!party) {
        result.sitesSkipped.push({ document: site.document, siteCode: site.siteCode, reason: "third_party_not_found" });
        continue;
      }
      const existing = await ctx.db
        .query("thirdPartySites")
        .withIndex("by_organization_and_document_and_site", (q) => q.eq("organizationId", args.organizationId).eq("document", site.document).eq("siteCode", site.siteCode))
        .unique();
      if (existing) {
        const patch: Record<string, unknown> = { thirdPartyId: party._id, updatedAt: now };
        for (const [key, value] of Object.entries(site)) {
          if (value !== undefined) {
            patch[key] = value;
          }
        }
        await ctx.db.patch(existing._id, patch);
        result.sitesUpdated += 1;
      } else {
        await ctx.db.insert("thirdPartySites", { ...site, organizationId: args.organizationId, thirdPartyId: party._id, createdAt: now, updatedAt: now });
        result.sitesInserted += 1;
      }
    }

    return result;
  }
});

export const ingestSnapshot = query({
  args: {
    ingestKey: v.string(),
    organizationId: v.id("organizations"),
    table: v.union(v.literal("drivers"), v.literal("thirdParties"), v.literal("thirdPartySites")),
    document: v.optional(v.string())
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.ingestKey !== process.env.RNDC_INGEST_KEY) {
      throw new ConvexError({ code: "UNAUTHORIZED", message: "Invalid ingest key" });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (args.table === "drivers") {
      const drivers = await ctx.db.query("drivers").collect();
      const driver = args.document ? drivers.find((item) => item.document === args.document) : undefined;
      return {
        total: drivers.length,
        inOrganization: drivers.filter((item) => item.organizationId === args.organizationId).length,
        withValidLicense: drivers.filter((item) => (item.licenseExpiresAt ?? "") >= today).length,
        sample: driver ? { name: driver.name, licenseCategory: driver.licenseCategory, licenseExpiresAt: driver.licenseExpiresAt, city: driver.city, phone1: driver.phone1 } : null
      };
    }
    if (args.table === "thirdParties") {
      const parties = await ctx.db.query("thirdParties").withIndex("by_organization_and_name", (q) => q.eq("organizationId", args.organizationId)).collect();
      const roles: Record<string, number> = {};
      for (const party of parties) {
        for (const role of party.roles) {
          roles[role] = (roles[role] ?? 0) + 1;
        }
      }
      const party = args.document ? parties.find((item) => item.document === args.document) : undefined;
      return { total: parties.length, roles, sample: party ? { name: party.name, roles: party.roles, siteCount: party.siteCount, city: party.city } : null };
    }
    const sites = await ctx.db.query("thirdPartySites").collect();
    const matching = args.document ? sites.filter((item) => item.document === args.document).map((item) => `${item.siteCode}:${item.siteName}`) : [];
    return { total: sites.length, withCoordinates: sites.filter((item) => item.latitude).length, sample: matching };
  }
});

const controlPointInputValidator = v.object({
  code: v.string(),
  name: v.string(),
  controlType: v.string(),
  rndcControlType: v.string(),
  status: v.string(),
  controllerDocument: v.optional(v.string()),
  controllerName: v.optional(v.string()),
  controllerCode: v.optional(v.string()),
  phone: v.optional(v.string()),
  address: v.optional(v.string()),
  originCityCode: v.optional(v.string()),
  originCity: v.optional(v.string()),
  destinationCityCode: v.optional(v.string()),
  destinationCity: v.optional(v.string()),
  latitude: v.optional(v.string()),
  longitude: v.optional(v.string()),
  calibrationCompany: v.optional(v.string()),
  calibrationReport: v.optional(v.string()),
  calibratedAt: v.optional(v.string()),
  calibrationExpiresAt: v.optional(v.string()),
  calibrationValid: v.optional(v.boolean()),
  rndcRegisteredAt: v.optional(v.string()),
  source: v.string()
});

export const upsertControlPointBatch = mutation({
  args: { ingestKey: v.string(), organizationId: v.id("organizations"), controlPoints: v.array(controlPointInputValidator) },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async (ctx, args) => {
    if (args.ingestKey !== process.env.RNDC_INGEST_KEY) {
      throw new ConvexError({ code: "UNAUTHORIZED", message: "Invalid ingest key" });
    }
    const now = Date.now();
    const result = { inserted: 0, updated: 0 };
    for (const point of args.controlPoints) {
      const existing = await ctx.db
        .query("controlPoints")
        .withIndex("by_organization_and_code", (q) => q.eq("organizationId", args.organizationId).eq("code", point.code))
        .unique();
      if (existing) {
        const patch: Record<string, unknown> = { updatedAt: now };
        for (const [key, value] of Object.entries(point)) {
          if (value !== undefined) {
            patch[key] = value;
          }
        }
        await ctx.db.patch(existing._id, patch);
        result.updated += 1;
      } else {
        await ctx.db.insert("controlPoints", { ...point, organizationId: args.organizationId, createdAt: now, updatedAt: now });
        result.inserted += 1;
      }
    }
    return result;
  }
});

export const controlPointsSnapshot = query({
  args: { ingestKey: v.string(), organizationId: v.id("organizations"), code: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.ingestKey !== process.env.RNDC_INGEST_KEY) {
      throw new ConvexError({ code: "UNAUTHORIZED", message: "Invalid ingest key" });
    }
    const points = await ctx.db.query("controlPoints").withIndex("by_organization_and_code", (q) => q.eq("organizationId", args.organizationId)).collect();
    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const point of points) {
      byType[point.controlType] = (byType[point.controlType] ?? 0) + 1;
      byStatus[point.status] = (byStatus[point.status] ?? 0) + 1;
    }
    const sample = args.code ? points.find((point) => point.code === args.code) : undefined;
    return { total: points.length, byType, byStatus, calibrationValid: points.filter((point) => point.calibrationValid).length, sample: sample ?? null };
  }
});

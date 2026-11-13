import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  organizationStatus,
  rndcReferenceCatalogKind,
  rndcReferenceImportStatus,
  rndcReferenceFailureCode,
  rndcReferenceFailureMessage,
  rndcReferenceFileSummary,
  rndcReferenceTotals,
  masterWorkReference,
  masterSyncValidator
} from "./schemaValidators";

export const masterTables = {
  drivers: defineTable({
    organizationId: v.optional(v.id("organizations")),
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
    workReferences: v.optional(v.array(masterWorkReference)),
    observations: v.optional(v.string()),
    rndcSync: v.optional(masterSyncValidator),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_document", ["document"])
    .index("by_organization_and_document", ["organizationId", "document"])
    .searchIndex("search_name", { searchField: "name", filterFields: ["organizationId"] }),
  thirdParties: defineTable({
    organizationId: v.id("organizations"),
    personType: v.optional(v.union(v.literal("natural"), v.literal("legal"))),
    documentType: v.string(),
    document: v.string(),
    name: v.string(),
    firstNames: v.optional(v.string()),
    firstLastName: v.optional(v.string()),
    secondLastName: v.optional(v.string()),
    legalName: v.optional(v.string()),
    verificationDigit: v.optional(v.string()),
    abbreviation: v.optional(v.string()),
    phone: v.optional(v.string()),
    phone2: v.optional(v.string()),
    address: v.optional(v.string()),
    cityCode: v.optional(v.string()),
    cellphone: v.optional(v.string()),
    city: v.optional(v.string()),
    fax: v.optional(v.string()),
    website: v.optional(v.string()),
    email: v.optional(v.string()),
    taxRegime: v.optional(v.string()),
    observations: v.optional(v.string()),
    siteCount: v.optional(v.number()),
    rndcRegisteredAt: v.optional(v.string()),
    source: v.optional(v.string()),
    rndcSync: v.optional(masterSyncValidator),
    roles: v.array(v.union(
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
    )),
    createdBy: v.optional(v.id("users")),
    updatedBy: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_organization_and_document", ["organizationId", "document"])
    .index("by_organization_and_name", ["organizationId", "name"])
    .searchIndex("search_name", { searchField: "name", filterFields: ["organizationId"] }),
  controlPoints: defineTable({
    organizationId: v.id("organizations"),
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
    source: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_organization_and_code", ["organizationId", "code"])
    .index("by_organization_and_origin_city", ["organizationId", "originCityCode"]),
  thirdPartySites: defineTable({
    organizationId: v.id("organizations"),
    thirdPartyId: v.id("thirdParties"),
    document: v.string(),
    siteCode: v.string(),
    siteName: v.string(),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    cityCode: v.optional(v.string()),
    latitude: v.optional(v.string()),
    longitude: v.optional(v.string()),
    rndcRegisteredAt: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_organization_and_document_and_site", ["organizationId", "document", "siteCode"])
    .index("by_third_party", ["thirdPartyId"]),
  vehicles: defineTable({
    organizationId: v.optional(v.id("organizations")),
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
    ownershipSyncedAt: v.optional(v.number()),
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
    workReferences: v.optional(v.array(masterWorkReference)),
    rndcSync: v.optional(masterSyncValidator),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_plate", ["plate"])
    .index("by_organization_and_plate", ["organizationId", "plate"])
    .index("by_organization_and_status", ["organizationId", "status"]),
  rndcReferenceImportRuns: defineTable({
    clientRunId: v.string(),
    status: rndcReferenceImportStatus,
    files: v.object({
      vehicleLines: rndcReferenceFileSummary,
      insurers: rndcReferenceFileSummary,
      packages: rndcReferenceFileSummary,
      bodyTypes: rndcReferenceFileSummary
    }),
    totals: rndcReferenceTotals,
    certification: v.optional(v.object({
      totals: rndcReferenceTotals,
      certifiedAt: v.number()
    })),
    failureCode: v.optional(rndcReferenceFailureCode),
    failureMessage: v.optional(rndcReferenceFailureMessage),
    startedAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number())
  }).index("by_client_run_id", ["clientRunId"]),
  rndcVehicleLines: defineTable({
    makeCode: v.string(),
    makeName: v.optional(v.string()),
    lineCode: v.string(),
    lineName: v.optional(v.string()),
    grossWeightKg: v.number(),
    sourceRegisteredAt: v.string(),
    contentHash: v.string(),
    sourceImportRunId: v.id("rndcReferenceImportRuns"),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_make_and_line", ["makeCode", "lineCode"])
    .index("by_line_and_make", ["lineCode", "makeCode"])
    .index("by_source_import_run", ["sourceImportRunId"])
    .searchIndex("search_make", { searchField: "makeName" })
    .searchIndex("search_line", { searchField: "lineName" }),
  rndcInsurers: defineTable({
    insurerNit: v.string(),
    name: v.string(),
    insurerType: v.optional(v.string()),
    sourceRegisteredAt: v.string(),
    contentHash: v.string(),
    sourceImportRunId: v.id("rndcReferenceImportRuns"),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_nit", ["insurerNit"])
    .index("by_source_import_run", ["sourceImportRunId"])
    .searchIndex("search_name", { searchField: "name" }),
  rndcPackaging: defineTable({
    code: v.string(),
    description: v.string(),
    fullDescription: v.string(),
    definition: v.string(),
    minimumEmptyWeightKg: v.number(),
    maximumEmptyWeightKg: v.number(),
    hazardous: v.optional(v.boolean()),
    packageTypeCode: v.optional(v.string()),
    packageTypeName: v.optional(v.string()),
    materialCode: v.optional(v.string()),
    materialName: v.optional(v.string()),
    operationType: v.string(),
    sourceRegisteredAt: v.string(),
    contentHash: v.string(),
    sourceImportRunId: v.id("rndcReferenceImportRuns"),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_code", ["code"])
    .index("by_source_import_run", ["sourceImportRunId"])
    .searchIndex("search_description", { searchField: "fullDescription" }),
  rndcBodyTypes: defineTable({
    code: v.string(),
    description: v.string(),
    sourceRegisteredAt: v.string(),
    contentHash: v.string(),
    sourceImportRunId: v.id("rndcReferenceImportRuns"),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_code", ["code"])
    .index("by_source_import_run", ["sourceImportRunId"])
    .searchIndex("search_description", { searchField: "description" }),
  rndcDivisions: defineTable({
    code: v.string(),
    name: v.string(),
    zoneCode: v.string(),
    isMunicipality: v.boolean(),
    onRoad: v.boolean(),
    municipalityCode: v.string(),
    municipalityName: v.string(),
    departmentCode: v.string(),
    departmentName: v.string(),
    latitude: v.optional(v.string()),
    longitude: v.optional(v.string()),
    searchText: v.string(),
    rndcRegisteredAt: v.optional(v.string()),
    source: v.string(),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_code", ["code"])
    .index("by_municipality", ["municipalityCode", "isMunicipality"])
    .index("by_is_municipality", ["isMunicipality"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["isMunicipality"] }),
  rndcReferenceImportBatches: defineTable({
    importRunId: v.id("rndcReferenceImportRuns"),
    catalog: rndcReferenceCatalogKind,
    batchIndex: v.number(),
    batchHash: v.string(),
    rowCount: v.number(),
    inserted: v.number(),
    updated: v.number(),
    unchanged: v.number(),
    outdated: v.number(),
    createdAt: v.number()
  }).index("by_run_catalog_and_batch", ["importRunId", "catalog", "batchIndex"]),
  rndcReferenceImportKeys: defineTable({
    importRunId: v.id("rndcReferenceImportRuns"),
    catalog: rndcReferenceCatalogKind,
    naturalKey: v.string(),
    batchIndex: v.number(),
    contentHash: v.string(),
    createdAt: v.number()
  })
    .index("by_run_catalog_and_key", ["importRunId", "catalog", "naturalKey"])
    .index("by_run_catalog_and_batch", ["importRunId", "catalog", "batchIndex"]),
  driverVehicles: defineTable({
    organizationId: v.optional(v.id("organizations")),
    driverId: v.id("drivers"),
    vehicleId: v.id("vehicles"),
    driverDocument: v.string(),
    vehiclePlate: v.string(),
    matchConfidence: v.optional(v.string()),
    matchBasis: v.optional(v.string()),
    roles: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_document_and_plate", ["driverDocument", "vehiclePlate"])
    .index("by_driver", ["driverId"])
    .index("by_vehicle", ["vehicleId"])
    .index("by_organization_document_and_plate", ["organizationId", "driverDocument", "vehiclePlate"])
    .index("by_organization_and_driver", ["organizationId", "driverId"])
    .index("by_organization_and_vehicle", ["organizationId", "vehicleId"]),
  masterAttachments: defineTable({
    organizationId: v.id("organizations"),
    resourceType: v.union(
      v.literal("driver"),
      v.literal("third_party"),
      v.literal("trailer"),
      v.literal("vehicle")
    ),
    resourceId: v.string(),
    slot: v.union(
      v.literal("profile"),
      v.literal("front"),
      v.literal("left"),
      v.literal("right"),
      v.literal("rear")
    ),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    sha256: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number()
  })
    .index("by_storage_id", ["storageId"])
    .index("by_organization_resource_slot_and_created_at", ["organizationId", "resourceType", "resourceId", "slot", "createdAt"]),
  customers: defineTable({
    organizationId: v.id("organizations"),
    code: v.string(),
    name: v.string(),
    identificationType: v.optional(v.string()),
    identificationNumber: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    status: organizationStatus,
    source: v.optional(v.string()),
    sourceContentHash: v.optional(v.string()),
    sourceCapturedAt: v.optional(v.string()),
    sourceImportRunId: v.optional(v.id("avansatCustomerImportRuns")),
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_organization_and_code", ["organizationId", "code"])
    .index("by_organization_and_identification", ["organizationId", "identificationNumber"])
    .index("by_organization_and_status", ["organizationId", "status"])
    .searchIndex("search_customer_name", { searchField: "name", filterFields: ["organizationId"] }),
  customerLocations: defineTable({
    organizationId: v.id("organizations"),
    customerId: v.id("customers"),
    code: v.string(),
    name: v.string(),
    kind: v.union(v.literal("loading"), v.literal("unloading"), v.literal("both")),
    address: v.string(),
    city: v.string(),
    municipalityCode: v.optional(v.string()),
    contactName: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    status: organizationStatus,
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_customer_and_code", ["customerId", "code"])
    .index("by_organization_and_customer", ["organizationId", "customerId"]),
  avansatCustomerImportRuns: defineTable({
    organizationId: v.id("organizations"),
    clientRunId: v.string(),
    manifestHash: v.string(),
    capturedAt: v.string(),
    expectedTotal: v.number(),
    batchCount: v.number(),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    totals: v.object({
      batchesApplied: v.number(),
      customersInserted: v.number(),
      customersUpdated: v.number(),
      customersUnchanged: v.number(),
      locationsInserted: v.number(),
      locationsUpdated: v.number(),
      locationsUnchanged: v.number(),
      snapshotsInserted: v.number()
    }),
    certifiedAt: v.optional(v.number()),
    startedAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number())
  })
    .index("by_client_run_id", ["clientRunId"])
    .index("by_organization_and_status", ["organizationId", "status"]),
  avansatCustomerImportBatches: defineTable({
    importRunId: v.id("avansatCustomerImportRuns"),
    batchIndex: v.number(),
    batchHash: v.string(),
    rowCount: v.number(),
    customersInserted: v.number(),
    customersUpdated: v.number(),
    customersUnchanged: v.number(),
    locationsInserted: v.number(),
    locationsUpdated: v.number(),
    locationsUnchanged: v.number(),
    snapshotsInserted: v.number(),
    createdAt: v.number()
  }).index("by_run_and_batch", ["importRunId", "batchIndex"]),
  avansatCustomerImportKeys: defineTable({
    importRunId: v.id("avansatCustomerImportRuns"),
    document: v.string(),
    batchIndex: v.number(),
    contentHash: v.string(),
    createdAt: v.number()
  }).index("by_run_and_document", ["importRunId", "document"]),
  avansatCustomerSnapshots: defineTable({
    organizationId: v.id("organizations"),
    customerId: v.id("customers"),
    importRunId: v.id("avansatCustomerImportRuns"),
    document: v.string(),
    contentHash: v.string(),
    capturedAt: v.string(),
    sourceJson: v.string(),
    createdAt: v.number()
  })
    .index("by_customer", ["customerId"])
    .index("by_organization_and_document", ["organizationId", "document"])
    .index("by_import_run", ["importRunId"]),
  trailers: defineTable({
    organizationId: v.id("organizations"),
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
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_organization_and_plate", ["organizationId", "plate"])
    .index("by_organization_and_status", ["organizationId", "status"])
    .index("by_organization_and_linked_vehicle", ["organizationId", "linkedVehicleId"]),
  merchandiseProducts: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    searchText: v.string(),
    code: v.string(),
    natureCode: v.optional(v.string()),
    packagingCode: v.optional(v.string()),
    uses: v.number(),
    source: v.union(v.literal("rndc"), v.literal("tms")),
    updatedAt: v.number()
  }).index("by_organization_and_search", ["organizationId", "searchText"])
};

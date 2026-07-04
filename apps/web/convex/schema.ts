import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const documentStatus = v.union(
  v.literal("draft"),
  v.literal("pending"),
  v.literal("sent"),
  v.literal("authorized"),
  v.literal("rejected"),
  v.literal("fulfilled"),
  v.literal("annulled")
);

const documentKind = v.union(
  v.literal("orden_cargue"),
  v.literal("remesa"),
  v.literal("manifiesto"),
  v.literal("cumplido"),
  v.literal("anulacion")
);

const rndcMode = v.union(v.literal("dry-run"), v.literal("live"));

export default defineSchema({
  trips: defineTable({
    code: v.string(),
    status: v.string(),
    originCity: v.optional(v.string()),
    destinationCity: v.optional(v.string()),
    vehiclePlate: v.optional(v.string()),
    driverName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_status", ["status"])
    .index("by_code", ["code"]),

  documents: defineTable({
    tripId: v.id("trips"),
    kind: documentKind,
    status: documentStatus,
    number: v.optional(v.string()),
    rndcRadicado: v.optional(v.string()),
    mode: v.optional(rndcMode),
    pdfUrlPath: v.optional(v.string()),
    errorText: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_trip", ["tripId"])
    .index("by_status", ["status"])
    .index("by_kind", ["kind"])
    .index("by_kind_and_status", ["kind", "status"])
    .index("by_kind_and_number", ["kind", "number"]),

  rndcAttempts: defineTable({
    documentId: v.optional(v.id("documents")),
    tripId: v.optional(v.id("trips")),
    operation: v.string(),
    action: v.string(),
    title: v.optional(v.string()),
    procesoId: v.optional(v.number()),
    status: v.string(),
    mode: v.optional(rndcMode),
    radicado: v.optional(v.string()),
    requestXmlStorageId: v.optional(v.id("_storage")),
    responseXmlStorageId: v.optional(v.id("_storage")),
    requestPath: v.optional(v.string()),
    responsePath: v.optional(v.string()),
    errorText: v.optional(v.string()),
    createdAt: v.number(),
    finishedAt: v.optional(v.number())
  })
    .index("by_document", ["documentId"])
    .index("by_trip", ["tripId"])
    .index("by_status", ["status"]),

  drivers: defineTable({
    document: v.string(),
    documentType: v.optional(v.string()),
    name: v.optional(v.string()),
    status: v.optional(v.string()),
    birthDate: v.optional(v.string()),
    sex: v.optional(v.string()),
    bloodType: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    phone1: v.optional(v.string()),
    phone2: v.optional(v.string()),
    cellphone: v.optional(v.string()),
    licenseNumber: v.optional(v.string()),
    licenseCategory: v.optional(v.string()),
    licenseExpiresAt: v.optional(v.string()),
    eps: v.optional(v.string()),
    arp: v.optional(v.string()),
    pensionFund: v.optional(v.string()),
    hazmatCourse: v.optional(v.string()),
    hazmatCourseExpiresAt: v.optional(v.string()),
    observations: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index("by_document", ["document"]),

  vehicles: defineTable({
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
    createdAt: v.number(),
    updatedAt: v.number()
  }).index("by_plate", ["plate"]),

  driverVehicles: defineTable({
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
    .index("by_vehicle", ["vehicleId"]),

  notifications: defineTable({
    title: v.string(),
    body: v.string(),
    status: v.union(v.literal("unread"), v.literal("read")),
    relatedTripId: v.optional(v.id("trips")),
    relatedDocumentId: v.optional(v.id("documents")),
    createdAt: v.number()
  })
    .index("by_status", ["status"])
    .index("by_created_at", ["createdAt"]),

  counters: defineTable({
    documentType: v.string(),
    lastValue: v.number(),
    updatedAt: v.number()
  }).index("by_document_type", ["documentType"])
});

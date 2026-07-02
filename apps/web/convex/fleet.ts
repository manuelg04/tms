import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";

const driverInputValidator = v.object({
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
  possessorPhone: v.optional(v.string())
});

const relationInputValidator = v.object({
  driverDocument: v.string(),
  vehiclePlate: v.string(),
  matchConfidence: v.optional(v.string()),
  matchBasis: v.optional(v.string()),
  roles: v.optional(v.array(v.string()))
});

export const upsertFleetBatch = mutation({
  args: {
    ingestKey: v.string(),
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
      const existing = await ctx.db
        .query("drivers")
        .withIndex("by_document", (q) => q.eq("document", driver.document))
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
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
        await ctx.db.insert("drivers", { ...driver, createdAt: now, updatedAt: now });
        result.driversInserted += 1;
      }
    }

    for (const vehicle of args.vehicles) {
      const existing = await ctx.db
        .query("vehicles")
        .withIndex("by_plate", (q) => q.eq("plate", vehicle.plate))
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          make: vehicle.make ?? existing.make,
          line: vehicle.line ?? existing.line,
          modelYear: vehicle.modelYear ?? existing.modelYear,
          color: vehicle.color ?? existing.color,
          bodyType: vehicle.bodyType ?? existing.bodyType,
          configuration: vehicle.configuration ?? existing.configuration,
          trailer: vehicle.trailer ?? existing.trailer,
          linkType: vehicle.linkType ?? existing.linkType,
          capacityTn: vehicle.capacityTn ?? existing.capacityTn,
          emptyWeightTn: vehicle.emptyWeightTn ?? existing.emptyWeightTn,
          ownerDocument: vehicle.ownerDocument ?? existing.ownerDocument,
          ownerName: vehicle.ownerName ?? existing.ownerName,
          ownerCellphone: vehicle.ownerCellphone ?? existing.ownerCellphone,
          ownerPhone: vehicle.ownerPhone ?? existing.ownerPhone,
          possessorDocument: vehicle.possessorDocument ?? existing.possessorDocument,
          possessorName: vehicle.possessorName ?? existing.possessorName,
          possessorCellphone: vehicle.possessorCellphone ?? existing.possessorCellphone,
          possessorPhone: vehicle.possessorPhone ?? existing.possessorPhone,
          updatedAt: now
        });
        result.vehiclesUpdated += 1;
      } else {
        await ctx.db.insert("vehicles", { ...vehicle, createdAt: now, updatedAt: now });
        result.vehiclesInserted += 1;
      }
    }

    for (const relation of args.relations) {
      const driver = await ctx.db
        .query("drivers")
        .withIndex("by_document", (q) => q.eq("document", relation.driverDocument))
        .first();
      const vehicle = await ctx.db
        .query("vehicles")
        .withIndex("by_plate", (q) => q.eq("plate", relation.vehiclePlate))
        .first();

      if (!driver || !vehicle) {
        result.relationsSkipped.push({
          driverDocument: relation.driverDocument,
          vehiclePlate: relation.vehiclePlate,
          reason: !driver ? "driver_not_found" : "vehicle_not_found"
        });
        continue;
      }

      const existing = await ctx.db
        .query("driverVehicles")
        .withIndex("by_document_and_plate", (q) =>
          q.eq("driverDocument", relation.driverDocument).eq("vehiclePlate", relation.vehiclePlate)
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
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

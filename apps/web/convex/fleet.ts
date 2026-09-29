import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { appendAudit, requireActor } from "./model/access";
import { masterSyncSummary } from "./model/masterSync";

import {
  masterSyncKindValidator,
  masterSyncStateValidator,
  thirdPartyRoleValidator,
  relationInputValidator,
  driverRowValidator,
  vehicleRowValidator,
  trailerRowValidator,
  trailerDetailValidator,
  driverDetailValidator,
  vehicleDetailValidator,
  pageResultFields,
  thirdPartyRowValidator,
  driverInputValidator,
  vehicleInputValidator
} from "./model/fleetValidators";
import {
  normalizeMasterKey,
  loadMasterSyncBundle,
  prefixRange,
  toDriverRow,
  driverSyncSummary,
  toVehicleRow,
  toTrailerRow,
  readMasterAttachments,
  assignPrimaryDriver,
  matchingDriverVehicleRelations
} from "./model/fleetRecords";

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

export const masterSyncBundle = query({
  args: { kind: masterSyncKindValidator, key: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, ["admin", "operator"]);
    try {
      return await loadMasterSyncBundle(ctx, actor.organizationId, args.kind, args.key);
    } catch (error) {
      if (error instanceof ConvexError) throw error;
      throw new ConvexError({ code: "INCOMPLETE_MASTER", message: error instanceof Error ? error.message : "Maestro incompleto para el RNDC" });
    }
  }
});

export const recordMasterSync = mutation({
  args: {
    kind: masterSyncKindValidator,
    key: v.string(),
    state: masterSyncStateValidator,
    version: v.number(),
    error: v.optional(v.string()),
    operationId: v.optional(v.string())
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, ["admin", "operator"]);
    const now = Date.now();
    const key = normalizeMasterKey(args.kind, args.key);
    const record = { state: args.state, updatedAt: now, version: args.version, error: args.state === "rejected" ? args.error : undefined, operationId: args.operationId };
    const partyByDocument = (document: string) =>
      ctx.db.query("thirdParties").withIndex("by_organization_and_document", (q) => q.eq("organizationId", actor.organizationId).eq("document", document)).unique();
    if (args.kind === "driver") {
      const driver = await ctx.db.query("drivers").withIndex("by_organization_and_document", (q) => q.eq("organizationId", actor.organizationId).eq("document", key)).unique();
      if (!driver) throw new ConvexError({ code: "NOT_FOUND", message: "El conductor no existe en maestros" });
      await ctx.db.patch(driver._id, { rndcSync: record });
      const mirror = await partyByDocument(key);
      if (mirror) await ctx.db.patch(mirror._id, { rndcSync: record });
      await appendAudit(ctx, { organizationId: actor.organizationId, actorType: "user", actorId: actor._id, action: `driver.rndc_${args.state}`, entityType: "driver", entityId: driver._id, createdAt: now });
      return null;
    }
    if (args.kind === "vehicle") {
      const vehicle = await ctx.db.query("vehicles").withIndex("by_organization_and_plate", (q) => q.eq("organizationId", actor.organizationId).eq("plate", key)).unique();
      if (!vehicle) throw new ConvexError({ code: "NOT_FOUND", message: "El vehículo no existe en maestros" });
      await ctx.db.patch(vehicle._id, { rndcSync: record });
      if (args.state === "registered") {
        for (const document of new Set([vehicle.ownerDocument, vehicle.possessorDocument].filter((value): value is string => Boolean(value)))) {
          const party = await partyByDocument(document);
          if (party && masterSyncSummary(party).state !== "registered") await ctx.db.patch(party._id, { rndcSync: record });
        }
      }
      await appendAudit(ctx, { organizationId: actor.organizationId, actorType: "user", actorId: actor._id, action: `vehicle.rndc_${args.state}`, entityType: "vehicle", entityId: vehicle._id, createdAt: now });
      return null;
    }
    const party = await partyByDocument(key);
    if (!party) throw new ConvexError({ code: "NOT_FOUND", message: "El tercero no existe en maestros" });
    await ctx.db.patch(party._id, { rndcSync: record });
    const driver = await ctx.db.query("drivers").withIndex("by_organization_and_document", (q) => q.eq("organizationId", actor.organizationId).eq("document", key)).unique();
    if (driver && !driver.rndcSync && args.state === "registered") await ctx.db.patch(driver._id, { rndcSync: record });
    await appendAudit(ctx, { organizationId: actor.organizationId, actorType: "user", actorId: actor._id, action: `third_party.rndc_${args.state}`, entityType: "third_party", entityId: party._id, createdAt: now });
    return null;
  }
});

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
        rndcSyncSummary: masterSyncSummary(party),
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
    return { ...safeDriver, attachments, vehicles, rndcSyncSummary: await driverSyncSummary(ctx, driver) };
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
    return { ...safeVehicle, attachments, drivers, rndcSyncSummary: masterSyncSummary(vehicle) };
  }
});

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

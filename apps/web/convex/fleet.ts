import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { appendAudit, requireActor } from "./model/access";
import { normalizeDriverInput, normalizeThirdPartyInput, normalizeVehicleInput, type ThirdPartyInput } from "./model/masterData";

const thirdPartyRoleValidator = v.union(
  v.literal("driver"),
  v.literal("owner"),
  v.literal("possessor"),
  v.literal("holder"),
  v.literal("sender"),
  v.literal("recipient"),
  v.literal("other")
);

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

const driverDetailValidator = v.object({
  _id: v.id("drivers"),
  _creationTime: v.number(),
  document: v.string(),
  documentType: v.optional(v.string()),
  name: v.optional(v.string()),
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
  updatedAt: v.number(),
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
  sourceCompanyNit: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
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
    const fields = { ...input, roles: input.roles ?? ["other" as const], organizationId: actor.organizationId, updatedBy: actor._id, updatedAt: now };
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
    await upsertPartyRecord(ctx, actor.organizationId, actor._id, { documentType: normalized.documentType, document: normalized.document, name: normalized.name, phone: normalized.phone, address: normalized.address, cityCode: normalized.cityCode, roles: ["other"] }, now);
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
      const relation = await ctx.db.query("driverVehicles").withIndex("by_document_and_plate", (q) => q.eq("driverDocument", driverDocument).eq("vehiclePlate", input.plate)).unique();
      if (relation) await ctx.db.patch(relation._id, { driverId: driver._id, vehicleId, roles: ["primary"], updatedAt: now });
      else await ctx.db.insert("driverVehicles", { driverId: driver._id, vehicleId, driverDocument, vehiclePlate: input.plate, roles: ["primary"], createdAt: now, updatedAt: now });
    }
    await appendAudit(ctx, { organizationId: actor.organizationId, actorType: "user", actorId: actor._id, action: existing ? "vehicle.updated" : "vehicle.created", entityType: "vehicle", entityId: vehicleId, createdAt: now });
    return vehicleId;
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
      const existing = await ctx.db
        .query("drivers")
        .withIndex("by_document", (q) => q.eq("document", driver.document))
        .first();

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
      const existing = await ctx.db
        .query("vehicles")
        .withIndex("by_plate", (q) => q.eq("plate", vehicle.plate))
        .first();

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

export const driversPage = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(driverRowValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null()))
  }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const results = await ctx.db.query("drivers").withIndex("by_organization_and_document", (q) => q.eq("organizationId", actor.organizationId)).order("desc").paginate(args.paginationOpts);
    const page = await Promise.all(results.page.map((driver) => toDriverRow(ctx, driver)));
    return { ...results, page };
  }
});

export const vehiclesPage = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(vehicleRowValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null()))
  }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const results = await ctx.db.query("vehicles").withIndex("by_organization_and_plate", (q) => q.eq("organizationId", actor.organizationId)).order("desc").paginate(args.paginationOpts);
    const page = await Promise.all(results.page.map((vehicle) => toVehicleRow(ctx, vehicle)));
    return { ...results, page };
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

    const { organizationId: _organizationId, ...safeDriver } = driver;
    return { ...safeDriver, vehicles };
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

    const { organizationId: _organizationId, ...safeVehicle } = vehicle;
    return { ...safeVehicle, drivers };
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

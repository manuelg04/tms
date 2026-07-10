import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { appendAudit, requireActor, requireSameOrganization } from "./model/access";

const activeStatusValidator = v.union(v.literal("active"), v.literal("inactive"));

const serviceOrderStatusValidator = v.union(
  v.literal("draft"),
  v.literal("confirmed"),
  v.literal("assigned"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("cancelled")
);

const customerValidator = v.object({
  _id: v.id("customers"),
  _creationTime: v.number(),
  organizationId: v.id("organizations"),
  code: v.string(),
  name: v.string(),
  identificationType: v.optional(v.string()),
  identificationNumber: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  status: activeStatusValidator,
  createdBy: v.id("users"),
  updatedBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number()
});

const locationValidator = v.object({
  _id: v.id("customerLocations"),
  _creationTime: v.number(),
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
  status: activeStatusValidator,
  createdBy: v.id("users"),
  updatedBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number()
});

const serviceOrderValidator = v.object({
  _id: v.id("serviceOrders"),
  _creationTime: v.number(),
  organizationId: v.id("organizations"),
  code: v.string(),
  customerId: v.id("customers"),
  loadingLocationId: v.id("customerLocations"),
  unloadingLocationId: v.id("customerLocations"),
  status: serviceOrderStatusValidator,
  customerReference: v.optional(v.string()),
  cargoDescription: v.string(),
  cargoQuantity: v.optional(v.number()),
  cargoUnit: v.optional(v.string()),
  cargoWeightKg: v.optional(v.number()),
  agreedRate: v.number(),
  currency: v.string(),
  scheduledLoadingAt: v.optional(v.number()),
  scheduledUnloadingAt: v.optional(v.number()),
  notes: v.optional(v.string()),
  createdBy: v.id("users"),
  updatedBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number()
});

const trailerStatusValidator = v.union(
  v.literal("available"),
  v.literal("assigned"),
  v.literal("maintenance"),
  v.literal("inactive")
);

const trailerValidator = v.object({
  _id: v.id("trailers"),
  _creationTime: v.number(),
  organizationId: v.id("organizations"),
  plate: v.string(),
  trailerType: v.optional(v.string()),
  configuration: v.optional(v.string()),
  capacityKg: v.optional(v.number()),
  ownerDocument: v.optional(v.string()),
  status: trailerStatusValidator,
  createdBy: v.id("users"),
  updatedBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number()
});

export const upsertCustomer = mutation({
  args: {
    actorToken: v.optional(v.string()),
    organizationId: v.id("organizations"),
    code: v.string(),
    name: v.string(),
    identificationType: v.optional(v.string()),
    identificationNumber: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    status: activeStatusValidator
  },
  returns: v.id("customers"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    requireSameOrganization(actor, args.organizationId);
    const code = normalizeCode(args.code);
    const now = Date.now();
    const existing = await ctx.db
      .query("customers")
      .withIndex("by_organization_and_code", (q) => q.eq("organizationId", args.organizationId).eq("code", code))
      .unique();
    let customerId;

    if (existing) {
      await ctx.db.patch("customers", existing._id, {
        name: args.name.trim(),
        identificationType: args.identificationType,
        identificationNumber: args.identificationNumber,
        email: args.email?.trim().toLowerCase(),
        phone: args.phone,
        status: args.status,
        updatedBy: actor._id,
        updatedAt: now
      });
      customerId = existing._id;
    } else {
      customerId = await ctx.db.insert("customers", {
        organizationId: args.organizationId,
        code,
        name: args.name.trim(),
        identificationType: args.identificationType,
        identificationNumber: args.identificationNumber,
        email: args.email?.trim().toLowerCase(),
        phone: args.phone,
        status: args.status,
        createdBy: actor._id,
        updatedBy: actor._id,
        createdAt: now,
        updatedAt: now
      });
    }

    await appendAudit(ctx, {
      organizationId: args.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: existing ? "customer.updated" : "customer.created",
      entityType: "customer",
      entityId: customerId,
      createdAt: now
    });
    return customerId;
  }
});

export const upsertCustomerLocation = mutation({
  args: {
    actorToken: v.optional(v.string()),
    customerId: v.id("customers"),
    code: v.string(),
    name: v.string(),
    kind: v.union(v.literal("loading"), v.literal("unloading"), v.literal("both")),
    address: v.string(),
    city: v.string(),
    municipalityCode: v.optional(v.string()),
    contactName: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    status: activeStatusValidator
  },
  returns: v.id("customerLocations"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const customer = await ctx.db.get("customers", args.customerId);

    if (!customer) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Customer not found" });
    }

    requireSameOrganization(actor, customer.organizationId);
    const code = normalizeCode(args.code);
    const now = Date.now();
    const existing = await ctx.db
      .query("customerLocations")
      .withIndex("by_customer_and_code", (q) => q.eq("customerId", args.customerId).eq("code", code))
      .unique();
    let locationId;

    if (existing) {
      await ctx.db.patch("customerLocations", existing._id, {
        name: args.name.trim(),
        kind: args.kind,
        address: args.address.trim(),
        city: args.city.trim(),
        municipalityCode: args.municipalityCode,
        contactName: args.contactName,
        contactPhone: args.contactPhone,
        status: args.status,
        updatedBy: actor._id,
        updatedAt: now
      });
      locationId = existing._id;
    } else {
      locationId = await ctx.db.insert("customerLocations", {
        organizationId: customer.organizationId,
        customerId: customer._id,
        code,
        name: args.name.trim(),
        kind: args.kind,
        address: args.address.trim(),
        city: args.city.trim(),
        municipalityCode: args.municipalityCode,
        contactName: args.contactName,
        contactPhone: args.contactPhone,
        status: args.status,
        createdBy: actor._id,
        updatedBy: actor._id,
        createdAt: now,
        updatedAt: now
      });
    }

    await appendAudit(ctx, {
      organizationId: customer.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: existing ? "customer_location.updated" : "customer_location.created",
      entityType: "customer_location",
      entityId: locationId,
      createdAt: now
    });
    return locationId;
  }
});

export const upsertServiceOrder = mutation({
  args: {
    actorToken: v.optional(v.string()),
    organizationId: v.id("organizations"),
    code: v.string(),
    customerId: v.id("customers"),
    loadingLocationId: v.id("customerLocations"),
    unloadingLocationId: v.id("customerLocations"),
    status: serviceOrderStatusValidator,
    customerReference: v.optional(v.string()),
    cargoDescription: v.string(),
    cargoQuantity: v.optional(v.number()),
    cargoUnit: v.optional(v.string()),
    cargoWeightKg: v.optional(v.number()),
    agreedRate: v.number(),
    currency: v.optional(v.string()),
    scheduledLoadingAt: v.optional(v.number()),
    scheduledUnloadingAt: v.optional(v.number()),
    notes: v.optional(v.string())
  },
  returns: v.id("serviceOrders"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    requireSameOrganization(actor, args.organizationId);
    const [customer, loadingLocation, unloadingLocation] = await Promise.all([
      ctx.db.get("customers", args.customerId),
      ctx.db.get("customerLocations", args.loadingLocationId),
      ctx.db.get("customerLocations", args.unloadingLocationId)
    ]);

    if (!customer || !loadingLocation || !unloadingLocation) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Customer or route location not found" });
    }

    for (const resource of [customer, loadingLocation, unloadingLocation]) {
      if (resource.organizationId !== args.organizationId) {
        throw new ConvexError({ code: "FORBIDDEN", message: "Service order resource belongs to another organization" });
      }
    }

    const code = normalizeCode(args.code);
    const now = Date.now();
    const existing = await ctx.db
      .query("serviceOrders")
      .withIndex("by_organization_and_code", (q) => q.eq("organizationId", args.organizationId).eq("code", code))
      .unique();
    const values = {
      customerId: args.customerId,
      loadingLocationId: args.loadingLocationId,
      unloadingLocationId: args.unloadingLocationId,
      status: args.status,
      customerReference: args.customerReference,
      cargoDescription: args.cargoDescription.trim(),
      cargoQuantity: args.cargoQuantity,
      cargoUnit: args.cargoUnit,
      cargoWeightKg: args.cargoWeightKg,
      agreedRate: args.agreedRate,
      currency: args.currency ?? "COP",
      scheduledLoadingAt: args.scheduledLoadingAt,
      scheduledUnloadingAt: args.scheduledUnloadingAt,
      notes: args.notes,
      updatedBy: actor._id,
      updatedAt: now
    };
    let serviceOrderId;

    if (existing) {
      await ctx.db.patch("serviceOrders", existing._id, values);
      serviceOrderId = existing._id;
    } else {
      serviceOrderId = await ctx.db.insert("serviceOrders", {
        organizationId: args.organizationId,
        code,
        ...values,
        createdBy: actor._id,
        createdAt: now
      });
    }

    await appendAudit(ctx, {
      organizationId: args.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: existing ? "service_order.updated" : "service_order.created",
      entityType: "service_order",
      entityId: serviceOrderId,
      createdAt: now
    });
    return serviceOrderId;
  }
});

export const upsertTrailer = mutation({
  args: {
    actorToken: v.optional(v.string()),
    organizationId: v.id("organizations"),
    plate: v.string(),
    trailerType: v.optional(v.string()),
    configuration: v.optional(v.string()),
    capacityKg: v.optional(v.number()),
    ownerDocument: v.optional(v.string()),
    status: trailerStatusValidator
  },
  returns: v.id("trailers"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    requireSameOrganization(actor, args.organizationId);
    const plate = normalizeCode(args.plate);
    const now = Date.now();
    const existing = await ctx.db
      .query("trailers")
      .withIndex("by_organization_and_plate", (q) => q.eq("organizationId", args.organizationId).eq("plate", plate))
      .unique();
    const values = {
      trailerType: args.trailerType,
      configuration: args.configuration,
      capacityKg: args.capacityKg,
      ownerDocument: args.ownerDocument,
      status: args.status,
      updatedBy: actor._id,
      updatedAt: now
    };
    let trailerId;

    if (existing) {
      await ctx.db.patch("trailers", existing._id, values);
      trailerId = existing._id;
    } else {
      trailerId = await ctx.db.insert("trailers", {
        organizationId: args.organizationId,
        plate,
        ...values,
        createdBy: actor._id,
        createdAt: now
      });
    }

    await appendAudit(ctx, {
      organizationId: args.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: existing ? "trailer.updated" : "trailer.created",
      entityType: "trailer",
      entityId: trailerId,
      createdAt: now
    });
    return trailerId;
  }
});

export const listCustomers = query({
  args: { actorToken: v.optional(v.string()), organizationId: v.id("organizations"), status: v.optional(activeStatusValidator) },
  returns: v.array(customerValidator),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    requireSameOrganization(actor, args.organizationId);
    const q = ctx.db
      .query("customers")
      .withIndex("by_organization_and_status", (index) =>
        args.status
          ? index.eq("organizationId", args.organizationId).eq("status", args.status)
          : index.eq("organizationId", args.organizationId)
      );
    return await q.take(250);
  }
});

export const listCustomerLocations = query({
  args: { actorToken: v.optional(v.string()), customerId: v.id("customers") },
  returns: v.array(locationValidator),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    const customer = await ctx.db.get("customers", args.customerId);

    if (!customer) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Customer not found" });
    }

    requireSameOrganization(actor, customer.organizationId);
    return await ctx.db
      .query("customerLocations")
      .withIndex("by_organization_and_customer", (q) =>
        q.eq("organizationId", customer.organizationId).eq("customerId", customer._id)
      )
      .take(250);
  }
});

export const listServiceOrders = query({
  args: {
    actorToken: v.optional(v.string()),
    organizationId: v.id("organizations"),
    status: v.optional(serviceOrderStatusValidator),
    limit: v.optional(v.number())
  },
  returns: v.array(serviceOrderValidator),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    requireSameOrganization(actor, args.organizationId);
    const q = ctx.db
      .query("serviceOrders")
      .withIndex("by_organization_and_status", (index) =>
        args.status
          ? index.eq("organizationId", args.organizationId).eq("status", args.status)
          : index.eq("organizationId", args.organizationId)
      );
    return await q.order("desc").take(Math.min(Math.max(args.limit ?? 100, 1), 250));
  }
});

export const listTrailers = query({
  args: {
    actorToken: v.optional(v.string()),
    organizationId: v.id("organizations"),
    status: v.optional(trailerStatusValidator)
  },
  returns: v.array(trailerValidator),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    requireSameOrganization(actor, args.organizationId);
    const q = ctx.db
      .query("trailers")
      .withIndex("by_organization_and_status", (index) =>
        args.status
          ? index.eq("organizationId", args.organizationId).eq("status", args.status)
          : index.eq("organizationId", args.organizationId)
      );
    return await q.take(250);
  }
});

function normalizeCode(value: string): string {
  const normalized = value.trim().toUpperCase();

  if (!normalized) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "Code is required" });
  }

  return normalized;
}

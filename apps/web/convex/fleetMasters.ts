import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { appendAudit, requireActor } from "./model/access";
import {
  deriveDriverThirdPartyRoles,
  normalizeDriverMasterInput,
  normalizeThirdPartyMasterInput,
  normalizeTrailerMasterInput,
  normalizeVehicleMasterInput,
  type DriverMasterInput,
  type ThirdPartyMasterInput,
  type ThirdPartyRole,
  type TrailerMasterInput,
  type VehicleMasterInput
} from "./model/masterData";
import { pendingMasterSync } from "./model/masterSync";

import {
  creationOutcomeValidator,
  CreationOutcome,
  uploadInputValidator,
  vehiclePhotoInputValidator,
  driverMasterInputValidator,
  thirdPartyMasterInputValidator,
  trailerMasterInputValidator,
  vehicleMasterInputValidator
} from "./model/fleetValidators";
import {
  normalizeWorkReferences,
  enrichmentPatch,
  hasFields,
  sameStringArray,
  requireOrganizationResource,
  ensureAssignedThirdPartyRoles,
  assignPrimaryDriver,
  synchronizeTrailerVehicleRelationship,
  validateDriverMasterRequired,
  validateThirdPartyMasterRequired,
  validateTrailerMasterRequired,
  validateVehiclePhotos,
  validateVehicleMasterRequired,
  storeMasterAttachment,
  resolveVehicleCatalogFields
} from "./model/fleetRecords";

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
        await ctx.db.patch(existingParty._id, { ...partyPatch, updatedBy: actor._id, updatedAt: now, rndcSync: pendingMasterSync(now, now) });
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
        rndcSync: pendingMasterSync(now, now),
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
        await ctx.db.patch(existing._id, { ...patch, updatedAt: now, rndcSync: pendingMasterSync(now, now) });
      }
      id = existing._id;
      outcome = hasFields(patch) || relatedChanged ? "enriched" : "unchanged";
    } else {
      id = await ctx.db.insert("drivers", {
        ...incoming,
        organizationId: actor.organizationId,
        status: "active",
        rndcSync: pendingMasterSync(now, now),
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
        await ctx.db.patch(existing._id, { ...patch, updatedBy: actor._id, updatedAt: now, rndcSync: pendingMasterSync(now, now) });
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
        rndcSync: pendingMasterSync(now, now),
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
        await ctx.db.patch(existing._id, { ...patch, updatedAt: now, rndcSync: pendingMasterSync(now, now) });
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
        rndcSync: pendingMasterSync(now, now),
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


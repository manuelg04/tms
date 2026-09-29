import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  normalizeThirdPartyInput,
  type ThirdPartyInput,
  type ThirdPartyRole,
  type VehicleMasterInput
} from "./masterData";
import {
  buildDriverSyncPayload,
  buildPartySyncPayloads,
  buildVehicleSyncPayload,
  masterSyncSummary,
  pendingMasterSync,
  type MasterSyncKind,
  type MasterSyncSummary
} from "./masterSync";
import type { MasterAttachmentSlot, MasterResourceType, MasterUploadInput, MasterWorkReference } from "./fleetValidators";


export function normalizeMasterKey(kind: MasterSyncKind, key: string): string {
  const trimmed = key.trim();
  return kind === "vehicle" ? trimmed.toUpperCase() : trimmed;
}

export type MasterSyncBundle = {
  organizationId: Id<"organizations">;
  kind: MasterSyncKind;
  key: string;
  label: string;
  version: number;
  summary: MasterSyncSummary;
  payloads: Array<{ businessKey: string; payload: Record<string, unknown> }>;
};

export async function loadMasterSyncBundle(ctx: QueryCtx, organizationId: Id<"organizations">, kind: MasterSyncKind, rawKey: string): Promise<MasterSyncBundle | null> {
  const key = normalizeMasterKey(kind, rawKey);
  if (kind === "driver") {
    const driver = await ctx.db.query("drivers").withIndex("by_organization_and_document", (q) => q.eq("organizationId", organizationId).eq("document", key)).unique();
    if (!driver) return null;
    return {
      organizationId,
      kind,
      key,
      label: `Conductor ${driver.name ?? driver.document}`,
      version: driver.updatedAt,
      summary: await driverSyncSummary(ctx, driver),
      payloads: [{ businessKey: `master:driver:${key}:${driver.updatedAt}`, payload: buildDriverSyncPayload(driver) }]
    };
  }
  if (kind === "vehicle") {
    const vehicle = await ctx.db.query("vehicles").withIndex("by_organization_and_plate", (q) => q.eq("organizationId", organizationId).eq("plate", key)).unique();
    if (!vehicle) return null;
    if (!vehicle.ownerDocument || !vehicle.possessorDocument) throw new Error(`El vehículo ${key} no tiene propietario y poseedor definidos`);
    const [owner, possessor] = await Promise.all([
      ctx.db.query("thirdParties").withIndex("by_organization_and_document", (q) => q.eq("organizationId", organizationId).eq("document", vehicle.ownerDocument!)).unique(),
      ctx.db.query("thirdParties").withIndex("by_organization_and_document", (q) => q.eq("organizationId", organizationId).eq("document", vehicle.possessorDocument!)).unique()
    ]);
    if (!owner) throw new Error(`El propietario ${vehicle.ownerDocument} del vehículo ${key} no existe en maestros`);
    if (!possessor) throw new Error(`El poseedor ${vehicle.possessorDocument} del vehículo ${key} no existe en maestros`);
    const version = Math.max(vehicle.updatedAt, owner.updatedAt, possessor.updatedAt);
    return {
      organizationId,
      kind,
      key,
      label: `Vehículo ${key}`,
      version,
      summary: masterSyncSummary(vehicle),
      payloads: [{ businessKey: `master:vehicle:${key}:${version}`, payload: buildVehicleSyncPayload(vehicle, owner, possessor) }]
    };
  }
  const party = await ctx.db.query("thirdParties").withIndex("by_organization_and_document", (q) => q.eq("organizationId", organizationId).eq("document", key)).unique();
  if (!party) return null;
  const sites = await ctx.db.query("thirdPartySites").withIndex("by_third_party", (q) => q.eq("thirdPartyId", party._id)).collect();
  const version = Math.max(party.updatedAt, ...sites.map((site) => site.updatedAt));
  return {
    organizationId,
    kind,
    key,
    label: `Tercero ${party.name}`,
    version,
    summary: masterSyncSummary(party),
    payloads: buildPartySyncPayloads(party, sites).map((entry) => ({ businessKey: `master:party:${key}:${entry.siteCode}:${version}`, payload: entry.payload }))
  };
}

export async function upsertPartyRecord(ctx: MutationCtx, organizationId: Id<"organizations">, actorId: Id<"users">, raw: ThirdPartyInput, now: number): Promise<Id<"thirdParties">> {
  const input = normalizeThirdPartyInput(raw);
  const existing = await ctx.db.query("thirdParties").withIndex("by_organization_and_document", (q) => q.eq("organizationId", organizationId).eq("document", input.document)).unique();
  const roles = [...new Set([...(existing?.roles ?? []), ...(input.roles ?? [])])];
  if (existing) {
    await ctx.db.patch(existing._id, { ...input, roles, updatedBy: actorId, updatedAt: now, rndcSync: pendingMasterSync(now, now) });
    return existing._id;
  }
  return await ctx.db.insert("thirdParties", { ...input, roles, organizationId, createdBy: actorId, updatedBy: actorId, createdAt: now, updatedAt: now, rndcSync: pendingMasterSync(now, now) });
}

export function prefixRange(prefix: string): { from: string; to: string } | null {
  return prefix === "" ? null : { from: prefix, to: prefix + "\uffff" };
}

export async function toDriverRow(ctx: QueryCtx, driver: Doc<"drivers">) {
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
    rndcSyncSummary: await driverSyncSummary(ctx, driver),
    updatedAt: driver.updatedAt
  };
}

export async function driverSyncSummary(ctx: QueryCtx, driver: Doc<"drivers">): Promise<MasterSyncSummary> {
  if (driver.rndcSync) return masterSyncSummary(driver);
  const mirror = driver.organizationId
    ? await ctx.db.query("thirdParties").withIndex("by_organization_and_document", (q) => q.eq("organizationId", driver.organizationId!).eq("document", driver.document)).unique()
    : null;
  return masterSyncSummary(mirror ? { rndcRegisteredAt: mirror.rndcRegisteredAt, source: mirror.source } : null);
}

export async function toVehicleRow(ctx: QueryCtx, vehicle: Doc<"vehicles">) {
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
    rndcSyncSummary: masterSyncSummary(vehicle),
    driverCount: drivers.length,
    updatedAt: vehicle.updatedAt
  };
}

export function toTrailerRow(trailer: Doc<"trailers">) {
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

export async function readMasterAttachments(
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

export function normalizeWorkReferences(input: MasterWorkReference[] | undefined): MasterWorkReference[] | undefined {
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

export function enrichmentPatch(
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

export function hasFields(value: Record<string, unknown>): boolean {
  return Object.keys(value).length > 0;
}

export function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

export function isBlankValue(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

export function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right) || isPlainObject(left) || isPlainObject(right)) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return false;
}

export function sameMasterValue(key: string, left: unknown, right: unknown): boolean {
  if (key === "status" && typeof left === "string" && typeof right === "string") {
    return normalizedResourceStatus(left) === normalizedResourceStatus(right);
  }
  return sameValue(left, right);
}

export function normalizedResourceStatus(value: string): string {
  if (value === "activo") return "active";
  if (value === "archivado") return "inactive";
  return value;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function trimmedOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));
}

export function requireOrganizationResource<T extends { organizationId?: Id<"organizations"> }>(
  resource: T | null,
  organizationId: Id<"organizations">,
  message: string
): asserts resource is T {
  if (!resource || resource.organizationId !== organizationId) {
    throw new ConvexError({ code: "NOT_FOUND", message });
  }
}

export async function ensureAssignedThirdPartyRoles(
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

export async function assignPrimaryDriver(
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

export async function matchingDriverVehicleRelations(
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

export async function synchronizeTrailerVehicleRelationship(
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

export function validateDriverMasterRequired(input: {
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

export function validateThirdPartyMasterRequired(input: {
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

export function validateTrailerMasterRequired(input: {
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

export function requireMasterTextFields(fields: ReadonlyArray<readonly [string | undefined, string]>): void {
  for (const [value, label] of fields) {
    if (!value?.trim()) {
      throw new ConvexError({ code: "INVALID_INPUT", message: `${label} es obligatorio` });
    }
  }
}

export function validateVehiclePhotos(
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

export function validateVehicleMasterRequired(input: {
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

export async function storeMasterAttachment(
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

export async function resolveVehicleCatalogFields(ctx: MutationCtx, input: VehicleMasterInput) {
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

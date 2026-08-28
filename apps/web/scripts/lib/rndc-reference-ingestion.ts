import { createHash } from "node:crypto";
import {
  canonicalizeRndcCatalogPayload,
  type RndcCatalogKind,
  type RndcCatalogPayload
} from "../../convex/model/rndcCatalogs.js";
import type {
  RndcBodyTypeCatalogRow,
  RndcInsurerCatalogRow,
  RndcPackageCatalogRow,
  RndcVehicleLineCatalogRow
} from "./rndc-reference-catalogs.js";

export type PreparedVehicleLineRow = RndcVehicleLineCatalogRow & { contentHash: string };
export type PreparedInsurerRow = RndcInsurerCatalogRow & { contentHash: string };
export type PreparedPackageRow = RndcPackageCatalogRow & { contentHash: string };
export type PreparedBodyTypeRow = RndcBodyTypeCatalogRow & { contentHash: string };
export type PreparedCatalogRow =
  | PreparedVehicleLineRow
  | PreparedInsurerRow
  | PreparedPackageRow
  | PreparedBodyTypeRow;

function payloadHash(payload: RndcCatalogPayload): string {
  return createHash("sha256").update(canonicalizeRndcCatalogPayload(payload)).digest("hex");
}

export function prepareVehicleLineRows(rows: RndcVehicleLineCatalogRow[]): PreparedVehicleLineRow[] {
  return rows.map((row) => ({
    ...row,
    contentHash: payloadHash({
      makeCode: row.makeCode,
      makeName: row.makeName ?? null,
      lineCode: row.lineCode,
      lineName: row.lineName ?? null,
      grossWeightKg: row.grossWeightKg
    })
  }));
}

export function prepareInsurerRows(rows: RndcInsurerCatalogRow[]): PreparedInsurerRow[] {
  return rows.map((row) => ({
    ...row,
    contentHash: payloadHash({
      insurerNit: row.insurerNit,
      name: row.name,
      insurerType: row.insurerType ?? null
    })
  }));
}

export function preparePackageRows(rows: RndcPackageCatalogRow[]): PreparedPackageRow[] {
  return rows.map((row) => ({
    ...row,
    contentHash: payloadHash({
      code: row.code,
      description: row.description,
      fullDescription: row.fullDescription,
      definition: row.definition,
      minimumEmptyWeightKg: row.minimumEmptyWeightKg,
      maximumEmptyWeightKg: row.maximumEmptyWeightKg,
      hazardous: row.hazardous ?? null,
      packageTypeCode: row.packageTypeCode ?? null,
      packageTypeName: row.packageTypeName ?? null,
      materialCode: row.materialCode ?? null,
      materialName: row.materialName ?? null,
      operationType: row.operationType
    })
  }));
}

export function prepareBodyTypeRows(rows: RndcBodyTypeCatalogRow[]): PreparedBodyTypeRow[] {
  return rows.map((row) => ({
    ...row,
    contentHash: payloadHash({ code: row.code, description: row.description })
  }));
}

export function chunkCatalogRows<T>(rows: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1 || size > 200) {
    throw new Error("El tamaño del lote debe estar entre 1 y 200");
  }
  const batches: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    batches.push(rows.slice(index, index + size));
  }
  return batches;
}

export function hashCatalogBatch(catalog: RndcCatalogKind, rows: ReadonlyArray<PreparedCatalogRow>): string {
  const canonicalRows = rows.map((row) => {
    const canonicalPayload = canonicalizeRndcCatalogPayload(catalogPayload(catalog, row));
    if (createHash("sha256").update(canonicalPayload).digest("hex") !== row.contentHash) {
      throw new Error("El hash de contenido de una fila no coincide con su contenido canónico");
    }
    return [row.sourceRegisteredAt, canonicalPayload, row.contentHash];
  });
  return createHash("sha256").update(JSON.stringify([catalog, canonicalRows])).digest("hex");
}

export function hashCatalogManifest(catalog: RndcCatalogKind, batchHashes: ReadonlyArray<string>): string {
  if (batchHashes.length < 1 || batchHashes.some((hash) => !/^[0-9a-f]{64}$/.test(hash))) {
    throw new Error("El manifiesto del catálogo contiene hashes de lote inválidos");
  }
  return createHash("sha256").update(JSON.stringify([catalog, batchHashes])).digest("hex");
}

export function deterministicCatalogRunId(manifest: unknown): string {
  const stableManifest = stableJson(manifest);
  const bytes = createHash("sha256").update(stableManifest).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stableJson(value: unknown): string {
  const stable = stableValue(value);
  const serialized = JSON.stringify(stable);
  if (serialized === undefined) throw new Error("El manifiesto de la corrida no se puede serializar");
  return serialized;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)])
    );
  }
  return value;
}

function catalogPayload(catalog: RndcCatalogKind, row: PreparedCatalogRow): RndcCatalogPayload {
  if (catalog === "vehicle_line") {
    const vehicleLine = row as PreparedVehicleLineRow;
    return {
      makeCode: vehicleLine.makeCode,
      makeName: vehicleLine.makeName ?? null,
      lineCode: vehicleLine.lineCode,
      lineName: vehicleLine.lineName ?? null,
      grossWeightKg: vehicleLine.grossWeightKg
    };
  }
  if (catalog === "insurer") {
    const insurer = row as PreparedInsurerRow;
    return { insurerNit: insurer.insurerNit, name: insurer.name, insurerType: insurer.insurerType ?? null };
  }
  if (catalog === "packaging") {
    const packaging = row as PreparedPackageRow;
    return {
      code: packaging.code,
      description: packaging.description,
      fullDescription: packaging.fullDescription,
      definition: packaging.definition,
      minimumEmptyWeightKg: packaging.minimumEmptyWeightKg,
      maximumEmptyWeightKg: packaging.maximumEmptyWeightKg,
      hazardous: packaging.hazardous ?? null,
      packageTypeCode: packaging.packageTypeCode ?? null,
      packageTypeName: packaging.packageTypeName ?? null,
      materialCode: packaging.materialCode ?? null,
      materialName: packaging.materialName ?? null,
      operationType: packaging.operationType
    };
  }
  const bodyType = row as PreparedBodyTypeRow;
  return { code: bodyType.code, description: bodyType.description };
}

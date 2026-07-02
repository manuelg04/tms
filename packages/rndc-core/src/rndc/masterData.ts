import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RndcMessageRequest, RndcXmlRecord } from "./types.js";

export type RndcDriverMaster = {
  key: string;
  idType: string;
  id: string;
  fullName: string;
  phone?: string;
  cityCode?: string;
  licenseCategory?: string;
  licenseNumber?: string;
  licenseExpirationDate?: string;
  readyForDocuments: boolean;
  reviewReasons: string[];
};

export type RndcThirdPartyMaster = {
  key: string;
  idType: string;
  id: string;
  fullName: string;
  phone?: string;
  cityCode?: string;
  readyForDocuments: boolean;
  reviewReasons: string[];
};

export type RndcVehicleMaster = {
  key: string;
  plate: string;
  configurationCode?: string;
  ownerId?: string;
  holderId?: string;
  capacityKg?: number;
  soatNumber?: string;
  soatExpirationDate?: string;
  readyForDocuments: boolean;
  reviewReasons: string[];
};

export type LocalMasterSnapshotInput = {
  storeDir: string;
  fetchedAt: string;
  driver?: RndcDriverMaster;
  vehicle?: RndcVehicleMaster;
  driverRequestXml: string;
  vehicleRequestXml: string;
  driverResponseXml: string;
  vehicleResponseXml: string;
};

export type LocalOwnerVehicleSnapshotInput = {
  storeDir: string;
  fetchedAt: string;
  owner?: RndcThirdPartyMaster;
  vehicle?: RndcVehicleMaster;
  ownerRequestXml: string;
  vehicleRequestXml: string;
  ownerResponseXml: string;
  vehicleResponseXml: string;
};

export type LocalOwnerVehicleSnapshotResult = {
  readyForDocuments: boolean;
  ownerMatchesVehicle: boolean;
  ownerVehiclePath: string;
  ownerPath: string;
  vehiclePath: string;
  reviewReasons: string[];
};

export type LocalMasterSnapshotResult = {
  readyForDocuments: boolean;
  pairPath: string;
  driverPath: string;
  vehiclePath: string;
  reviewReasons: string[];
};

const driverFields = [
  "NUMNITEMPRESATRANSPORTE",
  "CODTIPOIDTERCERO",
  "NUMIDTERCERO",
  "NOMIDTERCERO",
  "PRIMERAPELLIDOIDTERCERO",
  "SEGUNDOAPELLIDOIDTERCERO",
  "NUMTELEFONOCONTACTO",
  "NUMCELULARPERSONA",
  "NOMENCLATURADIRECCION",
  "CODMUNICIPIORNDC",
  "CODCATEGORIALICENCIACONDUCCION",
  "NUMLICENCIACONDUCCION",
  "FECHAVENCIMIENTOLICENCIA",
  "CODSEDETERCERO",
  "NOMSEDETERCERO",
  "LATITUD",
  "LONGITUD"
];

const vehicleFields = [
  "NUMNITEMPRESATRANSPORTE",
  "NUMPLACA",
  "CODCONFIGURACIONUNIDADCARGA",
  "CODMARCAVEHICULOCARGA",
  "CODLINEAVEHICULOCARGA",
  "ANOFABRICACIONVEHICULOCARGA",
  "CODTIPOIDPROPIETARIO",
  "NUMIDPROPIETARIO",
  "CODTIPOIDTENEDOR",
  "NUMIDTENEDOR",
  "CODTIPOCOMBUSTIBLE",
  "PESOVEHICULOVACIO",
  "CAPACIDADUNIDADCARGA",
  "CODCOLORVEHICULOCARGA",
  "CODTIPOCARROCERIA",
  "UNIDADMEDIDACAPACIDAD",
  "NUMNITASEGURADORASOAT",
  "FECHAVENCIMIENTOSOAT",
  "NUMSEGUROSOAT"
];

export function buildDriverMasterQuery(input: { companyRndcNit: string; idType: string; id: string }): RndcMessageRequest {
  return buildThirdPartyMasterQuery(input);
}

export function buildThirdPartyMasterQuery(input: { companyRndcNit: string; idType: string; id: string }): RndcMessageRequest {
  return {
    tipo: 2,
    procesoId: 11,
    variables: driverFields.join(","),
    documento: {
      NUMNITEMPRESATRANSPORTE: input.companyRndcNit,
      CODTIPOIDTERCERO: queryTextLiteral(input.idType.trim().toUpperCase()),
      NUMIDTERCERO: input.id.trim()
    }
  };
}

export function buildVehicleMasterQuery(input: { companyRndcNit: string; plate: string }): RndcMessageRequest {
  return {
    tipo: 2,
    procesoId: 12,
    variables: vehicleFields.join(","),
    documento: {
      NUMNITEMPRESATRANSPORTE: input.companyRndcNit,
      NUMPLACA: queryTextLiteral(input.plate.trim().toUpperCase())
    }
  };
}

export function normalizeDriverMaster(parsed: unknown, now = new Date()): RndcDriverMaster | undefined {
  const document = firstDocument(parsed);

  if (!document) {
    return undefined;
  }

  const idType = readText(document, "CODTIPOIDTERCERO") ?? "C";
  const id = readText(document, "NUMIDTERCERO");

  if (!id) {
    return undefined;
  }

  const names = [
    readText(document, "NOMIDTERCERO"),
    readText(document, "PRIMERAPELLIDOIDTERCERO"),
    readText(document, "SEGUNDOAPELLIDOIDTERCERO")
  ].filter(isPresent);
  const licenseExpirationDate = readText(document, "FECHAVENCIMIENTOLICENCIA");
  const reviewReasons = driverReviewReasons(licenseExpirationDate, now);

  return {
    key: `${idType}-${id}`,
    idType,
    id,
    fullName: names.join(" ") || id,
    phone: readText(document, "NUMCELULARPERSONA") ?? readText(document, "NUMTELEFONOCONTACTO"),
    cityCode: readText(document, "CODMUNICIPIORNDC"),
    licenseCategory: readText(document, "CODCATEGORIALICENCIACONDUCCION"),
    licenseNumber: readText(document, "NUMLICENCIACONDUCCION"),
    licenseExpirationDate,
    readyForDocuments: reviewReasons.length === 0,
    reviewReasons
  };
}

export function normalizeThirdPartyMaster(parsed: unknown): RndcThirdPartyMaster | undefined {
  const document = firstDocument(parsed);

  if (!document) {
    return undefined;
  }

  const idType = readText(document, "CODTIPOIDTERCERO") ?? "C";
  const id = readText(document, "NUMIDTERCERO");

  if (!id) {
    return undefined;
  }

  const names = [
    readText(document, "NOMIDTERCERO"),
    readText(document, "PRIMERAPELLIDOIDTERCERO"),
    readText(document, "SEGUNDOAPELLIDOIDTERCERO")
  ].filter(isPresent);

  return {
    key: `${idType}-${id}`,
    idType,
    id,
    fullName: names.join(" ") || id,
    phone: readText(document, "NUMCELULARPERSONA") ?? readText(document, "NUMTELEFONOCONTACTO"),
    cityCode: readText(document, "CODMUNICIPIORNDC"),
    readyForDocuments: true,
    reviewReasons: []
  };
}

export function normalizeVehicleMaster(parsed: unknown, now = new Date()): RndcVehicleMaster | undefined {
  const document = firstDocument(parsed);

  if (!document) {
    return undefined;
  }

  const plate = readText(document, "NUMPLACA")?.toUpperCase();

  if (!plate) {
    return undefined;
  }

  const soatExpirationDate = readText(document, "FECHAVENCIMIENTOSOAT");
  const reviewReasons = vehicleReviewReasons(soatExpirationDate, now);

  return {
    key: plate,
    plate,
    configurationCode: readText(document, "CODCONFIGURACIONUNIDADCARGA"),
    ownerId: readText(document, "NUMIDPROPIETARIO"),
    holderId: readText(document, "NUMIDTENEDOR"),
    capacityKg: readNumber(document, "CAPACIDADUNIDADCARGA"),
    soatNumber: readText(document, "NUMSEGUROSOAT"),
    soatExpirationDate,
    readyForDocuments: reviewReasons.length === 0,
    reviewReasons
  };
}

export function extractRndcDocuments(parsed: unknown): Record<string, unknown>[] {
  const documents: Record<string, unknown>[] = [];
  collectDocuments(parsed, documents);
  return documents;
}

export function hasRndcDocuments(parsed: unknown): boolean {
  return extractRndcDocuments(parsed).length > 0;
}

export async function saveLocalMasterSnapshot(input: LocalMasterSnapshotInput): Promise<LocalMasterSnapshotResult> {
  const driverKey = safeFileName(input.driver?.key ?? "missing-driver");
  const vehicleKey = safeFileName(input.vehicle?.key ?? "missing-vehicle");
  const driverPath = join(input.storeDir, "drivers", `${driverKey}.json`);
  const vehiclePath = join(input.storeDir, "vehicles", `${vehicleKey}.json`);
  const pairPath = join(input.storeDir, "pairs", `${driverKey}__${vehicleKey}.json`);
  const reviewReasons = [
    ...missingReasons(input.driver, "driver not found"),
    ...missingReasons(input.vehicle, "vehicle not found")
  ];
  const readyForDocuments = Boolean(input.driver?.readyForDocuments && input.vehicle?.readyForDocuments);
  const driverPayload = {
    fetchedAt: input.fetchedAt,
    found: Boolean(input.driver),
    driver: input.driver,
    requestXml: input.driverRequestXml,
    responseXml: input.driverResponseXml
  };
  const vehiclePayload = {
    fetchedAt: input.fetchedAt,
    found: Boolean(input.vehicle),
    vehicle: input.vehicle,
    requestXml: input.vehicleRequestXml,
    responseXml: input.vehicleResponseXml
  };
  const pairPayload = {
    fetchedAt: input.fetchedAt,
    readyForDocuments,
    reviewReasons,
    driver: input.driver,
    vehicle: input.vehicle,
    evidence: {
      driverPath,
      vehiclePath,
      driverRequestXml: input.driverRequestXml,
      vehicleRequestXml: input.vehicleRequestXml,
      driverResponseXml: input.driverResponseXml,
      vehicleResponseXml: input.vehicleResponseXml
    }
  };

  await mkdir(join(input.storeDir, "drivers"), { recursive: true });
  await mkdir(join(input.storeDir, "vehicles"), { recursive: true });
  await mkdir(join(input.storeDir, "pairs"), { recursive: true });
  await writeFile(driverPath, `${JSON.stringify(driverPayload, null, 2)}\n`, "utf8");
  await writeFile(vehiclePath, `${JSON.stringify(vehiclePayload, null, 2)}\n`, "utf8");
  await writeFile(pairPath, `${JSON.stringify(pairPayload, null, 2)}\n`, "utf8");

  return {
    readyForDocuments,
    pairPath,
    driverPath,
    vehiclePath,
    reviewReasons
  };
}

export async function saveLocalOwnerVehicleSnapshot(input: LocalOwnerVehicleSnapshotInput): Promise<LocalOwnerVehicleSnapshotResult> {
  const ownerKey = safeFileName(input.owner?.key ?? "missing-owner");
  const vehicleKey = safeFileName(input.vehicle?.key ?? "missing-vehicle");
  const ownerPath = join(input.storeDir, "third-parties", `${ownerKey}.json`);
  const vehiclePath = join(input.storeDir, "vehicles", `${vehicleKey}.json`);
  const ownerVehiclePath = join(input.storeDir, "owner-vehicles", `${ownerKey}__${vehicleKey}.json`);
  const ownerMatchesVehicle = Boolean(input.owner && input.vehicle && [input.vehicle.ownerId, input.vehicle.holderId].includes(input.owner.id));
  const reviewReasons = [
    ...missingReasons(input.owner, "owner not found"),
    ...missingReasons(input.vehicle, "vehicle not found"),
    ...ownerVehicleReviewReasons(input.owner, input.vehicle, ownerMatchesVehicle)
  ];
  const readyForDocuments = Boolean(input.owner?.readyForDocuments && input.vehicle?.readyForDocuments && ownerMatchesVehicle);
  const ownerPayload = {
    fetchedAt: input.fetchedAt,
    found: Boolean(input.owner),
    owner: input.owner,
    requestXml: input.ownerRequestXml,
    responseXml: input.ownerResponseXml
  };
  const vehiclePayload = {
    fetchedAt: input.fetchedAt,
    found: Boolean(input.vehicle),
    vehicle: input.vehicle,
    requestXml: input.vehicleRequestXml,
    responseXml: input.vehicleResponseXml
  };
  const ownerVehiclePayload = {
    fetchedAt: input.fetchedAt,
    readyForDocuments,
    ownerMatchesVehicle,
    reviewReasons,
    owner: input.owner,
    vehicle: input.vehicle,
    evidence: {
      ownerPath,
      vehiclePath,
      ownerRequestXml: input.ownerRequestXml,
      vehicleRequestXml: input.vehicleRequestXml,
      ownerResponseXml: input.ownerResponseXml,
      vehicleResponseXml: input.vehicleResponseXml
    }
  };

  await mkdir(join(input.storeDir, "third-parties"), { recursive: true });
  await mkdir(join(input.storeDir, "vehicles"), { recursive: true });
  await mkdir(join(input.storeDir, "owner-vehicles"), { recursive: true });
  await writeFile(ownerPath, `${JSON.stringify(ownerPayload, null, 2)}\n`, "utf8");
  await writeFile(vehiclePath, `${JSON.stringify(vehiclePayload, null, 2)}\n`, "utf8");
  await writeFile(ownerVehiclePath, `${JSON.stringify(ownerVehiclePayload, null, 2)}\n`, "utf8");

  return {
    readyForDocuments,
    ownerMatchesVehicle,
    ownerVehiclePath,
    ownerPath,
    vehiclePath,
    reviewReasons
  };
}

function firstDocument(parsed: unknown): Record<string, unknown> | undefined {
  return extractRndcDocuments(parsed)[0];
}

function collectDocuments(value: unknown, documents: Record<string, unknown>[]): void {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectDocuments(item, documents);
    }

    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key.toLowerCase() === "documento") {
      appendDocument(child, documents);
    }

    collectDocuments(child, documents);
  }
}

function appendDocument(value: unknown, documents: Record<string, unknown>[]): void {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      appendDocument(item, documents);
    }

    return;
  }

  documents.push(value as Record<string, unknown>);
}

function readText(record: Record<string, unknown>, name: string): string | undefined {
  const value = readField(record, name);

  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return String(value).trim();
}

function readNumber(record: Record<string, unknown>, name: string): number | undefined {
  const value = readText(record, name);

  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readField(record: Record<string, unknown>, name: string): unknown {
  const wanted = name.toLowerCase();
  return Object.entries(record).find(([key]) => key.toLowerCase() === wanted)?.[1];
}

function driverReviewReasons(licenseExpirationDate: string | undefined, now: Date): string[] {
  if (!licenseExpirationDate) {
    return ["license missing"];
  }

  return isExpiredDate(licenseExpirationDate, now) ? ["license expired"] : [];
}

function vehicleReviewReasons(soatExpirationDate: string | undefined, now: Date): string[] {
  if (!soatExpirationDate) {
    return ["SOAT missing"];
  }

  return isExpiredDate(soatExpirationDate, now) ? ["SOAT expired"] : [];
}

function ownerVehicleReviewReasons(owner: RndcThirdPartyMaster | undefined, vehicle: RndcVehicleMaster | undefined, ownerMatchesVehicle: boolean): string[] {
  if (!owner || !vehicle || ownerMatchesVehicle) {
    return [];
  }

  return ["owner id does not match vehicle owner or holder"];
}

function isExpiredDate(value: string, now: Date): boolean {
  const parsed = parseDate(value);

  if (!parsed) {
    return true;
  }

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return parsed.getTime() < today;
}

function parseDate(value: string): Date | undefined {
  const cleaned = value.replaceAll("'", "").trim();
  const parts = cleaned.split(/[/-]/).map((part) => Number(part));

  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
    return undefined;
  }

  const [first, second, third] = parts;
  const yearFirst = first > 1900;
  const year = yearFirst ? first : third;
  const month = second;
  const day = yearFirst ? third : first;

  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }

  return new Date(Date.UTC(year, month - 1, day));
}

function missingReasons<T extends { reviewReasons: string[] }>(value: T | undefined, missing: string): string[] {
  return value ? value.reviewReasons : [missing];
}

function safeFileName(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "record";
}

function queryTextLiteral(value: string): string {
  const cleaned = value.replaceAll("'", "").trim();
  return `'${cleaned}'`;
}

function isPresent(value: string | undefined): value is string {
  return Boolean(value);
}

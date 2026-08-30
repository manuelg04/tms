export type MasterSyncKind = "driver" | "vehicle" | "party";

export type MasterSyncState = "pending" | "registered" | "rejected";

export type MasterSyncRecord = {
  state: MasterSyncState;
  updatedAt: number;
  version?: number;
  error?: string;
  operationId?: string;
};

export type MasterSyncSummary = {
  state: MasterSyncState;
  updatedAt?: number;
  error?: string;
};

type SyncableRow = {
  rndcSync?: MasterSyncRecord;
  rndcRegisteredAt?: string;
  source?: string;
  updatedAt?: number;
};

const IMPORTED_SOURCES = new Set(["rndc-maestro", "rndc", "rndc-import"]);

export const MASTER_SYNC_KIND_LABELS: Record<MasterSyncKind, string> = {
  driver: "Conductor",
  vehicle: "Vehículo",
  party: "Tercero"
};

export const MASTER_SYNC_STATE_LABELS: Record<MasterSyncState, string> = {
  pending: "Pendiente RNDC",
  registered: "Registrado en RNDC",
  rejected: "Rechazado por RNDC"
};

export const MASTER_SYNC_OPERATION_TYPES: Record<MasterSyncKind, "upsert_third_party" | "upsert_vehicle"> = {
  driver: "upsert_third_party",
  vehicle: "upsert_vehicle",
  party: "upsert_third_party"
};

export const MASTER_SYNC_PROCESS_IDS: Record<MasterSyncKind, number> = {
  driver: 11,
  vehicle: 12,
  party: 11
};

export const MASTER_SYNC_GATEWAY_PATHS: Record<MasterSyncKind, string> = {
  driver: "/rndc/forms/driver",
  vehicle: "/rndc/forms/vehicle",
  party: "/rndc/forms/party"
};

export function masterSyncSummary(row: SyncableRow | null | undefined): MasterSyncSummary {
  if (!row) return { state: "pending" };
  if (row.rndcSync) {
    return { state: row.rndcSync.state, updatedAt: row.rndcSync.updatedAt, error: row.rndcSync.error };
  }
  if (row.rndcRegisteredAt || (row.source && IMPORTED_SOURCES.has(row.source))) {
    return { state: "registered" };
  }
  return { state: "pending" };
}

export function pendingMasterSync(now: number, version?: number): MasterSyncRecord {
  return { state: "pending", updatedAt: now, version };
}

export function isMasterSyncStale(row: SyncableRow | null | undefined): boolean {
  if (!row) return false;
  const summary = masterSyncSummary(row);
  if (summary.state !== "registered") return true;
  if (!row.rndcSync) return false;
  return row.rndcSync.version !== undefined && row.updatedAt !== undefined && row.updatedAt > row.rndcSync.version;
}

const ID_TYPE_CODES: Record<string, string> = {
  C: "C",
  N: "N",
  E: "E",
  P: "P",
  CC: "C",
  "C.C": "C",
  "C.C.": "C",
  CEDULA: "C",
  "CEDULA DE CIUDADANIA": "C",
  "CÉDULA DE CIUDADANÍA": "C",
  NIT: "N",
  "N.I.T": "N",
  "N.I.T.": "N",
  CE: "E",
  "C.E": "E",
  "C.E.": "E",
  "CEDULA DE EXTRANJERIA": "E",
  "CÉDULA DE EXTRANJERÍA": "E",
  PASAPORTE: "P",
  PA: "P"
};

export function rndcIdType(value: string | undefined, label: string): string {
  const key = requireText(value, `tipo de identificación del ${label}`).toUpperCase();
  const mapped = ID_TYPE_CODES[key];
  if (!mapped) throw new Error(`tipo de identificación del ${label} no es válido para el RNDC (${value})`);
  return mapped;
}

export function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} es obligatorio`);
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function splitPersonName(input: { name?: string; firstNames?: string; firstLastName?: string; secondLastName?: string }, label: string) {
  const firstNames = optionalText(input.firstNames);
  const firstLastName = optionalText(input.firstLastName);
  if (firstNames && firstLastName) {
    return { firstName: firstNames, firstLastName, secondLastName: optionalText(input.secondLastName) };
  }
  const parts = requireText(input.name, `nombre del ${label}`).split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], firstLastName: parts[0], secondLastName: undefined };
  if (parts.length === 2) return { firstName: parts[0], firstLastName: parts[1], secondLastName: undefined };
  return { firstName: parts.slice(0, -2).join(" "), firstLastName: parts.at(-2)!, secondLastName: parts.at(-1)! };
}

export type DriverSyncSource = {
  documentType?: string;
  document: string;
  name?: string;
  firstNames?: string;
  firstLastName?: string;
  secondLastName?: string;
  cellphone?: string;
  phone1?: string;
  phone2?: string;
  address?: string;
  cityCode?: string;
  licenseCategory?: string;
  licenseNumber?: string;
  licenseExpiresAt?: string;
};

export type PartySyncSource = {
  documentType: string;
  document: string;
  name: string;
  firstNames?: string;
  firstLastName?: string;
  secondLastName?: string;
  personType?: "natural" | "legal";
  cellphone?: string;
  phone?: string;
  phone2?: string;
  address?: string;
  cityCode?: string;
};

export type PartySiteSyncSource = {
  siteCode: string;
  siteName: string;
  address?: string;
  cityCode?: string;
  latitude?: string;
  longitude?: string;
};

export type VehicleSyncSource = {
  plate: string;
  rndcConfigurationCode?: string;
  rndcMakeCode?: string;
  rndcBodyTypeCode?: string;
  rndcFuelCode?: string;
  line?: string;
  modelYear?: string;
  emptyWeightTn?: string;
  capacityTn?: string;
  color?: string;
  insurerNit?: string;
  soatExpiresAt?: string;
  soatNumber?: string;
};

export function buildDriverSyncPayload(driver: DriverSyncSource) {
  return {
    driver: {
      idType: rndcIdType(driver.documentType, "conductor"),
      id: requireText(driver.document, "identificación del conductor"),
      ...splitPersonName(driver, "conductor"),
      phone: requireText(driver.cellphone ?? driver.phone1 ?? driver.phone2, "teléfono del conductor"),
      address: requireText(driver.address, "dirección del conductor"),
      cityCode: requireText(driver.cityCode, "municipio del conductor"),
      licenseCategory: requireText(driver.licenseCategory, "categoría de licencia del conductor"),
      licenseNumber: requireText(driver.licenseNumber, "número de licencia del conductor"),
      licenseExpirationDate: requireText(driver.licenseExpiresAt, "vencimiento de licencia del conductor")
    }
  };
}

function personPayload(party: PartySyncSource, label: string) {
  const name = party.personType === "legal" || (!party.firstLastName && !party.firstNames && rndcIdType(party.documentType, label) === "N")
    ? { firstName: requireText(party.name, `nombre del ${label}`), firstLastName: requireText(party.name, `nombre del ${label}`), secondLastName: undefined }
    : splitPersonName(party, label);
  return {
    idType: rndcIdType(party.documentType, label),
    id: requireText(party.document, `identificación del ${label}`),
    ...name,
    phone: requireText(party.cellphone ?? party.phone ?? party.phone2, `teléfono del ${label}`),
    address: requireText(party.address, `dirección del ${label}`),
    cityCode: requireText(party.cityCode, `municipio del ${label}`)
  };
}

export function buildVehicleSyncPayload(vehicle: VehicleSyncSource, owner: PartySyncSource, possessor: PartySyncSource) {
  return {
    vehicleOwner: personPayload(owner, "propietario"),
    vehicleHolder: personPayload(possessor, "poseedor"),
    vehicle: {
      plate: requireText(vehicle.plate, "placa").toUpperCase(),
      rndcConfigurationCode: numericCode(vehicle.rndcConfigurationCode, "configuración RNDC del vehículo", 2),
      rndcMakeCode: numericCode(vehicle.rndcMakeCode, "marca RNDC del vehículo", 10),
      rndcFuelCode: numericCode(vehicle.rndcFuelCode, "combustible RNDC del vehículo", 2),
      rndcBodyTypeCode: numericCode(vehicle.rndcBodyTypeCode, "carrocería RNDC del vehículo", 10),
      lineCode: requireText(vehicle.line, "línea RNDC del vehículo"),
      modelYear: Number(requireText(vehicle.modelYear, "modelo del vehículo")),
      emptyWeightKg: tonsToKg(vehicle.emptyWeightTn, "peso vacío del vehículo"),
      capacityKg: tonsToKg(vehicle.capacityTn, "capacidad del vehículo"),
      colorCode: numericCode(vehicle.color, "color RNDC del vehículo", 5),
      insurerNit: requireText(vehicle.insurerNit, "aseguradora SOAT del vehículo"),
      soatExpirationDate: requireText(vehicle.soatExpiresAt, "vencimiento SOAT del vehículo"),
      soatNumber: requireText(vehicle.soatNumber, "número SOAT del vehículo")
    }
  };
}

export function buildPartySyncPayloads(party: PartySyncSource, sites: PartySiteSyncSource[]) {
  const base = {
    idType: rndcIdType(party.documentType, "tercero"),
    id: requireText(party.document, "identificación del tercero"),
    name: requireText(party.name, "nombre del tercero")
  };
  if (sites.length === 0) {
    return [{
      siteCode: "0",
      payload: {
        sender: {
          ...base,
          siteCode: "0",
          siteName: "PRINCIPAL",
          address: requireText(party.address, "dirección del tercero"),
          cityCode: requireText(party.cityCode, "municipio del tercero"),
          latitude: undefined as string | undefined,
          longitude: undefined as string | undefined
        }
      }
    }];
  }
  return sites.map((site) => ({
    siteCode: site.siteCode,
    payload: {
      sender: {
        ...base,
        siteCode: requireText(site.siteCode, "código de sede del tercero"),
        siteName: requireText(site.siteName, `nombre de la sede ${site.siteCode} del tercero`),
        address: requireText(site.address ?? party.address, `dirección de la sede ${site.siteCode} del tercero`),
        cityCode: requireText(site.cityCode ?? party.cityCode, `municipio de la sede ${site.siteCode} del tercero`),
        latitude: optionalText(site.latitude),
        longitude: optionalText(site.longitude)
      }
    }
  }));
}

function tonsToKg(value: string | undefined, label: string): number {
  const number = Number(requireText(value, label));
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} debe ser un número mayor que cero`);
  return Math.round(number * 1000);
}

function numericCode(value: string | undefined, label: string, maxLength: number): string {
  const code = requireText(value, label);
  if (!new RegExp(`^\\d{1,${maxLength}}$`).test(code)) throw new Error(`${label} debe ser un código numérico válido`);
  return code;
}

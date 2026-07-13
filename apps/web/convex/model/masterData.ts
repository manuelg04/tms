export type ThirdPartyRole = "owner" | "possessor" | "holder" | "sender" | "recipient" | "other";

export type ThirdPartyInput = {
  documentType?: string;
  document?: string;
  name?: string;
  phone?: string;
  address?: string;
  cityCode?: string;
  roles?: ThirdPartyRole[];
};

export type DriverInput = {
  documentType?: string;
  document?: string;
  name?: string;
  phone?: string;
  address?: string;
  cityCode?: string;
  licenseCategory?: string;
  licenseNumber?: string;
  licenseExpiresAt?: string;
};

export type VehicleInput = {
  plate?: string;
  make?: string;
  line?: string;
  modelYear?: string;
  color?: string;
  configuration?: string;
  ownerDocument?: string;
  possessorDocument?: string;
  capacityTn?: string;
  emptyWeightTn?: string;
  insurerNit?: string;
  soatExpiresAt?: string;
  soatNumber?: string;
};

export function normalizeThirdPartyInput(input: ThirdPartyInput) {
  const documentType = required(input.documentType, "tipo de identificación").toUpperCase();
  const document = required(input.document, "identificación");
  const name = required(input.name, "nombre");
  const roles = input.roles ? [...new Set(input.roles)] : undefined;
  return compact({
    documentType,
    document,
    name,
    phone: clean(input.phone),
    address: clean(input.address),
    cityCode: clean(input.cityCode),
    roles
  });
}

export function normalizeDriverInput(input: DriverInput) {
  return compact({
    documentType: required(input.documentType, "tipo de identificación").toUpperCase(),
    document: required(input.document, "identificación"),
    name: required(input.name, "nombre"),
    phone: clean(input.phone),
    address: clean(input.address),
    cityCode: clean(input.cityCode),
    licenseCategory: required(input.licenseCategory, "categoría de licencia"),
    licenseNumber: required(input.licenseNumber, "número de licencia"),
    licenseExpiresAt: required(input.licenseExpiresAt, "vencimiento de licencia")
  });
}

export function normalizeVehicleInput(input: VehicleInput) {
  return compact({
    plate: required(input.plate, "placa").toUpperCase(),
    make: clean(input.make),
    line: clean(input.line),
    modelYear: clean(input.modelYear),
    color: clean(input.color),
    configuration: clean(input.configuration),
    ownerDocument: clean(input.ownerDocument),
    possessorDocument: clean(input.possessorDocument),
    capacityTn: numericText(input.capacityTn, "capacidad"),
    emptyWeightTn: numericText(input.emptyWeightTn, "peso vacío"),
    insurerNit: clean(input.insurerNit),
    soatExpiresAt: clean(input.soatExpiresAt),
    soatNumber: clean(input.soatNumber)
  });
}

export function buildMasterRegistrationPayload(input: {
  driver: Required<Pick<DriverInput, "documentType" | "document" | "name" | "phone" | "address" | "cityCode" | "licenseCategory" | "licenseNumber" | "licenseExpiresAt">>;
  owner: Required<Pick<ThirdPartyInput, "documentType" | "document" | "name" | "phone" | "address" | "cityCode">>;
  possessor: Required<Pick<ThirdPartyInput, "documentType" | "document" | "name" | "phone" | "address" | "cityCode">>;
  vehicle: Required<Pick<VehicleInput, "plate" | "configuration" | "line" | "modelYear" | "emptyWeightTn" | "capacityTn" | "color" | "insurerNit" | "soatExpiresAt" | "soatNumber">>;
}) {
  const driverName = personName(input.driver.name);
  const ownerName = personName(input.owner.name);
  const possessorName = personName(input.possessor.name);
  return {
    driver: {
      idType: input.driver.documentType,
      id: input.driver.document,
      ...driverName,
      phone: input.driver.phone,
      address: input.driver.address,
      cityCode: input.driver.cityCode,
      licenseCategory: input.driver.licenseCategory,
      licenseNumber: input.driver.licenseNumber,
      licenseExpirationDate: input.driver.licenseExpiresAt
    },
    vehicleOwner: {
      idType: input.owner.documentType,
      id: input.owner.document,
      ...ownerName,
      phone: input.owner.phone,
      address: input.owner.address,
      cityCode: input.owner.cityCode
    },
    vehicleHolder: {
      idType: input.possessor.documentType,
      id: input.possessor.document,
      ...possessorName,
      phone: input.possessor.phone,
      address: input.possessor.address,
      cityCode: input.possessor.cityCode
    },
    vehicle: {
      plate: input.vehicle.plate,
      rndcConfigurationCode: input.vehicle.configuration,
      lineCode: input.vehicle.line,
      modelYear: Number(input.vehicle.modelYear),
      emptyWeightKg: tonsToKg(input.vehicle.emptyWeightTn, "peso vacío"),
      capacityKg: tonsToKg(input.vehicle.capacityTn, "capacidad"),
      colorCode: Number(input.vehicle.color),
      insurerNit: input.vehicle.insurerNit,
      soatExpirationDate: input.vehicle.soatExpiresAt,
      soatNumber: input.vehicle.soatNumber
    }
  };
}

function personName(value: string) {
  const parts = value.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], firstLastName: parts[0] };
  return { firstName: parts.slice(0, -1).join(" "), firstLastName: parts.at(-1)! };
}

function tonsToKg(value: string, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} debe ser un número mayor que cero`);
  return number * 1000;
}

function numericText(value: string | undefined, label: string): string | undefined {
  const cleaned = clean(value);
  if (cleaned === undefined) return undefined;
  const number = Number(cleaned);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} debe ser un número mayor que cero`);
  return cleaned;
}

function required(value: string | undefined, label: string): string {
  const cleaned = clean(value);
  if (!cleaned) throw new Error(`${label} es obligatorio`);
  return cleaned;
}

function clean(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result || undefined;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export type ThirdPartyRole =
  | "driver"
  | "owner"
  | "possessor"
  | "holder"
  | "sender"
  | "recipient"
  | "insured"
  | "insurance_company"
  | "transport_company"
  | "legal_representative"
  | "commercial"
  | "consignee"
  | "employee"
  | "logistics_operator"
  | "fiscal_reviewer"
  | "other";

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
  rndcConfigurationCode?: string;
  rndcMakeCode?: string;
  rndcBodyTypeCode?: string;
  rndcFuelCode?: string;
  ownerDocument?: string;
  possessorDocument?: string;
  capacityTn?: string;
  emptyWeightTn?: string;
  insurerNit?: string;
  soatExpiresAt?: string;
  soatNumber?: string;
};

export type DriverMasterInput = {
  documentType: string;
  document: string;
  firstNames: string;
  firstLastName: string;
  secondLastName?: string;
  birthDate?: string;
  sex?: string;
  bloodType?: string;
  address: string;
  city?: string;
  cityCode: string;
  phone1?: string;
  phone2?: string;
  cellphone: string;
  mobileOperator?: string;
  rating?: string;
  licenseNumber: string;
  licenseCategory: string;
  licenseExpiresAt: string;
  eps?: string;
  arp?: string;
  pensionFund?: string;
  crewCardNumber?: string;
  crewCardExpiresAt?: string;
  hazmatCourse?: string;
  hazmatCourseExpiresAt?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  observations?: string;
};

export type DriverActivities = {
  owner: boolean;
  possessor: boolean;
  employee: boolean;
};

export type ThirdPartyMasterInput = {
  personType: "natural" | "legal";
  documentType: string;
  document: string;
  firstNames?: string;
  firstLastName?: string;
  secondLastName?: string;
  legalName?: string;
  verificationDigit?: string;
  abbreviation?: string;
  address?: string;
  city?: string;
  cityCode?: string;
  phone1?: string;
  phone2?: string;
  cellphone?: string;
  fax?: string;
  website?: string;
  email?: string;
  taxRegime?: string;
  roles: ThirdPartyRole[];
  observations?: string;
};

export type TrailerMasterInput = {
  plate: string;
  trailerType?: string;
  make?: string;
  modelYear?: string;
  configuration?: string;
  capacityKg: number;
  emptyWeightKg: number;
  widthM: number;
  heightM: number;
  lengthM: number;
  rearVolumeM3?: number;
  bodyType?: string;
  procedureType?: string;
  chassisSerial?: string;
  color?: string;
  observations?: string;
  status: "available" | "assigned" | "maintenance" | "inactive";
};

export type VehicleMasterInput = {
  plate: string;
  make?: string;
  line?: string;
  lineName?: string;
  modelYear?: string;
  repoweredModelYear?: string;
  color?: string;
  bodyType?: string;
  configuration?: string;
  linkType?: string;
  engineNumber?: string;
  serialNumber?: string;
  capacityTn?: string;
  emptyWeightTn?: string;
  affiliatedTo?: string;
  technicalInspectionNumber?: string;
  technicalInspectionExpiresAt?: string;
  emissionsCertificateExpiresAt?: string;
  cargoRegistryNumber?: string;
  operationCardNumber?: string;
  transitLicenseNumber?: string;
  checkListExpress?: boolean;
  rating?: string;
  insurerNit?: string;
  insurerName?: string;
  soatExpiresAt?: string;
  soatNumber?: string;
  liabilityPolicyNumber?: string;
  liabilityInsurerNit?: string;
  liabilityInsurerName?: string;
  liabilityExpiresAt?: string;
  transitAuthority?: string;
  importDeclarationNumber?: string;
  publicServiceEntryMethod?: string;
  observations?: string;
  gpsOperator?: string;
  gpsUsername?: string;
  gpsPassword?: string;
  vehicleKind?: string;
  status?: string;
  rndcMakeCode?: string;
  rndcBodyTypeCode?: string;
  rndcConfigurationCode?: string;
  fuelType?: string;
  rndcFuelCode?: string;
};

const MOTOR_VEHICLE_PLATE_PATTERN = /^[A-Z]{3}\d{3}$/;
const TRAILER_PLATE_PATTERN = /^R\d{5}$/;
const NIT_WEIGHTS = [71, 67, 59, 53, 47, 43, 41, 37, 29, 23, 19, 17, 13, 7, 3];

export function normalizeDriverMasterInput(input: DriverMasterInput) {
  const firstNames = required(input.firstNames, "nombres");
  const firstLastName = required(input.firstLastName, "primer apellido");
  const secondLastName = clean(input.secondLastName);
  return compact({
    documentType: required(input.documentType, "tipo de identificacion").toUpperCase(),
    document: canonicalDocument(input.document, "identificacion"),
    firstNames,
    firstLastName,
    secondLastName,
    name: [firstNames, firstLastName, secondLastName].filter(Boolean).join(" "),
    birthDate: optionalIsoDate(input.birthDate, "fecha de nacimiento"),
    sex: clean(input.sex),
    bloodType: clean(input.bloodType)?.toUpperCase(),
    address: required(input.address, "direccion"),
    city: clean(input.city),
    cityCode: required(input.cityCode, "municipio"),
    phone1: clean(input.phone1),
    phone2: clean(input.phone2),
    cellphone: required(input.cellphone, "celular"),
    mobileOperator: clean(input.mobileOperator),
    rating: clean(input.rating),
    licenseNumber: required(input.licenseNumber, "numero de licencia"),
    licenseCategory: required(input.licenseCategory, "categoria de licencia").toUpperCase(),
    licenseExpiresAt: requiredIsoDate(input.licenseExpiresAt, "vencimiento de licencia"),
    eps: clean(input.eps),
    arp: clean(input.arp),
    pensionFund: clean(input.pensionFund),
    crewCardNumber: clean(input.crewCardNumber),
    crewCardExpiresAt: optionalIsoDate(input.crewCardExpiresAt, "vencimiento de libreta de tripulante"),
    hazmatCourse: clean(input.hazmatCourse),
    hazmatCourseExpiresAt: optionalIsoDate(input.hazmatCourseExpiresAt, "vencimiento del curso de mercancias"),
    emergencyContactName: clean(input.emergencyContactName),
    emergencyContactPhone: clean(input.emergencyContactPhone),
    observations: clean(input.observations)
  });
}

export function deriveDriverThirdPartyRoles(
  existingRoles: ThirdPartyRole[],
  activities: DriverActivities
): ThirdPartyRole[] {
  return [...new Set<ThirdPartyRole>([
    ...existingRoles,
    "driver",
    ...(activities.owner ? ["owner" as const] : []),
    ...(activities.possessor ? ["possessor" as const] : []),
    ...(activities.employee ? ["employee" as const] : [])
  ])];
}

export function normalizeThirdPartyMasterInput(input: ThirdPartyMasterInput) {
  const documentType = required(input.documentType, "tipo de identificacion").toUpperCase();
  const roles = [...new Set(input.roles)];
  const verificationDigit = input.personType === "legal"
    ? required(input.verificationDigit, "digito de verificacion")
    : undefined;
  if (verificationDigit !== undefined && !/^\d$/.test(verificationDigit)) {
    throw new Error("digito de verificacion debe contener un solo numero");
  }
  const document = input.personType === "legal" && isNitDocumentType(documentType)
    ? canonicalNitDocument(input.document, verificationDigit!)
    : canonicalDocument(input.document, "identificacion");
  const common = {
    personType: input.personType,
    documentType,
    document,
    address: clean(input.address),
    city: clean(input.city),
    cityCode: clean(input.cityCode),
    phone: clean(input.phone1),
    phone2: clean(input.phone2),
    cellphone: clean(input.cellphone),
    fax: clean(input.fax),
    website: clean(input.website),
    email: clean(input.email)?.toLowerCase(),
    taxRegime: clean(input.taxRegime),
    roles,
    observations: clean(input.observations)
  };
  if (input.personType === "legal") {
    const legalName = required(input.legalName, "razon social");
    return compact({
      ...common,
      verificationDigit,
      legalName,
      abbreviation: clean(input.abbreviation),
      name: legalName
    });
  }
  const firstNames = required(input.firstNames, "nombres");
  const firstLastName = required(input.firstLastName, "primer apellido");
  const secondLastName = clean(input.secondLastName);
  return compact({
    ...common,
    firstNames,
    firstLastName,
    secondLastName,
    name: [firstNames, firstLastName, secondLastName].filter(Boolean).join(" ")
  });
}

export function normalizeTrailerMasterInput(input: TrailerMasterInput) {
  return compact({
    plate: normalizedTrailerPlate(input.plate),
    trailerType: clean(input.trailerType),
    make: clean(input.make),
    modelYear: clean(input.modelYear),
    configuration: clean(input.configuration),
    capacityKg: positiveNumber(input.capacityKg, "capacidad"),
    emptyWeightKg: positiveNumber(input.emptyWeightKg, "peso vacio"),
    widthM: positiveNumber(input.widthM, "ancho"),
    heightM: positiveNumber(input.heightM, "alto"),
    lengthM: positiveNumber(input.lengthM, "largo"),
    rearVolumeM3: optionalPositiveNumber(input.rearVolumeM3, "volumen posterior"),
    bodyType: clean(input.bodyType),
    procedureType: clean(input.procedureType),
    chassisSerial: clean(input.chassisSerial),
    color: clean(input.color),
    observations: clean(input.observations),
    status: input.status
  });
}

export function normalizeVehicleMasterInput(input: VehicleMasterInput) {
  return compact({
    plate: normalizedMotorVehiclePlate(input.plate),
    make: clean(input.make),
    line: clean(input.line),
    lineName: clean(input.lineName),
    modelYear: clean(input.modelYear),
    repoweredModelYear: clean(input.repoweredModelYear),
    color: clean(input.color),
    bodyType: clean(input.bodyType),
    configuration: clean(input.configuration),
    linkType: clean(input.linkType),
    engineNumber: clean(input.engineNumber),
    serialNumber: clean(input.serialNumber),
    capacityTn: numericText(input.capacityTn, "capacidad"),
    emptyWeightTn: numericText(input.emptyWeightTn, "peso vacio"),
    affiliatedTo: clean(input.affiliatedTo),
    technicalInspectionNumber: clean(input.technicalInspectionNumber),
    technicalInspectionExpiresAt: optionalIsoDate(input.technicalInspectionExpiresAt, "fecha de revision tecnicomecanica"),
    emissionsCertificateExpiresAt: optionalIsoDate(input.emissionsCertificateExpiresAt, "fecha del certificado de emisiones"),
    cargoRegistryNumber: clean(input.cargoRegistryNumber),
    operationCardNumber: clean(input.operationCardNumber),
    transitLicenseNumber: clean(input.transitLicenseNumber),
    checkListExpress: input.checkListExpress,
    rating: clean(input.rating),
    insurerNit: optionalCanonicalDocument(input.insurerNit),
    insurerName: clean(input.insurerName),
    soatExpiresAt: optionalIsoDate(input.soatExpiresAt, "fecha de vencimiento SOAT"),
    soatNumber: clean(input.soatNumber),
    liabilityPolicyNumber: clean(input.liabilityPolicyNumber),
    liabilityInsurerNit: optionalCanonicalDocument(input.liabilityInsurerNit),
    liabilityInsurerName: clean(input.liabilityInsurerName),
    liabilityExpiresAt: optionalIsoDate(input.liabilityExpiresAt, "fecha de vencimiento de responsabilidad civil"),
    transitAuthority: clean(input.transitAuthority),
    importDeclarationNumber: clean(input.importDeclarationNumber),
    publicServiceEntryMethod: clean(input.publicServiceEntryMethod),
    observations: clean(input.observations),
    gpsOperator: clean(input.gpsOperator),
    gpsUsername: clean(input.gpsUsername),
    vehicleKind: clean(input.vehicleKind),
    status: clean(input.status),
    rndcMakeCode: clean(input.rndcMakeCode),
    rndcBodyTypeCode: clean(input.rndcBodyTypeCode),
    rndcConfigurationCode: clean(input.rndcConfigurationCode),
    fuelType: clean(input.fuelType),
    rndcFuelCode: clean(input.rndcFuelCode)
  });
}

export function normalizeThirdPartyInput(input: ThirdPartyInput) {
  const documentType = required(input.documentType, "tipo de identificación").toUpperCase();
  const document = canonicalDocument(input.document, "identificación");
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
    document: canonicalDocument(input.document, "identificación"),
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
    plate: normalizedMotorVehiclePlate(input.plate),
    make: clean(input.make),
    line: clean(input.line),
    modelYear: clean(input.modelYear),
    color: clean(input.color),
    configuration: clean(input.configuration),
    rndcConfigurationCode: clean(input.rndcConfigurationCode),
    rndcMakeCode: clean(input.rndcMakeCode),
    rndcBodyTypeCode: clean(input.rndcBodyTypeCode),
    rndcFuelCode: clean(input.rndcFuelCode),
    ownerDocument: optionalCanonicalDocument(input.ownerDocument),
    possessorDocument: optionalCanonicalDocument(input.possessorDocument),
    capacityTn: numericText(input.capacityTn, "capacidad"),
    emptyWeightTn: numericText(input.emptyWeightTn, "peso vacío"),
    insurerNit: optionalCanonicalDocument(input.insurerNit),
    soatExpiresAt: clean(input.soatExpiresAt),
    soatNumber: clean(input.soatNumber)
  });
}

export function buildMasterRegistrationPayload(input: {
  driver: Required<Pick<DriverInput, "documentType" | "document" | "name" | "phone" | "address" | "cityCode" | "licenseCategory" | "licenseNumber" | "licenseExpiresAt">>;
  owner: Required<Pick<ThirdPartyInput, "documentType" | "document" | "name" | "phone" | "address" | "cityCode">>;
  possessor: Required<Pick<ThirdPartyInput, "documentType" | "document" | "name" | "phone" | "address" | "cityCode">>;
  vehicle: Required<Pick<VehicleInput, "plate" | "rndcConfigurationCode" | "rndcMakeCode" | "rndcBodyTypeCode" | "rndcFuelCode" | "line" | "modelYear" | "emptyWeightTn" | "capacityTn" | "color" | "insurerNit" | "soatExpiresAt" | "soatNumber">>;
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
      rndcConfigurationCode: numericCode(input.vehicle.rndcConfigurationCode, "configuración RNDC", 2),
      rndcMakeCode: numericCode(input.vehicle.rndcMakeCode, "marca RNDC", 10),
      rndcFuelCode: numericCode(input.vehicle.rndcFuelCode, "combustible RNDC", 2),
      rndcBodyTypeCode: numericCode(input.vehicle.rndcBodyTypeCode, "carrocería RNDC", 10),
      lineCode: input.vehicle.line,
      modelYear: Number(input.vehicle.modelYear),
      emptyWeightKg: tonsToKg(input.vehicle.emptyWeightTn, "peso vacío"),
      capacityKg: tonsToKg(input.vehicle.capacityTn, "capacidad"),
      colorCode: numericCode(input.vehicle.color, "color RNDC", 5),
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

function numericCode(value: string, label: string, maxLength: number): string {
  const code = value.trim();
  if (!new RegExp(`^\\d{1,${maxLength}}$`).test(code)) throw new Error(`${label} debe ser un código numérico válido`);
  return code;
}

function numericText(value: string | undefined, label: string): string | undefined {
  const cleaned = clean(value);
  if (cleaned === undefined) return undefined;
  const number = Number(cleaned);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} debe ser un número mayor que cero`);
  return String(number);
}

function normalizedMotorVehiclePlate(value: string | undefined): string {
  const plate = required(value, "placa").toUpperCase();
  if (!MOTOR_VEHICLE_PLATE_PATTERN.test(plate)) {
    throw new Error("placa de vehiculo debe usar el formato colombiano AAA000");
  }
  return plate;
}

function normalizedTrailerPlate(value: string): string {
  const plate = required(value, "placa de remolque").toUpperCase();
  if (!TRAILER_PLATE_PATTERN.test(plate)) {
    throw new Error("placa de remolque debe usar R seguido de cinco numeros");
  }
  return plate;
}

function canonicalDocument(value: string | undefined, label: string): string {
  const document = required(value, label).replace(/[.\s-]+/g, "").toUpperCase();
  if (!document) throw new Error(`${label} es obligatorio`);
  return document;
}

function optionalCanonicalDocument(value: string | undefined): string | undefined {
  return clean(value) === undefined ? undefined : canonicalDocument(value, "identificacion");
}

function isNitDocumentType(documentType: string): boolean {
  return documentType === "N" || documentType === "NIT";
}

function canonicalNitDocument(value: string | undefined, verificationDigit: string): string {
  const raw = required(value, "identificacion");
  const embeddedDigit = raw.match(/^(.*)-\s*(\d)$/);
  if (embeddedDigit && embeddedDigit[2] !== verificationDigit) {
    throw new Error("digito de verificacion no corresponde al NIT");
  }
  const document = canonicalDocument(embeddedDigit?.[1] ?? raw, "identificacion");
  if (!/^\d+$/.test(document) || document.length > NIT_WEIGHTS.length) {
    throw new Error("NIT debe contener solo numeros");
  }
  validateNitVerificationDigit(document, verificationDigit);
  return `${document}${verificationDigit}`;
}

function validateNitVerificationDigit(document: string, verificationDigit: string): void {
  if (calculateNitVerificationDigit(document) !== verificationDigit) {
    throw new Error("digito de verificacion no corresponde al NIT");
  }
}

function calculateNitVerificationDigit(document: string): string {
  const offset = NIT_WEIGHTS.length - document.length;
  const total = [...document].reduce(
    (sum, digit, index) => sum + Number(digit) * NIT_WEIGHTS[offset + index]!,
    0
  );
  const remainder = total % 11;
  const expected = remainder > 1 ? 11 - remainder : remainder;
  return String(expected);
}

function positiveNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} debe ser un numero mayor que cero`);
  }
  return value;
}

function optionalPositiveNumber(value: number | undefined, label: string): number | undefined {
  return value === undefined ? undefined : positiveNumber(value, label);
}

function requiredIsoDate(value: string | undefined, label: string): string {
  return isoDate(required(value, label), label);
}

function optionalIsoDate(value: string | undefined, label: string): string | undefined {
  const cleaned = clean(value);
  return cleaned === undefined ? undefined : isoDate(cleaned, label);
}

function isoDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} debe usar el formato AAAA-MM-DD`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${label} no es una fecha valida`);
  }
  return value;
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

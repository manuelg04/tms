import { classifyKind } from "./rndc-vehicle-maestro.js";

export type AvansatVehicleInput = {
  plate: string;
  make?: string;
  lineName?: string;
  modelYear?: string;
  bodyType?: string;
  configuration?: string;
  configurationLabel?: string;
  vehicleKind: string;
  status: string;
  trailer?: string;
  linkType?: string;
  capacityTn?: string;
  emptyWeightTn?: string;
  ownerDocumentType?: string;
  ownerDocument?: string;
  ownerName?: string;
  ownerCellphone?: string;
  ownerPhone?: string;
  possessorDocumentType?: string;
  possessorDocument?: string;
  possessorName?: string;
  possessorCellphone?: string;
  possessorPhone?: string;
  insurerName?: string;
  soatNumber?: string;
  soatExpiresAt?: string;
  rndcRegisteredAt?: string;
  source: string;
};

export type AvansatPartyInput = {
  documentType: string;
  document: string;
  name: string;
  phone?: string;
  cellphone?: string;
  address?: string;
  roles: Array<"owner" | "possessor">;
  siteCount: number;
  source: string;
};

export type AvansatRelationInput = {
  driverDocument: string;
  vehiclePlate: string;
  matchConfidence: string;
  matchBasis: string;
  roles: string[];
};

export type VehicleWarning = { plate: string; field: string; value: string; reason: string };

export type AvansatVehicleParseResult = {
  vehicles: AvansatVehicleInput[];
  parties: AvansatPartyInput[];
  relations: AvansatRelationInput[];
  rejected: Array<{ line: number; plate: string; reason: string }>;
  warnings: VehicleWarning[];
  stats: {
    rows: number;
    vehicles: number;
    registeredInRndc: number;
    withTrailer: number;
    withValidSoat: number;
    parties: number;
    companies: number;
    relations: number;
    createdFrom?: string;
    createdTo?: string;
  };
};

export const AVANSAT_VEHICLE_COLUMNS = [
  "placa",
  "vinculado_rndc",
  "fecha_creacion",
  "configuracion",
  "remolque",
  "poseedor_nombre",
  "poseedor_documento",
  "propietario_nombre",
  "propietario_documento",
  "conductor_documento",
  "soat_vence"
];

export const AVANSAT_VEHICLE_SOURCE = "avansat-vehiculos";

const PLATE_PATTERN = /^[A-Z]{3}\d{3}$/;
const TRAILER_PATTERN = /^[A-Z]\d{5}$/;
const DOCUMENT_PATTERN = /^\d{5,12}$/;
const COMPANY_PATTERN = /(^|[^A-Z])(S\.? ?A\.? ?S\.?|S\.? ?A\.?|LTDA\.?|L\.?T\.?D\.?A\.?|E\.? ?U\.?|S\.? ?C\.? ?A\.?|S EN C\.?|& ?CIA\.?|Y CIA\.?|BANCO|BANCOLOMBIA|LEASING|FINANCIERA|FINANCIAMIENTO|COMPAÑIA|COMPANIA|COOPERATIVA|INVERSIONES|TRANSPORTES?|TRANSPORTADORA|LOGISTICA|GRUPO|SOCIEDAD|FIDUCIARIA|ASOCIADOS|COMERCIALIZADORA|DISTRIBUIDORA|INGENIERIA|CONSTRUCCIONES|SERVICIOS|SUMINISTROS|OPERADOR)([^A-Z]|$)/;
const NIT_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

function clean(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim().replace(/\s+/g, " ");
  return trimmed === "" || trimmed === "0" ? undefined : trimmed;
}

function date(value: string | undefined): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec((value ?? "").trim());
  return match && match[1] !== "0000" ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

function tons(value: string | undefined): string | undefined {
  const number = Number((value ?? "").trim().replace(",", "."));
  return Number.isFinite(number) && number > 0 ? String(number) : undefined;
}

export function nitCheckDigit(base: string): string {
  const sum = [...base].reverse().reduce((total, digit, index) => total + Number(digit) * NIT_WEIGHTS[index], 0);
  const remainder = sum % 11;
  return String(remainder < 2 ? remainder : 11 - remainder);
}

export function isCompanyName(name: string | undefined): boolean {
  return COMPANY_PATTERN.test((name ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/Ñ/g, "N").replace(/COMPANIA/g, "COMPAÑIA"));
}

export function classifyDocument(document: string, name: string | undefined): { documentType: string; document: string; doubtful?: string } {
  if (!isCompanyName(name)) return { documentType: "C", document };
  if (document.length === 9) return { documentType: "N", document: `${document}${nitCheckDigit(document)}` };
  if (document.length === 10 && nitCheckDigit(document.slice(0, 9)) === document[9]) return { documentType: "N", document };
  return { documentType: "N", document, doubtful: "nit_sin_digito_de_verificacion_reconocible" };
}

export function tractorConfiguration(code: string | undefined): string | undefined {
  const cleaned = clean(code)?.toUpperCase();
  if (!cleaned) return undefined;
  const combined = /^(\d)S\d$/.exec(cleaned);
  return combined ? `${combined[1]}S` : cleaned;
}

export function parseAvansatVehicles(text: string, options: { today: string }): AvansatVehicleParseResult {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) throw new Error("El archivo está vacío");
  const header = lines[0].split("\t").map((cell) => cell.trim());
  const missing = AVANSAT_VEHICLE_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) throw new Error(`Faltan columnas en el archivo de vehículos de Avansat: ${missing.join(", ")}`);

  const result: AvansatVehicleParseResult = {
    vehicles: [],
    parties: [],
    relations: [],
    rejected: [],
    warnings: [],
    stats: { rows: lines.length - 1, vehicles: 0, registeredInRndc: 0, withTrailer: 0, withValidSoat: 0, parties: 0, companies: 0, relations: 0 }
  };
  const seen = new Set<string>();
  const parties = new Map<string, AvansatPartyInput>();
  const created: string[] = [];

  const party = (plate: string, role: "owner" | "possessor", row: Record<string, string>, prefix: "propietario" | "poseedor") => {
    const rawDocument = (row[`${prefix}_documento`] ?? "").trim();
    const name = clean(row[`${prefix}_nombre`]);
    if (!DOCUMENT_PATTERN.test(rawDocument) || !name) {
      result.warnings.push({ plate, field: `${prefix}_documento`, value: rawDocument, reason: "sin_documento_o_nombre" });
      return undefined;
    }
    const classified = classifyDocument(rawDocument, name);
    if (classified.doubtful) result.warnings.push({ plate, field: `${prefix}_documento`, value: rawDocument, reason: classified.doubtful });
    const existing = parties.get(classified.document);
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role);
    } else {
      parties.set(classified.document, {
        documentType: classified.documentType,
        document: classified.document,
        name,
        phone: clean(row[`${prefix}_telefono`]),
        cellphone: clean(row[`${prefix}_celular`]),
        address: clean(row[`${prefix}_direccion`]),
        roles: [role],
        siteCount: 0,
        source: AVANSAT_VEHICLE_SOURCE
      });
    }
    return { ...classified, name, phone: clean(row[`${prefix}_telefono`]), cellphone: clean(row[`${prefix}_celular`]) };
  };

  for (let index = 1; index < lines.length; index++) {
    const cells = lines[index].split("\t");
    const row: Record<string, string> = {};
    header.forEach((column, position) => {
      if (column !== "") row[column] = cells[position] ?? "";
    });
    const line = index + 1;
    const plate = (row.placa ?? "").trim().toUpperCase();
    if (!PLATE_PATTERN.test(plate)) {
      result.rejected.push({ line, plate, reason: "placa_invalida" });
      continue;
    }
    if (seen.has(plate)) {
      result.rejected.push({ line, plate, reason: "placa_repetida" });
      continue;
    }
    seen.add(plate);

    const owner = party(plate, "owner", row, "propietario");
    const possessor = party(plate, "possessor", row, "poseedor");
    const rawConfiguration = clean(row.configuracion)?.toUpperCase();
    const configuration = tractorConfiguration(rawConfiguration);
    const soatExpiresAt = date(row.soat_vence);
    const registered = (row.vinculado_rndc ?? "").trim().toUpperCase() === "SI";
    const trailer = clean(row.remolque)?.toUpperCase();
    if (trailer && !TRAILER_PATTERN.test(trailer)) result.warnings.push({ plate, field: "remolque", value: trailer, reason: "placa_de_remolque_inusual" });
    if (!soatExpiresAt) result.warnings.push({ plate, field: "soat_vence", value: (row.soat_vence ?? "").trim(), reason: "soat_sin_vencimiento" });

    result.vehicles.push({
      plate,
      make: clean(row.marca),
      lineName: clean(row.linea),
      modelYear: clean(row.modelo),
      bodyType: clean(row.tipo_carroceria),
      configuration,
      configurationLabel: [rawConfiguration, clean(row.configuracion_texto)].filter(Boolean).join(" - ") || undefined,
      vehicleKind: classifyKind(configuration),
      status: soatExpiresAt && soatExpiresAt >= options.today ? "activo" : "archivado",
      trailer,
      linkType: clean(row.tipo_vinculacion),
      capacityTn: tons(row.capacidad_tn),
      emptyWeightTn: tons(row.peso_vacio_tn),
      ownerDocumentType: owner?.documentType,
      ownerDocument: owner?.document,
      ownerName: owner?.name,
      ownerCellphone: owner?.cellphone,
      ownerPhone: owner?.phone,
      possessorDocumentType: possessor?.documentType,
      possessorDocument: possessor?.document,
      possessorName: possessor?.name,
      possessorCellphone: possessor?.cellphone,
      possessorPhone: possessor?.phone,
      insurerName: clean(row.soat_aseguradora),
      soatNumber: clean(row.soat_numero),
      soatExpiresAt,
      rndcRegisteredAt: registered ? date(row.fecha_ultima_vinculacion) ?? date(row.fecha_creacion) : undefined,
      source: AVANSAT_VEHICLE_SOURCE
    });

    const driverDocument = (row.conductor_documento ?? "").trim();
    if (DOCUMENT_PATTERN.test(driverDocument)) {
      result.relations.push({
        driverDocument,
        vehiclePlate: plate,
        matchConfidence: "high",
        matchBasis: "avansat_vehicle_driver",
        roles: [
          "conductor",
          ...(driverDocument === (row.poseedor_documento ?? "").trim() ? ["poseedor"] : []),
          ...(driverDocument === (row.propietario_documento ?? "").trim() ? ["propietario"] : [])
        ]
      });
    } else {
      result.warnings.push({ plate, field: "conductor_documento", value: driverDocument, reason: "sin_conductor" });
    }

    if (registered) result.stats.registeredInRndc += 1;
    if (trailer) result.stats.withTrailer += 1;
    if (soatExpiresAt && soatExpiresAt >= options.today) result.stats.withValidSoat += 1;
    const createdAt = date(row.fecha_creacion);
    if (createdAt) created.push(createdAt);
  }

  created.sort();
  result.parties = [...parties.values()];
  result.stats.vehicles = result.vehicles.length;
  result.stats.parties = result.parties.length;
  result.stats.companies = result.parties.filter((item) => item.documentType === "N").length;
  result.stats.relations = result.relations.length;
  result.stats.createdFrom = created[0];
  result.stats.createdTo = created[created.length - 1];
  return result;
}

export type ExistingState = {
  vehicles: Map<string, { trailer?: string; ownerDocument?: string; possessorDocument?: string }>;
  parties: Set<string>;
};

export type AvansatVehiclePlan = {
  newVehicles: AvansatVehicleInput[];
  vehiclePatches: Array<Partial<AvansatVehicleInput> & { plate: string }>;
  untouchedVehicles: string[];
  newParties: AvansatPartyInput[];
  existingParties: string[];
  relations: AvansatRelationInput[];
};

export function planAvansatVehicleLoad(parsed: AvansatVehicleParseResult, existing: ExistingState): AvansatVehiclePlan {
  const plan: AvansatVehiclePlan = { newVehicles: [], vehiclePatches: [], untouchedVehicles: [], newParties: [], existingParties: [], relations: parsed.relations };
  for (const vehicle of parsed.vehicles) {
    const current = existing.vehicles.get(vehicle.plate);
    if (!current) {
      plan.newVehicles.push(vehicle);
      continue;
    }
    const patch: Partial<AvansatVehicleInput> & { plate: string } = { plate: vehicle.plate };
    if (!current.trailer && vehicle.trailer) patch.trailer = vehicle.trailer;
    if (!current.possessorDocument && vehicle.possessorDocument) {
      Object.assign(patch, {
        possessorDocumentType: vehicle.possessorDocumentType,
        possessorDocument: vehicle.possessorDocument,
        possessorName: vehicle.possessorName,
        possessorCellphone: vehicle.possessorCellphone,
        possessorPhone: vehicle.possessorPhone
      });
    }
    if (!current.ownerDocument && vehicle.ownerDocument) {
      Object.assign(patch, {
        ownerDocumentType: vehicle.ownerDocumentType,
        ownerDocument: vehicle.ownerDocument,
        ownerName: vehicle.ownerName,
        ownerCellphone: vehicle.ownerCellphone,
        ownerPhone: vehicle.ownerPhone
      });
    }
    if (Object.keys(patch).length > 1) plan.vehiclePatches.push(patch);
    else plan.untouchedVehicles.push(vehicle.plate);
  }
  for (const party of parsed.parties) {
    if (existing.parties.has(party.document)) plan.existingParties.push(party.document);
    else plan.newParties.push(party);
  }
  return plan;
}

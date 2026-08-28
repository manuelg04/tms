export type RndcVehicleRow = Record<string, string>;

export type VehicleKind = "cabezote" | "rigido" | "remolque" | "otro";
export type VehicleStatus = "activo" | "archivado";

export type RndcVehicleInput = {
  plate: string;
  vehicleKind: VehicleKind;
  status: VehicleStatus;
  make?: string;
  rndcMakeCode?: string;
  line?: string;
  lineName?: string;
  modelYear?: string;
  color?: string;
  bodyType?: string;
  rndcBodyTypeCode?: string;
  configuration?: string;
  configurationLabel?: string;
  rndcConfigurationCode?: string;
  emptyWeightTn?: string;
  fuelType?: string;
  rndcFuelCode?: string;
  axles?: string;
  ownerDocumentType?: string;
  ownerDocument?: string;
  ownerName?: string;
  possessorDocumentType?: string;
  possessorDocument?: string;
  possessorName?: string;
  insurerNit?: string;
  insurerName?: string;
  soatNumber?: string;
  soatExpiresAt?: string;
  rndcRegisteredAt?: string;
  source: string;
  sourceCompanyNit?: string;
};

export type RejectedRow = { line: number; plate: string; reason: string };

export type ParseResult = {
  vehicles: RndcVehicleInput[];
  rejected: RejectedRow[];
  stats: {
    rows: number;
    byKind: Record<VehicleKind, number>;
    byStatus: Record<VehicleStatus, number>;
    missingPossessor: number;
  };
};

export const REQUIRED_COLUMNS = [
  "NUMPLACA",
  "CONFIGURACIONUNIDADCARGA",
  "FECHAVENCIMIENTOSOAT",
  "NUMIDPROPIETARIO",
  "NUMIDTENEDOR",
  "FECHAINGRESO"
];

export const TRAILER_ACTIVE_MONTHS = 24;

const PLATE_PATTERN = /^[A-Z0-9]{5,7}$/;
const RNDC_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;
const NULL_DATE_PREFIX = "1899-";

function clean(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
}

function cleanCode(value: string | undefined): string | undefined {
  const cleaned = clean(value);
  return cleaned === undefined || cleaned === "." || cleaned === "0" ? undefined : cleaned;
}

export function parseRndcDate(value: string | undefined): string | undefined {
  const cleaned = clean(value);
  if (!cleaned || cleaned.startsWith(NULL_DATE_PREFIX)) {
    return undefined;
  }
  const match = RNDC_DATE_PATTERN.exec(cleaned);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

export function parseRegisteredAt(value: string | undefined): string | undefined {
  const cleaned = clean(value);
  if (!cleaned) {
    return undefined;
  }
  const match = /^(\d{4})\/(\d{2})\/(\d{2})/.exec(cleaned);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

export function splitConfiguration(label: string | undefined): { code?: string; label?: string } {
  const cleaned = clean(label);
  if (!cleaned) {
    return {};
  }
  const separator = cleaned.indexOf(" - ");
  if (separator === -1) {
    return { code: cleaned, label: cleaned };
  }
  return { code: cleaned.slice(0, separator).trim(), label: cleaned };
}

export function classifyKind(configurationCode: string | undefined): VehicleKind {
  if (!configurationCode) {
    return "otro";
  }
  if (/^[SRB]\d/.test(configurationCode)) {
    return "remolque";
  }
  if (/^\d+S$/.test(configurationCode)) {
    return "cabezote";
  }
  if (/^(\d+|CA|V\d)$/.test(configurationCode)) {
    return "rigido";
  }
  return "otro";
}

function monthsBefore(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 - months, day));
  return date.toISOString().slice(0, 10);
}

export function resolveStatus(input: {
  kind: VehicleKind;
  soatExpiresAt?: string;
  registeredAt?: string;
  today: string;
}): VehicleStatus {
  if (input.kind === "remolque") {
    const threshold = monthsBefore(input.today, TRAILER_ACTIVE_MONTHS);
    return input.registeredAt && input.registeredAt >= threshold ? "activo" : "archivado";
  }
  return input.soatExpiresAt && input.soatExpiresAt >= input.today ? "activo" : "archivado";
}

function kilogramsToTons(value: string | undefined): string | undefined {
  const cleaned = clean(value);
  if (!cleaned) {
    return undefined;
  }
  const kg = Number(cleaned);
  if (!Number.isFinite(kg) || kg <= 0) {
    return undefined;
  }
  return String(Math.round((kg / 1000) * 1000) / 1000);
}

function modelYear(value: string | undefined): string | undefined {
  const cleaned = clean(value);
  if (!cleaned) {
    return undefined;
  }
  const year = Number(cleaned);
  return Number.isInteger(year) && year >= 1950 && year <= 2100 ? String(year) : undefined;
}

export function mapRndcVehicleRow(row: RndcVehicleRow, today: string): RndcVehicleInput {
  const plate = (row.NUMPLACA ?? "").trim().toUpperCase();
  const configuration = splitConfiguration(row.CONFIGURACIONUNIDADCARGA);
  const kind = classifyKind(configuration.code);
  const soatExpiresAt = parseRndcDate(row.FECHAVENCIMIENTOSOAT);
  const registeredAt = parseRegisteredAt(row.FECHAINGRESO);
  const lineName = clean(row.LINEAVEHICULOCARGA);

  return {
    plate,
    vehicleKind: kind,
    status: resolveStatus({ kind, soatExpiresAt, registeredAt, today }),
    make: clean(row.MARCAVEHICULOCARGA),
    rndcMakeCode: cleanCode(row.CODMARCAVEHICULOCARGA),
    line: cleanCode(row.CODLINEAVEHICULOCARGA),
    lineName: lineName && lineName.toUpperCase() !== "SIN LINEA" ? lineName : undefined,
    modelYear: modelYear(row.ANOFABRICACIONVEHICULOCARGA),
    color: cleanCode(row.CODCOLORVEHICULOCARGA),
    bodyType: clean(row.TIPOCARROCERIA),
    rndcBodyTypeCode: cleanCode(row.CODTIPOCARROCERIA),
    configuration: configuration.code,
    configurationLabel: configuration.label,
    rndcConfigurationCode: cleanCode(row.CODCONFIGURACIONUNIDADCARGA),
    emptyWeightTn: kilogramsToTons(row.PESOVEHICULOVACIO),
    fuelType: clean(row.TIPOCOMBUSTIBLE),
    rndcFuelCode: cleanCode(row.CODTIPOCOMBUSTIBLE),
    axles: cleanCode(row.NUMEJES),
    ownerDocumentType: clean(row.CODTIPOIDPROPIETARIO),
    ownerDocument: clean(row.NUMIDPROPIETARIO),
    ownerName: clean(row.VEHNOMBREPROP)?.replace(/\s+/g, " "),
    possessorDocumentType: clean(row.CODTIPOIDTENEDOR),
    possessorDocument: clean(row.NUMIDTENEDOR),
    possessorName: clean(row.VEHNOMBRETENENC)?.replace(/\s+/g, " "),
    insurerNit: clean(row.NUMNITASEGURADORASOAT),
    insurerName: clean(row.ASEGURADORASOAT),
    soatNumber: clean(row.NUMSEGUROSOAT),
    soatExpiresAt,
    rndcRegisteredAt: registeredAt,
    source: "rndc-maestro",
    sourceCompanyNit: clean(row.NUMNITEMPRESATRANSPORTE)
  };
}

export function parseRndcVehicleMaestro(text: string, today: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    throw new Error("El archivo está vacío");
  }

  const header = lines[0].split("\t").map((cell) => cell.trim());
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new Error(`Faltan columnas en el maestro RNDC: ${missing.join(", ")}`);
  }

  const result: ParseResult = {
    vehicles: [],
    rejected: [],
    stats: {
      rows: lines.length - 1,
      byKind: { cabezote: 0, rigido: 0, remolque: 0, otro: 0 },
      byStatus: { activo: 0, archivado: 0 },
      missingPossessor: 0
    }
  };
  const seen = new Map<string, number>();

  for (let index = 1; index < lines.length; index++) {
    const cells = lines[index].split("\t");
    const row: RndcVehicleRow = {};
    header.forEach((column, position) => {
      if (column !== "") {
        row[column] = cells[position] ?? "";
      }
    });

    const lineNumber = index + 1;
    const vehicle = mapRndcVehicleRow(row, today);

    if (!PLATE_PATTERN.test(vehicle.plate)) {
      result.rejected.push({ line: lineNumber, plate: vehicle.plate, reason: "placa_invalida" });
      continue;
    }
    const previous = seen.get(vehicle.plate);
    if (previous !== undefined) {
      result.rejected.push({ line: lineNumber, plate: vehicle.plate, reason: `placa_duplicada_linea_${previous}` });
      continue;
    }
    seen.set(vehicle.plate, lineNumber);

    result.vehicles.push(vehicle);
    result.stats.byKind[vehicle.vehicleKind] += 1;
    result.stats.byStatus[vehicle.status] += 1;
    if (!vehicle.possessorDocument) {
      result.stats.missingPossessor += 1;
    }
  }

  return result;
}

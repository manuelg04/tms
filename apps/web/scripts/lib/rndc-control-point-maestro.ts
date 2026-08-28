export type RndcControlPointRow = Record<string, string>;

export type ControlPointType = "bascula" | "fijo" | "alterno" | "otro";
export type ControlPointStatus = "activo" | "inactivo" | "sin_estado";

export type ControlPointInput = {
  code: string;
  name: string;
  controlType: ControlPointType;
  rndcControlType: string;
  status: ControlPointStatus;
  controllerDocument?: string;
  controllerName?: string;
  controllerCode?: string;
  phone?: string;
  address?: string;
  originCityCode?: string;
  originCity?: string;
  destinationCityCode?: string;
  destinationCity?: string;
  latitude?: string;
  longitude?: string;
  calibrationCompany?: string;
  calibrationReport?: string;
  calibratedAt?: string;
  calibrationExpiresAt?: string;
  calibrationValid?: boolean;
  rndcRegisteredAt?: string;
  source: string;
};

export type RejectedRow = { line: number; code: string; reason: string };

export type ParseResult = {
  controlPoints: ControlPointInput[];
  rejected: RejectedRow[];
  stats: {
    rows: number;
    byType: Record<ControlPointType, number>;
    byStatus: Record<ControlPointStatus, number>;
    calibrationValid: number;
    calibrationExpired: number;
    withCoordinates: number;
    swappedCoordinates: number;
  };
};

export const REQUIRED_COLUMNS = ["CODIGOPUESTOCONTROL", "NOMBREPUESTOCONTROL", "TIPOCONTROL", "CODMUNICIPIOORIGEN", "FECHAINGRESO"];

const CONTROL_TYPES: Record<string, ControlPointType> = { PES: "bascula", FIJ: "fijo", ALT: "alterno" };
const STATUSES: Record<string, ControlPointStatus> = { AC: "activo", IN: "inactivo" };
const CODE_PATTERN = /^[A-Z0-9-]{1,20}$/;

function clean(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim().replace(/\s+/g, " ");
  return trimmed === "" ? undefined : trimmed;
}

export function parseRndcDate(value: string | undefined): string | undefined {
  const cleaned = clean(value);
  if (!cleaned || cleaned.startsWith("1899-")) {
    return undefined;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(cleaned);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

export function parseRegisteredAt(value: string | undefined): string | undefined {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})/.exec((value ?? "").trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

export function normalizeCoordinates(latitude: string | undefined, longitude: string | undefined): { latitude?: string; longitude?: string; swapped: boolean } {
  const latText = clean(latitude)?.replace(",", ".");
  const lonText = clean(longitude)?.replace(",", ".");
  const lat = Number(latText);
  const lon = Number(lonText);
  if (!latText || !lonText || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { swapped: false };
  }
  const looksLikeColombia = (a: number, b: number) => a >= -5 && a <= 14 && Math.abs(b) >= 66 && Math.abs(b) <= 80;
  if (looksLikeColombia(lat, lon)) {
    return { latitude: String(lat), longitude: String(-Math.abs(lon)), swapped: false };
  }
  if (looksLikeColombia(lon, lat)) {
    return { latitude: String(lon), longitude: String(-Math.abs(lat)), swapped: true };
  }
  return { swapped: false };
}

export function mapRndcControlPointRow(row: RndcControlPointRow, today: string): ControlPointInput & { swapped: boolean } {
  const rndcControlType = (row.TIPOCONTROL ?? "").trim().toUpperCase();
  const statusCode = (row.ESTADOPUESTOCONTROL ?? "").trim().toUpperCase();
  const coordinates = normalizeCoordinates(row.LATITUD, row.LONGITUD);
  const calibrationExpiresAt = parseRndcDate(row.FECHAVENCECALIBRACION);
  return {
    code: (row.CODIGOPUESTOCONTROL ?? "").trim().toUpperCase(),
    name: clean(row.NOMBREPUESTOCONTROL) ?? "",
    controlType: CONTROL_TYPES[rndcControlType] ?? "otro",
    rndcControlType,
    status: STATUSES[statusCode] ?? "sin_estado",
    controllerDocument: clean(row.NUMIDCONTROLADOR),
    controllerName: clean(row.NOMBRECONTROLADOR),
    controllerCode: clean(row.CODIGOCONTROLADOR),
    phone: clean(row.TELEFONO),
    address: clean(row.DIRECCION),
    originCityCode: clean(row.CODMUNICIPIOORIGEN),
    originCity: clean(row.MUNICIPIOORIGEN),
    destinationCityCode: clean(row.CODMUNICIPIODESTINO),
    destinationCity: clean(row.MUNICIPIODESTINO),
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    calibrationCompany: clean(row.EMPRESACALIBRACION)?.toUpperCase(),
    calibrationReport: clean(row.REPORTECALIBRACION),
    calibratedAt: parseRndcDate(row.FECHACALIBRACION),
    calibrationExpiresAt,
    calibrationValid: calibrationExpiresAt ? calibrationExpiresAt >= today : undefined,
    rndcRegisteredAt: parseRegisteredAt(row.FECHAINGRESO),
    source: "rndc-maestro",
    swapped: coordinates.swapped
  };
}

export function parseRndcControlPointMaestro(text: string, today: string): ParseResult {
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
    controlPoints: [],
    rejected: [],
    stats: {
      rows: lines.length - 1,
      byType: { bascula: 0, fijo: 0, alterno: 0, otro: 0 },
      byStatus: { activo: 0, inactivo: 0, sin_estado: 0 },
      calibrationValid: 0,
      calibrationExpired: 0,
      withCoordinates: 0,
      swappedCoordinates: 0
    }
  };
  const byCode = new Map<string, { index: number; registeredAt: string }>();

  for (let index = 1; index < lines.length; index++) {
    const cells = lines[index].split("\t");
    const row: RndcControlPointRow = {};
    header.forEach((column, position) => {
      if (column !== "") {
        row[column] = cells[position] ?? "";
      }
    });
    const lineNumber = index + 1;
    const { swapped, ...point } = mapRndcControlPointRow(row, today);
    if (!CODE_PATTERN.test(point.code)) {
      result.rejected.push({ line: lineNumber, code: point.code, reason: "codigo_invalido" });
      continue;
    }
    if (point.name === "") {
      result.rejected.push({ line: lineNumber, code: point.code, reason: "nombre_vacio" });
      continue;
    }
    const previous = byCode.get(point.code);
    if (previous) {
      if ((point.rndcRegisteredAt ?? "") >= previous.registeredAt) {
        result.controlPoints[previous.index] = point;
        byCode.set(point.code, { index: previous.index, registeredAt: point.rndcRegisteredAt ?? "" });
      }
      result.rejected.push({ line: lineNumber, code: point.code, reason: "codigo_duplicado_se_conserva_el_mas_reciente" });
      continue;
    }
    byCode.set(point.code, { index: result.controlPoints.length, registeredAt: point.rndcRegisteredAt ?? "" });
    result.controlPoints.push(point);
    if (swapped) {
      result.stats.swappedCoordinates += 1;
    }
  }

  for (const point of result.controlPoints) {
    result.stats.byType[point.controlType] += 1;
    result.stats.byStatus[point.status] += 1;
    if (point.calibrationValid === true) result.stats.calibrationValid += 1;
    if (point.calibrationValid === false) result.stats.calibrationExpired += 1;
    if (point.latitude) result.stats.withCoordinates += 1;
  }
  return result;
}

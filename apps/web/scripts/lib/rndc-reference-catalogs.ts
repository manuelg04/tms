export type RndcCatalogResult<T> = {
  rows: T[];
  rawRows: number;
  deduplicated: number;
};

export type RndcInsurerCatalogRow = {
  insurerNit: string;
  name: string;
  insurerType?: string;
  sourceRegisteredAt: string;
};

export type RndcVehicleLineCatalogRow = {
  makeCode: string;
  makeName?: string;
  lineCode: string;
  lineName?: string;
  grossWeightKg: number;
  sourceRegisteredAt: string;
};

export type RndcPackageCatalogRow = {
  code: string;
  description: string;
  fullDescription: string;
  definition: string;
  minimumEmptyWeightKg: number;
  maximumEmptyWeightKg: number;
  hazardous?: boolean;
  packageTypeCode?: string;
  packageTypeName?: string;
  materialCode?: string;
  materialName?: string;
  operationType: string;
  sourceRegisteredAt: string;
};

export type RndcBodyTypeCatalogRow = {
  code: string;
  description: string;
  sourceRegisteredAt: string;
};

const INSURER_HEADER = ["FECHAINGRESO", "NITASEGURADORA", "NOMBREASEGURADORA", "TIPOASEGURADORA", ""];
const VEHICLE_LINE_HEADER = [
  "FECHAINGRESO",
  "CODIGOMARCA",
  "DESCRIPCIONMARCA",
  "CODIGOLINEA",
  "DESCRIPCIONLINEA",
  "PESOBRUTO",
  ""
];
const PACKAGE_HEADER = [
  "FECHAINGRESO",
  "CODIGO",
  "DESCRIPCION",
  "DESCRIPCIONCOMPLETA",
  "DEFINICION",
  "PESOVACIOMINIMO",
  "PESOVACIOMAXIMO",
  "MERCANCIAPELIGROSA",
  "TIPOEMPAQUE",
  "NOMTIPOEMPAQUE",
  "MATERIALEMPAQUE",
  "NOMMATERIALEMPAQUE",
  "TIPOOPERACION",
  ""
];
const BODY_TYPE_HEADER = ["FECHAINGRESO", "CODIGOCARROCERIA", "CARROCERIADESCRIPCION", ""];
const WINDOWS_1252_C1 = [
  "€",
  "\u0081",
  "‚",
  "ƒ",
  "„",
  "…",
  "†",
  "‡",
  "ˆ",
  "‰",
  "Š",
  "‹",
  "Œ",
  "\u008d",
  "Ž",
  "\u008f",
  "\u0090",
  "‘",
  "’",
  "“",
  "”",
  "•",
  "–",
  "—",
  "˜",
  "™",
  "š",
  "›",
  "œ",
  "\u009d",
  "ž",
  "Ÿ"
] as const;

function decodeWindows1252(bytes: Uint8Array): string {
  return new TextDecoder("windows-1252", { fatal: true })
    .decode(bytes)
    .replace(/[\u0080-\u009f]/g, (character) => WINDOWS_1252_C1[character.charCodeAt(0) - 0x80]);
}

function normalizeText(value: string): string {
  return value.replaceAll("Ã‘", "Ñ").trim().replace(/[\s\u00a0]+/g, " ");
}

function sourceRegisteredAt(value: string): string {
  const match = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Fecha RNDC inválida: ${value}`);
  }
  const parts = match.slice(1).map(Number);
  const [year, month, day, hour, minute, second] = parts;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    throw new Error(`Fecha RNDC inválida: ${value}`);
  }
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
}

function nonNegativeNumber(value: string, label: string): number {
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`El ${label} del maestro RNDC no es un número mayor o igual a cero`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > Number.MAX_SAFE_INTEGER) {
    throw new Error(`El ${label} del maestro RNDC no es un número mayor o igual a cero`);
  }
  return parsed;
}

function limitedText(value: string, label: string, maximumLength: number): string {
  if (value.length > maximumLength) {
    throw new Error(`El campo ${label} supera ${maximumLength} caracteres en el maestro RNDC`);
  }
  return value;
}

function requiredKey(value: string, label: string, maximumLength: number): string {
  if (value === "") {
    throw new Error(`La llave ${label} está vacía en el maestro RNDC`);
  }
  return limitedText(value, label, maximumLength);
}

function numericKey(value: string, label: string): string {
  const key = requiredKey(value, label, 80);
  if (!/^\d+$/.test(key)) {
    throw new Error(`El formato de la llave ${label} no es válido en el maestro RNDC`);
  }
  return key;
}

function packageKey(value: string): string {
  const key = requiredKey(value, "CODIGO", 80);
  if (!/^[A-Z0-9]+$/.test(key)) {
    throw new Error("El formato de la llave CODIGO no es válido en el maestro RNDC");
  }
  return key;
}

function requiredText(value: string, label: string, maximumLength: number): string {
  if (value === "") {
    throw new Error(`El campo ${label} está vacío en el maestro RNDC`);
  }
  return limitedText(value, label, maximumLength);
}

function optionalText(value: string, label: string, maximumLength: number): string | undefined {
  if (value === "") return undefined;
  return limitedText(value, label, maximumLength);
}

function hazardousValue(value: string): boolean | undefined {
  if (value === "") return undefined;
  if (value === "SI") return true;
  if (value === "NO") return false;
  throw new Error(`Valor MERCANCIAPELIGROSA desconocido: ${value}`);
}

function parseCatalogTable(bytes: Uint8Array, expectedHeader: readonly string[]): string[][] {
  const decoded = decodeWindows1252(bytes);
  if (!decoded.endsWith("\r\n")) {
    throw new Error("El archivo RNDC no tiene la terminación CRLF esperada");
  }
  const lines = decoded.split("\r\n");
  lines.pop();
  const header = lines[0]?.split("\t") ?? [];
  if (header.length !== expectedHeader.length || header.some((column, index) => column !== expectedHeader[index])) {
    throw new Error("El archivo no tiene el encabezado exacto del maestro RNDC");
  }
  if (lines.length < 2) {
    throw new Error("El maestro RNDC no contiene filas de datos");
  }
  return lines.slice(1).map((line, index) => {
    const cells = line.split("\t");
    if (cells.length !== expectedHeader.length || cells[cells.length - 1] !== "") {
      throw new Error(`La fila ${index + 2} no tiene la cantidad de columnas esperada`);
    }
    return cells;
  });
}

function deduplicateRows<T extends { sourceRegisteredAt: string }>(
  input: T[],
  keyOf: (row: T) => string
): RndcCatalogResult<T> {
  const rows: T[] = [];
  const indexes = new Map<string, number>();
  let deduplicated = 0;
  for (const row of input) {
    const key = keyOf(row);
    const previousIndex = indexes.get(key);
    if (previousIndex === undefined) {
      indexes.set(key, rows.length);
      rows.push(row);
      continue;
    }
    deduplicated += 1;
    const previous = rows[previousIndex];
    if (row.sourceRegisteredAt === previous.sourceRegisteredAt && JSON.stringify(row) !== JSON.stringify(previous)) {
      throw new Error(`Conflicto RNDC para la llave ${key}: misma fecha con contenido diferente`);
    }
    if (row.sourceRegisteredAt > previous.sourceRegisteredAt) {
      rows[previousIndex] = row;
    }
  }
  return { rows, rawRows: input.length, deduplicated };
}

export function parseRndcInsurerCatalog(bytes: Uint8Array): RndcCatalogResult<RndcInsurerCatalogRow> {
  const tableRows = parseCatalogTable(bytes, INSURER_HEADER);
  const positions = new Map(INSURER_HEADER.map((column, index) => [column, index]));
  const rows = tableRows.map((cells) => {
    const get = (column: string) => normalizeText(cells[positions.get(column) ?? -1] ?? "");
    return {
      insurerNit: numericKey(get("NITASEGURADORA"), "NITASEGURADORA"),
      name: requiredText(get("NOMBREASEGURADORA"), "NOMBREASEGURADORA", 300),
      insurerType: optionalText(get("TIPOASEGURADORA"), "TIPOASEGURADORA", 120),
      sourceRegisteredAt: sourceRegisteredAt(get("FECHAINGRESO"))
    };
  });
  return deduplicateRows(rows, (row) => row.insurerNit);
}

export function parseRndcVehicleLineCatalog(bytes: Uint8Array): RndcCatalogResult<RndcVehicleLineCatalogRow> {
  const tableRows = parseCatalogTable(bytes, VEHICLE_LINE_HEADER);
  const positions = new Map(VEHICLE_LINE_HEADER.map((column, index) => [column, index]));
  const rows = tableRows.map((cells) => {
    const get = (column: string) => normalizeText(cells[positions.get(column) ?? -1] ?? "");
    return {
      makeCode: numericKey(get("CODIGOMARCA"), "CODIGOMARCA"),
      makeName: optionalText(get("DESCRIPCIONMARCA"), "DESCRIPCIONMARCA", 300),
      lineCode: numericKey(get("CODIGOLINEA"), "CODIGOLINEA"),
      lineName: optionalText(get("DESCRIPCIONLINEA"), "DESCRIPCIONLINEA", 300),
      grossWeightKg: nonNegativeNumber(get("PESOBRUTO"), "peso bruto"),
      sourceRegisteredAt: sourceRegisteredAt(get("FECHAINGRESO"))
    };
  });
  return deduplicateRows(rows, (row) => `${row.makeCode}\u0000${row.lineCode}`);
}

export function parseRndcPackageCatalog(bytes: Uint8Array): RndcCatalogResult<RndcPackageCatalogRow> {
  const tableRows = parseCatalogTable(bytes, PACKAGE_HEADER);
  const positions = new Map(PACKAGE_HEADER.map((column, index) => [column, index]));
  const rows = tableRows.map((cells) => {
    const get = (column: string) => normalizeText(cells[positions.get(column) ?? -1] ?? "");
    const hazardous = get("MERCANCIAPELIGROSA");
    const minimumEmptyWeightKg = nonNegativeNumber(get("PESOVACIOMINIMO"), "peso vacío mínimo");
    const maximumEmptyWeightKg = nonNegativeNumber(get("PESOVACIOMAXIMO"), "peso vacío máximo");
    if (minimumEmptyWeightKg > maximumEmptyWeightKg) {
      throw new Error("El peso vacío mínimo supera el máximo en el maestro RNDC");
    }
    return {
      code: packageKey(get("CODIGO")),
      description: requiredText(get("DESCRIPCION"), "DESCRIPCION", 1000),
      fullDescription: requiredText(get("DESCRIPCIONCOMPLETA"), "DESCRIPCIONCOMPLETA", 2000),
      definition: requiredText(get("DEFINICION"), "DEFINICION", 2000),
      minimumEmptyWeightKg,
      maximumEmptyWeightKg,
      hazardous: hazardousValue(hazardous),
      packageTypeCode: optionalText(get("TIPOEMPAQUE"), "TIPOEMPAQUE", 80),
      packageTypeName: optionalText(get("NOMTIPOEMPAQUE"), "NOMTIPOEMPAQUE", 300),
      materialCode: optionalText(get("MATERIALEMPAQUE"), "MATERIALEMPAQUE", 80),
      materialName: optionalText(get("NOMMATERIALEMPAQUE"), "NOMMATERIALEMPAQUE", 300),
      operationType: requiredText(get("TIPOOPERACION"), "TIPOOPERACION", 120),
      sourceRegisteredAt: sourceRegisteredAt(get("FECHAINGRESO"))
    };
  });
  return deduplicateRows(rows, (row) => row.code);
}

export function parseRndcBodyTypeCatalog(bytes: Uint8Array): RndcCatalogResult<RndcBodyTypeCatalogRow> {
  const tableRows = parseCatalogTable(bytes, BODY_TYPE_HEADER);
  const positions = new Map(BODY_TYPE_HEADER.map((column, index) => [column, index]));
  const rows = tableRows.map((cells) => {
    const get = (column: string) => normalizeText(cells[positions.get(column) ?? -1] ?? "");
    return {
      code: numericKey(get("CODIGOCARROCERIA"), "CODIGOCARROCERIA"),
      description: requiredText(get("CARROCERIADESCRIPCION"), "CARROCERIADESCRIPCION", 500),
      sourceRegisteredAt: sourceRegisteredAt(get("FECHAINGRESO"))
    };
  });
  return deduplicateRows(rows, (row) => row.code);
}

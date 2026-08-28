import { normalizeSearchText } from "../../convex/model/searchText.js";

export type DivisionInput = {
  code: string;
  name: string;
  zoneCode: string;
  isMunicipality: boolean;
  onRoad: boolean;
  municipalityCode: string;
  municipalityName: string;
  departmentCode: string;
  departmentName: string;
  latitude?: string;
  longitude?: string;
  searchText: string;
  rndcRegisteredAt?: string;
  source: string;
};

export type RejectedRow = { line: number; code: string; reason: string };

export type ParseResult = {
  divisions: DivisionInput[];
  rejected: RejectedRow[];
  stats: { rows: number; municipalities: number; zones: number; departments: number; withCoordinates: number };
};

export const REQUIRED_COLUMNS = ["CODIGODIVISION", "NOMBREDIVISION", "CODIGOMUNICIPIO", "NOMBREMUNICIPIO", "CODIGODEPTO", "NOMBREDEPTO"];

function clean(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim().replace(/\s+/g, " ");
  return trimmed === "" ? undefined : trimmed;
}

export function titleCase(value: string): string {
  const small = new Set(["de", "del", "la", "las", "los", "y", "el"]);
  return value
    .toLowerCase()
    .split(" ")
    .map((word, index) => (index > 0 && small.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

function parseRegisteredAt(value: string | undefined): string | undefined {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})/.exec((value ?? "").trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

function coordinate(value: string | undefined): string | undefined {
  const text = clean(value)?.replace(",", ".");
  if (!text) return undefined;
  const number = Number(text);
  return Number.isFinite(number) && number !== 0 ? String(number) : undefined;
}

export function parseRndcDivisionMaestro(content: string, sourceDate: string): ParseResult {
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "");
  const header = (lines[0] ?? "").split("\t").map((column) => column.trim());
  for (const column of REQUIRED_COLUMNS) {
    if (!header.includes(column)) {
      throw new Error(`El archivo no tiene la columna ${column}.`);
    }
  }

  const divisions: DivisionInput[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Set<string>();
  const departments = new Set<string>();
  const stats = { rows: 0, municipalities: 0, zones: 0, departments: 0, withCoordinates: 0 };

  for (let index = 1; index < lines.length; index++) {
    const cells = lines[index].split("\t");
    const row: Record<string, string> = {};
    header.forEach((column, position) => {
      row[column] = cells[position] ?? "";
    });
    stats.rows += 1;
    const line = index + 1;

    const rawCode = clean(row.CODIGODIVISION)?.replace(/\D/g, "");
    const municipalityDigits = clean(row.CODIGOMUNICIPIO)?.replace(/\D/g, "");
    const departmentDigits = clean(row.CODIGODEPTO)?.replace(/\D/g, "");
    const zoneName = clean(row.NOMBREZONA);
    const municipalityName = clean(row.NOMBREMUNICIPIO);
    const departmentName = clean(row.NOMBREDEPTO);

    if (!rawCode || rawCode.length < 7 || rawCode.length > 8) {
      rejected.push({ line, code: rawCode ?? "", reason: "Código de división inválido" });
      continue;
    }
    if (!municipalityDigits || !departmentDigits || !municipalityName || !departmentName) {
      rejected.push({ line, code: rawCode, reason: "Faltan municipio o departamento" });
      continue;
    }

    const code = rawCode.padStart(8, "0");
    if (seen.has(code)) {
      rejected.push({ line, code, reason: "Código duplicado" });
      continue;
    }
    seen.add(code);

    const municipalityCode = municipalityDigits.padStart(5, "0");
    const departmentCode = departmentDigits.padStart(2, "0");
    const zoneCode = String(Number(clean(row.CODIGOZONA) ?? code.slice(5)));
    const isMunicipality = code.endsWith("000");
    const name = isMunicipality ? titleCase(municipalityName) : titleCase(zoneName ?? clean(row.NOMBREDIVISION) ?? municipalityName);
    const latitude = coordinate(row.LATITUD);
    const longitude = coordinate(row.LONGITUD);

    if (isMunicipality) stats.municipalities += 1;
    else stats.zones += 1;
    if (latitude && longitude) stats.withCoordinates += 1;
    departments.add(departmentCode);

    divisions.push({
      code,
      name,
      zoneCode,
      isMunicipality,
      onRoad: clean(row.CARRETERA)?.toUpperCase() === "SI",
      municipalityCode,
      municipalityName: titleCase(municipalityName),
      departmentCode,
      departmentName: titleCase(departmentName),
      latitude,
      longitude,
      searchText: normalizeSearchText(name, isMunicipality ? undefined : municipalityName, departmentName, code, municipalityCode),
      rndcRegisteredAt: parseRegisteredAt(row.FECHAINGRESO),
      source: `rndc-maestro-divisiones-${sourceDate}`
    });
  }

  stats.departments = departments.size;
  return { divisions, rejected, stats };
}

import { normalizeSearchText } from "../../convex/model/searchText.js";

export type AvansatDriverInput = {
  document: string;
  documentType: string;
  name: string;
  firstNames: string;
  firstLastName: string;
  secondLastName?: string;
  status: string;
  sex?: string;
  bloodType?: string;
  address?: string;
  city?: string;
  cityCode?: string;
  phone1?: string;
  phone2?: string;
  cellphone?: string;
  licenseNumber?: string;
  licenseCategory?: string;
  licenseExpiresAt?: string;
  eps?: string;
  arp?: string;
  pensionFund?: string;
  observations?: string;
};

export type RejectedDriverRow = { file: string; line: number; document: string; reason: string };

export type DriverWarning = { document: string; field: "cityCode" | "licenseCategory" | "licenseExpiresAt"; value: string; reason: string };

export type CityIndex = Map<string, string[]>;

export type AvansatDriverParseOptions = {
  today: string;
  cities?: CityIndex;
  licenseCategories?: Record<string, string>;
};

export type AvansatDriverParseResult = {
  drivers: AvansatDriverInput[];
  rejected: RejectedDriverRow[];
  warnings: DriverWarning[];
  stats: {
    rows: number;
    drivers: number;
    duplicates: number;
    withCityCode: number;
    withLicenseCategory: number;
    withValidLicense: number;
    createdFrom?: string;
    createdTo?: string;
    byLicenseCategory: Record<string, number>;
  };
};

export const AVANSAT_DRIVER_COLUMNS = ["DOC_CONDUCTOR", "CONDUCTOR", "1APELLIDO", "NRO_LICENCIA", "CAT_LICENCIA", "F_VENCLICENCIA", "F_CREADO"];

export const AVANSAT_LICENSE_CATEGORIES: Record<string, string> = { "7": "C1", "8": "C2", "9": "C3" };

const DOCUMENT_PATTERN = /^\d{5,12}$/;
const RNDC_LICENSE_CATEGORY = /^[ABC][1-3]$/;
const PLACEHOLDERS = new Set(["", ".", "0", "N/A", "NA", "SIN DEFINIR", "NO APLICA", "NINGUNO", "NINGUNA"]);
const BLOOD_TYPE = /^(AB|A|B|O) ?\(?([+-])\)?$/;
const CITY_ALIASES: Record<string, string> = {
  "santiago de cali": "cali",
  "cartagena de indias": "cartagena",
  "san juan de pasto": "pasto",
  "san sebastian de mariquita": "mariquita"
};

function clean(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim().replace(/\s+/g, " ");
  return PLACEHOLDERS.has(trimmed.toUpperCase()) ? undefined : trimmed;
}

function date(value: string | undefined): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec((value ?? "").trim());
  return match && match[1] !== "0000" ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

function sex(value: string | undefined): string | undefined {
  const code = (value ?? "").trim();
  return code === "1" ? "Masculino" : code === "2" ? "Femenino" : undefined;
}

function bloodType(value: string | undefined): string | undefined {
  const match = BLOOD_TYPE.exec((value ?? "").trim().toUpperCase());
  return match ? `${match[1]} (${match[2]})` : undefined;
}

export function cityKey(value: string): string {
  const key = normalizeSearchText(value).replace(/\b(d c|distrito capital)\b/g, "").replace(/\s+/g, " ").trim();
  return CITY_ALIASES[key] ?? key;
}

export function buildCityIndex(divisions: Array<{ code: string; isMunicipality: boolean; municipalityName: string }>): CityIndex {
  const index: CityIndex = new Map();
  for (const division of divisions) {
    if (!division.isMunicipality) continue;
    const key = cityKey(division.municipalityName);
    const codes = index.get(key) ?? [];
    if (!codes.includes(division.code)) codes.push(division.code);
    index.set(key, codes);
  }
  return index;
}

function resolveCity(name: string | undefined, cities: CityIndex | undefined): { code?: string; reason?: string } {
  if (!name || !cities) return {};
  const codes = cities.get(cityKey(name)) ?? cities.get(cityKey(name.split(",")[0]));
  if (!codes) return { reason: "municipio_no_encontrado" };
  if (codes.length > 1) return { reason: "municipio_repetido_en_varios_departamentos" };
  return { code: codes[0] };
}

export function parseAvansatDrivers(files: Array<{ name: string; text: string }>, options: AvansatDriverParseOptions): AvansatDriverParseResult {
  const categories = options.licenseCategories ?? AVANSAT_LICENSE_CATEGORIES;
  const rejected: RejectedDriverRow[] = [];
  const warnings: DriverWarning[] = [];
  const byDocument = new Map<string, { driver: AvansatDriverInput; stamp: string }>();
  const created: string[] = [];
  let rows = 0;
  let duplicates = 0;

  for (const file of files) {
    const lines = file.text.split(/\r?\n/).filter((line) => line.trim() !== "");
    if (lines.length === 0) throw new Error(`${file.name}: el archivo está vacío`);
    const header = lines[0].split("\t").map((cell) => cell.trim());
    const missing = AVANSAT_DRIVER_COLUMNS.filter((column) => !header.includes(column));
    if (missing.length > 0) throw new Error(`${file.name}: faltan columnas ${missing.join(", ")}`);

    for (let index = 1; index < lines.length; index++) {
      const cells = lines[index].split("\t");
      const row: Record<string, string> = {};
      header.forEach((column, position) => {
        if (column !== "") row[column] = cells[position] ?? "";
      });
      rows += 1;
      const line = index + 1;
      const document = (row.DOC_CONDUCTOR ?? "").trim();
      const firstNames = clean(row.CONDUCTOR)?.toUpperCase();
      const firstLastName = clean(row["1APELLIDO"])?.toUpperCase();
      const secondLastName = clean(row["2APELLIDO"])?.toUpperCase();

      if (!DOCUMENT_PATTERN.test(document)) {
        rejected.push({ file: file.name, line, document, reason: "identificacion_invalida" });
        continue;
      }
      if (!firstNames || !firstLastName) {
        rejected.push({ file: file.name, line, document, reason: "nombre_incompleto" });
        continue;
      }

      const city = clean(row.ORIGEN);
      const resolvedCity = resolveCity(city, options.cities);
      const rawCategory = (row.CAT_LICENCIA ?? "").trim().toUpperCase();
      const licenseCategory = RNDC_LICENSE_CATEGORY.test(rawCategory) ? rawCategory : categories[rawCategory];
      const licenseExpiresAt = date(row.F_VENCLICENCIA);
      const reference = [clean(row.NOM_REFPERSONALES), clean(row.TEL_REFPERSONALES)].filter(Boolean).join(" · ");
      const observations = [clean(row.OBS_CONDCUTOR), reference ? `Referencia personal: ${reference}` : undefined].filter(Boolean).join(" | ");

      const driver: AvansatDriverInput = {
        document,
        documentType: "C",
        name: [firstNames, firstLastName, secondLastName].filter(Boolean).join(" "),
        firstNames,
        firstLastName,
        secondLastName,
        status: "Activo",
        sex: sex(row.SEXO),
        bloodType: bloodType(row.GSANGUINEO),
        address: clean(row.DIRECCION),
        city,
        cityCode: resolvedCity.code,
        phone1: clean(row.TELEFONO1),
        phone2: clean(row.TELEFONO2),
        cellphone: clean(row.TELMOVIL),
        licenseNumber: clean(row.NRO_LICENCIA),
        licenseCategory,
        licenseExpiresAt,
        eps: clean(row.EPS),
        arp: clean(row.ARP),
        pensionFund: clean(row.PENSIONES),
        observations: observations || undefined
      };

      const rowWarnings: DriverWarning[] = [];
      if (resolvedCity.reason) rowWarnings.push({ document, field: "cityCode", value: city ?? "", reason: resolvedCity.reason });
      if (!licenseCategory) rowWarnings.push({ document, field: "licenseCategory", value: rawCategory, reason: "categoria_sin_equivalencia" });
      if (!licenseExpiresAt) rowWarnings.push({ document, field: "licenseExpiresAt", value: (row.F_VENCLICENCIA ?? "").trim(), reason: "vencimiento_invalido" });

      const stamp = (row.F_MODIFICADO ?? "").trim() || (row.F_CREADO ?? "").trim();
      const previous = byDocument.get(document);
      if (previous) duplicates += 1;
      if (!previous || stamp >= previous.stamp) {
        byDocument.set(document, { driver, stamp });
        for (let position = warnings.length - 1; position >= 0; position--) {
          if (warnings[position].document === document) warnings.splice(position, 1);
        }
        warnings.push(...rowWarnings);
      }
      const createdAt = date(row.F_CREADO);
      if (createdAt) created.push(createdAt);
    }
  }

  const drivers = [...byDocument.values()].map((entry) => entry.driver);
  const byLicenseCategory: Record<string, number> = {};
  for (const driver of drivers) {
    const key = driver.licenseCategory ?? "sin_categoria";
    byLicenseCategory[key] = (byLicenseCategory[key] ?? 0) + 1;
  }
  created.sort();

  return {
    drivers,
    rejected,
    warnings,
    stats: {
      rows,
      drivers: drivers.length,
      duplicates,
      withCityCode: drivers.filter((driver) => driver.cityCode).length,
      withLicenseCategory: drivers.filter((driver) => driver.licenseCategory).length,
      withValidLicense: drivers.filter((driver) => driver.licenseExpiresAt && driver.licenseExpiresAt >= options.today).length,
      createdFrom: created[0],
      createdTo: created[created.length - 1],
      byLicenseCategory
    }
  };
}

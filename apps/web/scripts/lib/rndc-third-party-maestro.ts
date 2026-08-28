export type RndcThirdPartyRow = Record<string, string>;

export type ThirdPartyRole = "driver" | "owner" | "possessor" | "holder" | "sender" | "recipient" | "other";

export type DriverInput = {
  document: string;
  documentType?: string;
  name?: string;
  address?: string;
  city?: string;
  cityCode?: string;
  phone1?: string;
  cellphone?: string;
  licenseNumber?: string;
  licenseCategory?: string;
  licenseExpiresAt?: string;
};

export type ThirdPartyInput = {
  documentType: string;
  document: string;
  name: string;
  phone?: string;
  cellphone?: string;
  address?: string;
  city?: string;
  cityCode?: string;
  email?: string;
  roles: ThirdPartyRole[];
  siteCount: number;
  rndcRegisteredAt?: string;
  source: string;
};

export type ThirdPartySiteInput = {
  document: string;
  siteCode: string;
  siteName: string;
  address?: string;
  city?: string;
  cityCode?: string;
  latitude?: string;
  longitude?: string;
  rndcRegisteredAt?: string;
};

export type RejectedRow = { line: number; document: string; reason: string };

export type ParseOptions = {
  today: string;
  ownerDocuments?: Set<string>;
  possessorDocuments?: Set<string>;
};

export type ParseResult = {
  drivers: DriverInput[];
  parties: ThirdPartyInput[];
  sites: ThirdPartySiteInput[];
  rejected: RejectedRow[];
  stats: {
    rows: number;
    parties: number;
    sites: number;
    drivers: number;
    driversWithValidLicense: number;
    byDocumentType: Record<string, number>;
    byRole: Record<ThirdPartyRole, number>;
    multiSiteParties: number;
  };
};

export const REQUIRED_COLUMNS = [
  "NUMIDTERCERO",
  "CODTIPOIDTERCERO",
  "NOMIDTERCERO",
  "CODSEDETERCERO",
  "CODMUNICIPIORNDC",
  "FECHAINGRESO"
];

const DOCUMENT_PATTERN = /^[A-Z0-9]{3,20}$/;
const LICENSE_CATEGORY_PATTERN = /^[ABC][1-3]$/;
const PLACEHOLDER_VALUES = new Set(["", ".", "0", "NO DISPONIBLE", ".@.", "N/A", "NA"]);

function clean(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim().replace(/\s+/g, " ");
  return PLACEHOLDER_VALUES.has(trimmed.toUpperCase()) ? undefined : trimmed;
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

export function buildPartyName(row: RndcThirdPartyRow): string {
  const first = clean(row.NOMIDTERCERO) ?? "";
  if ((row.CODTIPOIDTERCERO ?? "").trim().toUpperCase() === "N") {
    return first;
  }
  return [first, clean(row.PRIMERAPELLIDOIDTERCERO), clean(row.SEGUNDOAPELLIDOIDTERCERO)]
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

function licenseCategory(value: string | undefined): string | undefined {
  const cleaned = clean(value)?.toUpperCase();
  return cleaned && LICENSE_CATEGORY_PATTERN.test(cleaned) ? cleaned : undefined;
}

function siteCode(value: string | undefined): string {
  const cleaned = (value ?? "").trim();
  return cleaned === "" ? "0" : cleaned;
}

type Mapped = {
  document: string;
  documentType: string;
  name: string;
  phone?: string;
  cellphone?: string;
  address?: string;
  city?: string;
  cityCode?: string;
  email?: string;
  registeredAt?: string;
  site: ThirdPartySiteInput;
  driver?: DriverInput;
};

export function mapRndcThirdPartyRow(row: RndcThirdPartyRow): Mapped {
  const document = (row.NUMIDTERCERO ?? "").trim().toUpperCase();
  const documentType = (row.CODTIPOIDTERCERO ?? "").trim().toUpperCase();
  const name = buildPartyName(row);
  const phone = clean(row.NUMTELEFONOCONTACTO);
  const cellphone = clean(row.NUMCELULARPERSONA);
  const address = clean(row.NOMENCLATURADIRECCION);
  const city = clean(row.MUNICIPIORNDC);
  const cityCode = clean(row.CODMUNICIPIORNDC);
  const registeredAt = parseRegisteredAt(row.FECHAINGRESO);
  const category = licenseCategory(row.CODCATEGORIALICENCIACONDUCCION);

  const site: ThirdPartySiteInput = {
    document,
    siteCode: siteCode(row.CODSEDETERCERO),
    siteName: clean(row.NOMSEDETERCERO) ?? city ?? address ?? "Principal",
    address,
    city,
    cityCode,
    latitude: clean(row.LATITUD),
    longitude: clean(row.LONGITUD),
    rndcRegisteredAt: registeredAt
  };

  const driver: DriverInput | undefined = category
    ? {
        document,
        documentType,
        name,
        address,
        city,
        cityCode,
        phone1: phone,
        cellphone,
        licenseNumber: clean(row.NUMLICENCIACONDUCCION),
        licenseCategory: category,
        licenseExpiresAt: parseRndcDate(row.FECHAVENCIMIENTOLICENCIA)
      }
    : undefined;

  return { document, documentType, name, phone, cellphone, address, city, cityCode, email: clean(row.EMAILTERCERO), registeredAt, site, driver };
}

export function parseRndcThirdPartyMaestro(text: string, options: ParseOptions): ParseResult {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    throw new Error("El archivo está vacío");
  }
  const header = lines[0].split("\t").map((cell) => cell.trim());
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new Error(`Faltan columnas en el maestro RNDC: ${missing.join(", ")}`);
  }

  const rejected: RejectedRow[] = [];
  const mappedByDocument = new Map<string, Mapped[]>();
  const rows = lines.length - 1;

  for (let index = 1; index < lines.length; index++) {
    const cells = lines[index].split("\t");
    const row: RndcThirdPartyRow = {};
    header.forEach((column, position) => {
      if (column !== "") {
        row[column] = cells[position] ?? "";
      }
    });
    const mapped = mapRndcThirdPartyRow(row);
    const lineNumber = index + 1;
    if (!DOCUMENT_PATTERN.test(mapped.document)) {
      rejected.push({ line: lineNumber, document: mapped.document, reason: "identificacion_invalida" });
      continue;
    }
    if (mapped.documentType === "") {
      rejected.push({ line: lineNumber, document: mapped.document, reason: "tipo_identificacion_vacio" });
      continue;
    }
    if (mapped.name === "" && mapped.documentType === "N") {
      mapped.name = `NIT ${mapped.document} (sin nombre en RNDC)`;
    }
    if (mapped.name === "") {
      rejected.push({ line: lineNumber, document: mapped.document, reason: "nombre_vacio" });
      continue;
    }
    const group = mappedByDocument.get(mapped.document) ?? [];
    group.push(mapped);
    mappedByDocument.set(mapped.document, group);
  }

  const result: ParseResult = {
    drivers: [],
    parties: [],
    sites: [],
    rejected,
    stats: {
      rows,
      parties: 0,
      sites: 0,
      drivers: 0,
      driversWithValidLicense: 0,
      byDocumentType: {},
      byRole: { driver: 0, owner: 0, possessor: 0, holder: 0, sender: 0, recipient: 0, other: 0 },
      multiSiteParties: 0
    }
  };

  for (const [document, group] of mappedByDocument) {
    const sitesByCode = new Map<string, ThirdPartySiteInput>();
    for (const mapped of group) {
      const previous = sitesByCode.get(mapped.site.siteCode);
      if (!previous || (mapped.registeredAt ?? "") >= (previous.rndcRegisteredAt ?? "")) {
        sitesByCode.set(mapped.site.siteCode, mapped.site);
      }
    }
    const sites = [...sitesByCode.values()].sort((a, b) => Number(a.siteCode) - Number(b.siteCode));
    const main = group.find((mapped) => mapped.site.siteCode === "0") ?? group[0];
    const driverRows = group.filter((mapped) => mapped.driver);
    const driver = driverRows.sort((a, b) => (b.registeredAt ?? "").localeCompare(a.registeredAt ?? ""))[0]?.driver;

    const roles = new Set<ThirdPartyRole>();
    if (driver) {
      roles.add("driver");
    }
    if (options.ownerDocuments?.has(document)) {
      roles.add("owner");
    }
    if (options.possessorDocuments?.has(document)) {
      roles.add("possessor");
    }
    if (roles.size === 0) {
      roles.add(main.documentType === "N" || sites.length > 1 ? "sender" : "other");
    }

    const party: ThirdPartyInput = {
      documentType: main.documentType,
      document,
      name: main.name,
      phone: main.phone ?? group.map((item) => item.phone).find(Boolean),
      cellphone: main.cellphone ?? group.map((item) => item.cellphone).find(Boolean),
      address: main.address,
      city: main.city,
      cityCode: main.cityCode,
      email: main.email ?? group.map((item) => item.email).find(Boolean),
      roles: [...roles],
      siteCount: sites.length,
      rndcRegisteredAt: group.map((item) => item.registeredAt ?? "").sort()[0] || undefined,
      source: "rndc-maestro"
    };

    result.parties.push(party);
    result.sites.push(...sites);
    if (driver) {
      result.drivers.push(driver);
      result.stats.drivers += 1;
      if (driver.licenseExpiresAt && driver.licenseExpiresAt >= options.today) {
        result.stats.driversWithValidLicense += 1;
      }
    }
    result.stats.byDocumentType[party.documentType] = (result.stats.byDocumentType[party.documentType] ?? 0) + 1;
    for (const role of roles) {
      result.stats.byRole[role] += 1;
    }
    if (sites.length > 1) {
      result.stats.multiSiteParties += 1;
    }
  }

  result.stats.parties = result.parties.length;
  result.stats.sites = result.sites.length;
  return result;
}

export function collectVehicleParties(vehicleMaestroText: string): { owners: Set<string>; possessors: Set<string> } {
  const lines = vehicleMaestroText.split(/\r?\n/).filter((line) => line.trim() !== "");
  const header = lines[0]?.split("\t").map((cell) => cell.trim()) ?? [];
  const ownerIndex = header.indexOf("NUMIDPROPIETARIO");
  const possessorIndex = header.indexOf("NUMIDTENEDOR");
  if (ownerIndex === -1 || possessorIndex === -1) {
    throw new Error("El maestro de vehículos no trae NUMIDPROPIETARIO/NUMIDTENEDOR");
  }
  const owners = new Set<string>();
  const possessors = new Set<string>();
  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    const owner = (cells[ownerIndex] ?? "").trim().toUpperCase();
    const possessor = (cells[possessorIndex] ?? "").trim().toUpperCase();
    if (owner) owners.add(owner);
    if (possessor) possessors.add(possessor);
  }
  return { owners, possessors };
}

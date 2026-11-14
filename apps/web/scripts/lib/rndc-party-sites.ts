export type PartySiteInput = {
  document: string;
  siteCode: string;
  siteName: string;
  address?: string;
  cityCode?: string;
  latitude?: string;
  longitude?: string;
};

export type PartySitesSummary = {
  parties: number;
  partiesWithoutSites: string[];
  failedLookups: string[];
  sites: number;
  withCoordinates: number;
  withoutCoordinates: number;
};

export type PartySitesFile = { sites: PartySiteInput[]; summary: PartySitesSummary };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

export function parsePartySitesLookup(content: string): PartySitesFile {
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed) || !Array.isArray(parsed.results)) {
    throw new Error("El archivo no es un resultado de rndc:lookup-sites.");
  }
  if (parsed.mode !== "live" || parsed.environment !== "primary") {
    throw new Error("El archivo no viene del RNDC real (modo live, ambiente primary): no se carga.");
  }
  const sites = new Map<string, PartySiteInput>();
  const summary: PartySitesSummary = { parties: 0, partiesWithoutSites: [], failedLookups: [], sites: 0, withCoordinates: 0, withoutCoordinates: 0 };
  for (const result of parsed.results) {
    if (!isRecord(result)) continue;
    const id = text(result.id) ?? "";
    summary.parties += 1;
    if (result.ok !== true) {
      summary.failedLookups.push(id);
      continue;
    }
    const rows = Array.isArray(result.sites) ? result.sites.filter(isRecord) : [];
    if (rows.length === 0) summary.partiesWithoutSites.push(id);
    for (const row of rows) {
      const document = text(row.id);
      const siteCode = text(row.siteCode);
      if (!document || !siteCode) continue;
      const latitude = text(row.latitude);
      const longitude = text(row.longitude);
      const address = text(row.address);
      sites.set(`${document}:${siteCode}`, {
        document,
        siteCode,
        siteName: text(row.siteName) ?? address ?? "Principal",
        address,
        cityCode: text(row.cityCode),
        latitude: latitude && longitude ? latitude : undefined,
        longitude: latitude && longitude ? longitude : undefined
      });
    }
  }
  const list = [...sites.values()];
  summary.sites = list.length;
  summary.withCoordinates = list.filter((site) => site.latitude && site.longitude).length;
  summary.withoutCoordinates = list.length - summary.withCoordinates;
  return { sites: list, summary };
}

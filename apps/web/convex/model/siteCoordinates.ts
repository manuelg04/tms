import type { PartyDraft } from "./dispatchWorkflow";
import { placeMatches, type RouteEnd, type TripRoute } from "./tripRoute";

export type SiteRecord = {
  document: string;
  siteCode: string;
  siteName?: string;
  cityCode?: string;
  city?: string;
  latitude?: string;
  longitude?: string;
};

type SiteLike = Pick<SiteRecord, "siteCode" | "siteName" | "cityCode" | "city" | "latitude" | "longitude">;

function text(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed || undefined;
}

function coordinate(value: string | undefined): number | undefined {
  const trimmed = text(value);
  if (!trimmed) return undefined;
  const number = Number(trimmed.replace(",", "."));
  return Number.isFinite(number) && number !== 0 ? number : undefined;
}

export function hasSiteCoordinates(site: Pick<SiteRecord, "latitude" | "longitude"> | null | undefined): boolean {
  return coordinate(site?.latitude) !== undefined && coordinate(site?.longitude) !== undefined;
}

function sitePlace(site: SiteLike): RouteEnd {
  return { code: text(site.cityCode), city: text(site.city) };
}

export function siteInPlace(site: SiteLike, place: RouteEnd | undefined): boolean {
  return Boolean(place && (place.code || place.city) && placeMatches(sitePlace(site), place));
}

function bySiteCode(left: SiteLike, right: SiteLike): number {
  return Number(left.siteCode) - Number(right.siteCode) || left.siteCode.localeCompare(right.siteCode);
}

export function rankSites<T extends SiteLike>(sites: ReadonlyArray<T>, place?: RouteEnd): T[] {
  const score = (site: T) => (siteInPlace(site, place) ? 0 : 2) + (hasSiteCoordinates(site) ? 0 : 1);
  return [...sites].sort((left, right) => score(left) - score(right) || bySiteCode(left, right));
}

export function preferredSite<T extends SiteLike>(sites: ReadonlyArray<T>, place?: RouteEnd): T | undefined {
  if (sites.length === 1) return sites[0];
  const local = sites.filter((site) => siteInPlace(site, place));
  if (local.length === 1) return local[0];
  const located = local.filter((site) => hasSiteCoordinates(site));
  return located.length === 1 ? located[0] : undefined;
}

export function siteAlternatives<T extends SiteLike>(sites: ReadonlyArray<T>, current: SiteLike | undefined, place?: RouteEnd): T[] {
  const target = place && (place.code || place.city) ? place : current ? sitePlace(current) : undefined;
  return rankSites(
    sites.filter((site) => site.siteCode.trim() !== current?.siteCode.trim() && hasSiteCoordinates(site) && siteInPlace(site, target)),
    target
  );
}

function siteLabel(site: SiteLike): string {
  const name = text(site.siteName);
  return name ? `${site.siteCode} · ${name}` : site.siteCode;
}

export function siteAlternativesText(alternatives: ReadonlyArray<SiteLike>): string | undefined {
  if (alternatives.length === 0) return undefined;
  const shown = alternatives.slice(0, 3).map(siteLabel);
  return alternatives.length === 1
    ? `La sede ${shown[0]} queda en el mismo municipio y sí las tiene`
    : `Estas sedes quedan en el mismo municipio y sí las tienen: ${shown.join(", ")}`;
}

export function tripIsMonitored(manifest: { monitoringCompanyNit?: string } | null | undefined): boolean {
  return !manifest || Boolean(text(manifest.monitoringCompanyNit));
}

function coordinateWarning(
  role: "remitente" | "destinatario",
  code: "REM502" | "REM503",
  party: PartyDraft | undefined,
  place: RouteEnd,
  sites: ReadonlyArray<SiteRecord>
): string | null {
  const document = text(party?.identificationNumber);
  const siteCode = text(party?.siteCode);
  if (!document || !siteCode) return null;
  const own = sites.filter((row) => row.document.trim() === document);
  const site = own.find((row) => row.siteCode.trim() === siteCode);
  if (site && hasSiteCoordinates(site)) return null;
  const alternative = siteAlternativesText(siteAlternatives(own, site ?? { siteCode }, place));
  const next = alternative
    ? `${alternative}`
    : "Si ya las tiene en el RNDC puedes emitir; si no, hay que registrarle las coordenadas antes de emitir";
  return `La sede ${site ? siteLabel(site) : siteCode} del ${role} no tiene coordenadas en los datos del RNDC que conoce el TMS y el viaje lleva monitoreo GPS: el RNDC puede rechazar la remesa (${code}). ${next}`;
}

export function siteCoordinateWarnings(
  parties: { sender?: PartyDraft; recipient?: PartyDraft },
  route: TripRoute,
  sites: ReadonlyArray<SiteRecord>,
  monitored: boolean
): string[] {
  if (!monitored) return [];
  return [
    coordinateWarning("remitente", "REM502", parties.sender, route.origin, sites),
    coordinateWarning("destinatario", "REM503", parties.recipient, route.destination, sites)
  ].filter((warning): warning is string => warning !== null);
}

import {
  effectiveConsignment,
  normalizeManifestType,
  type ConsignmentDraft,
  type LoadingOrderDraft,
  type ManifestDraft,
  type PartyDraft,
  type SiteAppointmentDraft
} from "./dispatchWorkflow";

export type RouteEnd = { code?: string; city?: string };
export type TripRoute = { origin: RouteEnd; destination: RouteEnd };
export type SiteCity = { document: string; siteCode: string; cityCode?: string; city?: string };

const URBAN_MANIFEST_TYPES = new Set(["U", "V"]);

function text(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed || undefined;
}

function cityKey(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function codeKey(value: string | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length > 5 ? digits.padStart(8, "0").slice(0, 5) : digits.padStart(5, "0");
}

function end(site: SiteAppointmentDraft | undefined, party: PartyDraft | undefined): RouteEnd {
  return {
    code: text(site?.municipalityCode) ?? text(party?.municipalityCode),
    city: text(site?.cityName) ?? text(party?.cityName)
  };
}

function known(value: RouteEnd): boolean {
  return Boolean(value.code || value.city);
}

export function orderRoute(order: LoadingOrderDraft | null | undefined): TripRoute {
  return { origin: end(order?.loading, order?.sender), destination: end(order?.unloading, order?.recipient) };
}

export function consignmentRoute(draft: ConsignmentDraft | null | undefined, order: LoadingOrderDraft | null | undefined): TripRoute {
  const effective = effectiveConsignment(draft ?? {}, order);
  return { origin: end(effective.loading, effective.sender), destination: end(effective.unloading, effective.recipient) };
}

export function tripRoute(
  order: LoadingOrderDraft | null | undefined,
  consignments: ReadonlyArray<ConsignmentDraft | null | undefined>,
  fallback?: Partial<TripRoute>
): TripRoute {
  const current = consignments.length > 0 ? consignmentRoute(consignments[0], order) : orderRoute(order);
  const complete = (value: RouteEnd, other: RouteEnd | undefined): RouteEnd => {
    if (!known(value)) return other ?? {};
    if (!other || !sameEnd(value, other)) return value;
    return { code: value.code ?? other.code, city: value.city ?? other.city };
  };
  return { origin: complete(current.origin, fallback?.origin), destination: complete(current.destination, fallback?.destination) };
}

function sameCity(left: RouteEnd, right: RouteEnd): boolean {
  return Boolean(left.city && right.city && cityKey(left.city) === cityKey(right.city));
}

export function sameMunicipality(route: TripRoute): boolean {
  const { origin, destination } = route;
  if (origin.code && destination.code) return codeKey(origin.code) === codeKey(destination.code);
  return sameCity(origin, destination);
}

export function sameEnd(left: RouteEnd, right: RouteEnd): boolean {
  if (!known(left) || !known(right)) return true;
  if (left.code && right.code) return codeKey(left.code) === codeKey(right.code);
  if (left.city && right.city) return cityKey(left.city) === cityKey(right.city);
  return true;
}

function cityLabel(value: RouteEnd): string {
  return value.city ?? value.code ?? "sin definir";
}

export function routeLabel(route: TripRoute): string {
  return `${cityLabel(route.origin)} → ${cityLabel(route.destination)}`;
}

export function consignmentRouteBlockers(draft: ConsignmentDraft | null | undefined, order: LoadingOrderDraft | null | undefined): string[] {
  if (!draft) return [];
  const route = consignmentRoute(draft, order);
  if (draft.consignmentClass === "municipal" || !known(route.origin) || !known(route.destination) || !sameMunicipality(route)) return [];
  return [`Origen y destino son el mismo municipio (${cityLabel(route.origin)}). Corrige el destino o, si el viaje es urbano, marca Remesa municipal`];
}

export function manifestRouteBlockers(manifest: ManifestDraft | null | undefined, route: TripRoute | undefined): string[] {
  if (!manifest || !route || !known(route.origin) || !known(route.destination) || !sameMunicipality(route)) return [];
  const type = normalizeManifestType(manifest.manifestType);
  const urban = manifest.operationScope === "municipal" && Boolean(type && URBAN_MANIFEST_TYPES.has(type));
  if (urban) return [];
  return [`El manifiesto saldría con origen y destino en el mismo municipio (${cityLabel(route.origin)}). Corrige el destino en la orden o en la remesa; si el viaje es urbano usa alcance Municipal y tipo Viaje municipal o urbano`];
}

function siteMismatch(
  role: "remitente" | "destinatario",
  action: "cargue" | "descargue",
  party: PartyDraft | undefined,
  place: RouteEnd,
  sites: ReadonlyArray<SiteCity>
): string | null {
  const document = text(party?.identificationNumber);
  const siteCode = text(party?.siteCode);
  if (!document || !siteCode || !known(place)) return null;
  const site = sites.find((row) => row.document.trim() === document && row.siteCode.trim() === siteCode);
  if (!site || (!site.cityCode && !site.city)) return null;
  const siteEnd: RouteEnd = { code: text(site.cityCode), city: text(site.city) };
  const comparisons: boolean[] = [];
  if (siteEnd.code && place.code) comparisons.push(codeKey(siteEnd.code) === codeKey(place.code));
  if (siteEnd.city && place.city) comparisons.push(cityKey(siteEnd.city) === cityKey(place.city));
  if (comparisons.length === 0 || comparisons.some(Boolean)) return null;
  return `La sede ${siteCode} del ${role} queda en ${cityLabel(siteEnd)}, pero el municipio de ${action} es ${cityLabel(place)}. Elige la sede de ese municipio o corrige el municipio`;
}

export function siteRouteBlockers(
  parties: { sender?: PartyDraft; recipient?: PartyDraft },
  route: TripRoute,
  sites: ReadonlyArray<SiteCity>
): string[] {
  return [
    siteMismatch("remitente", "cargue", parties.sender, route.origin, sites),
    siteMismatch("destinatario", "descargue", parties.recipient, route.destination, sites)
  ].filter((blocker): blocker is string => blocker !== null);
}

export type RouteSource = { label: string; route: TripRoute; emitted: boolean };

export function routeDifferences(sources: ReadonlyArray<RouteSource>): string[] {
  const reference = sources.find((source) => !source.emitted) ?? sources[0];
  if (!reference) return [];
  return sources
    .filter((source) => source !== reference && (!sameEnd(source.route.origin, reference.route.origin) || !sameEnd(source.route.destination, reference.route.destination)))
    .map((source) =>
      source.emitted
        ? `${source.label} ya quedó con ${routeLabel(source.route)} y ${reference.label.toLowerCase()} dice ${routeLabel(reference.route)}. Revisa cuál es el correcto: lo ya emitido solo cambia corrigiendo o anulando`
        : `${source.label} dice ${routeLabel(source.route)} y ${reference.label.toLowerCase()} dice ${routeLabel(reference.route)}`
    );
}

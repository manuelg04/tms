import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { effectiveConsignment, type ConsignmentDraft, type LoadingOrderDraft, type PartyDraft } from "./dispatchWorkflow";
import { siteCoordinateWarnings, tripIsMonitored, type SiteRecord } from "./siteCoordinates";
import { consignmentRoute, orderRoute, routeDifferences, siteRouteBlockers, tripRoute, type RouteEnd, type RouteSource, type TripRoute } from "./tripRoute";

type LocationCity = { city?: string; municipalityCode?: string } | null | undefined;

function locationEnd(location: LocationCity): RouteEnd {
  return { city: location?.city, code: location?.municipalityCode };
}

function firstKnown(...ends: RouteEnd[]): RouteEnd {
  return ends.find((item) => Boolean(item.code || item.city)) ?? {};
}

export function expedienteRoute(
  expediente: Pick<Doc<"expedientes">, "loadingOrderDraft" | "manifestDraft">,
  remesas: ReadonlyArray<Pick<Doc<"expedienteRemesas">, "draft">>,
  locations?: { loading?: LocationCity; unloading?: LocationCity }
): TripRoute {
  const manifest = expediente.manifestDraft;
  return tripRoute(
    (expediente.loadingOrderDraft ?? null) as LoadingOrderDraft | null,
    remesas.map((remesa) => (remesa.draft ?? null) as ConsignmentDraft | null),
    {
      origin: firstKnown({ code: manifest?.originMunicipalityCode, city: manifest?.originCityName }, locationEnd(locations?.loading)),
      destination: firstKnown({ code: manifest?.destinationMunicipalityCode, city: manifest?.destinationCityName }, locationEnd(locations?.unloading))
    }
  );
}

export async function loadPartySites(
  ctx: Pick<QueryCtx, "db">,
  organizationId: Id<"organizations">,
  parties: ReadonlyArray<PartyDraft | undefined>
): Promise<SiteRecord[]> {
  const documents = new Set<string>();
  for (const party of parties) {
    const document = party?.identificationNumber?.trim();
    if (document && party?.siteCode?.trim()) documents.add(document);
  }
  const rows = await Promise.all(
    [...documents].map((document) =>
      ctx.db
        .query("thirdPartySites")
        .withIndex("by_organization_and_document_and_site", (q) => q.eq("organizationId", organizationId).eq("document", document))
        .take(200)
    )
  );
  return rows.flat().map((row) => ({
    document: row.document,
    siteCode: row.siteCode,
    siteName: row.siteName,
    cityCode: row.cityCode,
    city: row.city,
    latitude: row.latitude,
    longitude: row.longitude
  }));
}

export async function expedienteRouteReview(
  ctx: Pick<QueryCtx, "db">,
  expediente: Doc<"expedientes">,
  remesas: ReadonlyArray<Doc<"expedienteRemesas">>,
  states: { orderEmitted: boolean; manifestEmitted: boolean },
  locations?: { loading?: LocationCity; unloading?: LocationCity }
): Promise<{ route: TripRoute; siteBlockers: string[]; differences: string[]; coordinateWarnings: string[] }> {
  const order = (expediente.loadingOrderDraft ?? null) as LoadingOrderDraft | null;
  const route = expedienteRoute(expediente, remesas, locations);
  const effective = remesas.map((remesa) => effectiveConsignment((remesa.draft ?? {}) as ConsignmentDraft, order));
  const sites = await loadPartySites(ctx, expediente.organizationId, [order?.sender, order?.recipient, ...effective.flatMap((item) => [item.sender, item.recipient])]);
  const siteBlockers = new Set<string>();
  const coordinateWarnings = new Set<string>();
  const monitored = tripIsMonitored(expediente.manifestDraft);
  if (order && remesas.length === 0) {
    for (const warning of siteCoordinateWarnings({ sender: order.sender, recipient: order.recipient }, orderRoute(order), sites, monitored)) coordinateWarnings.add(warning);
  }
  if (order && !states.orderEmitted) {
    for (const blocker of siteRouteBlockers({ sender: order.sender, recipient: order.recipient }, orderRoute(order), sites)) siteBlockers.add(blocker);
  }
  remesas.forEach((remesa, index) => {
    if (remesa.officialState !== "draft" && remesa.officialState !== "pending") return;
    const item = effective[index];
    const itemRoute = consignmentRoute(remesa.draft as ConsignmentDraft | undefined, order);
    for (const blocker of siteRouteBlockers({ sender: item.sender, recipient: item.recipient }, itemRoute, sites)) siteBlockers.add(blocker);
    for (const warning of siteCoordinateWarnings({ sender: item.sender, recipient: item.recipient }, itemRoute, sites, monitored)) coordinateWarnings.add(warning);
  });
  const sources: RouteSource[] = [];
  if (order) sources.push({ label: "La orden de cargue", route: orderRoute(order), emitted: states.orderEmitted });
  remesas.forEach((remesa) => {
    sources.push({
      label: `La remesa ${remesa.number ?? remesa.sequence}`,
      route: consignmentRoute(remesa.draft as ConsignmentDraft | undefined, order),
      emitted: remesa.officialState === "authorized" || remesa.officialState === "fulfilled"
    });
  });
  const manifest = expediente.manifestDraft;
  if (states.manifestEmitted && manifest && (manifest.originMunicipalityCode || manifest.destinationMunicipalityCode)) {
    sources.push({
      label: "El manifiesto",
      route: {
        origin: { code: manifest.originMunicipalityCode, city: manifest.originCityName },
        destination: { code: manifest.destinationMunicipalityCode, city: manifest.destinationCityName }
      },
      emitted: true
    });
  }
  return { route, siteBlockers: [...siteBlockers], differences: routeDifferences(sources), coordinateWarnings: [...coordinateWarnings] };
}

export async function syncTripRoute(ctx: MutationCtx, expedienteId: Id<"expedientes">): Promise<void> {
  const expediente = await ctx.db.get("expedientes", expedienteId);
  if (!expediente?.tripId) return;
  const [trip, remesas] = await Promise.all([
    ctx.db.get("trips", expediente.tripId),
    ctx.db
      .query("expedienteRemesas")
      .withIndex("by_expediente_and_sequence", (q) => q.eq("expedienteId", expediente._id))
      .collect()
  ]);
  if (!trip) return;
  const route = expedienteRoute(expediente, remesas);
  const originCity = route.origin.city ?? trip.originCity;
  const destinationCity = route.destination.city ?? trip.destinationCity;
  if (originCity !== trip.originCity || destinationCity !== trip.destinationCity) {
    await ctx.db.patch("trips", trip._id, { originCity, destinationCity, updatedAt: Date.now() });
  }
}

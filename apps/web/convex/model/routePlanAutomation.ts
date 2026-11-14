type RouteCandidate = { _id: string; origin: string; destination: string; originCode?: string; destinationCode?: string };
type TripCity = { city: string; code?: string };

export type AutomaticRouteChoice<Id> =
  | { status: "none"; suggestedRouteId: null }
  | { status: "single"; suggestedRouteId: Id }
  | { status: "several"; suggestedRouteId: Id | null };

export function routeCityKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, "")
    .split(",")[0]
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function tripRouteCandidates<Route extends RouteCandidate>(routes: Route[], origin: string | TripCity, destination: string | TripCity): Route[] {
  const from = typeof origin === "string" ? { city: origin } : origin;
  const to = typeof destination === "string" ? { city: destination } : destination;
  const ranked = routes
    .map((route) => ({
      route,
      originRank: cityRank(route.origin, route.originCode, from),
      destinationRank: cityRank(route.destination, route.destinationCode, to)
    }))
    .filter((entry) => entry.originRank > 0 && entry.destinationRank > 0);
  const best = Math.max(0, ...ranked.map((entry) => entry.originRank + entry.destinationRank));
  return ranked.filter((entry) => entry.originRank + entry.destinationRank === best).map((entry) => entry.route);
}

function cityRank(routeCity: string, routeCode: string | undefined, trip: TripCity): number {
  const tripCode = codeKey(trip.code);

  if (tripCode && tripCode === codeKey(routeCode)) {
    return 4;
  }

  const routeKey = routeCityKey(routeCity);
  const tripKey = routeCityKey(trip.city);

  if (!routeKey || !tripKey) {
    return 0;
  }

  if (routeKey === tripKey) {
    return 3;
  }

  if (tripKey.startsWith(`${routeKey} `)) {
    return 2;
  }

  return routeKey.includes(tripKey) ? 1 : 0;
}

function codeKey(value: string | undefined): string {
  return (value ?? "").replace(/\D/g, "").replace(/^0+/, "");
}

export function automaticRouteChoice<Route extends { _id: unknown }>(
  candidates: Route[],
  lastUsedRouteId: Route["_id"] | null
): AutomaticRouteChoice<Route["_id"]> {
  if (candidates.length === 0) {
    return { status: "none", suggestedRouteId: null };
  }

  if (candidates.length === 1) {
    return { status: "single", suggestedRouteId: candidates[0]._id };
  }

  const remembered = candidates.find((route) => route._id === lastUsedRouteId);
  return { status: "several", suggestedRouteId: remembered ? remembered._id : null };
}

export function bogotaDeparture(now: number): string {
  return new Date(now - 5 * 3600000).toISOString().slice(0, 16);
}

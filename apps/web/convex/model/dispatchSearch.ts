export const dispatchFilterKeys = [
  "search",
  "customer",
  "plate",
  "driver",
  "origin",
  "destination",
  "stage",
  "status",
  "from",
  "to"
] as const;

export type DispatchFilterKey = typeof dispatchFilterKeys[number];

export type DispatchFilters = Partial<Record<DispatchFilterKey, string>>;

export type DispatchSearchRow = {
  id: string;
  code: string;
  customerName: string;
  originCity: string;
  destinationCity: string;
  vehiclePlate?: string;
  driverName?: string;
  stage: string;
  rndcStatus: string;
  orderState: string;
  remesaStates: string[];
  manifestState: string;
  updatedAt: number;
  searchText: string;
};

const queryNames: Record<DispatchFilterKey, string> = {
  search: "q",
  customer: "customer",
  plate: "plate",
  driver: "driver",
  origin: "origin",
  destination: "destination",
  stage: "stage",
  status: "status",
  from: "from",
  to: "to"
};

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/\s+/g, " ")
    .trim();
}

export function applyDispatchFilters<T extends DispatchSearchRow>(rows: readonly T[], filters: DispatchFilters): T[] {
  const normalized = normalizeDispatchFilters(filters);
  const searchTerms = normalizeSearchText(normalized.search ?? "").split(" ").filter(Boolean);
  const from = normalized.from ? Date.parse(`${normalized.from}T00:00:00-05:00`) : undefined;
  const to = normalized.to ? Date.parse(`${normalized.to}T23:59:59.999-05:00`) : undefined;

  return rows
    .filter((row) => {
      const searchText = normalizeSearchText(row.searchText);
      return searchTerms.every((term) => searchText.includes(term))
        && matches(row.customerName, normalized.customer)
        && matches(row.vehiclePlate, normalized.plate)
        && matches(row.driverName, normalized.driver)
        && matches(row.originCity, normalized.origin)
        && matches(row.destinationCity, normalized.destination)
        && (!normalized.stage || (normalized.stage === "pending_manifest"
          ? isAuthorized(row.orderState) && !isAuthorized(row.manifestState)
          : row.stage === normalized.stage))
        && (!normalized.status || row.rndcStatus === normalized.status)
        && (from === undefined || row.updatedAt >= from)
        && (to === undefined || row.updatedAt <= to);
    })
    .sort((left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id));
}

function isAuthorized(state: string): boolean {
  return state === "authorized" || state === "fulfilled";
}

export function normalizeDispatchFilters(filters: DispatchFilters): DispatchFilters {
  return Object.fromEntries(
    dispatchFilterKeys.flatMap((key) => {
      const value = filters[key]?.trim();
      return value ? [[key, value]] : [];
    })
  );
}

export function dispatchFiltersToSearchParams(filters: DispatchFilters): URLSearchParams {
  const params = new URLSearchParams();
  const normalized = normalizeDispatchFilters(filters);

  for (const key of dispatchFilterKeys) {
    const value = normalized[key];
    if (value) {
      params.set(queryNames[key], value);
    }
  }

  return params;
}

export function dispatchFiltersFromSearchParams(params: URLSearchParams): DispatchFilters {
  return normalizeDispatchFilters(Object.fromEntries(
    dispatchFilterKeys.flatMap((key) => {
      const value = params.get(queryNames[key]);
      return value ? [[key, value]] : [];
    })
  ));
}

function matches(value: string | undefined, filter: string | undefined): boolean {
  return !filter || normalizeSearchText(value ?? "").includes(normalizeSearchText(filter));
}

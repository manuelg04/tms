import {
  consignmentMissingFields,
  effectiveConsignment,
  loadingOrderMissingFields,
  manifestMissingFields,
  type ConsignmentDraft,
  type LoadingOrderDraft,
  type ManifestDraft
} from "./dispatchWorkflow";
import type { MoneyLimits } from "./moneyChecks";
import { rndcTextBlocker } from "./rndcTextLimits";
import { consignmentRouteBlockers, manifestRouteBlockers, type TripRoute } from "./tripRoute";

function compact(values: Array<string | null>): string[] {
  return values.filter((value): value is string => value !== null);
}

export function loadingOrderBlockers(draft: LoadingOrderDraft | null | undefined): string[] {
  return loadingOrderMissingFields(draft);
}

export function consignmentTextBlockers(draft: ConsignmentDraft | null | undefined, order: LoadingOrderDraft | null | undefined): string[] {
  if (!draft) return [];
  const effective = effectiveConsignment(draft, order);
  return compact([
    rndcTextBlocker("cargoShortDescription", effective.remissions?.[0]?.description),
    rndcTextBlocker("policyNumber", effective.policyNumber)
  ]);
}

export function consignmentBlockers(draft: ConsignmentDraft | null | undefined, order: LoadingOrderDraft | null | undefined): string[] {
  return [...consignmentMissingFields(draft, order), ...consignmentRouteBlockers(draft, order), ...consignmentTextBlockers(draft, order)];
}

export function manifestTextBlockers(draft: ManifestDraft | null | undefined): string[] {
  return draft ? compact([rndcTextBlocker("manifestObservations", draft.observations)]) : [];
}

export function manifestBlockers(
  draft: ManifestDraft | null | undefined,
  consignmentCount: number | undefined,
  moneyLimits: MoneyLimits | undefined,
  route: TripRoute | undefined
): string[] {
  return [...manifestMissingFields(draft, consignmentCount, moneyLimits), ...manifestRouteBlockers(draft, route), ...manifestTextBlockers(draft)];
}

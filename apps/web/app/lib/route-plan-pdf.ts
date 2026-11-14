import type { RoutePlanPdfInput } from "@tms/rndc-core";
import { companyProfile } from "./company-profile";

type PlanStop = { label: string; kind: "physical" | "virtual" | "delivery"; scheduledAt: string; controller: string; address: string };

type PlanSheet = {
  dispatchCode: string;
  manifestNumber: string;
  origin: string;
  destination: string;
  vehicle: RoutePlanPdfInput["vehicle"];
  driver: RoutePlanPdfInput["driver"];
};

export function routePlanStopTitle(stop: { label: string; kind: "physical" | "virtual" | "delivery" }): string {
  return stop.kind === "virtual" && !/virtual/i.test(stop.label) ? `${stop.label} (Virtual)` : stop.label;
}

export function routePlanPdfInput(
  plan: { departureAt: string; stops: PlanStop[] },
  sheet: PlanSheet,
  now: number,
  photos: { vehicle?: Buffer | null; driver?: Buffer | null } = {}
): RoutePlanPdfInput {
  return {
    vehiclePhoto: photos.vehicle ?? null,
    driverPhoto: photos.driver ?? null,
    company: { name: companyProfile.name, nit: companyProfile.nit, address: companyProfile.address, phones: companyProfile.phones },
    dispatchCode: sheet.dispatchCode,
    manifestNumber: sheet.manifestNumber,
    origin: sheet.origin,
    destination: sheet.destination,
    convoy: "0",
    vehicle: sheet.vehicle,
    driver: sheet.driver,
    departureAt: plan.departureAt.replace("T", " "),
    arrivalAt: plan.stops.at(-1)?.scheduledAt ?? "",
    fine: companyProfile.routePlanFine,
    stops: plan.stops.map((stop) => ({
      label: routePlanStopTitle(stop),
      detail: stop.kind === "delivery" ? "-" : stop.controller || stop.address || "-",
      scheduledAt: `${stop.scheduledAt}:00`
    })),
    observations: companyProfile.routePlanObservations,
    printedAt: printedAt(now)
  };
}

function printedAt(now: number): string {
  const local = new Date(now - 5 * 3600000).toISOString();
  return `${local.slice(8, 10)}/${local.slice(5, 7)}/${local.slice(2, 4)}, ${local.slice(11, 16)}`;
}

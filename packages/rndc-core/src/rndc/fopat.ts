export const FOPAT_RATE = 0.001 as const;
export const FOPAT_GROSS_WEIGHT_THRESHOLD_KG = 10_500 as const;

export type FopatInput = {
  valueToPay?: number;
  operationType?: string;
  isOwnFleet?: boolean;
  grossVehicleWeightKg?: number;
  vehicleConfigurationEligible?: boolean;
};

export type FopatResult =
  | {
    status: "applicable";
    amount: number;
    basis: number;
    rate: typeof FOPAT_RATE;
  }
  | {
    status: "not-applicable";
    amount: 0;
    reason: "municipal-operation" | "own-fleet" | "gross-weight-at-or-below-10500" | "vehicle-configuration";
  }
  | {
    status: "review-required";
    amount: null;
    reason:
      | "missing-operation-type"
      | "missing-own-fleet-status"
      | "missing-gross-vehicle-weight"
      | "missing-vehicle-configuration-eligibility"
      | "invalid-value-to-pay";
  };

export function calculateFopat(input: FopatInput): FopatResult {
  const operationType = input.operationType?.trim().toUpperCase();

  if (!operationType) {
    return reviewRequired("missing-operation-type");
  }

  if (operationType === "U" || operationType === "V") {
    return notApplicable("municipal-operation");
  }

  if (input.isOwnFleet === undefined) {
    return reviewRequired("missing-own-fleet-status");
  }

  if (input.isOwnFleet) {
    return notApplicable("own-fleet");
  }

  if (!Number.isFinite(input.grossVehicleWeightKg)) {
    return reviewRequired("missing-gross-vehicle-weight");
  }

  if ((input.grossVehicleWeightKg as number) <= FOPAT_GROSS_WEIGHT_THRESHOLD_KG) {
    return notApplicable("gross-weight-at-or-below-10500");
  }

  if (input.vehicleConfigurationEligible === undefined) {
    return reviewRequired("missing-vehicle-configuration-eligibility");
  }

  if (!input.vehicleConfigurationEligible) {
    return notApplicable("vehicle-configuration");
  }

  if (!Number.isFinite(input.valueToPay) || (input.valueToPay as number) < 0) {
    return reviewRequired("invalid-value-to-pay");
  }

  return {
    status: "applicable",
    amount: Math.round((input.valueToPay as number) * FOPAT_RATE),
    basis: input.valueToPay as number,
    rate: FOPAT_RATE
  };
}

function notApplicable(reason: Extract<FopatResult, { status: "not-applicable" }>["reason"]): FopatResult {
  return { status: "not-applicable", amount: 0, reason };
}

function reviewRequired(reason: Extract<FopatResult, { status: "review-required" }>["reason"]): FopatResult {
  return { status: "review-required", amount: null, reason };
}

export type RndcActionName =
  | "emit_loading_order"
  | "emit_remesa"
  | "register_trip"
  | "issue_manifest"
  | "emit_manifest"
  | "fulfill_remesa"
  | "fulfill_manifest"
  | "correct_remesa"
  | "annul_cargo"
  | "annul_trip"
  | "annul_remesa"
  | "annul_manifest"
  | "annul_remesa_fulfillment"
  | "annul_manifest_fulfillment"
  | "reconcile"
  | "query_acceptance";

export type RndcActionConfig = {
  operationType:
    | "emit_cargo"
    | "emit_trip"
    | "emit_remesa"
    | "emit_manifest"
    | "fulfill_remesa"
    | "fulfill_manifest"
    | "correct_remesa"
    | "annul_cargo"
    | "annul_trip"
    | "annul_remesa"
    | "annul_manifest"
    | "annul_remesa_fulfillment"
    | "annul_manifest_fulfillment"
    | "reconcile"
    | "query_acceptance";
  backendPath: string;
  processId: number;
  lifecycle: "submission" | "fulfillment" | "correction" | "annulment" | "reconciliation" | "none";
};

const actionConfigs: Record<RndcActionName, RndcActionConfig> = {
  emit_loading_order: { operationType: "emit_cargo", backendPath: "/rndc/forms/loading-order", processId: 1, lifecycle: "submission" },
  emit_remesa: { operationType: "emit_remesa", backendPath: "/rndc/forms/remesa", processId: 3, lifecycle: "submission" },
  register_trip: { operationType: "emit_trip", backendPath: "/rndc/forms/trip", processId: 2, lifecycle: "none" },
  issue_manifest: { operationType: "emit_manifest", backendPath: "/rndc/forms/manifest-issue", processId: 4, lifecycle: "submission" },
  emit_manifest: { operationType: "emit_manifest", backendPath: "/rndc/forms/manifest", processId: 4, lifecycle: "submission" },
  fulfill_remesa: { operationType: "fulfill_remesa", backendPath: "/rndc/forms/fulfill-remesa", processId: 5, lifecycle: "fulfillment" },
  fulfill_manifest: { operationType: "fulfill_manifest", backendPath: "/rndc/forms/fulfill-manifest", processId: 6, lifecycle: "fulfillment" },
  correct_remesa: { operationType: "correct_remesa", backendPath: "/rndc/corrections/remesa", processId: 38, lifecycle: "correction" },
  annul_cargo: { operationType: "annul_cargo", backendPath: "/rndc/annulments/targeted", processId: 7, lifecycle: "annulment" },
  annul_trip: { operationType: "annul_trip", backendPath: "/rndc/annulments/targeted", processId: 8, lifecycle: "annulment" },
  annul_remesa: { operationType: "annul_remesa", backendPath: "/rndc/annulments/targeted", processId: 9, lifecycle: "annulment" },
  annul_manifest: { operationType: "annul_manifest", backendPath: "/rndc/annulments/targeted", processId: 32, lifecycle: "annulment" },
  annul_remesa_fulfillment: { operationType: "annul_remesa_fulfillment", backendPath: "/rndc/annulments/targeted", processId: 28, lifecycle: "annulment" },
  annul_manifest_fulfillment: { operationType: "annul_manifest_fulfillment", backendPath: "/rndc/annulments/targeted", processId: 29, lifecycle: "annulment" },
  reconcile: { operationType: "reconcile", backendPath: "/rndc/reconciliation", processId: 0, lifecycle: "reconciliation" },
  query_acceptance: { operationType: "query_acceptance", backendPath: "/rndc/acceptances/query", processId: 73, lifecycle: "none" }
};

export function getRndcActionConfig(value: string): RndcActionConfig | null {
  return value in actionConfigs ? actionConfigs[value as RndcActionName] : null;
}

export function lifecycleEvents(
  lifecycle: RndcActionConfig["lifecycle"],
  accepted: boolean
): { started: string; finished: string } | null {
  if (lifecycle === "none") {
    return null;
  }

  if (lifecycle === "submission") {
    return { started: "submission_started", finished: accepted ? "submission_succeeded" : "attempt_rejected" };
  }

  if (lifecycle === "fulfillment") {
    return { started: "fulfillment_started", finished: accepted ? "fulfillment_succeeded" : "fulfillment_rejected" };
  }

  if (lifecycle === "correction") {
    return { started: "correction_started", finished: accepted ? "correction_succeeded" : "correction_rejected" };
  }

  if (lifecycle === "annulment") {
    return { started: "annulment_started", finished: accepted ? "annulment_succeeded" : "annulment_rejected" };
  }

  return { started: "reconciliation_started", finished: accepted ? "reconciliation_confirmed" : "reconciliation_mismatch" };
}

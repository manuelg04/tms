export type OfficialDocumentState = "draft" | "pending" | "authorized" | "fulfilled" | "annulled";
export type FulfillmentState = "not_requested" | "pending" | "fulfilled" | "rejected" | "annulment_pending";
export type CorrectionState = "none" | "pending" | "corrected" | "rejected";
export type AnnulmentState = "none" | "pending" | "annulled" | "rejected";
export type ReconciliationState = "not_needed" | "pending" | "confirmed" | "mismatch";

export type DocumentLifecycle = {
  officialState: OfficialDocumentState;
  fulfillmentState: FulfillmentState;
  correctionState: CorrectionState;
  annulmentState: AnnulmentState;
  reconciliationState: ReconciliationState;
};

export type DocumentEvent =
  | "submission_started"
  | "submission_succeeded"
  | "attempt_rejected"
  | "submission_abandoned"
  | "fulfillment_started"
  | "fulfillment_succeeded"
  | "fulfillment_rejected"
  | "fulfillment_annulment_started"
  | "fulfillment_annulment_succeeded"
  | "fulfillment_annulment_rejected"
  | "correction_started"
  | "correction_succeeded"
  | "correction_rejected"
  | "annulment_started"
  | "annulment_succeeded"
  | "annulment_rejected"
  | "reconciliation_started"
  | "reconciliation_confirmed"
  | "reconciliation_mismatch";

export function initialDocumentLifecycle(): DocumentLifecycle {
  return {
    officialState: "draft",
    fulfillmentState: "not_requested",
    correctionState: "none",
    annulmentState: "none",
    reconciliationState: "not_needed"
  };
}

export function applyDocumentEvent(lifecycle: DocumentLifecycle, event: DocumentEvent): DocumentLifecycle {
  switch (event) {
    case "submission_started":
      requireOfficialState(lifecycle, ["draft", "pending"], event);
      return { ...lifecycle, officialState: "pending" };
    case "submission_succeeded":
      requireOfficialState(lifecycle, ["pending", "authorized"], event);
      return { ...lifecycle, officialState: "authorized" };
    case "attempt_rejected":
      return lifecycle;
    case "submission_abandoned":
      requireOfficialState(lifecycle, ["pending"], event);
      return { ...lifecycle, officialState: "draft" };
    case "fulfillment_started":
      requireOfficialState(lifecycle, ["authorized"], event);
      return { ...lifecycle, fulfillmentState: "pending" };
    case "fulfillment_succeeded":
      requireOfficialState(lifecycle, ["authorized", "fulfilled"], event);
      return { ...lifecycle, officialState: "fulfilled", fulfillmentState: "fulfilled" };
    case "fulfillment_rejected":
      requireOfficialState(lifecycle, ["authorized"], event);
      return { ...lifecycle, fulfillmentState: "rejected" };
    case "fulfillment_annulment_started":
      requireOfficialState(lifecycle, ["fulfilled"], event);
      return { ...lifecycle, fulfillmentState: "annulment_pending" };
    case "fulfillment_annulment_succeeded":
      requireOfficialState(lifecycle, ["fulfilled", "authorized"], event);
      return { ...lifecycle, officialState: "authorized", fulfillmentState: "not_requested" };
    case "fulfillment_annulment_rejected":
      requireOfficialState(lifecycle, ["fulfilled"], event);
      return { ...lifecycle, fulfillmentState: "fulfilled" };
    case "correction_started":
      requireOfficialState(lifecycle, ["authorized", "fulfilled"], event);
      return { ...lifecycle, correctionState: "pending" };
    case "correction_succeeded":
      requireOfficialState(lifecycle, ["authorized", "fulfilled"], event);
      return { ...lifecycle, correctionState: "corrected" };
    case "correction_rejected":
      requireOfficialState(lifecycle, ["authorized", "fulfilled"], event);
      return { ...lifecycle, correctionState: "rejected" };
    case "annulment_started":
      requireOfficialState(lifecycle, ["authorized", "fulfilled"], event);
      return { ...lifecycle, annulmentState: "pending" };
    case "annulment_succeeded":
      requireOfficialState(lifecycle, ["authorized", "fulfilled", "annulled"], event);
      return { ...lifecycle, officialState: "annulled", annulmentState: "annulled" };
    case "annulment_rejected":
      requireOfficialState(lifecycle, ["authorized", "fulfilled"], event);
      return { ...lifecycle, annulmentState: "rejected" };
    case "reconciliation_started":
      return { ...lifecycle, reconciliationState: "pending" };
    case "reconciliation_confirmed":
      return { ...lifecycle, reconciliationState: "confirmed" };
    case "reconciliation_mismatch":
      return { ...lifecycle, reconciliationState: "mismatch" };
  }
}

function requireOfficialState(
  lifecycle: DocumentLifecycle,
  allowed: OfficialDocumentState[],
  event: DocumentEvent
): void {
  if (!allowed.includes(lifecycle.officialState)) {
    throw new Error(`Invalid document transition: ${lifecycle.officialState} -> ${event}`);
  }
}

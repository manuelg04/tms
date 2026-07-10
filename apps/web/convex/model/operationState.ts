export type RndcOperationStatus =
  | "queued"
  | "claimed"
  | "succeeded"
  | "failed"
  | "uncertain"
  | "reconciling"
  | "cancelled";

export type RndcOperationEvent =
  | "claim"
  | "succeed"
  | "fail"
  | "mark_uncertain"
  | "begin_reconciliation"
  | "confirm_succeeded"
  | "confirm_failed"
  | "remain_uncertain"
  | "retry"
  | "cancel";

const transitions: Record<RndcOperationStatus, Partial<Record<RndcOperationEvent, RndcOperationStatus>>> = {
  queued: { claim: "claimed", cancel: "cancelled" },
  claimed: {
    succeed: "succeeded",
    fail: "failed",
    mark_uncertain: "uncertain",
    cancel: "cancelled"
  },
  succeeded: {},
  failed: { retry: "queued", cancel: "cancelled" },
  uncertain: { begin_reconciliation: "reconciling", cancel: "cancelled" },
  reconciling: {
    confirm_succeeded: "succeeded",
    confirm_failed: "failed",
    remain_uncertain: "uncertain",
    cancel: "cancelled"
  },
  cancelled: {}
};

export function nextOperationState(status: RndcOperationStatus, event: RndcOperationEvent): RndcOperationStatus {
  const next = transitions[status]?.[event];

  if (!next) {
    throw new Error(`Invalid operation transition: ${status} -> ${event}`);
  }

  return next;
}

export function canClaimOperation(
  operation: { status: string; availableAt: number; leaseExpiresAt?: number },
  now: number
): boolean {
  if (operation.status === "queued") {
    return operation.availableAt <= now;
  }

  return false;
}

export function chooseExistingOperation(
  requestMatch?: string | null,
  businessMatch?: string | null
): string | null {
  if (requestMatch && businessMatch && requestMatch !== businessMatch) {
    throw new Error("Idempotency conflict: request key and business key belong to different operations");
  }

  return requestMatch ?? businessMatch ?? null;
}

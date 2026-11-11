import { emissionScopeTargets, type DispatchWorkflowVariant } from "./dispatchWorkflow";

export type ChainScope = "orden" | "remesas" | "manifiesto";

const rank: Record<ChainScope, number> = { orden: 1, remesas: 2, manifiesto: 3 };

export const RETRY_LEASE_MS = 120_000;
export const TICK_MS = 60_000;

export function tickerIsIdle(ticker: { scheduledFor: number } | null, now: number): boolean {
  return !ticker || ticker.scheduledFor <= now;
}

export function widestScope(current: ChainScope | undefined, next: ChainScope): ChainScope {
  return current && rank[current] >= rank[next] ? current : next;
}

export function covers(completed: ChainScope, queued: ChainScope): boolean {
  return rank[completed] >= rank[queued];
}

export function isChainScope(value: unknown): value is ChainScope {
  return value === "orden" || value === "remesas" || value === "manifiesto";
}

export function chainScopes(
  target: ChainScope,
  state: {
    workflowVariant?: DispatchWorkflowVariant;
    orderAuthorized: boolean;
    consignmentsAuthorized: boolean;
    manifestAuthorized: boolean;
  }
): ChainScope[] {
  const variant = state.workflowVariant ?? "standard";
  const scopes: ChainScope[] = [];

  if (emissionScopeTargets("orden", variant).order && !state.orderAuthorized) {
    scopes.push("orden");
  }

  if (rank[target] >= rank.remesas && emissionScopeTargets("remesas", variant).consignments && !state.consignmentsAuthorized) {
    scopes.push("remesas");
  }

  if (target === "manifiesto" && !state.manifestAuthorized) {
    scopes.push("manifiesto");
  }

  return scopes;
}

export function retryIsDue(entry: { status: "waiting" | "attention"; lastAttemptAt?: number }, now: number): boolean {
  return entry.status === "waiting" && (entry.lastAttemptAt === undefined || now - entry.lastAttemptAt >= RETRY_LEASE_MS);
}

import { randomUUID } from "node:crypto";
import { ConvexError } from "convex/values";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { MasterSyncBundle } from "../../convex/fleet";
import { MASTER_SYNC_GATEWAY_PATHS, MASTER_SYNC_OPERATION_TYPES, MASTER_SYNC_PROCESS_IDS, type MasterSyncKind } from "../../convex/model/masterSync";
import { buildDurableEvidenceHeaders, durableEvidenceWasStored, forwardRndcRequest, safeRndcMode } from "./rndc-gateway";
import { resolveActionOutcome } from "./rndc-action-outcome";

export type MasterSyncTarget = { kind: MasterSyncKind; key: string };

export type MasterSyncResult = {
  kind: MasterSyncKind;
  key: string;
  label: string;
  state: "registered" | "rejected" | "uncertain";
  skipped: boolean;
  error?: string;
  operationIds: string[];
};

export type MasterSyncOptions = { force?: boolean };

export function isMasterSyncKind(value: unknown): value is MasterSyncKind {
  return value === "driver" || value === "vehicle" || value === "party";
}

export async function syncMaster(client: ConvexHttpClient, serviceKey: string, target: MasterSyncTarget, options: MasterSyncOptions = {}): Promise<MasterSyncResult> {
  let bundle: MasterSyncBundle | null;
  try {
    bundle = await client.query(api.fleet.masterSyncBundle, target) as MasterSyncBundle | null;
  } catch (error) {
    return { ...target, label: defaultLabel(target), state: "rejected", skipped: false, error: convexMessage(error), operationIds: [] };
  }
  if (!bundle) {
    return { ...target, label: defaultLabel(target), state: "rejected", skipped: false, error: `${defaultLabel(target)} no existe en maestros`, operationIds: [] };
  }
  if (!options.force && bundle.summary.state === "registered") {
    return { kind: bundle.kind, key: bundle.key, label: bundle.label, state: "registered", skipped: true, operationIds: [] };
  }

  const operationIds: string[] = [];
  let uncertain = false;
  for (const entry of bundle.payloads) {
    const step = await runDurableOperation(client, serviceKey, bundle, entry);
    if (step.operationId) operationIds.push(step.operationId);
    if (step.outcome === "failed") {
      await client.mutation(api.fleet.recordMasterSync, { kind: bundle.kind, key: bundle.key, state: "rejected", version: bundle.version, error: step.error, operationId: step.operationId });
      return { kind: bundle.kind, key: bundle.key, label: bundle.label, state: "rejected", skipped: false, error: step.error, operationIds };
    }
    if (step.outcome === "uncertain") uncertain = true;
  }
  if (uncertain) {
    return { kind: bundle.kind, key: bundle.key, label: bundle.label, state: "uncertain", skipped: false, error: "El RNDC no confirmó el registro; se reintentará en la próxima transmisión", operationIds };
  }
  await client.mutation(api.fleet.recordMasterSync, { kind: bundle.kind, key: bundle.key, state: "registered", version: bundle.version, operationId: operationIds.at(-1) });
  return { kind: bundle.kind, key: bundle.key, label: bundle.label, state: "registered", skipped: false, operationIds };
}

type DurableStep = { outcome: "succeeded" | "failed" | "uncertain"; operationId?: string; error?: string };

async function runDurableOperation(client: ConvexHttpClient, serviceKey: string, bundle: MasterSyncBundle, entry: MasterSyncBundle["payloads"][number]): Promise<DurableStep> {
  const operationType = MASTER_SYNC_OPERATION_TYPES[bundle.kind];
  const requestKey = `master-${randomUUID()}`;
  const payloadJson = JSON.stringify(entry.payload);
  const queued = await client.mutation(api.rndcOperations.enqueue, {
    organizationId: bundle.organizationId,
    operationType,
    procesoId: MASTER_SYNC_PROCESS_IDS[bundle.kind],
    mode: safeRndcMode(),
    requestKey,
    businessKey: entry.businessKey,
    payloadJson,
    maxAttempts: 3
  });
  const existing = await client.query(api.rndcOperations.get, { operationId: queued.operationId });
  if (!existing || existing.operationType !== operationType) {
    return { outcome: "failed", operationId: queued.operationId, error: "La operación RNDC persistida no coincide con el maestro seleccionado" };
  }
  if (!queued.created && existing.status !== "queued") {
    if (existing.status === "succeeded") return { outcome: "succeeded", operationId: queued.operationId };
    if (existing.status === "failed") return { outcome: "failed", operationId: queued.operationId, error: existing.lastError ?? "El RNDC rechazó el registro" };
    return { outcome: "uncertain", operationId: queued.operationId };
  }
  const workerId = `web-master-${randomUUID()}`;
  const claimed = await client.mutation(api.rndcOperations.claimById, { serviceKey, operationId: queued.operationId, workerId, leaseMs: 60_000 });
  if (!claimed) return { outcome: "uncertain", operationId: queued.operationId, error: "La operación RNDC no pudo iniciarse" };
  const backendResponse = await forwardRndcRequest(MASTER_SYNC_GATEWAY_PATHS[bundle.kind], {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": requestKey,
      "X-Correlation-Id": queued.operationId,
      ...buildDurableEvidenceHeaders({ organizationId: bundle.organizationId, operationId: queued.operationId, operationType, leaseOwner: workerId })
    },
    body: payloadJson
  });
  const rawResult = await backendResponse.text();
  const result = parseJson(rawResult) ?? { error: rawResult || "La operación RNDC falló" };
  const evidenceStored = durableEvidenceWasStored(result);
  const outcome = resolveActionOutcome({ backendOk: backendResponse.ok, backendStatus: backendResponse.status, evidenceStored });
  const errorText = outcome.errorText ?? describeBackendError(result, backendResponse.ok);
  await client.mutation(api.rndcOperations.finish, {
    serviceKey,
    operationId: queued.operationId,
    workerId,
    outcome: outcome.operationOutcome,
    radicado: lastRadicado(result),
    resultJson: JSON.stringify(result),
    errorText
  });
  return { outcome: outcome.operationOutcome, operationId: queued.operationId, error: outcome.operationOutcome === "succeeded" ? undefined : errorText ?? "El RNDC rechazó el registro" };
}

function describeBackendError(result: unknown, ok: boolean): string | undefined {
  if (ok || !isRecord(result)) return undefined;
  if (Array.isArray(result.steps)) {
    const failed = result.steps.find((step) => isRecord(step) && step.ok === false);
    if (isRecord(failed)) {
      const message = typeof failed.errorMessage === "string" ? failed.errorMessage : typeof failed.error === "string" ? failed.error : undefined;
      if (message) return message;
    }
  }
  if (Array.isArray(result.missingFields) && result.missingFields.length > 0) {
    return `Faltan datos para el RNDC: ${result.missingFields.join(", ")}`;
  }
  return typeof result.error === "string" ? result.error : undefined;
}

function defaultLabel(target: MasterSyncTarget): string {
  return target.kind === "driver" ? `Conductor ${target.key}` : target.kind === "vehicle" ? `Vehículo ${target.key}` : `Tercero ${target.key}`;
}

function convexMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: string } | string;
    if (typeof data === "string") return data;
    if (data && typeof data.message === "string") return data.message;
  }
  if (error instanceof Error) {
    const match = /ConvexError: (.*)$/m.exec(error.message);
    return match ? match[1] : error.message;
  }
  return String(error);
}

function lastRadicado(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.steps)) return undefined;
  return value.steps.flatMap((step) => isRecord(step) && typeof step.radicado === "string" ? [step.radicado] : []).at(-1);
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { appendAudit } from "./access";
import { blocksAnotherDocumentOperation, canClaimOperation, chooseExistingOperation, nextOperationState } from "./operationState";
import { operationIntentMatches } from "./operationIntent";
import { applyDocumentEvent, initialDocumentLifecycle, type DocumentLifecycle } from "./documentLifecycle";
import { applyLifecycle } from "../officialDocuments";
import { bindPayloadToPersistedDocument, lifecyclePlanForOperation, liveOperationBlocked } from "./officialDocumentIdentity";

export const operationTypeValidator = v.union(
  v.literal("emit_cargo"),
  v.literal("emit_trip"),
  v.literal("emit_remesa"),
  v.literal("emit_manifest"),
  v.literal("fulfill_remesa"),
  v.literal("fulfill_manifest"),
  v.literal("correct_remesa"),
  v.literal("annul_cargo"),
  v.literal("annul_trip"),
  v.literal("annul_remesa"),
  v.literal("annul_manifest"),
  v.literal("annul_remesa_fulfillment"),
  v.literal("annul_remesa_initial_fulfillment"),
  v.literal("annul_manifest_fulfillment"),
  v.literal("upsert_third_party"),
  v.literal("upsert_vehicle"),
  v.literal("reconcile"),
  v.literal("query_acceptance")
);

export const statusValidator = v.union(
  v.literal("queued"),
  v.literal("claimed"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("uncertain"),
  v.literal("reconciling"),
  v.literal("cancelled")
);

export const modeValidator = v.union(v.literal("dry-run"), v.literal("live"));

export const operationValidator = v.object({
  _id: v.id("rndcOperations"),
  _creationTime: v.number(),
  organizationId: v.id("organizations"),
  expedienteId: v.optional(v.id("expedientes")),
  documentId: v.optional(v.id("documents")),
  expedienteRemesaId: v.optional(v.id("expedienteRemesas")),
  operationType: operationTypeValidator,
  procesoId: v.optional(v.number()),
  status: statusValidator,
  mode: modeValidator,
  requestKey: v.string(),
  businessKey: v.string(),
  payloadJson: v.string(),
  availableAt: v.number(),
  attemptCount: v.number(),
  maxAttempts: v.number(),
  leaseOwner: v.optional(v.string()),
  leaseExpiresAt: v.optional(v.number()),
  claimedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  uncertainAt: v.optional(v.number()),
  resultRadicado: v.optional(v.string()),
  resultJson: v.optional(v.string()),
  lastError: v.optional(v.string()),
  reconciledByOperationId: v.optional(v.id("rndcOperations")),
  createdBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number()
});

export const enqueueInputValidator = {
  organizationId: v.id("organizations"),
  expedienteId: v.optional(v.id("expedientes")),
  documentId: v.optional(v.id("documents")),
  expedienteRemesaId: v.optional(v.id("expedienteRemesas")),
  operationType: operationTypeValidator,
  procesoId: v.optional(v.number()),
  mode: modeValidator,
  requestKey: v.string(),
  businessKey: v.string(),
  payloadJson: v.string(),
  availableAt: v.optional(v.number()),
  maxAttempts: v.optional(v.number())
};

export const enqueueResultValidator = v.object({
  operationId: v.id("rndcOperations"),
  created: v.boolean(),
  status: statusValidator
});

export type EnqueueInput = {
  organizationId: Id<"organizations">;
  expedienteId?: Id<"expedientes">;
  documentId?: Id<"documents">;
  expedienteRemesaId?: Id<"expedienteRemesas">;
  operationType: Doc<"rndcOperations">["operationType"];
  procesoId?: number;
  mode: "dry-run" | "live";
  requestKey: string;
  businessKey: string;
  payloadJson: string;
  availableAt?: number;
  maxAttempts?: number;
};

export async function enqueueOperation(
  ctx: MutationCtx,
  input: EnqueueInput,
  createdBy: Id<"users">,
  actorType: "user" | "service"
): Promise<{ operationId: Id<"rndcOperations">; created: boolean; status: Doc<"rndcOperations">["status"] }> {
  validateQueueInput(input);
  await validateReferences(ctx, input);
  const requestKey = input.requestKey.trim();
  const businessKey = input.businessKey.trim();
  const requestKeyRecord = await ctx.db
    .query("rndcRequestKeys")
    .withIndex("by_organization_and_request_key", (q) =>
      q.eq("organizationId", input.organizationId).eq("requestKey", requestKey)
    )
    .unique();
  const indexedRequestMatch = await ctx.db
    .query("rndcOperations")
    .withIndex("by_organization_and_request_key", (q) =>
      q.eq("organizationId", input.organizationId).eq("requestKey", requestKey)
    )
    .unique();
  const requestMatch = requestKeyRecord
    ? await ctx.db.get("rndcOperations", requestKeyRecord.operationId)
    : indexedRequestMatch;
  const businessMatch = await ctx.db
    .query("rndcOperations")
    .withIndex("by_organization_and_business_key", (q) =>
      q.eq("organizationId", input.organizationId).eq("businessKey", businessKey)
    )
    .unique();
  let existingId: string | null;

  try {
    existingId = chooseExistingOperation(requestMatch?._id, businessMatch?._id);
  } catch (error) {
    throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT", message: String(error) });
  }

  if (existingId) {
    const existing = requestMatch?._id === existingId ? requestMatch : businessMatch;

    if (!existing) {
      throw new ConvexError({ code: "INTERNAL", message: "Idempotent operation could not be loaded" });
    }

    if (requestMatch && requestMatch.businessKey !== businessKey) {
      throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT", message: "Request key was reused for another action" });
    }

    if (!operationIntentMatches(existing, { ...input, businessKey })) {
      throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT", message: "Operation key was reused with a different persisted intent" });
    }

    let existingStatus = existing.status;

    if (existing.status === "claimed" && (!existing.leaseExpiresAt || existing.leaseExpiresAt <= Date.now())) {
      const now = Date.now();
      existingStatus = nextOperationState(existing.status, "mark_uncertain");
      await ctx.db.patch("rndcOperations", existing._id, {
        status: existingStatus,
        uncertainAt: now,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        lastError: "Operation lease expired before a final result was recorded",
        updatedAt: now
      });
      await appendAudit(ctx, {
        organizationId: existing.organizationId,
        actorType: "service",
        action: "rndc_operation.lease_expired",
        entityType: "rndc_operation",
        entityId: existing._id,
        createdAt: now
      });
    }

    if (!requestKeyRecord) {
      await ctx.db.insert("rndcRequestKeys", {
        organizationId: input.organizationId,
        requestKey,
        operationId: existing._id,
        createdAt: Date.now()
      });
    }

    return { operationId: existing._id, created: false, status: existingStatus };
  }

  if (input.documentId && lifecyclePlanForOperation(input.operationType)) {
    const active = await findBlockingDocumentOperation(ctx, input.documentId, undefined, true);

    if (active) {
      throw new ConvexError({ code: "OPERATION_IN_PROGRESS", message: "Another official action is active for this document" });
    }
  }

  const now = Date.now();
  const operationId = await ctx.db.insert("rndcOperations", {
    organizationId: input.organizationId,
    expedienteId: input.expedienteId,
    documentId: input.documentId,
    expedienteRemesaId: input.expedienteRemesaId,
    operationType: input.operationType,
    procesoId: input.procesoId,
    status: "queued",
    mode: input.mode,
    requestKey,
    businessKey,
    payloadJson: input.payloadJson,
    availableAt: input.availableAt ?? now,
    attemptCount: 0,
    maxAttempts: Math.min(Math.max(input.maxAttempts ?? 3, 1), 10),
    createdBy,
    createdAt: now,
    updatedAt: now
  });
  await ctx.db.insert("rndcRequestKeys", {
    organizationId: input.organizationId,
    requestKey,
    operationId,
    createdAt: now
  });
  await appendAudit(ctx, {
    organizationId: input.organizationId,
    actorType,
    actorId: actorType === "user" ? createdBy : undefined,
    action: "rndc_operation.queued",
    entityType: "rndc_operation",
    entityId: operationId,
    createdAt: now
  });
  return { operationId, created: true, status: "queued" };
}

export async function validateReferences(ctx: MutationCtx, input: EnqueueInput): Promise<void> {
  const organization = await ctx.db.get("organizations", input.organizationId);

  if (!organization || organization.status !== "active") {
    throw new ConvexError({ code: "NOT_FOUND", message: "Active organization not found" });
  }

  const references = await Promise.all([
    input.expedienteId ? ctx.db.get("expedientes", input.expedienteId) : null,
    input.documentId ? ctx.db.get("documents", input.documentId) : null,
    input.expedienteRemesaId ? ctx.db.get("expedienteRemesas", input.expedienteRemesaId) : null
  ]);

  if (
    (input.expedienteId && !references[0]) ||
    (input.documentId && !references[1]) ||
    (input.expedienteRemesaId && !references[2])
  ) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Operation reference not found" });
  }

  for (const reference of references) {
    if (reference && reference.organizationId !== input.organizationId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Operation reference belongs to another organization" });
    }
  }

  const [expediente, document, remesa] = references;

  if (input.mode === "live" && officialLiveWriteBlocked(input.operationType)) {
    throw new ConvexError({ code: "UNSUPPORTED_LIVE_OPERATION", message: "This official action remains disabled in live mode until exact recovery is available" });
  }

  if (document && (document.mode ?? "dry-run") !== input.mode) {
    throw new ConvexError({ code: "CONFLICT", message: "Operation mode does not match the persisted document" });
  }

  if (
    (expediente && document?.expedienteId && document.expedienteId !== expediente._id) ||
    (expediente && remesa?.expedienteId && remesa.expedienteId !== expediente._id) ||
    (document && remesa?.documentId && remesa.documentId !== document._id)
  ) {
    throw new ConvexError({ code: "CONFLICT", message: "Operation references do not belong to the same expediente" });
  }

  if (lifecyclePlanForOperation(input.operationType) || input.operationType === "query_acceptance") {
    const payload = parseObjectJson(input.payloadJson);

    if (!document || !payload) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Persisted document actions require a valid document payload" });
    }

    const boundPayload = bindPayloadToPersistedDocument({
      operationType: input.operationType,
      payload,
      documentKind: document.kind,
      documentNumber: document.number,
      documentIssuanceRadicado: document.issuanceRadicado,
      documentRndcRadicado: document.rndcRadicado,
      documentOfficialState: document.officialState,
      documentStatus: document.status,
      documentFulfillmentState: document.fulfillmentState
    });

    if (!boundPayload.ok) {
      throw new ConvexError({ code: "CONFLICT", message: boundPayload.error });
    }

    const plan = lifecyclePlanForOperation(input.operationType);

    if (plan && !canStartLifecycle(document, plan.started)) {
      throw new ConvexError({ code: "INVALID_STATE", message: "Document lifecycle is not valid for this operation" });
    }
  }
}

export async function claimPersistedDocumentOperation(
  ctx: MutationCtx,
  operation: Doc<"rndcOperations">,
  workerId: string,
  leaseMs?: number
): Promise<Doc<"rndcOperations"> | null> {
  const now = Date.now();
  const plan = lifecyclePlanForOperation(operation.operationType);

  if (!plan || !operation.documentId || !canClaimOperation(operation, now)) {
    return null;
  }

  if (operation.attemptCount >= operation.maxAttempts) {
    await ctx.db.patch("rndcOperations", operation._id, {
      status: "failed",
      completedAt: now,
      lastError: "Maximum operation attempts reached",
      updatedAt: now
    });
    return null;
  }

  const document = await ctx.db.get("documents", operation.documentId);
  const payload = parseObjectJson(operation.payloadJson);

  if (
    !document
    || !document.organizationId
    || !payload
    || (document.mode ?? "dry-run") !== operation.mode
    || (operation.mode === "live" && officialLiveWriteBlocked(operation.operationType))
  ) {
    await failUnclaimableOperation(ctx, operation, "Persisted operation document or mode is invalid");
    return null;
  }

  const boundPayload = bindPayloadToPersistedDocument({
    operationType: operation.operationType,
    payload,
    documentKind: document.kind,
    documentNumber: document.number,
    documentIssuanceRadicado: document.issuanceRadicado,
    documentRndcRadicado: document.rndcRadicado,
    documentOfficialState: document.officialState,
    documentStatus: document.status,
    documentFulfillmentState: document.fulfillmentState
  });

  if (!boundPayload.ok) {
    await failUnclaimableOperation(ctx, operation, boundPayload.error);
    return null;
  }

  const active = await findBlockingDocumentOperation(ctx, document._id, operation._id, false);

  if (active) {
    await failUnclaimableOperation(ctx, operation, "Another official action is active for this document");
    return null;
  }

  if (!canStartLifecycle(document, plan.started)) {
    await failUnclaimableOperation(ctx, operation, "Document lifecycle is not valid for this operation");
    return null;
  }

  const leaseExpiresAt = now + normalizeLeaseMs(leaseMs);
  await applyLifecycle(ctx, {
    documentId: document._id,
    rndcOperationId: operation._id,
    event: plan.started,
    detailsJson: JSON.stringify({ operationId: operation._id }),
    actorType: "service"
  });
  await ctx.db.patch("rndcOperations", operation._id, {
    status: nextOperationState(operation.status, "claim"),
    attemptCount: operation.attemptCount + 1,
    leaseOwner: workerId,
    leaseExpiresAt,
    claimedAt: now,
    completedAt: undefined,
    updatedAt: now
  });
  await appendAudit(ctx, {
    organizationId: operation.organizationId,
    actorType: "service",
    action: "rndc_operation.claimed",
    entityType: "rndc_operation",
    entityId: operation._id,
    detailsJson: JSON.stringify({ workerId, leaseExpiresAt }),
    createdAt: now
  });
  return await ctx.db.get("rndcOperations", operation._id);
}

export async function findBlockingDocumentOperation(
  ctx: MutationCtx,
  documentId: Id<"documents">,
  excludedOperationId: Id<"rndcOperations"> | undefined,
  includeQueued: boolean
): Promise<Doc<"rndcOperations"> | null> {
  const statuses: Doc<"rndcOperations">["status"][] = includeQueued
    ? ["queued", "claimed", "uncertain", "reconciling"]
    : ["claimed", "uncertain", "reconciling"];

  for (const status of statuses) {
    const candidates = await ctx.db
      .query("rndcOperations")
      .withIndex("by_document_and_status", (q) => q.eq("documentId", documentId).eq("status", status))
      .collect();

    const active = candidates.find((candidate) =>
      candidate._id !== excludedOperationId
      && Boolean(lifecyclePlanForOperation(candidate.operationType))
      && blocksAnotherDocumentOperation(candidate.status)
    );

    if (active) {
      return active;
    }
  }

  return null;
}

export async function requireWorkerLease(
  ctx: MutationCtx,
  operationId: Id<"rndcOperations">,
  workerId: string,
  allowedStatuses: Doc<"rndcOperations">["status"][]
): Promise<Doc<"rndcOperations">> {
  const operation = await ctx.db.get("rndcOperations", operationId);

  if (!operation) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Operation not found" });
  }

  if (!allowedStatuses.includes(operation.status) || operation.leaseOwner !== workerId) {
    throw new ConvexError({ code: "LEASE_LOST", message: "Worker does not own the operation lease" });
  }

  if (!operation.leaseExpiresAt || operation.leaseExpiresAt <= Date.now()) {
    throw new ConvexError({ code: "LEASE_EXPIRED", message: "Operation lease has expired" });
  }

  return operation;
}

export function validateQueueInput(input: EnqueueInput): void {
  if (!input.requestKey.trim() || !input.businessKey.trim()) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "Request and business keys are required" });
  }

  try {
    JSON.parse(input.payloadJson);
  } catch {
    throw new ConvexError({ code: "INVALID_INPUT", message: "Operation payload must be valid JSON" });
  }
}

export function normalizeLeaseMs(leaseMs?: number): number {
  return Math.min(Math.max(leaseMs ?? 60_000, 5_000), 300_000);
}

export async function requireCompleteOperationEvidence(ctx: MutationCtx, operationId: Id<"rndcOperations">): Promise<void> {
  if (!await hasCompleteOperationEvidence(ctx, operationId)) {
    throw new ConvexError({ code: "CONFLICT", message: "Durable RNDC request and response evidence are required" });
  }
}

export async function hasCompleteOperationEvidence(ctx: MutationCtx, operationId: Id<"rndcOperations">): Promise<boolean> {
  const evidence = await ctx.db
    .query("evidenceArtifacts")
    .withIndex("by_rndc_operation", (q) => q.eq("rndcOperationId", operationId))
    .collect();
  const kinds = new Set(evidence.map((artifact) => artifact.kind));

  return kinds.has("request_xml") && kinds.has("response_xml");
}

export async function failUnclaimableOperation(
  ctx: MutationCtx,
  operation: Doc<"rndcOperations">,
  errorText: string
): Promise<void> {
  const now = Date.now();
  await ctx.db.patch("rndcOperations", operation._id, {
    status: "failed",
    completedAt: now,
    lastError: errorText,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    updatedAt: now
  });
  await appendAudit(ctx, {
    organizationId: operation.organizationId,
    actorType: "service",
    action: "rndc_operation.invalid_queued_operation",
    entityType: "rndc_operation",
    entityId: operation._id,
    detailsJson: JSON.stringify({ errorText }),
    createdAt: now
  });
}

export function canStartLifecycle(document: Doc<"documents">, event: Parameters<typeof applyDocumentEvent>[1]): boolean {
  try {
    applyDocumentEvent(documentLifecycle(document), event);
    return true;
  } catch {
    return false;
  }
}

export function documentLifecycle(document: Doc<"documents">): DocumentLifecycle {
  const initial = initialDocumentLifecycle();
  const status = document.status;
  const officialState = document.officialState
    ?? (status === "authorized" || status === "fulfilled" || status === "annulled" || status === "draft" || status === "pending"
      ? status
      : "pending");
  return {
    officialState,
    fulfillmentState: document.fulfillmentState ?? initial.fulfillmentState,
    correctionState: document.correctionState ?? initial.correctionState,
    annulmentState: document.annulmentState ?? initial.annulmentState,
    reconciliationState: document.reconciliationState ?? initial.reconciliationState
  };
}

export function officialLiveWriteBlocked(operationType: string): boolean {
  return liveOperationBlocked(operationType, process.env.RNDC_LIVE_WRITES_ENABLED === "true");
}

export function parseObjectJson(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

export function readMatchingAcceptance(
  result: Record<string, unknown> | undefined,
  expectedManifestRadicado: string
): { actorId?: string; recordedAt?: number; raw: Record<string, unknown> } | null {
  const records = result?.records;
  const raw = Array.isArray(records)
    ? records.find((record) =>
        record
        && typeof record === "object"
        && (record as Record<string, unknown>).manifestRadicado === expectedManifestRadicado
      ) as Record<string, unknown> | undefined
    : undefined;

  if (!raw) {
    return null;
  }

  const parsedAt = typeof raw.acceptedAt === "string" ? Date.parse(raw.acceptedAt) : Number.NaN;
  return {
    actorId: typeof raw.actorId === "string" ? raw.actorId : undefined,
    recordedAt: Number.isFinite(parsedAt) ? parsedAt : undefined,
    raw
  };
}

import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { appendAudit, requireActor, requireSameOrganization, requireServiceKey } from "./model/access";
import { canClaimOperation, chooseExistingOperation, nextOperationState } from "./model/operationState";

const operationTypeValidator = v.union(
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
  v.literal("annul_manifest_fulfillment"),
  v.literal("upsert_third_party"),
  v.literal("upsert_vehicle"),
  v.literal("reconcile"),
  v.literal("query_acceptance")
);

const statusValidator = v.union(
  v.literal("queued"),
  v.literal("claimed"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("uncertain"),
  v.literal("reconciling"),
  v.literal("cancelled")
);

const modeValidator = v.union(v.literal("dry-run"), v.literal("live"));

const operationValidator = v.object({
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
  createdBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number()
});

const attemptValidator = v.object({
  _id: v.id("rndcAttempts"),
  _creationTime: v.number(),
  organizationId: v.optional(v.id("organizations")),
  rndcOperationId: v.optional(v.id("rndcOperations")),
  documentId: v.optional(v.id("documents")),
  tripId: v.optional(v.id("trips")),
  operation: v.string(),
  action: v.string(),
  attemptNumber: v.optional(v.number()),
  title: v.optional(v.string()),
  procesoId: v.optional(v.number()),
  status: v.string(),
  mode: v.optional(modeValidator),
  radicado: v.optional(v.string()),
  requestXmlStorageId: v.optional(v.id("_storage")),
  responseXmlStorageId: v.optional(v.id("_storage")),
  requestPath: v.optional(v.string()),
  responsePath: v.optional(v.string()),
  errorText: v.optional(v.string()),
  createdAt: v.number(),
  finishedAt: v.optional(v.number())
});

const enqueueInputValidator = {
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

const enqueueResultValidator = v.object({
  operationId: v.id("rndcOperations"),
  created: v.boolean(),
  status: statusValidator
});

type EnqueueInput = {
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

export const enqueue = mutation({
  args: { actorToken: v.optional(v.string()), ...enqueueInputValidator },
  returns: enqueueResultValidator,
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    requireSameOrganization(actor, args.organizationId);
    const { actorToken: _actorToken, ...input } = args;
    return await enqueueOperation(ctx, input, actor._id, "user");
  }
});

export const enqueueFromService = mutation({
  args: { serviceKey: v.string(), createdBy: v.id("users"), ...enqueueInputValidator },
  returns: enqueueResultValidator,
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    const actor = await ctx.db.get("users", args.createdBy);

    if (!actor || actor.organizationId !== args.organizationId || actor.status !== "active") {
      throw new ConvexError({ code: "FORBIDDEN", message: "Invalid operation actor" });
    }

    const { serviceKey: _serviceKey, createdBy: _createdBy, ...input } = args;
    return await enqueueOperation(ctx, input, actor._id, "service");
  }
});

export const claimById = mutation({
  args: {
    serviceKey: v.string(),
    operationId: v.id("rndcOperations"),
    workerId: v.string(),
    leaseMs: v.optional(v.number())
  },
  returns: v.union(operationValidator, v.null()),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    const operation = await ctx.db.get("rndcOperations", args.operationId);
    const now = Date.now();

    if (!operation || !canClaimOperation(operation, now)) {
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

    const leaseExpiresAt = now + normalizeLeaseMs(args.leaseMs);
    await ctx.db.patch("rndcOperations", operation._id, {
      status: nextOperationState(operation.status, "claim"),
      attemptCount: operation.attemptCount + 1,
      leaseOwner: args.workerId,
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
      detailsJson: JSON.stringify({ workerId: args.workerId, leaseExpiresAt }),
      createdAt: now
    });
    return await ctx.db.get("rndcOperations", operation._id);
  }
});

export const claimNext = mutation({
  args: { serviceKey: v.string(), workerId: v.string(), leaseMs: v.optional(v.number()) },
  returns: v.union(operationValidator, v.null()),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    const now = Date.now();
    const leaseMs = normalizeLeaseMs(args.leaseMs);
    const expired = await ctx.db
      .query("rndcOperations")
      .withIndex("by_status_and_lease_expiration", (q) => q.eq("status", "claimed").lte("leaseExpiresAt", now))
      .order("asc")
      .first();

    if (expired) {
      await ctx.db.patch("rndcOperations", expired._id, {
        status: "uncertain",
        uncertainAt: now,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        lastError: "Worker lease expired before a final result was recorded",
        updatedAt: now
      });
      await appendAudit(ctx, {
        organizationId: expired.organizationId,
        actorType: "service",
        action: "rndc_operation.lease_expired",
        entityType: "rndc_operation",
        entityId: expired._id,
        createdAt: now
      });
    }

    const operation = await ctx.db
      .query("rndcOperations")
      .withIndex("by_status_and_available_at", (q) => q.eq("status", "queued").lte("availableAt", now))
      .order("asc")
      .first();

    if (!operation) {
      return null;
    }

    if (!canClaimOperation(operation, now)) {
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

    await ctx.db.patch("rndcOperations", operation._id, {
      status: nextOperationState(operation.status, "claim"),
      attemptCount: operation.attemptCount + 1,
      leaseOwner: args.workerId,
      leaseExpiresAt: now + leaseMs,
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
      detailsJson: JSON.stringify({ workerId: args.workerId, leaseExpiresAt: now + leaseMs }),
      createdAt: now
    });

    const claimed = await ctx.db.get("rndcOperations", operation._id);
    return claimed;
  }
});

export const renewLease = mutation({
  args: {
    serviceKey: v.string(),
    operationId: v.id("rndcOperations"),
    workerId: v.string(),
    leaseMs: v.optional(v.number())
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    const operation = await requireWorkerLease(ctx, args.operationId, args.workerId, ["claimed", "reconciling"]);
    const leaseExpiresAt = Date.now() + normalizeLeaseMs(args.leaseMs);
    await ctx.db.patch("rndcOperations", operation._id, { leaseExpiresAt, updatedAt: Date.now() });
    return leaseExpiresAt;
  }
});

export const finish = mutation({
  args: {
    serviceKey: v.string(),
    operationId: v.id("rndcOperations"),
    workerId: v.string(),
    outcome: v.union(v.literal("succeeded"), v.literal("failed"), v.literal("uncertain")),
    radicado: v.optional(v.string()),
    resultJson: v.optional(v.string()),
    errorText: v.optional(v.string())
  },
  returns: statusValidator,
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    const operation = await requireWorkerLease(ctx, args.operationId, args.workerId, ["claimed"]);
    const now = Date.now();
    const event = args.outcome === "succeeded" ? "succeed" : args.outcome === "failed" ? "fail" : "mark_uncertain";
    const status = nextOperationState(operation.status, event);
    await ctx.db.patch("rndcOperations", operation._id, {
      status,
      completedAt: status === "uncertain" ? undefined : now,
      uncertainAt: status === "uncertain" ? now : undefined,
      resultRadicado: args.radicado,
      resultJson: args.resultJson,
      lastError: args.errorText,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now
    });
    await ctx.db.insert("rndcAttempts", {
      organizationId: operation.organizationId,
      rndcOperationId: operation._id,
      documentId: operation.documentId,
      operation: operation.operationType,
      action: operation.operationType,
      attemptNumber: operation.attemptCount,
      procesoId: operation.procesoId,
      status,
      mode: operation.mode,
      radicado: args.radicado,
      errorText: args.errorText,
      createdAt: operation.claimedAt ?? now,
      finishedAt: now
    });
    await appendAudit(ctx, {
      organizationId: operation.organizationId,
      actorType: "service",
      action: `rndc_operation.${status}`,
      entityType: "rndc_operation",
      entityId: operation._id,
      createdAt: now
    });
    return status;
  }
});

export const beginReconciliation = mutation({
  args: {
    serviceKey: v.string(),
    operationId: v.id("rndcOperations"),
    workerId: v.string(),
    leaseMs: v.optional(v.number())
  },
  returns: statusValidator,
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    const operation = await ctx.db.get("rndcOperations", args.operationId);

    if (!operation || operation.status !== "uncertain") {
      throw new ConvexError({ code: "INVALID_STATE", message: "Only uncertain operations can be reconciled" });
    }

    const now = Date.now();
    const status = nextOperationState(operation.status, "begin_reconciliation");
    await ctx.db.patch("rndcOperations", operation._id, {
      status,
      leaseOwner: args.workerId,
      leaseExpiresAt: now + normalizeLeaseMs(args.leaseMs),
      claimedAt: now,
      updatedAt: now
    });
    await appendAudit(ctx, {
      organizationId: operation.organizationId,
      actorType: "service",
      action: "rndc_operation.reconciliation_started",
      entityType: "rndc_operation",
      entityId: operation._id,
      createdAt: now
    });
    return status;
  }
});

export const finishReconciliation = mutation({
  args: {
    serviceKey: v.string(),
    operationId: v.id("rndcOperations"),
    workerId: v.string(),
    result: v.union(v.literal("confirmed_succeeded"), v.literal("confirmed_failed"), v.literal("still_uncertain")),
    radicado: v.optional(v.string()),
    resultJson: v.optional(v.string()),
    errorText: v.optional(v.string())
  },
  returns: statusValidator,
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    const operation = await requireWorkerLease(ctx, args.operationId, args.workerId, ["reconciling"]);
    const now = Date.now();
    const event =
      args.result === "confirmed_succeeded"
        ? "confirm_succeeded"
        : args.result === "confirmed_failed"
          ? "confirm_failed"
          : "remain_uncertain";
    const status = nextOperationState(operation.status, event);
    await ctx.db.patch("rndcOperations", operation._id, {
      status,
      completedAt: status === "uncertain" ? undefined : now,
      uncertainAt: status === "uncertain" ? now : operation.uncertainAt,
      resultRadicado: args.radicado ?? operation.resultRadicado,
      resultJson: args.resultJson,
      lastError: args.errorText,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now
    });
    await ctx.db.insert("rndcAttempts", {
      organizationId: operation.organizationId,
      rndcOperationId: operation._id,
      documentId: operation.documentId,
      operation: operation.operationType,
      action: "reconciliation",
      attemptNumber: operation.attemptCount,
      procesoId: operation.procesoId,
      status,
      mode: operation.mode,
      radicado: args.radicado,
      errorText: args.errorText,
      createdAt: operation.claimedAt ?? now,
      finishedAt: now
    });
    await appendAudit(ctx, {
      organizationId: operation.organizationId,
      actorType: "service",
      action: `rndc_operation.reconciled_${status}`,
      entityType: "rndc_operation",
      entityId: operation._id,
      createdAt: now
    });
    return status;
  }
});

export const retryFailed = mutation({
  args: {
    actorToken: v.optional(v.string()),
    operationId: v.id("rndcOperations"),
    reason: v.string(),
    availableAt: v.optional(v.number())
  },
  returns: statusValidator,
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const operation = await ctx.db.get("rndcOperations", args.operationId);

    if (!operation) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Operation not found" });
    }

    requireSameOrganization(actor, operation.organizationId);

    if (operation.status !== "failed" || operation.attemptCount >= operation.maxAttempts) {
      throw new ConvexError({ code: "INVALID_STATE", message: "Operation cannot be retried" });
    }

    const now = Date.now();
    const status = nextOperationState(operation.status, "retry");
    await ctx.db.patch("rndcOperations", operation._id, {
      status,
      availableAt: args.availableAt ?? now,
      completedAt: undefined,
      lastError: undefined,
      updatedAt: now
    });
    await appendAudit(ctx, {
      organizationId: operation.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "rndc_operation.retry_requested",
      entityType: "rndc_operation",
      entityId: operation._id,
      reason: args.reason,
      createdAt: now
    });
    return status;
  }
});

export const cancel = mutation({
  args: { actorToken: v.optional(v.string()), operationId: v.id("rndcOperations"), reason: v.string() },
  returns: statusValidator,
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin"]);
    const operation = await ctx.db.get("rndcOperations", args.operationId);

    if (!operation) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Operation not found" });
    }

    requireSameOrganization(actor, operation.organizationId);
    const status = nextOperationState(operation.status, "cancel");
    const now = Date.now();
    await ctx.db.patch("rndcOperations", operation._id, {
      status,
      completedAt: now,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now
    });
    await appendAudit(ctx, {
      organizationId: operation.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "rndc_operation.cancelled",
      entityType: "rndc_operation",
      entityId: operation._id,
      reason: args.reason,
      createdAt: now
    });
    return status;
  }
});

export const get = query({
  args: { actorToken: v.optional(v.string()), operationId: v.id("rndcOperations") },
  returns: v.union(operationValidator, v.null()),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    const operation = await ctx.db.get("rndcOperations", args.operationId);

    if (!operation) {
      return null;
    }

    requireSameOrganization(actor, operation.organizationId);
    return operation;
  }
});

export const getForService = query({
  args: { serviceKey: v.string(), operationId: v.id("rndcOperations") },
  returns: v.union(operationValidator, v.null()),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    return await ctx.db.get("rndcOperations", args.operationId);
  }
});

export const listByStatusForService = query({
  args: { serviceKey: v.string(), status: statusValidator, limit: v.optional(v.number()) },
  returns: v.array(operationValidator),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    return await ctx.db
      .query("rndcOperations")
      .withIndex("by_status_and_available_at", (q) => q.eq("status", args.status))
      .order("asc")
      .take(Math.min(Math.max(args.limit ?? 100, 1), 250));
  }
});

export const listForExpediente = query({
  args: { actorToken: v.optional(v.string()), expedienteId: v.id("expedientes"), limit: v.optional(v.number()) },
  returns: v.array(operationValidator),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    const expediente = await ctx.db.get("expedientes", args.expedienteId);

    if (!expediente) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Expediente not found" });
    }

    requireSameOrganization(actor, expediente.organizationId);
    return await ctx.db
      .query("rndcOperations")
      .withIndex("by_expediente_and_created_at", (q) => q.eq("expedienteId", args.expedienteId))
      .order("desc")
      .take(Math.min(Math.max(args.limit ?? 100, 1), 200));
  }
});

export const listAttempts = query({
  args: { actorToken: v.optional(v.string()), operationId: v.id("rndcOperations") },
  returns: v.array(attemptValidator),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    const operation = await ctx.db.get("rndcOperations", args.operationId);

    if (!operation) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Operation not found" });
    }

    requireSameOrganization(actor, operation.organizationId);
    return await ctx.db
      .query("rndcAttempts")
      .withIndex("by_rndc_operation", (q) => q.eq("rndcOperationId", operation._id))
      .order("desc")
      .take(100);
  }
});

export const listAttemptsForService = query({
  args: { serviceKey: v.string(), operationId: v.id("rndcOperations") },
  returns: v.array(attemptValidator),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    return await ctx.db
      .query("rndcAttempts")
      .withIndex("by_rndc_operation", (q) => q.eq("rndcOperationId", args.operationId))
      .order("desc")
      .take(100);
  }
});

async function enqueueOperation(
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

    if (!requestKeyRecord) {
      await ctx.db.insert("rndcRequestKeys", {
        organizationId: input.organizationId,
        requestKey,
        operationId: existing._id,
        createdAt: Date.now()
      });
    }

    return { operationId: existing._id, created: false, status: existing.status };
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

async function validateReferences(ctx: MutationCtx, input: EnqueueInput): Promise<void> {
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

  if (
    (expediente && document?.expedienteId && document.expedienteId !== expediente._id) ||
    (expediente && remesa?.expedienteId && remesa.expedienteId !== expediente._id) ||
    (document && remesa?.documentId && remesa.documentId !== document._id)
  ) {
    throw new ConvexError({ code: "CONFLICT", message: "Operation references do not belong to the same expediente" });
  }
}

async function requireWorkerLease(
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

function validateQueueInput(input: EnqueueInput): void {
  if (!input.requestKey.trim() || !input.businessKey.trim()) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "Request and business keys are required" });
  }

  try {
    JSON.parse(input.payloadJson);
  } catch {
    throw new ConvexError({ code: "INVALID_INPUT", message: "Operation payload must be valid JSON" });
  }
}

function normalizeLeaseMs(leaseMs?: number): number {
  return Math.min(Math.max(leaseMs ?? 60_000, 5_000), 300_000);
}

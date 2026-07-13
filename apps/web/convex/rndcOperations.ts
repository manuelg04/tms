import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { appendAudit, requireActor, requireSameOrganization, requireServiceKey } from "./model/access";
import { blocksAnotherDocumentOperation, canClaimOperation, chooseExistingOperation, nextOperationState } from "./model/operationState";
import { operationIntentMatches } from "./model/operationIntent";
import { applyDocumentEvent, initialDocumentLifecycle, type DocumentLifecycle } from "./model/documentLifecycle";
import { applyLifecycle, recordAcceptance } from "./officialDocuments";
import {
  bindPayloadToPersistedDocument,
  lifecyclePlanForOperation,
  liveOperationBlocked,
  manifestIssuanceOperationMatches,
  readManifestIssuanceRadicado,
  readOperationDocumentNumber
} from "./model/officialDocumentIdentity";
import {
  preparePersistedReconciliationTarget,
  readExpectedReconciliationIdentity,
  readReconciliationIdentity,
  readReconciliationRadicado,
  resolveReconciliationOutcome
} from "./model/reconciliationOutcome";

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
  reconciledByOperationId: v.optional(v.id("rndcOperations")),
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

    if (operation.mode === "live" && officialLiveWriteBlocked(operation.operationType)) {
      await failUnclaimableOperation(ctx, operation, "Official write actions remain disabled in live mode");
      return null;
    }

    if (lifecyclePlanForOperation(operation.operationType)) {
      throw new ConvexError({ code: "INVALID_STATE", message: "Document operations require an atomic lifecycle claim" });
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

export const claimDocumentById = mutation({
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

    if (!operation) {
      return null;
    }

    return await claimPersistedDocumentOperation(ctx, operation, args.workerId, args.leaseMs);
  }
});

export const recoverStaleDocumentOperationsFromService = mutation({
  args: {
    serviceKey: v.string(),
    documentId: v.id("documents")
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    const now = Date.now();
    const document = await ctx.db.get("documents", args.documentId);

    if (!document) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Persisted document not found" });
    }

    const claimed = await ctx.db
      .query("rndcOperations")
      .withIndex("by_document_and_status", (q) => q.eq("documentId", args.documentId).eq("status", "claimed"))
      .collect();
    let expired = 0;

    for (const operation of claimed) {
      if (operation.leaseExpiresAt && operation.leaseExpiresAt > now) {
        continue;
      }

      await ctx.db.patch("rndcOperations", operation._id, {
        status: "uncertain",
        uncertainAt: now,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        lastError: "Operation lease expired before a final result was recorded",
        updatedAt: now
      });
      await appendAudit(ctx, {
        organizationId: operation.organizationId,
        actorType: "service",
        action: "rndc_operation.lease_expired",
        entityType: "rndc_operation",
        entityId: operation._id,
        createdAt: now
      });
      expired += 1;
    }

    const queued = await ctx.db
      .query("rndcOperations")
      .withIndex("by_document_and_status", (q) => q.eq("documentId", args.documentId).eq("status", "queued"))
      .collect();

    for (const operation of queued) {
      const plan = lifecyclePlanForOperation(operation.operationType);
      const payload = parseObjectJson(operation.payloadJson);

      if (!plan) {
        continue;
      }

      const bound = payload
        ? bindPayloadToPersistedDocument({
            operationType: operation.operationType,
            payload,
            documentKind: document.kind,
            documentNumber: document.number,
            documentIssuanceRadicado: document.issuanceRadicado,
            documentRndcRadicado: document.rndcRadicado,
            documentOfficialState: document.officialState,
            documentStatus: document.status,
            documentFulfillmentState: document.fulfillmentState
          })
        : undefined;
      const invalid = !bound?.ok
        || (document.mode ?? "dry-run") !== operation.mode
        || (operation.mode === "live" && officialLiveWriteBlocked(operation.operationType))
        || !canStartLifecycle(document, plan.started);

      if (invalid) {
        await failUnclaimableOperation(ctx, operation, "Queued document operation failed durable validation");
        expired += 1;
      }
    }

    return expired;
  }
});

export const backfillManifestIssuanceRadicadoFromService = mutation({
  args: {
    serviceKey: v.string(),
    organizationId: v.id("organizations"),
    expedienteId: v.id("expedientes"),
    documentId: v.id("documents"),
    manifestNumber: v.string(),
    mode: modeValidator
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    const document = await ctx.db.get("documents", args.documentId);
    const expediente = await ctx.db.get("expedientes", args.expedienteId);
    const manifestNumber = args.manifestNumber.trim();

    if (
      !document
      || !expediente
      || document.kind !== "manifiesto"
      || document.organizationId !== args.organizationId
      || document.expedienteId !== args.expedienteId
      || (document.mode ?? "dry-run") !== args.mode
      || document.number?.trim() !== manifestNumber
      || expediente.organizationId !== args.organizationId
      || expediente.manifestNumber?.trim() !== manifestNumber
      || (expediente.manifestDocumentId && expediente.manifestDocumentId !== document._id)
    ) {
      return null;
    }

    if (document.issuanceRadicado) {
      return document.issuanceRadicado;
    }

    const operations = await ctx.db
      .query("rndcOperations")
      .withIndex("by_document_and_status", (q) => q.eq("documentId", document._id).eq("status", "succeeded"))
      .collect();
    const radicados: string[] = [];

    for (const operation of operations) {
      const payload = parseObjectJson(operation.payloadJson);
      const matches = manifestIssuanceOperationMatches({
        document: {
          id: document._id,
          organizationId: args.organizationId,
          expedienteId: args.expedienteId,
          kind: document.kind,
          number: document.number,
          mode: document.mode
        },
        operation: {
          organizationId: operation.organizationId,
          expedienteId: operation.expedienteId,
          documentId: operation.documentId,
          operationType: operation.operationType,
          status: operation.status,
          mode: operation.mode,
          payload
        }
      });
      const radicado = matches ? operation.resultRadicado?.trim() : undefined;

      if (radicado && await hasCompleteOperationEvidence(ctx, operation._id)) {
        radicados.push(radicado);
      }
    }

    const uniqueRadicados = [...new Set(radicados)];

    if (uniqueRadicados.length === 0) {
      return null;
    }

    if (uniqueRadicados.length > 1) {
      throw new ConvexError({ code: "CONFLICT", message: "Multiple verified manifest issuance radicados require manual review" });
    }

    const issuanceRadicado = uniqueRadicados[0];
    const now = Date.now();
    await ctx.db.patch("documents", document._id, { issuanceRadicado, updatedAt: now });
    await appendAudit(ctx, {
      organizationId: args.organizationId,
      actorType: "service",
      action: "official_document.issuance_radicado_backfilled",
      entityType: "document",
      entityId: document._id,
      detailsJson: JSON.stringify({ issuanceRadicado }),
      createdAt: now
    });
    return issuanceRadicado;
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
      .withIndex("by_status_and_lease_expiration", (q) => q.eq("status", "claimed"))
      .order("asc")
      .first();

    if (expired && (!expired.leaseExpiresAt || expired.leaseExpiresAt <= now)) {
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

    if (lifecyclePlanForOperation(operation.operationType)) {
      return await claimPersistedDocumentOperation(ctx, operation, args.workerId, args.leaseMs);
    }

    if (operation.mode === "live" && officialLiveWriteBlocked(operation.operationType)) {
      await failUnclaimableOperation(ctx, operation, "Official write actions remain disabled in live mode");
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

    if (lifecyclePlanForOperation(operation.operationType) || operation.operationType === "query_acceptance") {
      throw new ConvexError({ code: "INVALID_STATE", message: "Document operations require atomic finalization" });
    }

    if (args.outcome === "succeeded") {
      await requireCompleteOperationEvidence(ctx, operation._id);
    }

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

export const finishDocumentOperationFromService = mutation({
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
    const plan = lifecyclePlanForOperation(operation.operationType);

    if (!plan || !operation.documentId) {
      throw new ConvexError({ code: "INVALID_STATE", message: "Operation is not a persisted document action" });
    }

    const document = await ctx.db.get("documents", operation.documentId);
    const payload = parseObjectJson(operation.payloadJson);

    if (!document || !document.organizationId || !payload || (document.mode ?? "dry-run") !== operation.mode) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Persisted operation document could not be loaded" });
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
      throw new ConvexError({ code: "CONFLICT", message: boundPayload.error });
    }

    if (args.outcome === "succeeded") {
      if (!args.radicado?.trim()) {
        throw new ConvexError({ code: "CONFLICT", message: "Successful document operation requires an RNDC radicado" });
      }
      await requireCompleteOperationEvidence(ctx, operation._id);
    }

    const now = Date.now();
    const event = args.outcome === "succeeded" ? "succeed" : args.outcome === "failed" ? "fail" : "mark_uncertain";
    const status = nextOperationState(operation.status, event);
    const detailsJson = JSON.stringify({ operationId: operation._id, outcome: args.outcome });

    if (args.outcome !== "uncertain") {
      await applyLifecycle(ctx, {
        documentId: document._id,
        rndcOperationId: operation._id,
        event: args.outcome === "succeeded" ? plan.succeeded : plan.rejected,
        radicado: args.radicado,
        errorText: args.errorText,
        detailsJson,
        actorType: "service"
      });
    }

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

export const finishAcceptanceQueryFromService = mutation({
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

    if (operation.operationType !== "query_acceptance" || !operation.documentId) {
      throw new ConvexError({ code: "INVALID_STATE", message: "Operation is not an acceptance query" });
    }

    const document = await ctx.db.get("documents", operation.documentId);
    const payload = parseObjectJson(operation.payloadJson);
    const result = parseObjectJson(args.resultJson);
    const issuanceRadicado = document
      ? readManifestIssuanceRadicado({
          documentKind: document.kind,
          issuanceRadicado: document.issuanceRadicado,
          rndcRadicado: document.rndcRadicado,
          officialState: document.officialState,
          status: document.status,
          fulfillmentState: document.fulfillmentState
        })
      : undefined;

    if (
      !document
      || document.kind !== "manifiesto"
      || (document.mode ?? "dry-run") !== operation.mode
      || !issuanceRadicado
      || payload?.manifestRadicado !== issuanceRadicado
    ) {
      throw new ConvexError({ code: "CONFLICT", message: "Acceptance query does not match the persisted manifest issuance" });
    }

    if (args.outcome === "succeeded") {
      await requireCompleteOperationEvidence(ctx, operation._id);
      const acceptance = readMatchingAcceptance(result, issuanceRadicado);

      if (acceptance) {
        if (!document.issuanceRadicado) {
          await ctx.db.patch("documents", document._id, { issuanceRadicado, updatedAt: Date.now() });
        }
        await recordAcceptance(ctx, {
          documentId: document._id,
          rndcOperationId: operation._id,
          state: "accepted",
          actorDocument: acceptance.actorId,
          recordedAt: acceptance.recordedAt,
          detailsJson: JSON.stringify(acceptance.raw)
        });
      }
    }

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

export const confirmExactReconciliationFromService = mutation({
  args: {
    serviceKey: v.string(),
    operationId: v.id("rndcOperations"),
    reconciliationOperationId: v.id("rndcOperations")
  },
  returns: v.object({
    status: v.literal("succeeded"),
    documentId: v.id("documents"),
    radicado: v.string(),
    idempotent: v.boolean()
  }),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    const operation = await ctx.db.get("rndcOperations", args.operationId);
    const reconciliationOperation = await ctx.db.get("rndcOperations", args.reconciliationOperationId);

    if (!operation || !operation.documentId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Reconciliation target operation not found" });
    }

    const document = await ctx.db.get("documents", operation.documentId);

    if (!document || !document.organizationId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Reconciliation target document not found" });
    }

    if ((document.mode ?? "dry-run") !== operation.mode) {
      throw new ConvexError({ code: "CONFLICT", message: "Reconciliation mode does not match the persisted document" });
    }

    if (
      !reconciliationOperation
      || reconciliationOperation.operationType !== "reconcile"
      || reconciliationOperation.status !== "succeeded"
      || reconciliationOperation.organizationId !== operation.organizationId
      || reconciliationOperation.expedienteId !== operation.expedienteId
      || reconciliationOperation.documentId !== operation.documentId
      || reconciliationOperation.mode !== operation.mode
    ) {
      throw new ConvexError({ code: "CONFLICT", message: "Reconciliation operation does not match the target operation" });
    }

    if (
      operation.status === "succeeded"
      && operation.reconciledByOperationId === reconciliationOperation._id
      && operation.resultRadicado
    ) {
      return {
        status: "succeeded" as const,
        documentId: document._id,
        radicado: operation.resultRadicado,
        idempotent: true
      };
    }

    const originalPayload = parseObjectJson(operation.payloadJson);
    const target = preparePersistedReconciliationTarget({
      operationType: operation.operationType,
      operationStatus: operation.status,
      operationOrganizationId: operation.organizationId,
      operationExpedienteId: operation.expedienteId,
      operationDocumentId: operation.documentId,
      documentId: document._id,
      documentOrganizationId: document.organizationId,
      documentExpedienteId: document.expedienteId,
      documentKind: document.kind,
      documentNumber: document.number,
      operationPayload: originalPayload
    });

    if (!target) {
      throw new ConvexError({ code: "INVALID_STATE", message: "Operation cannot be reconciled against this document" });
    }

    const reconciliationPayload = parseObjectJson(reconciliationOperation.payloadJson);
    const reconciliationResult = parseObjectJson(reconciliationOperation.resultJson);
    const expectedIdentity = readExpectedReconciliationIdentity(reconciliationPayload);
    const returnedIdentity = readReconciliationIdentity(reconciliationResult);
    const radicado = readReconciliationRadicado(reconciliationResult);

    if (
      reconciliationPayload?.originalOperationId !== operation._id
      || !expectedIdentity
      || readOperationDocumentNumber(operation.operationType, originalPayload) !== target.identity.number
      || expectedIdentity.kind !== target.identity.kind
      || expectedIdentity.number.trim() !== target.identity.number.trim()
      || expectedIdentity.correctionCode !== target.identity.correctionCode
      || expectedIdentity.correctionReason !== target.identity.correctionReason
    ) {
      throw new ConvexError({ code: "CONFLICT", message: "Stored reconciliation identity does not match the target operation" });
    }

    const outcome = resolveReconciliationOutcome({
      expected: target.identity,
      reportedStatus: "accepted",
      returned: returnedIdentity,
      radicado
    });

    if (outcome.status !== "accepted" || !outcome.identityMatched || !radicado) {
      throw new ConvexError({ code: "CONFLICT", message: "RNDC did not confirm the exact persisted document identity" });
    }

    const evidence = await ctx.db
      .query("evidenceArtifacts")
      .withIndex("by_rndc_operation", (q) => q.eq("rndcOperationId", reconciliationOperation._id))
      .collect();
    const evidenceKinds = new Set(evidence.map((artifact) => artifact.kind));

    if (!evidenceKinds.has("request_xml") || !evidenceKinds.has("response_xml")) {
      throw new ConvexError({ code: "CONFLICT", message: "Reconciliation evidence is incomplete" });
    }

    const now = Date.now();
    const detailsJson = JSON.stringify({
      operationId: operation._id,
      reconciliationOperationId: reconciliationOperation._id,
      identity: target.identity,
      radicado
    });
    await applyLifecycle(ctx, {
      documentId: document._id,
      rndcOperationId: reconciliationOperation._id,
      event: "reconciliation_started",
      detailsJson,
      actorType: "service"
    });
    await applyLifecycle(ctx, {
      documentId: document._id,
      rndcOperationId: operation._id,
      event: target.lifecycleEvent,
      radicado,
      detailsJson,
      actorType: "service"
    });
    await applyLifecycle(ctx, {
      documentId: document._id,
      rndcOperationId: reconciliationOperation._id,
      event: "reconciliation_confirmed",
      radicado,
      detailsJson,
      actorType: "service"
    });
    const reconciling = nextOperationState(operation.status, "begin_reconciliation");
    const status = nextOperationState(reconciling, "confirm_succeeded");
    await ctx.db.patch("rndcOperations", operation._id, {
      status,
      completedAt: now,
      resultRadicado: radicado,
      lastError: undefined,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      reconciledByOperationId: reconciliationOperation._id,
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
      radicado,
      createdAt: operation.uncertainAt ?? now,
      finishedAt: now
    });
    await appendAudit(ctx, {
      organizationId: operation.organizationId,
      actorType: "service",
      action: "rndc_operation.reconciled_succeeded",
      entityType: "rndc_operation",
      entityId: operation._id,
      detailsJson,
      createdAt: now
    });
    return { status: "succeeded" as const, documentId: document._id, radicado, idempotent: false };
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

    if (operation.mode === "live" && officialLiveWriteBlocked(operation.operationType)) {
      throw new ConvexError({ code: "UNSUPPORTED_LIVE_OPERATION", message: "This operation cannot be retried in live mode" });
    }

    if (operation.documentId && lifecyclePlanForOperation(operation.operationType)) {
      const active = await findBlockingDocumentOperation(ctx, operation.documentId, operation._id, true);

      if (active) {
        throw new ConvexError({ code: "OPERATION_IN_PROGRESS", message: "Another official action is active for this document" });
      }
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

    const lifecyclePlan = lifecyclePlanForOperation(operation.operationType);

    if (lifecyclePlan && operation.status !== "queued" && operation.status !== "failed") {
      const canDiscardDryRun = operation.mode === "dry-run"
        && operation.status === "uncertain"
        && operation.documentId;

      if (!canDiscardDryRun) {
        throw new ConvexError({ code: "INVALID_STATE", message: "Sent document operations must be reconciled instead of cancelled" });
      }

      await applyLifecycle(ctx, {
        documentId: operation.documentId as Id<"documents">,
        rndcOperationId: operation._id,
        event: lifecyclePlan.rejected === "attempt_rejected" ? "submission_abandoned" : lifecyclePlan.rejected,
        reason: args.reason,
        actorType: "user",
        actorId: actor._id
      });
    }

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

export const validateDurableContextForService = query({
  args: {
    serviceKey: v.string(),
    organizationId: v.id("organizations"),
    expedienteId: v.optional(v.id("expedientes")),
    documentId: v.optional(v.id("documents")),
    operationId: v.id("rndcOperations"),
    mode: modeValidator,
    operationType: operationTypeValidator,
    leaseOwner: v.string(),
    payloadJson: v.string()
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    const operation = await ctx.db.get("rndcOperations", args.operationId);

    return Boolean(
      operation
      && operation.status === "claimed"
      && operation.organizationId === args.organizationId
      && operation.expedienteId === args.expedienteId
      && operation.documentId === args.documentId
      && operation.mode === args.mode
      && operation.operationType === args.operationType
      && operation.leaseOwner === args.leaseOwner
      && operation.payloadJson === args.payloadJson
      && operation.leaseExpiresAt
      && operation.leaseExpiresAt > Date.now()
    );
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

export const listUncertainForExpediente = query({
  args: { actorToken: v.optional(v.string()), expedienteId: v.id("expedientes") },
  returns: v.array(operationValidator),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    const expediente = await ctx.db.get("expedientes", args.expedienteId);

    if (!expediente) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Expediente not found" });
    }

    requireSameOrganization(actor, expediente.organizationId);
    const operations = await ctx.db
      .query("rndcOperations")
      .withIndex("by_expediente_and_status", (q) => q.eq("expedienteId", args.expedienteId).eq("status", "uncertain"))
      .order("desc")
      .collect();
    return operations.filter((operation) => Boolean(lifecyclePlanForOperation(operation.operationType)));
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

async function claimPersistedDocumentOperation(
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

async function findBlockingDocumentOperation(
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

async function requireCompleteOperationEvidence(ctx: MutationCtx, operationId: Id<"rndcOperations">): Promise<void> {
  if (!await hasCompleteOperationEvidence(ctx, operationId)) {
    throw new ConvexError({ code: "CONFLICT", message: "Durable RNDC request and response evidence are required" });
  }
}

async function hasCompleteOperationEvidence(ctx: MutationCtx, operationId: Id<"rndcOperations">): Promise<boolean> {
  const evidence = await ctx.db
    .query("evidenceArtifacts")
    .withIndex("by_rndc_operation", (q) => q.eq("rndcOperationId", operationId))
    .collect();
  const kinds = new Set(evidence.map((artifact) => artifact.kind));

  return kinds.has("request_xml") && kinds.has("response_xml");
}

async function failUnclaimableOperation(
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

function canStartLifecycle(document: Doc<"documents">, event: Parameters<typeof applyDocumentEvent>[1]): boolean {
  try {
    applyDocumentEvent(documentLifecycle(document), event);
    return true;
  } catch {
    return false;
  }
}

function documentLifecycle(document: Doc<"documents">): DocumentLifecycle {
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

function officialLiveWriteBlocked(operationType: string): boolean {
  return liveOperationBlocked(operationType, process.env.RNDC_LIVE_WRITES_ENABLED === "true");
}

function parseObjectJson(value: string | undefined): Record<string, unknown> | undefined {
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

function readMatchingAcceptance(
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

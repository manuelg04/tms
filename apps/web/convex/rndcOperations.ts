import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { appendAudit, requireActor, requireSameOrganization, requireServiceKey } from "./model/access";
import { canClaimOperation, nextOperationState } from "./model/operationState";
import { applyLifecycle, recordAcceptance } from "./officialDocuments";
import {
  bindPayloadToPersistedDocument,
  lifecyclePlanForOperation,
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
import {
  operationTypeValidator,
  statusValidator,
  modeValidator,
  operationValidator,
  enqueueInputValidator,
  enqueueResultValidator,
  enqueueOperation,
  claimPersistedDocumentOperation,
  requireWorkerLease,
  normalizeLeaseMs,
  requireCompleteOperationEvidence,
  hasCompleteOperationEvidence,
  failUnclaimableOperation,
  canStartLifecycle,
  officialLiveWriteBlocked,
  parseObjectJson,
  readMatchingAcceptance
} from "./model/rndcOperationRecords";

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

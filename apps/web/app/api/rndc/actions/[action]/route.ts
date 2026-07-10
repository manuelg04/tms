import { randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { getAuthSettings, createConvexToken, jsonResponse } from "../../../../lib/auth-server";
import { authorizeGatewayRequest, buildDurableEvidenceHeaders, durableEvidenceWasStored, forwardRndcRequest, safeRndcMode } from "../../../../lib/rndc-gateway";
import { getRndcActionConfig } from "../../../../lib/rndc-action-config";
import { resolveActionOutcome } from "../../../../lib/rndc-action-outcome";
import { durablePreflightMessage, validateDurableActionPayload } from "../../../../lib/rndc-action-preflight";
import {
  bindPayloadToPersistedDocument,
  lifecyclePlanForOperation
} from "../../../../../convex/model/officialDocumentIdentity";
import {
  preparePersistedReconciliationTarget,
  readReconciliationIdentity,
  readReconciliationRadicado,
  resolveReconciliationOutcome
} from "../../../../../convex/model/reconciliationOutcome";

type ActionBody = {
  organizationId?: unknown;
  expedienteId?: unknown;
  documentId?: unknown;
  expedienteRemesaId?: unknown;
  requestKey?: unknown;
  businessKey?: unknown;
  originalOperationId?: unknown;
  payload?: unknown;
  simulateTimeout?: unknown;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> }
): Promise<Response> {
  const authorization = authorizeGatewayRequest(request, "submit_rndc");

  if (authorization instanceof Response) {
    return authorization;
  }

  const { action } = await context.params;
  const actionConfig = getRndcActionConfig(action);

  if (!actionConfig) {
    return jsonResponse({ error: "RNDC action not found" }, 404);
  }

  const body = await request.json().catch(() => null) as ActionBody | null;
  const validated = validateActionBody(body);

  if (!validated.ok) {
    return jsonResponse({ error: validated.error }, 400);
  }

  if (!validated.documentId) {
    return jsonResponse({ error: "A persisted official document is required" }, 400);
  }

  const preflight = validateDurableActionPayload(actionConfig.operationType, validated.payload);

  if (!preflight.ok) {
    return jsonResponse({
      error: durablePreflightMessage(preflight),
      missingFields: preflight.missingFields,
      invalidFields: preflight.invalidFields
    }, 400);
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  const serviceKey = process.env.RNDC_INGEST_KEY;

  if (!convexUrl || !serviceKey) {
    return jsonResponse({ error: "Durable RNDC operations are not configured" }, 503);
  }

  const client = new ConvexHttpClient(convexUrl);
  const settings = getAuthSettings();
  client.setAuth(createConvexToken(authorization, settings));

  const detail = await client.query(api.expedientes.detail, {
    expedienteId: validated.expedienteId as Id<"expedientes">
  });
  let persistedDocument = detail?.documents.find((candidate) => candidate._id === validated.documentId);

  if (
    !detail
    || !persistedDocument
    || detail.expediente.organizationId !== validated.organizationId
    || (persistedDocument.mode ?? "dry-run") !== safeRndcMode()
  ) {
    return jsonResponse({ error: "The official document does not belong to the persisted expediente" }, 409);
  }

  if (
    actionConfig.operationType === "query_acceptance"
    && persistedDocument.kind === "manifiesto"
    && persistedDocument.number
    && !persistedDocument.issuanceRadicado
  ) {
    const issuanceRadicado = await client.mutation(api.rndcOperations.backfillManifestIssuanceRadicadoFromService, {
      serviceKey,
      organizationId: validated.organizationId as Id<"organizations">,
      expedienteId: validated.expedienteId as Id<"expedientes">,
      documentId: validated.documentId as Id<"documents">,
      manifestNumber: persistedDocument.number,
      mode: safeRndcMode()
    });

    if (issuanceRadicado) {
      persistedDocument = { ...persistedDocument, issuanceRadicado };
    }
  }

  let reconciliationTarget: ReturnType<typeof preparePersistedReconciliationTarget>;
  let originalOperationId: Id<"rndcOperations"> | undefined;
  let effectivePayload = validated.payload;

  if (action === "reconcile") {
    if (!validated.originalOperationId) {
      return jsonResponse({ error: "An exact uncertain operation is required for reconciliation" }, 400);
    }

    originalOperationId = validated.originalOperationId as Id<"rndcOperations">;
    const operation = await client.query(api.rndcOperations.get, { operationId: originalOperationId });

    if (
      !operation
      || operation.organizationId !== validated.organizationId
      || operation.expedienteId !== validated.expedienteId
      || operation.documentId !== validated.documentId
    ) {
      return jsonResponse({ error: "The reconciliation target does not match the persisted expediente" }, 409);
    }

    reconciliationTarget = preparePersistedReconciliationTarget({
      operationType: operation.operationType,
      operationStatus: operation.status,
      operationOrganizationId: operation.organizationId,
      operationExpedienteId: operation.expedienteId,
      operationDocumentId: operation.documentId,
      documentId: persistedDocument._id,
      documentOrganizationId: detail.expediente.organizationId,
      documentExpedienteId: detail.expediente._id,
      documentKind: persistedDocument.kind,
      documentNumber: persistedDocument.number,
      operationPayload: parseJson(operation.payloadJson)
    });

    if (!reconciliationTarget) {
      return jsonResponse({ error: "The selected operation cannot be reconciled against this document" }, 409);
    }

    effectivePayload = {
      documentType: reconciliationTarget.identity.kind,
      documentNumber: reconciliationTarget.identity.number,
      correctionCode: reconciliationTarget.identity.correctionCode,
      correctionReason: reconciliationTarget.identity.correctionReason,
      originalOperationId
    };
  } else {
    const boundPayload = bindPayloadToPersistedDocument({
      operationType: actionConfig.operationType,
      payload: validated.payload,
      documentKind: persistedDocument.kind,
      documentNumber: persistedDocument.number,
      documentIssuanceRadicado: persistedDocument.issuanceRadicado,
      documentRndcRadicado: persistedDocument.rndcRadicado,
      documentOfficialState: persistedDocument.officialState,
      documentStatus: persistedDocument.status,
      documentFulfillmentState: persistedDocument.fulfillmentState
    });

    if (!boundPayload.ok) {
      return jsonResponse({ error: boundPayload.error }, 409);
    }

    effectivePayload = boundPayload.payload;
  }

  const payloadJson = JSON.stringify(effectivePayload);
  await client.mutation(api.rndcOperations.recoverStaleDocumentOperationsFromService, {
    serviceKey,
    documentId: validated.documentId as Id<"documents">
  });
  const queued = await client.mutation(api.rndcOperations.enqueue, {
    organizationId: validated.organizationId as Id<"organizations">,
    expedienteId: validated.expedienteId as Id<"expedientes">,
    documentId: validated.documentId as Id<"documents"> | undefined,
    expedienteRemesaId: validated.expedienteRemesaId as Id<"expedienteRemesas"> | undefined,
    operationType: actionConfig.operationType,
    procesoId: actionConfig.processId || undefined,
    mode: safeRndcMode(),
    requestKey: validated.requestKey,
    businessKey: validated.businessKey,
    payloadJson,
    maxAttempts: 3
  });
  const existing = await client.query(api.rndcOperations.get, { operationId: queued.operationId });

  if (
    !existing
    || existing.operationType !== actionConfig.operationType
    || existing.procesoId !== (actionConfig.processId || undefined)
    || existing.documentId !== validated.documentId
    || !isRecord(parseJson(existing.payloadJson))
  ) {
    return jsonResponse({ error: "Persisted RNDC operation does not match the requested action" }, 409);
  }

  const persistedPayloadJson = existing.payloadJson;

  if (!queued.created && existing?.status !== "queued") {
    const existingEvidence = existing?.status === "succeeded"
      ? await client.query(api.evidence.listForOperation, { operationId: queued.operationId })
      : [];
    const storedResult = parseJson(existing?.resultJson);
    const storedRadicado = action === "reconcile" ? readReconciliationRadicado(storedResult) : undefined;
    const storedReconciliationOutcome = action === "reconcile" && reconciliationTarget
      ? resolveReconciliationOutcome({
          expected: reconciliationTarget.identity,
          reportedStatus: existing?.status === "succeeded" ? "accepted" : "uncertain",
          returned: readReconciliationIdentity(storedResult),
          radicado: storedRadicado,
          errorText: existing?.lastError
        })
      : undefined;

    if (
      storedReconciliationOutcome?.status === "accepted"
      && storedReconciliationOutcome.identityMatched
      && originalOperationId
    ) {
      await client.mutation(api.rndcOperations.confirmExactReconciliationFromService, {
        serviceKey,
        operationId: originalOperationId,
        reconciliationOperationId: queued.operationId
      });
    }

    const replaySuccess = action === "reconcile"
      ? storedReconciliationOutcome?.status === "accepted" && storedReconciliationOutcome.identityMatched
      : existing?.status === "succeeded";
    return jsonResponse({
      ok: replaySuccess,
      operationId: queued.operationId,
      status: existing?.status ?? queued.status,
      idempotentReplay: true,
      evidenceStored: existingEvidence.length > 0,
      reconciliation: storedReconciliationOutcome,
      result: storedResult
    }, action === "reconcile"
      ? reconciliationResponseStatus(storedReconciliationOutcome, existing?.status === "succeeded" ? 200 : 409)
      : existing?.status === "succeeded" ? 200 : 409);
  }

  const workerId = `web-gateway-${randomUUID()}`;
  const claimArgs = {
    serviceKey,
    operationId: queued.operationId,
    workerId,
    leaseMs: 60_000
  } as const;
  const claimed = lifecyclePlanForOperation(actionConfig.operationType)
    ? await client.mutation(api.rndcOperations.claimDocumentById, claimArgs)
    : await client.mutation(api.rndcOperations.claimById, claimArgs);

  if (!claimed) {
    return jsonResponse({ error: "RNDC operation could not be claimed", operationId: queued.operationId }, 409);
  }

  const backendResponse = validated.simulateTimeout && process.env.NODE_ENV !== "production" && process.env.RNDC_ALLOW_TIMEOUT_SIMULATION === "true"
    ? jsonResponse({ error: "Simulated RNDC timeout for recovery verification" }, 504)
    : await forwardRndcRequest(actionConfig.backendPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": validated.requestKey,
          "X-Correlation-Id": queued.operationId,
          ...buildDurableEvidenceHeaders({
            organizationId: validated.organizationId,
            expedienteId: validated.expedienteId,
            documentId: validated.documentId,
            operationId: queued.operationId,
            operationType: actionConfig.operationType,
            leaseOwner: workerId
          })
        },
        body: persistedPayloadJson
      });
  const rawResult = await backendResponse.text();
  const result = parseJson(rawResult) ?? { error: rawResult || "RNDC operation failed" };
  const evidenceStored = durableEvidenceWasStored(result);
  const actionOutcome = resolveActionOutcome({
    backendOk: backendResponse.ok,
    backendStatus: backendResponse.status,
    evidenceStored
  });
  const radicado = extractRadicado(result);
  const errorText = actionOutcome.errorText ?? (backendResponse.ok ? undefined : extractError(result));
  const expectedReconciliationIdentity = action === "reconcile"
    ? reconciliationTarget?.identity
    : undefined;
  const reconciledRadicado = action === "reconcile" ? readReconciliationRadicado(result) : undefined;
  const reconciliationOutcome = action === "reconcile" && expectedReconciliationIdentity
    ? resolveReconciliationOutcome({
        expected: expectedReconciliationIdentity,
        reportedStatus: actionOutcome.lifecycleAccepted
          ? "accepted"
          : actionOutcome.operationOutcome === "uncertain"
            ? "uncertain"
            : "rejected",
        returned: readReconciliationIdentity(result),
        radicado: reconciledRadicado,
        errorText
      })
    : undefined;
  const finishArgs = {
    serviceKey,
    operationId: queued.operationId,
    workerId,
    outcome: actionOutcome.operationOutcome,
    radicado,
    resultJson: JSON.stringify(result),
    errorText
  } as const;
  const finalStatus = lifecyclePlanForOperation(actionConfig.operationType)
    ? await client.mutation(api.rndcOperations.finishDocumentOperationFromService, finishArgs)
    : actionConfig.operationType === "query_acceptance"
      ? await client.mutation(api.rndcOperations.finishAcceptanceQueryFromService, finishArgs)
    : await client.mutation(api.rndcOperations.finish, finishArgs);

  if (reconciliationOutcome?.status === "accepted" && reconciliationOutcome.identityMatched && originalOperationId) {
    await client.mutation(api.rndcOperations.confirmExactReconciliationFromService, {
      serviceKey,
      operationId: originalOperationId,
      reconciliationOperationId: queued.operationId
    });
  }

  const officialSuccess = action === "reconcile"
    ? reconciliationOutcome?.status === "accepted" && reconciliationOutcome.identityMatched
    : actionOutcome.lifecycleAccepted;
  const responseStatus = action === "reconcile"
    ? reconciliationResponseStatus(reconciliationOutcome, actionOutcome.responseStatus)
    : actionOutcome.responseStatus;
  return jsonResponse({
    ok: officialSuccess,
    operationId: queued.operationId,
    status: finalStatus,
    evidenceStored,
    reconciliation: reconciliationOutcome,
    result
  }, responseStatus);
}

function validateActionBody(body: ActionBody | null): { ok: true; organizationId: string; expedienteId: string; documentId?: string; expedienteRemesaId?: string; requestKey: string; businessKey: string; originalOperationId?: string; payload: Record<string, unknown>; simulateTimeout: boolean } | { ok: false; error: string } {
  if (!body || typeof body.organizationId !== "string" || typeof body.expedienteId !== "string") {
    return { ok: false, error: "Organization and expediente are required" };
  }

  if (typeof body.requestKey !== "string" || !body.requestKey.trim() || typeof body.businessKey !== "string" || !body.businessKey.trim()) {
    return { ok: false, error: "Request and business keys are required" };
  }

  if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) {
    return { ok: false, error: "A typed RNDC payload is required" };
  }

  if (body.documentId !== undefined && typeof body.documentId !== "string") {
    return { ok: false, error: "Invalid document reference" };
  }

  if (body.expedienteRemesaId !== undefined && typeof body.expedienteRemesaId !== "string") {
    return { ok: false, error: "Invalid remesa reference" };
  }

  if (body.originalOperationId !== undefined && typeof body.originalOperationId !== "string") {
    return { ok: false, error: "Invalid reconciliation operation reference" };
  }

  return {
    ok: true,
    organizationId: body.organizationId,
    expedienteId: body.expedienteId,
    documentId: body.documentId,
    expedienteRemesaId: body.expedienteRemesaId,
    originalOperationId: body.originalOperationId,
    requestKey: body.requestKey,
    businessKey: body.businessKey,
    payload: body.payload as Record<string, unknown>,
    simulateTimeout: body.simulateTimeout === true
  };
}

function reconciliationResponseStatus(
  outcome: ReturnType<typeof resolveReconciliationOutcome> | undefined,
  fallback: number
): number {
  if (!outcome) {
    return fallback;
  }

  if (outcome.status === "accepted") {
    return 200;
  }

  if (outcome.status === "pending" || outcome.reason === "missing_radicado" || outcome.reason === "reported_uncertain") {
    return 202;
  }

  return fallback >= 400 ? fallback : 409;
}

function parseJson(value: string | undefined): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractRadicado(result: unknown): string | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }

  const record = result as Record<string, unknown>;
  if (typeof record.radicado === "string") {
    return record.radicado;
  }

  if (Array.isArray(record.steps)) {
    const values = record.steps
      .map((step) => step && typeof step === "object" ? (step as Record<string, unknown>).radicado : undefined)
      .filter((value): value is string => typeof value === "string");
    return values.at(-1);
  }

  const response = record.response;
  return response && typeof response === "object" && typeof (response as Record<string, unknown>).radicado === "string"
    ? (response as Record<string, unknown>).radicado as string
    : undefined;
}

function extractError(result: unknown): string {
  if (!result || typeof result !== "object") {
    return "RNDC operation failed";
  }

  const record = result as Record<string, unknown>;
  if (typeof record.error === "string") {
    return record.error;
  }
  if (record.error && typeof record.error === "object" && typeof (record.error as Record<string, unknown>).message === "string") {
    return (record.error as Record<string, unknown>).message as string;
  }
  if (record.response && typeof record.response === "object" && typeof (record.response as Record<string, unknown>).errorText === "string") {
    return (record.response as Record<string, unknown>).errorText as string;
  }
  return "RNDC operation failed";
}

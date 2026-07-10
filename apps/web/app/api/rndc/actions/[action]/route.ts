import { randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { getAuthSettings, createConvexToken, jsonResponse } from "../../../../lib/auth-server";
import { authorizeGatewayRequest, buildDurableEvidenceHeaders, durableEvidenceWasStored, forwardRndcRequest, safeRndcMode } from "../../../../lib/rndc-gateway";
import { getRndcActionConfig, lifecycleEvents } from "../../../../lib/rndc-action-config";

type ActionBody = {
  organizationId?: unknown;
  expedienteId?: unknown;
  documentId?: unknown;
  expedienteRemesaId?: unknown;
  requestKey?: unknown;
  businessKey?: unknown;
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

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  const serviceKey = process.env.RNDC_INGEST_KEY;

  if (!convexUrl || !serviceKey) {
    return jsonResponse({ error: "Durable RNDC operations are not configured" }, 503);
  }

  const client = new ConvexHttpClient(convexUrl);
  const settings = getAuthSettings();
  client.setAuth(createConvexToken(authorization, settings));
  const payloadJson = JSON.stringify(validated.payload);
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

  if (!queued.created && existing?.status !== "queued") {
    const existingEvidence = existing?.status === "succeeded"
      ? await client.query(api.evidence.listForOperation, { operationId: queued.operationId })
      : [];
    return jsonResponse({
      ok: existing?.status === "succeeded",
      operationId: queued.operationId,
      status: existing?.status ?? queued.status,
      idempotentReplay: true,
      evidenceStored: existingEvidence.length > 0,
      result: parseJson(existing?.resultJson)
    }, existing?.status === "succeeded" ? 200 : 409);
  }

  const workerId = `web-gateway-${randomUUID()}`;
  const claimed = await client.mutation(api.rndcOperations.claimById, {
    serviceKey,
    operationId: queued.operationId,
    workerId,
    leaseMs: 60_000
  });

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
            operationId: queued.operationId
          })
        },
        body: payloadJson
      });
  const rawResult = await backendResponse.text();
  const result = parseJson(rawResult) ?? { error: rawResult || "RNDC operation failed" };
  const uncertain = backendResponse.status === 408 || backendResponse.status === 504;
  const outcome = backendResponse.ok ? "succeeded" : uncertain ? "uncertain" : "failed";
  const radicado = extractRadicado(result);
  const errorText = backendResponse.ok ? undefined : extractError(result);
  const finalStatus = await client.mutation(api.rndcOperations.finish, {
    serviceKey,
    operationId: queued.operationId,
    workerId,
    outcome,
    radicado,
    resultJson: JSON.stringify(result),
    errorText
  });
  const evidenceStored = durableEvidenceWasStored(result);

  if (validated.documentId && !uncertain && backendResponse.status !== 503) {
    const events = lifecycleEvents(actionConfig.lifecycle, backendResponse.ok);
    if (events) {
      await client.mutation(api.officialDocuments.applyLifecycleEventFromService, {
        serviceKey,
        documentId: validated.documentId as Id<"documents">,
        rndcOperationId: queued.operationId,
        event: events.started as never,
        detailsJson: JSON.stringify({ operationId: queued.operationId })
      });
      await client.mutation(api.officialDocuments.applyLifecycleEventFromService, {
        serviceKey,
        documentId: validated.documentId as Id<"documents">,
        rndcOperationId: queued.operationId,
        event: events.finished as never,
        radicado,
        errorText,
        detailsJson: JSON.stringify({ operationId: queued.operationId })
      });
    }
  }

  if (action === "query_acceptance" && validated.documentId && backendResponse.ok) {
    const acceptance = firstAcceptance(result);
    if (acceptance) {
      await client.mutation(api.officialDocuments.recordAcceptanceFromService, {
        serviceKey,
        documentId: validated.documentId as Id<"documents">,
        rndcOperationId: queued.operationId,
        state: "accepted",
        actorDocument: acceptance.actorId,
        recordedAt: acceptance.recordedAt,
        detailsJson: JSON.stringify(acceptance.raw)
      });
    }
  }

  if (action === "reconcile" && validated.documentId && backendResponse.ok) {
    const candidates = await client.query(api.rndcOperations.listForExpediente, {
      expedienteId: validated.expedienteId as Id<"expedientes">,
      limit: 100
    });
    const uncertainOperation = candidates.find((operation) =>
      operation._id !== queued.operationId
      && operation.documentId === validated.documentId
      && operation.status === "uncertain"
    );

    if (uncertainOperation) {
      const reconciliationWorker = `reconciliation-${randomUUID()}`;
      await client.mutation(api.rndcOperations.beginReconciliation, {
        serviceKey,
        operationId: uncertainOperation._id,
        workerId: reconciliationWorker,
        leaseMs: 60_000
      });
      await client.mutation(api.rndcOperations.finishReconciliation, {
        serviceKey,
        operationId: uncertainOperation._id,
        workerId: reconciliationWorker,
        result: "confirmed_succeeded",
        radicado,
        resultJson: JSON.stringify(result)
      });
    }
  }

  return jsonResponse({
    ok: backendResponse.ok,
    operationId: queued.operationId,
    status: finalStatus,
    evidenceStored,
    result
  }, backendResponse.status);
}

function validateActionBody(body: ActionBody | null): { ok: true; organizationId: string; expedienteId: string; documentId?: string; expedienteRemesaId?: string; requestKey: string; businessKey: string; payload: Record<string, unknown>; simulateTimeout: boolean } | { ok: false; error: string } {
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

  return {
    ok: true,
    organizationId: body.organizationId,
    expedienteId: body.expedienteId,
    documentId: body.documentId,
    expedienteRemesaId: body.expedienteRemesaId,
    requestKey: body.requestKey,
    businessKey: body.businessKey,
    payload: body.payload as Record<string, unknown>,
    simulateTimeout: body.simulateTimeout === true
  };
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

function firstAcceptance(result: unknown): { actorId?: string; recordedAt?: number; raw: Record<string, unknown> } | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  const records = (result as Record<string, unknown>).records;
  if (!Array.isArray(records) || !records[0] || typeof records[0] !== "object") {
    return null;
  }

  const raw = records[0] as Record<string, unknown>;
  const parsedAt = typeof raw.acceptedAt === "string" ? Date.parse(raw.acceptedAt) : Number.NaN;
  return {
    actorId: typeof raw.actorId === "string" ? raw.actorId : undefined,
    recordedAt: Number.isFinite(parsedAt) ? parsedAt : undefined,
    raw
  };
}

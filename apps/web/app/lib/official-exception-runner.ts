import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { createConvexToken, getAuthSettings, jsonResponse } from "./auth-server";
import { authorizeGatewayRequest } from "./rndc-gateway";
import { POST as runRndcAction } from "../api/rndc/actions/[action]/route";

export type OfficialExceptionInput = {
  requestKey: string;
  documentId: string;
  expedienteRemesaId?: string;
  originalOperationId?: string;
  reasonCode?: string;
  reason: string;
  observation: string;
  confirmed: boolean;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  dependencyPlan?: unknown;
};

export function validateOfficialExceptionBody(value: unknown): OfficialExceptionInput | Response {
  if (!isRecord(value)) return jsonResponse({ error: "Solicitud inválida" }, 400);
  const required = ["requestKey", "documentId", "reason", "observation"];
  const missing = required.filter((field) => typeof value[field] !== "string" || !(value[field] as string).trim());
  if (missing.length > 0) return jsonResponse({ error: `Campos requeridos: ${missing.join(", ")}` }, 400);
  if (value.confirmed !== true) return jsonResponse({ error: "Debes confirmar explícitamente la acción" }, 400);
  return value as OfficialExceptionInput;
}

export async function runOfficialException(input: {
  request: Request;
  expedienteId: string;
  type: "correction" | "annulment" | "reconciliation";
  action: string;
  body: OfficialExceptionInput;
  payload: Record<string, unknown>;
}): Promise<Response> {
  return await runOfficialExceptionSequence({
    request: input.request,
    expedienteId: input.expedienteId,
    type: input.type,
    body: input.body,
    steps: [{
      action: input.action,
      documentId: input.body.documentId,
      expedienteRemesaId: input.body.expedienteRemesaId,
      originalOperationId: input.body.originalOperationId,
      payload: input.payload
    }]
  });
}

export async function runOfficialExceptionSequence(input: {
  request: Request;
  expedienteId: string;
  type: "correction" | "annulment" | "reconciliation";
  body: OfficialExceptionInput;
  steps: Array<{
    action: string;
    documentId: string;
    expedienteRemesaId?: string;
    originalOperationId?: string;
    payload: Record<string, unknown>;
  }>;
}): Promise<Response> {
  const authorization = authorizeGatewayRequest(input.request, "manage_official_documents");
  if (authorization instanceof Response) return authorization;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  const serviceKey = process.env.RNDC_INGEST_KEY;
  if (!convexUrl || !serviceKey) return jsonResponse({ error: "Las excepciones durables no están configuradas" }, 503);
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(createConvexToken(authorization, getAuthSettings()));
  const detail = await client.query(api.expedientes.detail, { expedienteId: input.expedienteId as Id<"expedientes"> });
  if (!detail) return jsonResponse({ error: "Despacho no encontrado" }, 404);
  const exceptionId = await client.mutation(api.dispatchExceptions.start, {
    expedienteId: input.expedienteId as Id<"expedientes">,
    requestKey: input.body.requestKey,
    type: input.type,
    documentId: input.body.documentId as Id<"documents">,
    originalOperationId: input.body.originalOperationId as Id<"rndcOperations"> | undefined,
    reasonCode: input.body.reasonCode,
    reason: input.body.reason,
    observation: input.body.observation,
    confirmed: true,
    beforeJson: input.body.before ? JSON.stringify(input.body.before) : undefined,
    afterJson: input.body.after ? JSON.stringify(input.body.after) : undefined,
    dependencyPlanJson: input.body.dependencyPlan ? JSON.stringify(input.body.dependencyPlan) : undefined
  });
  const operations: Id<"rndcOperations">[] = [];
  const results: Array<{ action: string; documentId: string; response: Record<string, unknown> }> = [];
  let evidenceCount = 0;
  let status: "completed" | "rejected" | "uncertain" = "completed";
  let responseStatus = 200;

  for (const [index, step] of input.steps.entries()) {
    const headers = new Headers(input.request.headers);
    headers.set("Content-Type", "application/json");
    headers.delete("content-length");
    const actionResponse = await runRndcAction(new Request(new URL(`/api/rndc/actions/${step.action}`, input.request.url), {
      method: "POST",
      headers,
      body: JSON.stringify({
        organizationId: detail.expediente.organizationId,
        expedienteId: detail.expediente._id,
        documentId: step.documentId,
        expedienteRemesaId: step.expedienteRemesaId,
        originalOperationId: step.originalOperationId,
        requestKey: `${input.body.requestKey}:${index}:${step.action}`,
        businessKey: `exception:${exceptionId}:${index}:${step.action}`,
        payload: step.payload
      })
    }), { params: Promise.resolve({ action: step.action }) });
    const result = await actionResponse.json().catch(() => ({})) as Record<string, unknown>;
    results.push({ action: step.action, documentId: step.documentId, response: result });
    if (typeof result.operationId === "string") operations.push(result.operationId as Id<"rndcOperations">);
    if (result.evidenceStored === true) evidenceCount += 1;
    if (result.status === "uncertain" || result.status === "reconciling") {
      status = "uncertain";
      responseStatus = 202;
      break;
    }
    if (!actionResponse.ok || result.ok !== true) {
      status = "rejected";
      responseStatus = actionResponse.status;
      break;
    }
  }

  if (status === "completed" && evidenceCount !== input.steps.length) {
    status = "uncertain";
    responseStatus = 202;
  }
  await client.mutation(api.dispatchExceptions.complete, {
    exceptionId,
    status,
    operationIds: operations.length > 0 ? operations : undefined,
    evidenceCount,
    resultJson: JSON.stringify(results)
  });
  return jsonResponse({ ok: status === "completed", exceptionId, exceptionStatus: status, evidenceStored: evidenceCount === input.steps.length, steps: results }, responseStatus);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

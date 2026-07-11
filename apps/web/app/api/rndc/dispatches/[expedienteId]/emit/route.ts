import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import {
  buildEmissionPlan,
  type AssignmentSnapshotData,
  type EmissionPlanInput,
  type EmissionPlanStep
} from "../../../../../../convex/model/emissionPlan";
import type { OfficialDocumentState } from "../../../../../../convex/model/documentLifecycle";
import { getAuthSettings, createConvexToken, jsonResponse } from "../../../../../lib/auth-server";
import { authorizeGatewayRequest, safeRndcMode } from "../../../../../lib/rndc-gateway";
import { POST as runRndcAction } from "../../../actions/[action]/route";

type EmitBody = {
  simulateTimeoutAt?: unknown;
};

type ExecutedStep = {
  key: string;
  action: string;
  documentNumber: string;
  outcome: "authorized" | "rejected" | "uncertain" | "failed" | "in_progress";
  operationId?: string;
  radicado?: string;
  error?: string;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ expedienteId: string }> }
): Promise<Response> {
  try {
    return await handleEmit(request, context);
  } catch (error) {
    return jsonResponse(
      {
        error: "La emisión falló antes de completar la secuencia; ningún documento se marcó como autorizado sin evidencia",
        detail: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}

async function handleEmit(
  request: Request,
  context: { params: Promise<{ expedienteId: string }> }
): Promise<Response> {
  const authorization = authorizeGatewayRequest(request, "submit_rndc");

  if (authorization instanceof Response) {
    return authorization;
  }

  const { expedienteId } = await context.params;
  const rawBody = await request.text();
  let body: EmitBody = {};

  if (rawBody.trim()) {
    const parsed = safeParse(rawBody);

    if (!isRecord(parsed)) {
      return jsonResponse({ error: "Cuerpo de solicitud inválido" }, 400);
    }

    const allowedKeys = new Set(["simulateTimeoutAt"]);
    const unexpected = Object.keys(parsed).filter((key) => !allowedKeys.has(key));

    if (unexpected.length > 0) {
      return jsonResponse(
        { error: "La emisión sólo recibe la identidad del despacho; el navegador no puede aportar campos RNDC" },
        400
      );
    }

    body = parsed as EmitBody;
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;

  if (!convexUrl || !process.env.RNDC_INGEST_KEY) {
    return jsonResponse({ error: "Durable RNDC operations are not configured" }, 503);
  }

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(createConvexToken(authorization, getAuthSettings()));
  let inputs = await client.query(api.dispatches.emissionInputs, {
    expedienteId: expedienteId as Id<"expedientes">
  });

  if (!inputs) {
    return jsonResponse({ error: "Despacho no encontrado" }, 404);
  }

  if (inputs.status === "draft") {
    try {
      await client.mutation(api.dispatches.prepareEmission, {
        expedienteId: expedienteId as Id<"expedientes">
      });
    } catch (error) {
      return jsonResponse(
        {
          error: "El despacho tiene datos pendientes y no puede emitirse",
          detail: extractConvexError(error)
        },
        409
      );
    }

    inputs = await client.query(api.dispatches.emissionInputs, {
      expedienteId: expedienteId as Id<"expedientes">
    });

    if (!inputs) {
      return jsonResponse({ error: "Despacho no encontrado" }, 404);
    }
  }

  const documentIds = await ensureOfficialDocuments(client, expedienteId as Id<"expedientes">, inputs);
  const plan = buildEmissionPlan(toPlanInput(inputs));

  if (!plan.ok) {
    return jsonResponse(
      {
        ok: false,
        reason: plan.reason,
        blockers: plan.blockers,
        nextAction: plan.reason === "uncertain" ? "conciliar" : plan.reason === "in_flight" ? "esperar" : "completar_datos"
      },
      409
    );
  }

  const blockedSteps = plan.steps.filter((step) => step.state === "blocked");

  if (blockedSteps.length > 0) {
    return jsonResponse(
      {
        ok: false,
        reason: "missing_fields",
        blockers: blockedSteps.map((step) => ({
          key: step.key,
          action: step.action,
          documentNumber: step.documentNumber,
          missingFields: step.missingFields
        })),
        nextAction: "completar_datos"
      },
      409
    );
  }

  const executed: ExecutedStep[] = [];
  let stoppedAt: string | undefined;
  let nextAction: string | undefined;

  for (const step of plan.steps) {
    if (step.state === "authorized") {
      executed.push({
        key: step.key,
        action: step.action,
        documentNumber: step.documentNumber,
        outcome: "authorized"
      });
      continue;
    }

    const documentId = documentIdForStep(step, documentIds);

    if (!documentId) {
      return jsonResponse({ error: `No existe documento persistido para el paso ${step.key}` }, 409);
    }

    const stepResult = await executeStep(request, expedienteId, inputs.organizationId, step, documentId, body);
    executed.push(stepResult);

    if (stepResult.outcome !== "authorized") {
      stoppedAt = step.key;
      nextAction =
        stepResult.outcome === "uncertain"
          ? "conciliar"
          : stepResult.outcome === "rejected"
            ? "revisar_rechazo"
            : stepResult.outcome === "in_progress"
              ? "esperar"
              : "reintentar";
      break;
    }
  }

  const completed = !stoppedAt && executed.length === plan.steps.length;
  return jsonResponse(
    {
      ok: completed,
      code: inputs.code,
      mode: safeRndcMode(),
      completed,
      steps: executed,
      stoppedAt,
      nextAction
    },
    completed ? 200 : 409
  );
}

async function executeStep(
  request: Request,
  expedienteId: string,
  organizationId: string,
  step: EmissionPlanStep,
  documentId: string,
  body: EmitBody
): Promise<ExecutedStep> {
  const actionBody = {
    organizationId,
    expedienteId,
    documentId,
    expedienteRemesaId: step.remesaId,
    requestKey: `emit-${expedienteId}-${step.key}`,
    businessKey: `emit:${expedienteId}:${step.key}`,
    payload: step.payload,
    simulateTimeout: body.simulateTimeoutAt === step.key
  };
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");
  headers.delete("content-length");
  const response = await runRndcAction(
    new Request(new URL(`/api/rndc/actions/${step.action}`, request.url), {
      method: "POST",
      headers,
      body: JSON.stringify(actionBody)
    }),
    { params: Promise.resolve({ action: step.action }) }
  );
  const result = safeParse(await response.text());
  const record = isRecord(result) ? result : {};
  const operationId = typeof record.operationId === "string" ? record.operationId : undefined;
  const status = typeof record.status === "string" ? record.status : undefined;
  const errorText = typeof record.error === "string" ? record.error : extractResultError(record.result);
  const base = {
    key: step.key,
    action: step.action,
    documentNumber: step.documentNumber,
    operationId,
    radicado: extractRadicado(record.result)
  };

  if (response.ok && record.ok === true) {
    return { ...base, outcome: "authorized" };
  }

  if (response.status === 202 || status === "uncertain" || status === "reconciling") {
    return { ...base, outcome: "uncertain", error: errorText };
  }

  if (response.status === 422) {
    return { ...base, outcome: "rejected", error: errorText };
  }

  if (response.status === 409 && typeof record.error === "string" && record.error.includes("claimed")) {
    return { ...base, outcome: "in_progress", error: errorText };
  }

  if (status === "failed" || status === "queued" || response.status >= 500) {
    return { ...base, outcome: "failed", error: errorText };
  }

  return { ...base, outcome: "rejected", error: errorText };
}

type EmissionInputs = {
  organizationId: Id<"organizations">;
  code: string;
  status: string;
  tripNumber?: string;
  tripEmitted: boolean;
  order: { number?: string; payloadJson?: string; documentId?: Id<"documents">; officialState: string };
  consignments: Array<{
    remesaId: Id<"expedienteRemesas">;
    number?: string;
    payloadJson?: string;
    documentId?: Id<"documents">;
    officialState: string;
  }>;
  manifest: { number?: string; payloadJson?: string; documentId?: Id<"documents">; officialState: string };
  assignmentJson?: string;
  operations: Array<{ operationType: string; status: string }>;
};

type DocumentIds = {
  order?: string;
  manifest?: string;
  byRemesa: Map<string, string>;
};

async function ensureOfficialDocuments(
  client: ConvexHttpClient,
  expedienteId: Id<"expedientes">,
  inputs: EmissionInputs
): Promise<DocumentIds> {
  const ids: DocumentIds = { order: inputs.order.documentId, manifest: inputs.manifest.documentId, byRemesa: new Map() };

  if (!ids.order && inputs.order.number) {
    ids.order = await client.mutation(api.officialDocuments.createDraft, {
      expedienteId,
      kind: "orden_cargue",
      number: inputs.order.number,
      mode: safeRndcMode()
    });
  }

  for (const consignment of inputs.consignments) {
    if (consignment.documentId) {
      ids.byRemesa.set(consignment.remesaId, consignment.documentId);
    } else if (consignment.number) {
      const documentId = await client.mutation(api.officialDocuments.createDraft, {
        expedienteId,
        expedienteRemesaId: consignment.remesaId,
        kind: "remesa",
        number: consignment.number,
        mode: safeRndcMode()
      });
      ids.byRemesa.set(consignment.remesaId, documentId);
    }
  }

  if (!ids.manifest && inputs.manifest.number) {
    ids.manifest = await client.mutation(api.officialDocuments.createDraft, {
      expedienteId,
      kind: "manifiesto",
      number: inputs.manifest.number,
      mode: safeRndcMode()
    });
  }

  return ids;
}

function documentIdForStep(step: EmissionPlanStep, ids: DocumentIds): string | undefined {
  if (step.action === "emit_loading_order") {
    return ids.order;
  }

  if (step.action === "emit_remesa") {
    return step.remesaId ? ids.byRemesa.get(step.remesaId) : undefined;
  }

  return ids.manifest;
}

function toPlanInput(inputs: EmissionInputs): EmissionPlanInput {
  return {
    order: {
      number: inputs.order.number,
      snapshot: parseSnapshotData(inputs.order.payloadJson),
      officialState: inputs.order.officialState as OfficialDocumentState
    },
    consignments: inputs.consignments.map((consignment) => ({
      remesaId: consignment.remesaId,
      number: consignment.number,
      snapshot: parseSnapshotData(consignment.payloadJson),
      officialState: consignment.officialState as OfficialDocumentState
    })),
    manifest: {
      number: inputs.manifest.number,
      snapshot: parseSnapshotData(inputs.manifest.payloadJson),
      officialState: inputs.manifest.officialState as OfficialDocumentState
    },
    assignment: parseSnapshotData(inputs.assignmentJson) as AssignmentSnapshotData | null,
    tripNumber: inputs.tripNumber,
    tripEmitted: inputs.tripEmitted,
    operationsInFlight: inputs.operations
  };
}

function parseSnapshotData<T = Record<string, unknown>>(payloadJson: string | undefined): T | null {
  if (!payloadJson) {
    return null;
  }

  const parsed = safeParse(payloadJson);

  if (!isRecord(parsed) || !isRecord(parsed.data)) {
    return null;
  }

  return parsed.data as T;
}

function extractRadicado(result: unknown): string | undefined {
  if (!isRecord(result)) {
    return undefined;
  }

  if (typeof result.radicado === "string") {
    return result.radicado;
  }

  if (Array.isArray(result.steps)) {
    const values = result.steps
      .map((step) => (isRecord(step) ? step.radicado : undefined))
      .filter((value): value is string => typeof value === "string");
    return values.at(-1);
  }

  return undefined;
}

function extractResultError(result: unknown): string | undefined {
  if (!isRecord(result)) {
    return undefined;
  }

  if (typeof result.error === "string") {
    return result.error;
  }

  if (isRecord(result.error) && typeof result.error.message === "string") {
    return result.error.message;
  }

  if (Array.isArray(result.steps)) {
    const failing = result.steps.find((step) => isRecord(step) && step.accepted === false);
    return failing && isRecord(failing) && typeof failing.errorText === "string" ? failing.errorText : undefined;
  }

  return undefined;
}

function extractConvexError(error: unknown): unknown {
  if (error && typeof error === "object" && "data" in error) {
    return (error as { data: unknown }).data;
  }

  return error instanceof Error ? error.message : String(error);
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { annulmentReasonAllowed, annulmentStepLabel, buildAnnulmentPlan, documentIdsForRemesas, needsReplacementManifest } from "../../../../../../convex/model/advancedWorkflow";
import { fulfillmentNotes, lookupRemesaFulfillment } from "../../../../../lib/rndc-fulfillment-lookup";
import { ANNULMENT_DENIED_REASON, canAnnulOfficialDocuments } from "../../../../../../convex/model/annulmentPolicy";
import { createConvexToken, getAuthSettings, jsonResponse } from "../../../../../lib/auth-server";
import { authorizeGatewayRequest, forwardRndcRequest } from "../../../../../lib/rndc-gateway";
import { runOfficialExceptionSequence, validateOfficialExceptionBody } from "../../../../../lib/official-exception-runner";

type Detail = NonNullable<FunctionReturnType<typeof api.expedientes.detail>>;

export async function POST(request: Request, context: { params: Promise<{ expedienteId: string }> }): Promise<Response> {
  try {
    return await annul(request, context);
  } catch (error) {
    const data = error && typeof error === "object" && "data" in error ? (error as { data: unknown }).data : undefined;
    const code = data && typeof data === "object" ? (data as { code?: unknown }).code : undefined;

    if (code === "FORBIDDEN") {
      return jsonResponse({ error: ANNULMENT_DENIED_REASON }, 403);
    }

    return jsonResponse({ error: "La anulación no pudo iniciarse; ningún documento cambió de estado" }, 500);
  }
}

async function annul(request: Request, context: { params: Promise<{ expedienteId: string }> }): Promise<Response> {
  const authorization = authorizeGatewayRequest(request, "manage_official_documents");
  if (authorization instanceof Response) return authorization;
  if (!canAnnulOfficialDocuments({ roles: [authorization.role], jobTitle: authorization.jobTitle })) {
    return jsonResponse({ error: ANNULMENT_DENIED_REASON }, 403);
  }
  const raw = await request.json().catch(() => null);
  const body = validateOfficialExceptionBody(raw);
  if (body instanceof Response) return body;
  const { expedienteId } = await context.params;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!convexUrl) return jsonResponse({ error: "Las excepciones durables no están configuradas" }, 503);
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(createConvexToken(authorization, getAuthSettings()));
  const detail = await client.query(api.expedientes.detail, { expedienteId: expedienteId as Id<"expedientes"> });
  if (!detail) return jsonResponse({ error: "Despacho no encontrado" }, 404);
  const wholeSet = Boolean(raw && typeof raw === "object" && (raw as Record<string, unknown>).wholeSet === true);
  const replacement = needsReplacementManifest(body.reasonCode);
  const observation = body.observation.trim();
  const targetKind = detail.documents.find((document) => document._id === body.documentId)?.kind as "orden_cargue" | "remesa" | "manifiesto" | undefined;

  if (targetKind && !replacement && !annulmentReasonAllowed(wholeSet ? "remesa" : targetKind, body.reasonCode)) {
    return jsonResponse({ error: wholeSet ? "El conjunto completo solo admite error de digitación o cancelación del servicio" : "El motivo RNDC no aplica a este documento" }, 400);
  }

  if (observation.length > 200) {
    return jsonResponse({ error: "La observación no puede superar 200 caracteres" }, 400);
  }

  const { target, documents, plan } = await planAnnulment(client, detail, { documentId: body.documentId, wholeSet, reasonCode: body.reasonCode });

  if (!plan.ok) return jsonResponse({ error: plan.blockers[0], blockers: plan.blockers }, 409);

  if (plan.steps.some((step) => step.startsWith("annul_remesa_initial_fulfillment")) && observation.length < 20) {
    return jsonResponse({ error: "Para anular un cumplido, la observación debe tener al menos 20 caracteres" }, 400);
  }

  const replacementManifestNumber = replacement && target
    ? await client.mutation(api.dispatchExceptions.reserveReplacementManifest, {
        expedienteId: expedienteId as Id<"expedientes">,
        documentId: target.id as Id<"documents">
      })
    : undefined;
  const steps = plan.steps.map((planned) => sequenceStep(planned, target, documents, detail, { ...body, observation, replacementManifestNumber }, plan.optionalSteps.includes(planned)));
  if (steps.some((step) => !step)) return jsonResponse({ error: "No fue posible vincular todos los documentos del plan de anulación", dependencyPlan: plan.steps }, 409);
  const response = await runOfficialExceptionSequence({
    request,
    expedienteId,
    type: "annulment",
    body: { ...body, observation, dependencyPlan: plan.steps },
    steps: steps.filter((step): step is NonNullable<typeof step> => Boolean(step)),
    responseExtra: replacementManifestNumber ? { replacementManifestNumber } : undefined
  });

  if (replacementManifestNumber && target && await manifestWasAnnulled(response)) {
    await client.mutation(api.dispatchExceptions.openReplacementManifest, {
      expedienteId: expedienteId as Id<"expedientes">,
      documentId: target.id as Id<"documents">,
      replacementManifestNumber
    });
  }

  return response;
}

export async function GET(request: Request, context: { params: Promise<{ expedienteId: string }> }): Promise<Response> {
  const authorization = authorizeGatewayRequest(request, "manage_official_documents");
  if (authorization instanceof Response) return authorization;
  if (!canAnnulOfficialDocuments({ roles: [authorization.role], jobTitle: authorization.jobTitle })) {
    return jsonResponse({ error: ANNULMENT_DENIED_REASON }, 403);
  }
  const url = new URL(request.url);
  const documentId = url.searchParams.get("documentId") ?? "";
  if (!documentId) return jsonResponse({ error: "Selecciona un documento" }, 400);
  const { expedienteId } = await context.params;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!convexUrl) return jsonResponse({ error: "Las excepciones durables no están configuradas" }, 503);
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(createConvexToken(authorization, getAuthSettings()));
  const detail = await client.query(api.expedientes.detail, { expedienteId: expedienteId as Id<"expedientes"> });
  if (!detail) return jsonResponse({ error: "Despacho no encontrado" }, 404);
  const { documents, plan, notes } = await planAnnulment(client, detail, {
    documentId,
    wholeSet: url.searchParams.get("wholeSet") === "true",
    reasonCode: url.searchParams.get("reasonCode") ?? undefined
  });
  return jsonResponse({
    ok: plan.ok,
    blockers: plan.blockers,
    notes,
    steps: plan.steps.map((step) => {
      const plannedId = step.split(":")[1] ?? documentId;
      const document = detail.documents.find((item) => item._id === plannedId);
      return {
        step,
        label: annulmentStepLabel(step),
        documentNumber: step.startsWith("annul_trip") ? detail.expediente.tripNumber : document?.number,
        optional: plan.optionalSteps.includes(step),
        known: documents.some((item) => item.id === plannedId)
      };
    })
  }, 200);
}

async function planAnnulment(client: ConvexHttpClient, detail: Detail, input: { documentId: string; wholeSet: boolean; reasonCode?: string }) {
  const documents = detail.documents.map((document) => documentProjection(document, detail));
  const target = documents.find((document) => document.id === input.documentId);
  const lookupTargets = documents
    .filter((document) => document.kind === "remesa" && (document.officialState === "authorized" || document.officialState === "fulfilled"))
    .map((document) => ({ documentId: document.id as string, number: detail.documents.find((item) => item._id === document.id)?.number }));
  const [rndcFulfillment, inputs] = await Promise.all([
    lookupRemesaFulfillment(lookupTargets, (path) => forwardRndcRequest(path)),
    client.query(api.dispatches.emissionInputs, { expedienteId: detail.expediente._id })
  ]);
  const plan = buildAnnulmentPlan({
    target,
    documents,
    wholeSet: input.wholeSet,
    reasonCode: input.reasonCode,
    rndcFulfillment,
    tripRegistered: inputs?.tripEmitted === true
  });
  const knownFulfilled = new Set(documents.filter((document) => document.officialState === "fulfilled" || document.fulfillmentState === "fulfilled").map((document) => document.id as string));
  return { target, documents, plan, notes: fulfillmentNotes(lookupTargets, rndcFulfillment, knownFulfilled) };
}

type AnnulmentBody = { reasonCode?: string; observation: string; replacementManifestNumber?: string };

function sequenceStep(planned: string, selected: ReturnType<typeof documentProjection> | undefined, documents: ReturnType<typeof documentProjection>[], detail: Detail, body: AnnulmentBody, optional: boolean) {
  const [action, plannedId] = planned.split(":");
  const target = plannedId
    ? documents.find((document) => document.id === plannedId)
    : action === "annul_trip"
      ? selected?.kind === "manifiesto" ? selected : documents.find((document) => document.kind === "manifiesto")
      : selected;
  if (!target) return undefined;
  const remesa = detail.remesas.find((item) => item.documentId === target.id);
  return {
    action,
    documentId: target.id,
    expedienteRemesaId: remesa?._id,
    payload: annulmentPayload(action, target.kind, target.id, detail, body),
    optional
  };
}

function documentProjection(document: Detail["documents"][number], detail: Detail) {
  return {
    id: document._id,
    kind: document.kind as "orden_cargue" | "remesa" | "manifiesto",
    officialState: document.officialState ?? document.status,
    fulfillmentState: document.fulfillmentState,
    remesaIds: document.kind === "manifiesto" ? documentIdsForRemesas(detail.remesas) : undefined
  };
}

function annulmentPayload(action: string, kind: string, documentId: string, detail: Detail, body: AnnulmentBody): Record<string, unknown> {
  const document = detail.documents.find((item) => item._id === documentId);
  const remesa = detail.remesas.find((item) => item.documentId === documentId);
  const target = action === "annul_manifest_fulfillment" ? "manifest-compliance"
    : action === "annul_remesa_fulfillment" ? "remesa-compliance"
      : action === "annul_remesa_initial_fulfillment" ? "remesa-initial-compliance"
      : action === "annul_trip" ? "trip-information"
        : kind === "manifiesto" ? "manifest" : kind === "remesa" ? "remesa" : "cargo-information";
  return {
    target,
    manifestNumber: kind === "manifiesto" ? document?.number : target === "remesa-initial-compliance" ? manifestNumberFor(detail) : undefined,
    replacementManifestNumber: target === "manifest" ? body.replacementManifestNumber : undefined,
    remesaNumber: kind === "remesa" ? document?.number ?? remesa?.number : undefined,
    cargoNumber: kind === "orden_cargue" ? document?.number : undefined,
    tripNumber: action === "annul_trip" ? detail.expediente.tripNumber : undefined,
    reasonCode: annulmentReason(target, body.reasonCode),
    observations: body.observation
  };
}

async function manifestWasAnnulled(response: Response): Promise<boolean> {
  const body = await response.clone().json().catch(() => null) as { steps?: Array<{ action?: string; response?: { ok?: unknown } }> } | null;
  return Boolean(body?.steps?.some((step) => step.action === "annul_manifest" && step.response?.ok === true));
}

function manifestNumberFor(detail: Detail): string | undefined {
  return detail.documents
    .filter((document) => document.kind === "manifiesto" && document.number)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.number ?? detail.expediente.manifestNumber;
}

function annulmentReason(target: string, reasonCode: string | undefined): string | undefined {
  if (!reasonCode) return undefined;
  if (target.endsWith("-compliance")) return reasonCode === "D" ? "D" : "O";
  if (target !== "manifest" && needsReplacementManifest(reasonCode)) return "S";
  return reasonCode;
}

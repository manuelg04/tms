import { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { buildAnnulmentPlan, documentIdsForRemesas } from "../../../../../../convex/model/advancedWorkflow";
import { createConvexToken, getAuthSettings, jsonResponse } from "../../../../../lib/auth-server";
import { authorizeGatewayRequest } from "../../../../../lib/rndc-gateway";
import { runOfficialExceptionSequence, validateOfficialExceptionBody } from "../../../../../lib/official-exception-runner";

type Detail = NonNullable<FunctionReturnType<typeof api.expedientes.detail>>;

export async function POST(request: Request, context: { params: Promise<{ expedienteId: string }> }): Promise<Response> {
  const authorization = authorizeGatewayRequest(request, "manage_official_documents");
  if (authorization instanceof Response) return authorization;
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
  const remesaDocumentIds = documentIdsForRemesas(detail.remesas);
  const documents = detail.documents.map((document) => ({
    id: document._id,
    kind: document.kind as "orden_cargue" | "remesa" | "manifiesto",
    officialState: document.officialState ?? document.status,
    fulfillmentState: document.fulfillmentState,
    remesaIds: document.kind === "manifiesto" ? remesaDocumentIds : undefined
  }));
  const target = documents.find((document) => document.id === body.documentId);
  const plan = buildAnnulmentPlan({ target, documents, wholeSet: raw && typeof raw === "object" && (raw as Record<string, unknown>).wholeSet === true });
  if (!plan.ok) return jsonResponse({ error: plan.blockers[0], blockers: plan.blockers }, 409);
  const steps = plan.steps.map((planned) => sequenceStep(planned, target, documents, detail, body));
  if (steps.some((step) => !step)) return jsonResponse({ error: "No fue posible vincular todos los documentos del plan de anulación", dependencyPlan: plan.steps }, 409);
  return await runOfficialExceptionSequence({ request, expedienteId, type: "annulment", body: { ...body, dependencyPlan: plan.steps }, steps: steps.filter((step): step is NonNullable<typeof step> => Boolean(step)) });
}

function sequenceStep(planned: string, selected: ReturnType<typeof documentProjection> | undefined, documents: ReturnType<typeof documentProjection>[], detail: Detail, body: { reasonCode?: string; observation: string }) {
  const [action, plannedId] = planned.split(":");
  const target = plannedId
    ? documents.find((document) => document.id === plannedId)
    : action === "annul_trip"
      ? documents.find((document) => document.kind === "manifiesto")
      : selected;
  if (!target) return undefined;
  const remesa = detail.remesas.find((item) => item.documentId === target.id);
  return {
    action,
    documentId: target.id,
    expedienteRemesaId: remesa?._id,
    payload: annulmentPayload(action, target.kind, target.id, detail, body)
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

function annulmentPayload(action: string, kind: string, documentId: string, detail: Detail, body: { reasonCode?: string; observation: string }): Record<string, unknown> {
  const document = detail.documents.find((item) => item._id === documentId);
  const remesa = detail.remesas.find((item) => item.documentId === documentId);
  const target = action === "annul_manifest_fulfillment" ? "manifest-compliance"
    : action === "annul_remesa_fulfillment" ? "remesa-compliance"
      : action === "annul_trip" ? "trip-information"
        : kind === "manifiesto" ? "manifest" : kind === "remesa" ? "remesa" : "cargo-information";
  return {
    target,
    manifestNumber: kind === "manifiesto" ? document?.number : undefined,
    remesaNumber: kind === "remesa" ? document?.number ?? remesa?.number : undefined,
    cargoNumber: kind === "orden_cargue" ? document?.number : undefined,
    tripNumber: action === "annul_trip" ? detail.expediente.tripNumber : undefined,
    reasonCode: body.reasonCode,
    observations: body.observation
  };
}

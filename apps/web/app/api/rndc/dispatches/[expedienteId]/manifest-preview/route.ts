import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { createConvexToken, getAuthSettings, jsonResponse } from "../../../../../lib/auth-server";
import { manifestPreviewPayload } from "../../../../../lib/manifest-preview";
import { authorizeGatewayRequest, forwardRndcRequest } from "../../../../../lib/rndc-gateway";

export async function GET(
  request: Request,
  context: { params: Promise<{ expedienteId: string }> }
): Promise<Response> {
  const session = authorizeGatewayRequest(request, "download_evidence");

  if (session instanceof Response) {
    return session;
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;

  if (!convexUrl) {
    return jsonResponse({ error: "La vista previa no está configurada" }, 503);
  }

  const { expedienteId } = await context.params;

  if (!/^[a-z0-9]+$/i.test(expedienteId)) {
    return jsonResponse({ error: "Despacho inválido" }, 400);
  }

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(createConvexToken(session, getAuthSettings()));
  const id = expedienteId as Id<"expedientes">;
  let detail;
  let inputs;

  try {
    [detail, inputs] = await Promise.all([
      client.query(api.expedientes.detail, { expedienteId: id }),
      client.query(api.dispatches.emissionInputs, { expedienteId: id })
    ]);
  } catch {
    return jsonResponse({ error: "Despacho no encontrado" }, 404);
  }

  if (!detail || !inputs) {
    return jsonResponse({ error: "Despacho no encontrado" }, 404);
  }

  const { payload } = manifestPreviewPayload({
    workflowVariant: inputs.workflowVariant,
    tripNumber: inputs.tripNumber,
    orderNumber: inputs.order.number,
    orderDraft: detail.expediente.loadingOrderDraft,
    orderSnapshotJson: inputs.order.payloadJson,
    manifestNumber: inputs.manifest.number,
    manifestDraft: detail.expediente.manifestDraft,
    manifestSnapshotJson: inputs.manifest.officialState === "draft" ? undefined : inputs.manifest.payloadJson,
    assignmentJson: inputs.assignmentJson,
    driver: detail.driver,
    vehicle: detail.vehicle,
    trailer: detail.trailer,
    consignments: detail.remesas.map((remesa) => ({
      remesaId: remesa._id,
      number: remesa.number,
      draft: remesa.draft,
      snapshotJson: inputs.consignments.find((item) => item.remesaId === remesa._id)?.payloadJson,
      officialState: remesa.officialState
    }))
  });

  const response = await forwardRndcRequest("/documents/manifest-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, preparedBy: session.name })
  });

  if (!response.ok || !(response.headers.get("content-type") ?? "").includes("application/pdf")) {
    return jsonResponse({ error: "No fue posible preparar la vista previa del manifiesto" }, response.status === 404 ? 503 : response.status >= 400 ? response.status : 502);
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline; filename=\"manifiesto-pendiente.pdf\"",
      "Cache-Control": "no-store"
    }
  });
}

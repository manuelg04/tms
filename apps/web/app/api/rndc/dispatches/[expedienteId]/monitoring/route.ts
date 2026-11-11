import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { getAuthSettings, createConvexToken, jsonResponse } from "../../../../../lib/auth-server";
import { authorizeGatewayRequest, forwardRndcRequest, safeRndcMode } from "../../../../../lib/rndc-gateway";
import { readInitialCompliance, type RemesaMonitoring } from "../../../../../lib/remesa-monitoring";

export async function GET(
  request: Request,
  context: { params: Promise<{ expedienteId: string }> }
): Promise<Response> {
  const authorization = authorizeGatewayRequest(request, "view_expediente");

  if (authorization instanceof Response) {
    return authorization;
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;

  if (!convexUrl) {
    return jsonResponse({ error: "Convex no está configurado" }, 503);
  }

  const { expedienteId } = await context.params;
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(createConvexToken(authorization, getAuthSettings()));
  const detail = await client.query(api.expedientes.detail, {
    expedienteId: expedienteId as Id<"expedientes">
  });

  if (!detail) {
    return jsonResponse({ error: "Despacho no encontrado" }, 404);
  }

  const remesas: RemesaMonitoring[] = await Promise.all(
    detail.remesas.map(async (remesa): Promise<RemesaMonitoring> => {
      if (!remesa.number) {
        return { remesaId: remesa._id, status: "not_issued" };
      }

      const response = await forwardRndcRequest(`/rndc/initial-compliance/${encodeURIComponent(remesa.number)}`);

      if (!response.ok) {
        return { remesaId: remesa._id, number: remesa.number, status: "unavailable" };
      }

      const record = readInitialCompliance(await response.json().catch(() => null));
      return record
        ? { remesaId: remesa._id, number: remesa.number, status: "found", record }
        : { remesaId: remesa._id, number: remesa.number, status: "empty" };
    })
  );

  return jsonResponse({ mode: safeRndcMode(), remesas }, 200);
}

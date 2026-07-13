import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { createConvexToken, getAuthSettings, jsonResponse } from "../../../../../lib/auth-server";
import { authorizeGatewayRequest } from "../../../../../lib/rndc-gateway";
import { isRecord } from "../../../../../lib/official-exception-runner";

export async function POST(request: Request, context: { params: Promise<{ expedienteId: string }> }): Promise<Response> {
  const authorization = authorizeGatewayRequest(request, "override_rndc");
  if (authorization instanceof Response) return authorization;
  const body = await request.json().catch(() => null);
  if (!isRecord(body)) return jsonResponse({ error: "Solicitud inválida" }, 400);
  const allowed = ["remesa_without_order", "empty_manifest", "transshipment"] as const;
  if (!allowed.includes(body.type as typeof allowed[number])) return jsonResponse({ error: "Excepción estructural no reconocida" }, 400);
  if (typeof body.requestKey !== "string" || typeof body.reason !== "string" || typeof body.observation !== "string" || body.confirmed !== true || !isRecord(body.payload)) {
    return jsonResponse({ error: "Motivo, observación, confirmación y datos son obligatorios" }, 400);
  }
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!convexUrl) return jsonResponse({ error: "Las excepciones durables no están configuradas" }, 503);
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(createConvexToken(authorization, getAuthSettings()));
  const { expedienteId } = await context.params;
  try {
    const exceptionId = await client.mutation(api.dispatchExceptions.applyStructural, {
      expedienteId: expedienteId as Id<"expedientes">,
      requestKey: body.requestKey,
      type: body.type as typeof allowed[number],
      reasonCode: typeof body.reasonCode === "string" ? body.reasonCode : undefined,
      reason: body.reason,
      observation: body.observation,
      confirmed: true,
      payloadJson: JSON.stringify(body.payload),
      sourceManifestDocumentId: typeof body.sourceManifestDocumentId === "string" ? body.sourceManifestDocumentId as Id<"documents"> : undefined,
      replacementVehicleId: typeof body.replacementVehicleId === "string" ? body.replacementVehicleId as Id<"vehicles"> : undefined,
      replacementDriverId: typeof body.replacementDriverId === "string" ? body.replacementDriverId as Id<"drivers"> : undefined
    });
    return jsonResponse({ ok: true, exceptionId, status: "completed", evidenceStored: true });
  } catch (error) {
    return jsonResponse({ error: readable(error) }, 409);
  }
}

function readable(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const match = /message:\s*"([^"]+)"/.exec(message);
  return match?.[1] ?? message.replace(/^.*?: /, "");
}

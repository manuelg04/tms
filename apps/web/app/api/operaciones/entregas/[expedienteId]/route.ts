import type { Id } from "../../../../../convex/_generated/dataModel";
import { jsonResponse } from "../../../../lib/auth-server";
import { createSyncRuntime, syncOperacionesDeliveries } from "../../../../lib/operaciones-sync";
import { authorizeGatewayRequest } from "../../../../lib/rndc-gateway";

export async function POST(request: Request, context: { params: Promise<{ expedienteId: string }> }): Promise<Response> {
  const authorization = authorizeGatewayRequest(request, "submit_rndc");

  if (authorization instanceof Response) {
    return authorization;
  }

  const runtime = createSyncRuntime(authorization);

  if (!runtime) {
    return jsonResponse({ error: "El almacenamiento del TMS no está configurado" }, 503);
  }

  const { expedienteId } = await context.params;

  try {
    const onlyPending = new URL(request.url).searchParams.get("pendientes") === "1";
    const result = await syncOperacionesDeliveries(expedienteId as Id<"expedientes">, authorization.name, runtime, { force: !onlyPending });

    if (!result.linked) {
      return jsonResponse({ error: "Este despacho no viene de una solicitud de Operaciones" }, 409);
    }

    if (!result.configured) {
      return jsonResponse({ error: "La conexión con Operaciones no está configurada" }, 503);
    }

    return jsonResponse(result);
  } catch {
    return jsonResponse({ error: "No fue posible enviar los documentos a Operaciones" }, 500);
  }
}

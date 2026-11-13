import { jsonResponse } from "../../../../lib/auth-server";
import { OperacionesUnavailableError, getOperacionesRequest, operacionesSettings } from "../../../../lib/operaciones-client";
import { authorizeGatewayRequest } from "../../../../lib/rndc-gateway";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const authorization = authorizeGatewayRequest(request, "view_expediente");

  if (authorization instanceof Response) {
    return authorization;
  }

  if (!operacionesSettings()) {
    return jsonResponse({ error: "La conexión con Operaciones no está configurada" }, 503);
  }

  const { id } = await context.params;

  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    return jsonResponse({ error: "Solicitud inválida" }, 400);
  }

  try {
    const item = await getOperacionesRequest(id);
    return item ? jsonResponse({ item }) : jsonResponse({ error: "La solicitud ya no está disponible en Operaciones" }, 404);
  } catch (error) {
    return jsonResponse({ error: error instanceof OperacionesUnavailableError ? error.message : "Operaciones no respondió" }, 502);
  }
}

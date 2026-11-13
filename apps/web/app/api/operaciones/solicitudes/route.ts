import { jsonResponse } from "../../../lib/auth-server";
import { OperacionesUnavailableError, listOperacionesRequests, operacionesSettings } from "../../../lib/operaciones-client";
import { authorizeGatewayRequest } from "../../../lib/rndc-gateway";

export async function GET(request: Request): Promise<Response> {
  const authorization = authorizeGatewayRequest(request, "view_expediente");

  if (authorization instanceof Response) {
    return authorization;
  }

  if (!operacionesSettings()) {
    return jsonResponse({ configured: false, items: [] });
  }

  try {
    return jsonResponse({ configured: true, items: await listOperacionesRequests() });
  } catch (error) {
    return jsonResponse(
      { configured: true, items: [], error: error instanceof OperacionesUnavailableError ? error.message : "Operaciones no respondió" },
      502
    );
  }
}

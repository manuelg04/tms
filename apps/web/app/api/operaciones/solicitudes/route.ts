import { jsonResponse } from "../../../lib/auth-server";
import { OperacionesUnavailableError, listOperacionesRequests, operacionesSettings } from "../../../lib/operaciones-client";
import { inboxFilter } from "../../../lib/operaciones-request";
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
    const filter = inboxFilter(process.env);
    const items = (await listOperacionesRequests()).filter(filter.accepts);
    return jsonResponse({ configured: true, items, onlyDispatcher: filter.limited });
  } catch (error) {
    return jsonResponse(
      { configured: true, items: [], error: error instanceof OperacionesUnavailableError ? error.message : "Operaciones no respondió" },
      502
    );
  }
}

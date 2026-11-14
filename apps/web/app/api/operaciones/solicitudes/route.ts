import { jsonResponse } from "../../../lib/auth-server";
import { OperacionesUnavailableError, listOperacionesRequests, operacionesSettings } from "../../../lib/operaciones-client";
import { dispatcherTerms, matchesDispatcher } from "../../../lib/operaciones-request";
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
    const terms = dispatcherTerms(process.env.OPERACIONES_ONLY_DISPATCHER);
    const items = (await listOperacionesRequests()).filter((item) => matchesDispatcher(item, terms));
    return jsonResponse({ configured: true, items, onlyDispatcher: terms.length > 0 });
  } catch (error) {
    return jsonResponse(
      { configured: true, items: [], error: error instanceof OperacionesUnavailableError ? error.message : "Operaciones no respondió" },
      502
    );
  }
}

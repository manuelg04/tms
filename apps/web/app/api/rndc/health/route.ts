import { authorizeGatewayRequest, forwardRndcRequest, rndcAvailability, safeRndcMode } from "../../../lib/rndc-gateway";
import { jsonResponse } from "../../../lib/auth-server";

export async function GET(request: Request): Promise<Response> {
  const authorization = authorizeGatewayRequest(request, "view_expediente");

  if (authorization instanceof Response) {
    return authorization;
  }

  const response = await forwardRndcRequest("/healthz");

  if (!response.ok) {
    return jsonResponse({ ok: false, mode: "offline" }, 503);
  }

  const availability = await rndcAvailability();
  return jsonResponse({ ok: true, mode: safeRndcMode(), rndcAvailable: availability.available });
}

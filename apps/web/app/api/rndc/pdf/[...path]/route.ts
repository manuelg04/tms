import { authorizeGatewayRequest, forwardRndcRequest } from "../../../../lib/rndc-gateway";
import { jsonResponse } from "../../../../lib/auth-server";

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const authorization = authorizeGatewayRequest(request, "download_evidence");

  if (authorization instanceof Response) {
    return authorization;
  }

  const { path } = await context.params;

  if (path.length === 0 || path.some((segment) => !/^[A-Za-z0-9._-]+$/.test(segment))) {
    return jsonResponse({ error: "Invalid document path" }, 400);
  }

  return await forwardRndcRequest(`/pdf/${path.map(encodeURIComponent).join("/")}`);
}

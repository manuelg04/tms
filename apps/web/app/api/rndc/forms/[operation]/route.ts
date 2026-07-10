import { authorizeGatewayRequest, forwardRndcRequest } from "../../../../lib/rndc-gateway";
import { jsonResponse } from "../../../../lib/auth-server";

const allowedOperations = new Set([
  "loading-order",
  "remesa",
  "manifest",
  "driver-vehicle",
  "fulfill-remesa",
  "fulfill-manifest"
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ operation: string }> }
): Promise<Response> {
  const authorization = authorizeGatewayRequest(request, "submit_rndc");

  if (authorization instanceof Response) {
    return authorization;
  }

  const { operation } = await context.params;

  if (!allowedOperations.has(operation)) {
    return jsonResponse({ error: "RNDC operation not found" }, 404);
  }

  const body = await request.text();
  return await forwardRndcRequest(`/rndc/forms/${operation}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
}

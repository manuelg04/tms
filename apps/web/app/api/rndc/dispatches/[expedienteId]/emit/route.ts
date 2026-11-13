import { jsonResponse } from "../../../../../lib/auth-server";
import { syncAfterEmission } from "../../../../../lib/operaciones-sync";
import { authorizeGatewayRequest } from "../../../../../lib/rndc-gateway";
import { handleEmitWithRuntime } from "./handler";

export async function POST(
  request: Request,
  context: { params: Promise<{ expedienteId: string }> }
): Promise<Response> {
  const response = await handleEmitWithRuntime(request, context);

  if (response.status !== 200 && response.status !== 409) {
    return response;
  }

  const session = authorizeGatewayRequest(request, "submit_rndc");

  if (session instanceof Response) {
    return response;
  }

  const { expedienteId } = await context.params;
  const operaciones = await syncAfterEmission(session, expedienteId);

  if (!operaciones || !operaciones.linked) {
    return response;
  }

  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  return payload ? jsonResponse({ ...payload, operaciones }, response.status) : response;
}

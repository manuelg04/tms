import { jsonResponse } from "../../../../../lib/auth-server";
import { syncAfterEmission } from "../../../../../lib/operaciones-sync";
import { ensureRoutePlanAfterEmission } from "../../../../../lib/route-plan-auto";
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
  const routePlan = await ensureRoutePlanAfterEmission(session, expedienteId);
  const operaciones = await syncAfterEmission(session, expedienteId);
  const linked = operaciones && operaciones.linked ? operaciones : null;

  if (!linked && !routePlan) {
    return response;
  }

  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;

  if (!payload) {
    return response;
  }

  return jsonResponse({ ...payload, ...(linked ? { operaciones: linked } : {}), ...(routePlan ? { routePlan } : {}) }, response.status);
}

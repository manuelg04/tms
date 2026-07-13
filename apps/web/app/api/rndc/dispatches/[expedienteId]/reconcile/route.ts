import { jsonResponse } from "../../../../../lib/auth-server";
import { runOfficialException, validateOfficialExceptionBody } from "../../../../../lib/official-exception-runner";

export async function POST(request: Request, context: { params: Promise<{ expedienteId: string }> }): Promise<Response> {
  const body = validateOfficialExceptionBody(await request.json().catch(() => null));
  if (body instanceof Response) return body;
  if (!body.originalOperationId) return jsonResponse({ error: "Selecciona el intento incierto exacto" }, 400);
  const { expedienteId } = await context.params;
  return await runOfficialException({ request, expedienteId, type: "reconciliation", action: "reconcile", body, payload: {} });
}

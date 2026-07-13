import { jsonResponse } from "../../../../../lib/auth-server";
import { runOfficialException, validateOfficialExceptionBody } from "../../../../../lib/official-exception-runner";

export async function POST(request: Request, context: { params: Promise<{ expedienteId: string }> }): Promise<Response> {
  const body = validateOfficialExceptionBody(await request.json().catch(() => null));
  if (body instanceof Response) return body;
  const after = body.after;
  const appointmentDate = typeof after?.appointmentDate === "string" ? after.appointmentDate : "";
  const appointmentTime = typeof after?.appointmentTime === "string" ? after.appointmentTime : "";
  if (!after || !appointmentDate || !appointmentTime || !body.before) return jsonResponse({ error: "La corrección requiere comparación antes/después" }, 400);
  const { expedienteId } = await context.params;
  return await runOfficialException({
    request,
    expedienteId,
    type: "correction",
    action: "correct_remesa",
    body,
    payload: {
      remesaNumber: typeof after.remesaNumber === "string" ? after.remesaNumber : undefined,
      reasonCode: Number(body.reasonCode ?? "1"),
      change: { code: 1, appointmentDate: slashDate(appointmentDate), appointmentTime }
    }
  });
}

function slashDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

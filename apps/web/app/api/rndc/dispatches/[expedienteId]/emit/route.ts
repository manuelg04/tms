import { handleEmitWithRuntime } from "./handler";

export async function POST(
  request: Request,
  context: { params: Promise<{ expedienteId: string }> }
): Promise<Response> {
  return handleEmitWithRuntime(request, context);
}

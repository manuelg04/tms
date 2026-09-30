import { ConvexHttpClient } from "convex/browser";
import {
  mirrorWindow,
  mirrorProcesses,
  type MirrorProcess,
} from "@tms/rndc-core/mirror";
import {
  createConvexToken,
  getAuthSettings,
  jsonResponse,
} from "../../../lib/auth-server";
import { authorizeGatewayRequest } from "../../../lib/rndc-gateway";
import { syncRndcMirror } from "../../../lib/rndc-mirror-sync";

export const maxDuration = 180;

export async function POST(request: Request): Promise<Response> {
  const actor = authorizeGatewayRequest(request, "submit_rndc");
  if (actor instanceof Response) return actor;
  const input = await request.json().catch(() => null);
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !["process", "from", "to"].includes(k)) ||
    typeof input.process !== "number" ||
    typeof input.from !== "string" ||
    typeof input.to !== "string"
  )
    return jsonResponse({ error: "Consulta inválida." }, 400);
  try {
    mirrorWindow(input.from, input.to);
    if (!mirrorProcesses.includes(input.process as MirrorProcess))
      throw new Error("Proceso no permitido.");
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Consulta inválida." },
      400,
    );
  }
  const convexUrl =
      process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL,
    serviceKey = process.env.RNDC_INGEST_KEY;
  if (!convexUrl || !serviceKey)
    return jsonResponse(
      { error: "El almacenamiento del espejo no está configurado." },
      503,
    );
  const client = new ConvexHttpClient(convexUrl);
  try {
    client.setAuth(createConvexToken(actor, getAuthSettings()));
  } catch {
    return jsonResponse(
      { error: "La autenticación del espejo no está configurada." },
      503,
    );
  }
  try {
    return jsonResponse({
      ok: true,
      ...(await syncRndcMirror(client, serviceKey, input)),
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo actualizar el espejo.",
      },
      502,
    );
  }
}

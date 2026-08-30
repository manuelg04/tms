import { ConvexHttpClient } from "convex/browser";
import { createConvexToken, getAuthSettings, jsonResponse } from "../../../../lib/auth-server";
import { authorizeGatewayRequest } from "../../../../lib/rndc-gateway";
import { isMasterSyncKind, syncMaster } from "../../../../lib/rndc-master-sync";

export async function POST(request: Request): Promise<Response> {
  const authorization = authorizeGatewayRequest(request, "submit_rndc");
  if (authorization instanceof Response) return authorization;
  const body = await request.json().catch(() => null);
  if (!isRecord(body)) return jsonResponse({ error: "Solicitud inválida" }, 400);
  const allowed = new Set(["kind", "key", "force"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return jsonResponse({ error: "El navegador sólo puede seleccionar un maestro persistido" }, 400);
  if (!isMasterSyncKind(body.kind) || typeof body.key !== "string" || !body.key.trim()) {
    return jsonResponse({ error: "Indica el tipo de maestro y su identificación" }, 400);
  }
  if (body.force !== undefined && typeof body.force !== "boolean") return jsonResponse({ error: "Solicitud inválida" }, 400);
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  const serviceKey = process.env.RNDC_INGEST_KEY;
  if (!convexUrl || !serviceKey) return jsonResponse({ error: "Las operaciones RNDC durables no están configuradas" }, 503);

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(createConvexToken(authorization, getAuthSettings()));
  const result = await syncMaster(client, serviceKey, { kind: body.kind, key: body.key.trim() }, { force: body.force === true });
  const status = result.state === "registered" ? 200 : result.state === "uncertain" ? 202 : 409;
  return jsonResponse({ ok: result.state === "registered", ...result }, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

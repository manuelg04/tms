import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { createConvexToken, getAuthSettings, jsonResponse } from "../../../../lib/auth-server";
import { authorizeGatewayRequest, forwardRndcRequest } from "../../../../lib/rndc-gateway";

export const maxDuration = 120;

type OwnershipParty = { idType: string; id: string; name?: string; phone?: string; cityCode?: string };

export async function POST(request: Request): Promise<Response> {
  const actor = authorizeGatewayRequest(request, "submit_rndc");
  if (actor instanceof Response) return actor;
  const body = await request.json().catch(() => null);
  const plate = isRecord(body) && typeof body.plate === "string" ? body.plate.trim().toUpperCase() : "";
  if (!isRecord(body) || Object.keys(body).some((key) => key !== "plate") || !/^[A-Z0-9]{5,7}$/.test(plate)) {
    return jsonResponse({ ok: false, error: "Indica una placa válida." }, 400);
  }
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!convexUrl) return jsonResponse({ ok: false, error: "La conexión con la base de datos no está configurada." }, 503);
  const client = new ConvexHttpClient(convexUrl);
  try {
    client.setAuth(createConvexToken(actor, getAuthSettings()));
  } catch {
    return jsonResponse({ ok: false, error: "La autenticación no está configurada." }, 503);
  }

  try {
    const organizationId = await client.query(api.mirror.scope, {});
    const response = await forwardRndcRequest(`/rndc/masters/vehicle-ownership?plate=${encodeURIComponent(plate)}`, {
      headers: { "X-TMS-Organization-Id": organizationId }
    });
    const data: unknown = await response.json().catch(() => null);
    if (!isRecord(data)) return jsonResponse({ ok: false, error: "El servicio RNDC no respondió." }, 502);
    if (!response.ok || data.ok !== true || data.found !== true) {
      return jsonResponse({ ok: false, found: false, error: typeof data.error === "string" ? data.error : "El RNDC no devolvió datos para esta placa." }, response.status === 404 ? 404 : 502);
    }
    if (data.simulated === true) {
      return jsonResponse({ ok: false, found: false, simulated: true, error: "El sistema está en modo prueba sin lectura del RNDC: no se cambió ningún dato." }, 409);
    }
    const owner = readParty(data.owner);
    const holder = readParty(data.holder);
    if (!owner && !holder) {
      return jsonResponse({ ok: false, found: true, error: "El RNDC tiene la placa, pero sin propietario ni tenedor registrados." }, 404);
    }
    const queriedAt = typeof data.queriedAt === "string" && Number.isFinite(Date.parse(data.queriedAt)) ? Date.parse(data.queriedAt) : Date.now();
    const applied = await client.mutation(api.fleetMasters.applyRndcOwnership, { plate, owner, holder, queriedAt });
    return jsonResponse({ ok: true, found: true, plate, ...applied });
  } catch (error) {
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "No se pudo sincronizar con el RNDC." }, 502);
  }
}

function readParty(value: unknown): OwnershipParty | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) return undefined;
  return {
    idType: typeof value.idType === "string" && value.idType.trim() ? value.idType.trim() : "C",
    id: value.id.trim(),
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : undefined,
    phone: typeof value.phone === "string" && value.phone.trim() ? value.phone.trim() : undefined,
    cityCode: typeof value.cityCode === "string" && value.cityCode.trim() ? value.cityCode.trim() : undefined
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

import { isOperacionesRequest, type OperacionesRequest } from "./operaciones-request";

export type OperacionesDeliveryPayload = {
  expedienteId: string;
  kind: "loading_order" | "manifest_numbers" | "official_manifest" | "official_remesa";
  deliveryKey: string;
  tmsDispatchCode: string;
  actorName: string;
  fileName?: string;
  pdfBase64?: string;
  manifestNumber?: string;
  remesaNumber?: string;
};

export type OperacionesDeliveryOutcome =
  | { ok: true; outcome: "applied" | "pending" | "duplicate"; message: string }
  | { ok: false; error: string };

export class OperacionesUnavailableError extends Error {}

type Settings = { baseUrl: string; key: string };

export function operacionesSettings(env: Record<string, string | undefined> = process.env): Settings | null {
  const baseUrl = env.OPERACIONES_API_URL?.trim().replace(/\/$/, "");
  const key = env.OPERACIONES_INTEGRATION_KEY?.trim();
  if (!baseUrl || !key || key.length < 24) return null;
  return { baseUrl, key };
}

export async function listOperacionesRequests(fetcher: typeof fetch = fetch): Promise<OperacionesRequest[]> {
  const body = await call(fetcher, "/integrations/tms/worksheet-requests", { method: "GET" });
  const items = Array.isArray(body.items) ? body.items : [];
  return items.filter(isOperacionesRequest);
}

export async function getOperacionesRequest(expedienteId: string, fetcher: typeof fetch = fetch): Promise<OperacionesRequest | null> {
  const settings = requireSettings();
  const response = await send(fetcher, settings, `/integrations/tms/worksheet-requests?expedienteId=${encodeURIComponent(expedienteId)}`, { method: "GET" });
  if (response.status === 404) return null;
  const body = await readBody(response);
  if (!response.ok) throw new OperacionesUnavailableError(errorText(body, response.status));
  return isOperacionesRequest(body.item) ? body.item : null;
}

export async function sendOperacionesDelivery(payload: OperacionesDeliveryPayload, fetcher: typeof fetch = fetch): Promise<OperacionesDeliveryOutcome> {
  const settings = requireSettings();
  const response = await send(fetcher, settings, "/integrations/tms/deliveries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await readBody(response);

  if (response.ok && body.ok === true && (body.outcome === "applied" || body.outcome === "pending" || body.outcome === "duplicate")) {
    return { ok: true, outcome: body.outcome, message: typeof body.message === "string" ? body.message : "Recibido por Operaciones" };
  }

  if (response.status === 409 || response.status === 400) {
    return { ok: false, error: errorText(body, response.status) };
  }

  throw new OperacionesUnavailableError(errorText(body, response.status));
}

async function call(fetcher: typeof fetch, path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await send(fetcher, requireSettings(), path, init);
  const body = await readBody(response);
  if (!response.ok) throw new OperacionesUnavailableError(errorText(body, response.status));
  return body;
}

async function send(fetcher: typeof fetch, settings: Settings, path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-mtm-integration-key", settings.key);
  try {
    return await fetcher(`${settings.baseUrl}${path}`, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new OperacionesUnavailableError("Operaciones no respondió");
  }
}

function requireSettings(): Settings {
  const settings = operacionesSettings();
  if (!settings) throw new OperacionesUnavailableError("La conexión con Operaciones no está configurada");
  return settings;
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  const parsed = await response.json().catch(() => null) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function errorText(body: Record<string, unknown>, status: number): string {
  if (typeof body.error === "string" && body.error !== "Unauthorized") return body.error;
  if (status === 401) return "Operaciones rechazó la llave de la integración";
  return `Operaciones respondió con error ${status}`;
}

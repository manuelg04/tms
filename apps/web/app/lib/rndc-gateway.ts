import { canPerform, type DemoUser, type Permission } from "./auth";
import { getAuthSettings, jsonResponse, readRequestSession } from "./auth-server";

export type DurableEvidenceHeaderInput = {
  organizationId: string;
  expedienteId: string;
  documentId?: string;
  operationId: string;
  operationType: string;
  leaseOwner: string;
};

export function authorizeGatewayRequest(request: Request, permission: Permission): DemoUser | Response {
  try {
    const session = readRequestSession(request, getAuthSettings());

    if (!session) {
      return jsonResponse({ error: "Authentication required" }, 401);
    }

    if (!canPerform(session.role, permission)) {
      return jsonResponse({ error: "Permission denied" }, 403);
    }

    return session;
  } catch {
    return jsonResponse({ error: "Authentication is not configured" }, 503);
  }
}

export async function forwardRndcRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const baseUrl = process.env.RNDC_API_URL ?? "http://localhost:3017";
  const serviceToken = process.env.RNDC_SERVICE_TOKEN;

  if (!serviceToken || serviceToken.length < 32) {
    return jsonResponse({ error: "RNDC service connection is not configured" }, 503);
  }

  if ((process.env.AUTH_MODE ?? "demo") === "demo" && (process.env.RNDC_MODE ?? "dry-run") === "live") {
    return jsonResponse({ error: "Live RNDC mode is blocked while demo authentication is active" }, 503);
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${serviceToken}`);
  headers.set("Accept", "application/json");
  headers.set("X-TMS-Expected-Mode", safeRndcMode());

  try {
    const backendResponse = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers,
      cache: "no-store"
    });
    const responseHeaders = new Headers({ "Cache-Control": "no-store" });
    const contentType = backendResponse.headers.get("content-type");

    if (contentType) {
      responseHeaders.set("Content-Type", contentType);
    }

    const requestId = backendResponse.headers.get("x-request-id");
    if (requestId) {
      responseHeaders.set("X-Request-Id", requestId);
    }

    return new Response(backendResponse.body, {
      status: backendResponse.status,
      headers: responseHeaders
    });
  } catch {
    return jsonResponse({ error: "RNDC service is unavailable" }, 503);
  }
}

export function safeRndcMode(): "dry-run" | "live" {
  if ((process.env.AUTH_MODE ?? "demo") === "demo") {
    return "dry-run";
  }

  return process.env.RNDC_MODE === "live" ? "live" : "dry-run";
}

export function buildDurableEvidenceHeaders(input: DurableEvidenceHeaderInput): Record<string, string> {
  return {
    "X-TMS-Durable-Operation": "true",
    "X-TMS-Organization-Id": input.organizationId,
    "X-TMS-Expediente-Id": input.expedienteId,
    ...(input.documentId ? { "X-TMS-Document-Id": input.documentId } : {}),
    "X-TMS-Operation-Id": input.operationId,
    "X-TMS-Operation-Type": input.operationType,
    "X-TMS-Lease-Owner": input.leaseOwner
  };
}

export function durableEvidenceWasStored(result: unknown): boolean {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return false;
  }

  const durableEvidence = (result as Record<string, unknown>).durableEvidence;
  return Boolean(
    durableEvidence
    && typeof durableEvidence === "object"
    && !Array.isArray(durableEvidence)
    && (durableEvidence as Record<string, unknown>).stored === true
  );
}

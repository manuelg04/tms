import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { getAuthSettings, createConvexToken, jsonResponse } from "../../../../lib/auth-server";
import { authorizeGatewayRequest, rndcAvailability } from "../../../../lib/rndc-gateway";
import { classifyDrainResult } from "../../../../lib/pending-emission-drain";
import { handleEmitWithRuntime } from "../../dispatches/[expedienteId]/emit/handler";

export async function POST(request: Request): Promise<Response> {
  const authorization = authorizeGatewayRequest(request, "submit_rndc");

  if (authorization instanceof Response) {
    return authorization;
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;

  if (!convexUrl) {
    return jsonResponse({ error: "Durable RNDC operations are not configured" }, 503);
  }

  const availability = await rndcAvailability();

  if (!availability.available) {
    return jsonResponse({ ok: true, available: false, processed: [] });
  }

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(createConvexToken(authorization, getAuthSettings()));
  const due = await client.mutation(api.pendingEmissions.claimDue, { limit: 5 });
  const processed: Array<{ expedienteId: string; outcome: string; error?: string }> = [];

  for (const entry of due) {
    const headers = new Headers(request.headers);
    headers.set("Content-Type", "application/json");
    headers.delete("content-length");
    const response = await handleEmitWithRuntime(
      new Request(new URL(`/api/rndc/dispatches/${entry.expedienteId}/emit`, request.url), {
        method: "POST",
        headers,
        body: JSON.stringify({ scope: entry.scope, chain: true })
      }),
      { params: Promise.resolve({ expedienteId: entry.expedienteId }) },
      undefined,
      { preparedBy: entry.requestedByName }
    );
    const result = classifyDrainResult(response.status, await response.json().catch(() => null));

    if (result.outcome !== "done") {
      await client.mutation(api.pendingEmissions.settle, {
        expedienteId: entry.expedienteId,
        outcome: result.outcome,
        error: result.error
      });
    }

    processed.push({ expedienteId: entry.expedienteId, outcome: result.outcome, error: result.error });
  }

  return jsonResponse({ ok: true, available: true, processed });
}

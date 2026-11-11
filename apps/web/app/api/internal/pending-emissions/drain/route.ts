import { createHash, timingSafeEqual } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { createSessionToken, type DemoUser } from "../../../../lib/auth";
import { getAuthSettings, jsonResponse, sessionCookieName } from "../../../../lib/auth-server";
import { rndcAvailability } from "../../../../lib/rndc-gateway";
import { classifyDrainResult } from "../../../../lib/pending-emission-drain";
import { handleEmitWithRuntime } from "../../../rndc/dispatches/[expedienteId]/emit/handler";

export async function POST(request: Request): Promise<Response> {
  const serviceKey = process.env.RNDC_INGEST_KEY;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;

  if (!serviceKey || serviceKey.length < 32 || !convexUrl) {
    return jsonResponse({ error: "Durable RNDC operations are not configured" }, 503);
  }

  if (!bearerMatches(request.headers.get("authorization"), serviceKey)) {
    return jsonResponse({ error: "Service authentication required" }, 401);
  }

  const availability = await rndcAvailability();

  if (!availability.available) {
    return jsonResponse({ ok: true, available: false, processed: [] });
  }

  const settings = getAuthSettings();
  const client = new ConvexHttpClient(convexUrl);
  const due = await client.mutation(api.pendingEmissions.claimDueFromService, { serviceKey, limit: 5 });
  const processed: Array<{ expedienteId: string; outcome: string }> = [];

  for (const entry of due) {
    const requester: DemoUser = {
      id: entry.requester.subject,
      email: entry.requester.email,
      name: entry.requester.name,
      role: entry.requester.role
    };
    const session = createSessionToken(requester, settings.sessionSecret, Date.now(), 5 * 60);
    const response = await handleEmitWithRuntime(
      new Request(new URL(`/api/rndc/dispatches/${entry.expedienteId}/emit`, request.url), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `${sessionCookieName}=${encodeURIComponent(session)}`
        },
        body: JSON.stringify({ scope: entry.scope, chain: true })
      }),
      { params: Promise.resolve({ expedienteId: entry.expedienteId }) },
      undefined,
      { preparedBy: entry.requestedByName }
    );
    const result = classifyDrainResult(response.status, await response.json().catch(() => null));

    if (result.outcome !== "done") {
      await client.mutation(api.pendingEmissions.settleFromService, {
        serviceKey,
        expedienteId: entry.expedienteId,
        outcome: result.outcome,
        error: result.error
      });
    }

    processed.push({ expedienteId: entry.expedienteId, outcome: result.outcome });
  }

  return jsonResponse({ ok: true, available: true, processed });
}

function bearerMatches(header: string | null, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) {
    return false;
  }

  const supplied = createHash("sha256").update(header.slice(7)).digest();
  const wanted = createHash("sha256").update(expected).digest();
  return timingSafeEqual(supplied, wanted);
}

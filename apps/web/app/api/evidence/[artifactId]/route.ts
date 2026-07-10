import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { createConvexToken, getAuthSettings, jsonResponse } from "../../../lib/auth-server";
import { buildEvidenceDownloadHeaders } from "../../../lib/evidence-download";
import { authorizeGatewayRequest } from "../../../lib/rndc-gateway";

export async function GET(
  request: Request,
  context: { params: Promise<{ artifactId: string }> }
): Promise<Response> {
  const authorization = authorizeGatewayRequest(request, "download_evidence");

  if (authorization instanceof Response) {
    return authorization;
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;

  if (!convexUrl) {
    return jsonResponse({ error: "Evidence storage is not configured" }, 503);
  }

  try {
    const { artifactId } = await context.params;
    const client = new ConvexHttpClient(convexUrl);
    client.setAuth(createConvexToken(authorization, getAuthSettings()));
    const result = await client.query(api.evidence.getProtected, {
      artifactId: artifactId as Id<"evidenceArtifacts">
    });

    if (!result?.url) {
      return jsonResponse({ error: "Evidence not found" }, 404);
    }

    const stored = await fetch(result.url, { cache: "no-store" });

    if (!stored.ok || !stored.body) {
      return jsonResponse({ error: "Evidence is unavailable" }, 502);
    }

    return new Response(stored.body, {
      status: 200,
      headers: buildEvidenceDownloadHeaders(
        result.artifact.fileName,
        result.artifact.contentType ?? stored.headers.get("content-type") ?? undefined,
        result.artifact.size
      )
    });
  } catch {
    return jsonResponse({ error: "Evidence not found" }, 404);
  }
}

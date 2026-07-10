import { createConvexToken, getAuthSettings, jsonResponse, readRequestSession } from "../../../lib/auth-server";

export async function POST(request: Request): Promise<Response> {
  try {
    const settings = getAuthSettings();
    const user = readRequestSession(request, settings);

    if (!user) {
      return jsonResponse({ error: "Unauthenticated" }, 401);
    }

    return jsonResponse({ token: createConvexToken(user, settings) });
  } catch {
    return jsonResponse({ error: "Authentication is not configured" }, 503);
  }
}

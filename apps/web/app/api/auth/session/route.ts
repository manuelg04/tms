import { getAuthSettings, jsonResponse, readRequestSession } from "../../../lib/auth-server";

export async function GET(request: Request): Promise<Response> {
  try {
    const user = readRequestSession(request, getAuthSettings());
    return user ? jsonResponse({ user }) : jsonResponse({ user: null }, 401);
  } catch {
    return jsonResponse({ error: "Authentication is not configured" }, 503);
  }
}

import { createJwks, getAuthSettings, jsonResponse } from "../../../lib/auth-server";

export async function GET(): Promise<Response> {
  try {
    return jsonResponse(createJwks(getAuthSettings()));
  } catch {
    return jsonResponse({ error: "Authentication is not configured" }, 503);
  }
}

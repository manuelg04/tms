import { authenticateDemoUser } from "../../../lib/auth";
import { createSessionCookie, getAuthSettings, jsonResponse } from "../../../lib/auth-server";

export async function POST(request: Request): Promise<Response> {
  try {
    const settings = getAuthSettings();
    const body = await request.json() as { email?: unknown; password?: unknown };

    if (typeof body.email !== "string" || typeof body.password !== "string") {
      return jsonResponse({ error: "Correo y contrasena son obligatorios" }, 400);
    }

    const user = authenticateDemoUser(body.email, body.password, settings.demoPassword);

    if (!user) {
      return jsonResponse({ error: "Credenciales invalidas" }, 401);
    }

    const response = jsonResponse({ user });
    response.headers.append("Set-Cookie", createSessionCookie(user, settings));
    return response;
  } catch {
    return jsonResponse({ error: "Authentication is not configured" }, 503);
  }
}

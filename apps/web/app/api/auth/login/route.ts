import { authenticateDemoUser } from "../../../lib/auth";
import { createSessionCookie, getAuthSettings, jsonResponse } from "../../../lib/auth-server";
import { authenticateLocalUser } from "../../../lib/user-accounts";

export async function POST(request: Request): Promise<Response> {
  let settings;

  try {
    settings = getAuthSettings();
  } catch {
    return jsonResponse({ error: "Authentication is not configured" }, 503);
  }

  const body = await request.json().catch(() => ({})) as { email?: unknown; password?: unknown };

  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return jsonResponse({ error: "Correo y contrasena son obligatorios" }, 400);
  }

  let user;

  try {
    user = settings.mode === "local"
      ? await authenticateLocalUser(body.email, body.password)
      : authenticateDemoUser(body.email, body.password, settings.demoPassword);
  } catch {
    return jsonResponse({ error: "No fue posible consultar el directorio de usuarios" }, 503);
  }

  if (!user) {
    return jsonResponse({ error: "Credenciales invalidas" }, 401);
  }

  const response = jsonResponse({ user });
  response.headers.append("Set-Cookie", createSessionCookie(user, settings));
  return response;
}

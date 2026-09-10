import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { createConvexToken, getAuthSettings, jsonResponse, readRequestSession } from "../../../lib/auth-server";
import { convexErrorMessage } from "../../../lib/convex-error";
import { hashPassword } from "../../../lib/password";
import { newIdentity } from "../../../lib/user-accounts";
import { isJobTitle, validatePasswordStrength } from "../../../../convex/model/userAccounts";

export async function POST(request: Request): Promise<Response> {
  const settings = getAuthSettings();
  const session = readRequestSession(request, settings);

  if (!session) return jsonResponse({ error: "Sesión no válida" }, 401);
  if (session.role !== "admin") return jsonResponse({ error: "Solo un administrador puede crear usuarios" }, 403);

  const body = await request.json().catch(() => ({})) as { name?: unknown; email?: unknown; jobTitle?: unknown; password?: unknown };

  if (typeof body.name !== "string" || typeof body.email !== "string" || typeof body.password !== "string" || !isJobTitle(body.jobTitle)) {
    return jsonResponse({ error: "Nombre, correo, cargo y contraseña son obligatorios" }, 400);
  }

  const weakness = validatePasswordStrength(body.password);
  if (weakness) return jsonResponse({ error: weakness }, 400);

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return jsonResponse({ error: "El directorio de usuarios no está configurado" }, 503);

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(createConvexToken(session, settings));

  try {
    const userId = await client.mutation(api.userAccounts.create, {
      name: body.name,
      email: body.email,
      jobTitle: body.jobTitle,
      passwordHash: await hashPassword(body.password),
      ...newIdentity()
    });
    return jsonResponse({ userId }, 201);
  } catch (error) {
    return jsonResponse({ error: convexErrorMessage(error, "No fue posible crear el usuario") }, 409);
  }
}

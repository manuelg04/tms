import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { createConvexToken, getAuthSettings, jsonResponse, readRequestSession } from "../../../../../lib/auth-server";
import { convexErrorMessage } from "../../../../../lib/convex-error";
import { hashPassword } from "../../../../../lib/password";
import { validatePasswordStrength } from "../../../../../../convex/model/userAccounts";

export async function POST(request: Request, context: { params: Promise<{ userId: string }> }): Promise<Response> {
  const settings = getAuthSettings();
  const session = readRequestSession(request, settings);

  if (!session) return jsonResponse({ error: "Sesión no válida" }, 401);
  if (session.role !== "admin") return jsonResponse({ error: "Solo un administrador puede restablecer contraseñas" }, 403);

  const { userId } = await context.params;
  const body = await request.json().catch(() => ({})) as { password?: unknown };

  if (typeof body.password !== "string") return jsonResponse({ error: "La contraseña es obligatoria" }, 400);

  const weakness = validatePasswordStrength(body.password);
  if (weakness) return jsonResponse({ error: weakness }, 400);

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return jsonResponse({ error: "El directorio de usuarios no está configurado" }, 503);

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(createConvexToken(session, settings));

  try {
    await client.mutation(api.userAccounts.setPassword, { userId: userId as Id<"users">, passwordHash: await hashPassword(body.password) });
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: convexErrorMessage(error, "No fue posible restablecer la contraseña") }, 409);
  }
}

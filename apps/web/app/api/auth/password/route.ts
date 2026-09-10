import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { createConvexToken, getAuthSettings, jsonResponse, readRequestSession } from "../../../lib/auth-server";
import { convexErrorMessage } from "../../../lib/convex-error";
import { hashPassword } from "../../../lib/password";
import { authenticateLocalUser } from "../../../lib/user-accounts";
import { validatePasswordStrength } from "../../../../convex/model/userAccounts";

export async function POST(request: Request): Promise<Response> {
  const settings = getAuthSettings();
  const session = readRequestSession(request, settings);

  if (!session) return jsonResponse({ error: "Sesión no válida" }, 401);
  if (settings.mode !== "local") return jsonResponse({ error: "El cambio de contraseña no aplica en modo demostración" }, 400);

  const body = await request.json().catch(() => ({})) as { currentPassword?: unknown; newPassword?: unknown };

  if (typeof body.currentPassword !== "string" || typeof body.newPassword !== "string") {
    return jsonResponse({ error: "Debes indicar la contraseña actual y la nueva" }, 400);
  }

  const weakness = validatePasswordStrength(body.newPassword);
  if (weakness) return jsonResponse({ error: weakness }, 400);

  const verified = await authenticateLocalUser(session.email, body.currentPassword);
  if (!verified || verified.id !== session.id) return jsonResponse({ error: "La contraseña actual no es correcta" }, 401);

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return jsonResponse({ error: "El directorio de usuarios no está configurado" }, 503);

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(createConvexToken(session, settings));

  try {
    await client.mutation(api.userAccounts.setOwnPassword, { passwordHash: await hashPassword(body.newPassword) });
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: convexErrorMessage(error, "No fue posible cambiar la contraseña") }, 409);
  }
}

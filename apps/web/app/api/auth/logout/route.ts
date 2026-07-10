import { clearSessionCookie, getAuthSettings, jsonResponse } from "../../../lib/auth-server";

export async function POST(): Promise<Response> {
  let secure = process.env.NODE_ENV === "production";

  try {
    secure = getAuthSettings().secureCookies;
  } catch {
    secure = process.env.NODE_ENV === "production";
  }

  const response = jsonResponse({ ok: true });
  response.headers.append("Set-Cookie", clearSessionCookie(secure));
  return response;
}

import { NextResponse, type NextRequest } from "next/server";

const publicPaths = new Set(["/login", "/api/auth/login", "/api/auth/logout", "/api/auth/session", "/api/auth/token", "/api/auth/jwks"]);

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (publicPaths.has(path) || path.startsWith("/_next/") || path === "/favicon.ico") {
    return NextResponse.next();
  }

  if (!request.cookies.has("tms_session")) {
    const loginUrl = new URL("/login", request.url);
    if (!path.startsWith("/api/")) {
      loginUrl.searchParams.set("next", `${path}${request.nextUrl.search}`);
      return NextResponse.redirect(loginUrl);
    }

    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};

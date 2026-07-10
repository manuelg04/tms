import type { DemoUser } from "./auth.js";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export async function fetchDemoSession(fetcher: Fetcher = fetch): Promise<DemoUser | null> {
  try {
    const response = await fetcher("/api/auth/session", { cache: "no-store" });

    if (!response.ok) {
      return null;
    }

    const body = await response.json() as { user?: unknown };
    return isDemoUser(body.user) ? body.user : null;
  } catch {
    return null;
  }
}

export async function fetchConvexAccessToken(fetcher: Fetcher = fetch): Promise<string | null> {
  try {
    const response = await fetcher("/api/auth/token", { method: "POST", cache: "no-store" });

    if (!response.ok) {
      return null;
    }

    const body = await response.json() as { token?: unknown };
    return typeof body.token === "string" ? body.token : null;
  } catch {
    return null;
  }
}

function isDemoUser(value: unknown): value is DemoUser {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string"
    && typeof candidate.email === "string"
    && typeof candidate.name === "string"
    && (candidate.role === "admin" || candidate.role === "operator" || candidate.role === "auditor");
}

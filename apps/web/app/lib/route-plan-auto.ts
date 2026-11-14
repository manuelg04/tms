import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { DemoUser } from "./auth";
import { createConvexToken, getAuthSettings } from "./auth-server";

export type RoutePlanOutcome = {
  status: "created" | "exists" | "needs_choice" | "no_route" | "not_ready" | "blocked";
  message: string;
};

export async function ensureRoutePlanAfterEmission(user: DemoUser, expedienteId: string): Promise<RoutePlanOutcome | null> {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;

  if (!convexUrl) {
    return null;
  }

  try {
    const client = new ConvexHttpClient(convexUrl);
    client.setAuth(createConvexToken(user, getAuthSettings()));
    return await client.mutation(api.dispatchRoutePlans.ensureAutomatic, { expedienteId: expedienteId as Id<"expedientes"> });
  } catch {
    return null;
  }
}

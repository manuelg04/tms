import { randomBytes } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { DemoRole, DemoUser, JobTitle } from "./auth";
import { verifyPassword } from "./password";

export type StoredCredentials = {
  authSubject: string;
  name: string;
  email: string;
  roles: string[];
  jobTitle?: JobTitle;
  status: "active" | "disabled";
  organizationStatus: string;
  passwordHash?: string;
};

export type CredentialsLookup = (email: string) => Promise<StoredCredentials | null>;

export async function authenticateLocalUser(email: string, password: string, lookup: CredentialsLookup = lookupInConvex): Promise<DemoUser | null> {
  const normalized = email.trim().toLowerCase();

  if (!normalized || !password) {
    return null;
  }

  const stored = await lookup(normalized);
  const matches = await verifyPassword(password, stored?.passwordHash);

  if (!stored || !matches || stored.status !== "active" || stored.organizationStatus !== "active") {
    return null;
  }

  const role = sessionRole(stored.roles);

  if (!role) {
    return null;
  }

  return { id: stored.authSubject, email: stored.email, name: stored.name, role, ...(stored.jobTitle ? { jobTitle: stored.jobTitle } : {}) };
}

export function sessionRole(roles: string[]): DemoRole | null {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("operator")) return "operator";
  if (roles.includes("auditor")) return "auditor";
  return null;
}

export function newIdentity(): { authSubject: string; actorToken: string } {
  return {
    authSubject: `user_${randomBytes(12).toString("hex")}`,
    actorToken: randomBytes(32).toString("hex")
  };
}

async function lookupInConvex(email: string): Promise<StoredCredentials | null> {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const serviceKey = process.env.RNDC_INGEST_KEY;

  if (!convexUrl || !serviceKey) {
    throw new Error("User directory is not configured");
  }

  const client = new ConvexHttpClient(convexUrl);
  return await client.query(api.userAccounts.credentialsByEmail, { serviceKey, email });
}

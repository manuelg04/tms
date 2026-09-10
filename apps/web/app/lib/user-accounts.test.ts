import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword } from "./password.js";
import { authenticateLocalUser, newIdentity, sessionRole, type StoredCredentials } from "./user-accounts.js";

const password = "Piloto-MTM-2026";

async function stored(overrides: Partial<StoredCredentials> = {}): Promise<StoredCredentials> {
  return {
    authSubject: "user_abc",
    name: "Auxiliar Uno",
    email: "auxiliar@mtm.com.co",
    roles: ["operator"],
    jobTitle: "auxiliar_seguridad",
    status: "active",
    organizationStatus: "active",
    passwordHash: await hashPassword(password),
    ...overrides
  };
}

test("authenticates an active user and maps the job title into the session", async () => {
  const record = await stored();
  const user = await authenticateLocalUser("  Auxiliar@MTM.com.co ", password, async (email) => (email === "auxiliar@mtm.com.co" ? record : null));

  assert.deepEqual(user, { id: "user_abc", email: "auxiliar@mtm.com.co", name: "Auxiliar Uno", role: "operator", jobTitle: "auxiliar_seguridad" });
});

test("rejects unknown users, wrong passwords, disabled users and inactive organizations", async () => {
  const record = await stored();

  assert.equal(await authenticateLocalUser("nadie@mtm.com.co", password, async () => null), null);
  assert.equal(await authenticateLocalUser("auxiliar@mtm.com.co", "otra-clave-123", async () => record), null);
  assert.equal(await authenticateLocalUser("auxiliar@mtm.com.co", "", async () => record), null);
  assert.equal(await authenticateLocalUser("auxiliar@mtm.com.co", password, async () => ({ ...record, status: "disabled" })), null);
  assert.equal(await authenticateLocalUser("auxiliar@mtm.com.co", password, async () => ({ ...record, organizationStatus: "disabled" })), null);
  assert.equal(await authenticateLocalUser("auxiliar@mtm.com.co", password, async () => ({ ...record, passwordHash: undefined })), null);
});

test("derives the session role from the stored roles", () => {
  assert.equal(sessionRole(["admin", "operator"]), "admin");
  assert.equal(sessionRole(["operator"]), "operator");
  assert.equal(sessionRole(["auditor"]), "auditor");
  assert.equal(sessionRole(["finance"]), null);
});

test("generates distinct identities", () => {
  const a = newIdentity();
  const b = newIdentity();

  assert.match(a.authSubject, /^user_[0-9a-f]{24}$/);
  assert.match(a.actorToken, /^[0-9a-f]{64}$/);
  assert.notEqual(a.authSubject, b.authSubject);
  assert.notEqual(a.actorToken, b.actorToken);
});

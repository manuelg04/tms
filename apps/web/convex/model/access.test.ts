import assert from "node:assert/strict";
import test from "node:test";
import { requireActor } from "./access";

function contextFor(roles: string[]) {
  const user = { _id: "user-1", organizationId: "org-1", status: "active", roles, authSubject: "subject-1" };
  return {
    auth: { getUserIdentity: async () => ({ subject: "subject-1" }) },
    db: {
      query: () => ({ withIndex: () => ({ unique: async () => user }) }),
      get: async () => ({ _id: "org-1", status: "active" })
    }
  } as never;
}

const forbidden = (error: unknown) => (error as { data?: { code?: string } }).data?.code === "FORBIDDEN";

test("client accounts are denied by default and allowed only where a function lists them", async () => {
  await assert.rejects(requireActor(contextFor(["client"])), forbidden);
  assert.equal((await requireActor(contextFor(["client"]), undefined, ["admin", "client"]))._id, "user-1");
});

test("staff roles keep access to functions without an explicit role list", async () => {
  for (const role of ["admin", "operator", "auditor", "finance"]) {
    assert.equal((await requireActor(contextFor([role])))._id, "user-1");
  }
});

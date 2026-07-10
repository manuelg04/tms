import assert from "node:assert/strict";
import test from "node:test";
import { fetchConvexAccessToken, fetchDemoSession } from "./auth-client.js";

test("loads an authenticated demo session", async () => {
  const user = await fetchDemoSession(async () => Response.json({
    user: { id: "demo-operator", email: "operador@mtm.local", name: "Operador MTM", role: "operator" }
  }));

  assert.equal(user?.role, "operator");
});

test("treats an unauthorized session as signed out", async () => {
  const user = await fetchDemoSession(async () => Response.json({ user: null }, { status: 401 }));

  assert.equal(user, null);
});

test("returns a Convex access token only for successful responses", async () => {
  assert.equal(await fetchConvexAccessToken(async () => Response.json({ token: "signed-token" })), "signed-token");
  assert.equal(await fetchConvexAccessToken(async () => Response.json({ error: "unauthorized" }, { status: 401 })), null);
});

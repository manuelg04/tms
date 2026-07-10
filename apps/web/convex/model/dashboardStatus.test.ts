import assert from "node:assert/strict";
import test from "node:test";
import { dashboardStatus } from "./dashboardStatus.js";

test("counts a rejected initial submission as rejected instead of in progress", () => {
  assert.equal(dashboardStatus({ status: "pending", officialState: "pending", errorText: "REM038" }), "rejected");
});

test("keeps an authorized document authorized when a later action is rejected", () => {
  assert.equal(dashboardStatus({ status: "authorized", officialState: "authorized", errorText: "fulfillment rejected" }), "authorized");
});

test("preserves fulfilled annulled and legacy statuses", () => {
  assert.equal(dashboardStatus({ status: "fulfilled", officialState: "fulfilled" }), "fulfilled");
  assert.equal(dashboardStatus({ status: "annulled", officialState: "annulled" }), "annulled");
  assert.equal(dashboardStatus({ status: "rejected" }), "rejected");
  assert.equal(dashboardStatus({ status: "draft" }), "draft");
});

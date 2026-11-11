import assert from "node:assert/strict";
import test from "node:test";
import { chainScopes, covers, retryIsDue, tickerIsIdle, widestScope, RETRY_LEASE_MS } from "./pendingEmission";

const none = { orderAuthorized: false, consignmentsAuthorized: false, manifestAuthorized: false };

test("the chain emits the earlier documents that are still missing, in order", () => {
  assert.deepEqual(chainScopes("orden", none), ["orden"]);
  assert.deepEqual(chainScopes("remesas", none), ["orden", "remesas"]);
  assert.deepEqual(chainScopes("manifiesto", none), ["orden", "remesas", "manifiesto"]);
  assert.deepEqual(chainScopes("manifiesto", { ...none, orderAuthorized: true }), ["remesas", "manifiesto"]);
  assert.deepEqual(chainScopes("remesas", { ...none, orderAuthorized: true, consignmentsAuthorized: true }), []);
});

test("the chain skips documents the workflow does not use", () => {
  assert.deepEqual(chainScopes("manifiesto", { ...none, workflowVariant: "remesa_without_order" }), ["remesas", "manifiesto"]);
  assert.deepEqual(chainScopes("manifiesto", { ...none, workflowVariant: "empty_manifest" }), ["manifiesto"]);
});

test("a queued dispatch keeps its widest requested scope", () => {
  assert.equal(widestScope(undefined, "orden"), "orden");
  assert.equal(widestScope("manifiesto", "orden"), "manifiesto");
  assert.equal(widestScope("orden", "remesas"), "remesas");
});

test("only waiting entries outside the retry lease are retried", () => {
  assert.equal(retryIsDue({ status: "waiting" }, 1000), true);
  assert.equal(retryIsDue({ status: "waiting", lastAttemptAt: 1000 }, 1000 + RETRY_LEASE_MS - 1), false);
  assert.equal(retryIsDue({ status: "waiting", lastAttemptAt: 1000 }, 1000 + RETRY_LEASE_MS), true);
  assert.equal(retryIsDue({ status: "attention" }, 1000), false);
});

test("a queue entry closes only when the emitted document reaches the queued one", () => {
  assert.equal(covers("orden", "manifiesto"), false);
  assert.equal(covers("manifiesto", "remesas"), true);
  assert.equal(covers("remesas", "remesas"), true);
});

test("only one background retry is scheduled at a time", () => {
  assert.equal(tickerIsIdle(null, 1000), true);
  assert.equal(tickerIsIdle({ scheduledFor: 2000 }, 1000), false);
  assert.equal(tickerIsIdle({ scheduledFor: 1000 }, 1000), true);
});

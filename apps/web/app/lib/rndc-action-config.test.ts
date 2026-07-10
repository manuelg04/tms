import assert from "node:assert/strict";
import test from "node:test";
import { getRndcActionConfig, lifecycleEvents } from "./rndc-action-config.js";

test("maps only typed RNDC actions to fixed backend routes", () => {
  assert.deepEqual(getRndcActionConfig("annul_manifest"), {
    operationType: "annul_manifest",
    backendPath: "/rndc/annulments/targeted",
    processId: 32,
    lifecycle: "annulment"
  });
  assert.equal(getRndcActionConfig("arbitrary_xml"), null);
});

test("keeps document lifecycle separate for each action family", () => {
  assert.deepEqual(lifecycleEvents("fulfillment", false), {
    started: "fulfillment_started",
    finished: "fulfillment_rejected"
  });
  assert.deepEqual(lifecycleEvents("submission", true), {
    started: "submission_started",
    finished: "submission_succeeded"
  });
  assert.equal(lifecycleEvents("none", true), null);
});

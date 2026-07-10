import assert from "node:assert/strict";
import test from "node:test";
import { resolveActionOutcome } from "./rndc-action-outcome.js";

test("accepts an RNDC result only after durable evidence is stored", () => {
  assert.deepEqual(resolveActionOutcome({ backendOk: true, backendStatus: 200, evidenceStored: true }), {
    operationOutcome: "succeeded",
    lifecycleAccepted: true,
    responseStatus: 200
  });
});

test("quarantines an accepted RNDC result when durable evidence is missing", () => {
  assert.deepEqual(resolveActionOutcome({ backendOk: true, backendStatus: 200, evidenceStored: false }), {
    operationOutcome: "uncertain",
    lifecycleAccepted: false,
    responseStatus: 202,
    errorText: "RNDC responded successfully, but durable evidence was not stored"
  });
});

test("keeps ambiguous transport and server failures uncertain while definitive rejections fail", () => {
  for (const backendStatus of [408, 500, 502, 503, 504]) {
    assert.deepEqual(resolveActionOutcome({ backendOk: false, backendStatus, evidenceStored: false }), {
      operationOutcome: "uncertain",
      lifecycleAccepted: false,
      responseStatus: backendStatus
    });
  }
  assert.deepEqual(resolveActionOutcome({ backendOk: false, backendStatus: 422, evidenceStored: true }), {
    operationOutcome: "failed",
    lifecycleAccepted: false,
    responseStatus: 422
  });
  assert.deepEqual(resolveActionOutcome({ backendOk: false, backendStatus: 422, evidenceStored: false }), {
    operationOutcome: "uncertain",
    lifecycleAccepted: false,
    responseStatus: 422,
    errorText: "RNDC rejected the operation, but durable evidence was not stored"
  });
});

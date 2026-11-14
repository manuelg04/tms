import assert from "node:assert/strict";
import { test } from "node:test";
import { hasOpenRejection } from "./openRejection";

test("ignores rejections already corrected and authorized", () => {
  const authorizedRemesa = { _id: "rem", officialState: "authorized", errorText: "RNDC operation failed" };
  const authorizedManifest = { _id: "man", officialState: "authorized", errorText: "RNDC operation failed" };
  const failedRemesa = { status: "failed", businessKey: "emit:exp:remesa:90001:rechazada:op1", documentId: "rem" };
  const failedManifest = { status: "failed", businessKey: "emit:exp:manifiesto:0900001:rechazada:op3", documentId: "man" };
  assert.equal(hasOpenRejection([failedRemesa, failedManifest, { status: "succeeded", businessKey: "emit:exp:remesa:90001", documentId: "rem" }], [authorizedRemesa, authorizedManifest]), false);
});

test("keeps warning while a rejected document is still waiting for a fix", () => {
  const pending = { _id: "rem", officialState: "pending", errorText: "RNDC operation failed" };
  assert.equal(hasOpenRejection([{ status: "failed", businessKey: "emit:exp:remesa:90001", documentId: "rem" }], [pending]), true);
  assert.equal(hasOpenRejection([], [{ _id: "rem", officialState: "draft", errorText: "RNDC operation failed" }]), true);
  assert.equal(hasOpenRejection([{ status: "failed", businessKey: "emit:exp:cargo:1" }], []), true);
  assert.equal(hasOpenRejection([], [{ _id: "rem", officialState: "authorized" }]), false);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { archivedKey, rejectionUnlockProblem } from "./rejectionUnlock";

const rejected = {
  _id: "op1",
  status: "failed",
  operationType: "emit_remesa",
  mode: "live",
  requestKey: "emit-exp-remesa:90001",
  businessKey: "emit:exp:remesa:90001",
  resultJson: JSON.stringify({ ok: false, steps: [{ accepted: false, errorText: "Error REM502" }] }),
  expedienteRemesaId: "rem1",
  documentId: "doc1"
};
const remesa = { _id: "rem1", officialState: "pending", documentId: "doc1" };
const document = { _id: "doc1", officialState: "pending" };

test("reopens a remesa only when the RNDC rejected every step", () => {
  assert.equal(rejectionUnlockProblem(rejected, remesa, document), null);
  assert.equal(archivedKey(rejected.businessKey, rejected._id), "emit:exp:remesa:90001:rechazada:op1");
  assert.notEqual(rejectionUnlockProblem({ ...rejected, status: "succeeded" }, remesa, document), null);
  assert.notEqual(rejectionUnlockProblem({ ...rejected, status: "uncertain" }, remesa, document), null);
  assert.notEqual(rejectionUnlockProblem({ ...rejected, resultJson: JSON.stringify({ ok: false, steps: [{ accepted: true }] }) }, remesa, document), null);
  assert.notEqual(rejectionUnlockProblem({ ...rejected, resultJson: undefined }, remesa, document), null);
  assert.notEqual(rejectionUnlockProblem({ ...rejected, businessKey: archivedKey(rejected.businessKey, "op1") }, remesa, document), null);
  assert.notEqual(rejectionUnlockProblem({ ...rejected, operationType: "emit_manifest" }, remesa, document), null);
  assert.notEqual(rejectionUnlockProblem(rejected, { ...remesa, officialState: "authorized" }, document), null);
  assert.notEqual(rejectionUnlockProblem(rejected, { ...remesa, _id: "rem2" }, document), null);
  assert.notEqual(rejectionUnlockProblem(rejected, null, document), null);
});

test("reopens a rejected manifest through its own document", () => {
  const manifest = { ...rejected, operationType: "emit_manifest", expedienteRemesaId: undefined, businessKey: "emit:exp:manifest:0900001", documentId: "man1" };
  const manifestDocument = { _id: "man1", officialState: "pending" };
  assert.equal(rejectionUnlockProblem(manifest, null, manifestDocument), null);
  assert.notEqual(rejectionUnlockProblem(manifest, null, { ...manifestDocument, officialState: "authorized" }), null);
  assert.notEqual(rejectionUnlockProblem(manifest, null, { ...manifestDocument, _id: "other" }), null);
  assert.notEqual(rejectionUnlockProblem(manifest, remesa, manifestDocument), null);
  assert.notEqual(rejectionUnlockProblem({ ...manifest, status: "succeeded" }, null, manifestDocument), null);
});

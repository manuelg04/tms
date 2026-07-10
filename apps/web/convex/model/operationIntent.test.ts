import assert from "node:assert/strict";
import test from "node:test";
import { operationIntentMatches } from "./operationIntent.js";

const intent = {
  organizationId: "org-1",
  expedienteId: "exp-1",
  documentId: "doc-1",
  expedienteRemesaId: "rem-1",
  operationType: "emit_remesa",
  procesoId: 3,
  mode: "dry-run",
  businessKey: "emit-remesa:rem-1:990001",
  payloadJson: JSON.stringify({ remesaNumber: "990001" })
};

test("accepts only an identical persisted operation intent", () => {
  assert.equal(operationIntentMatches(intent, { ...intent }), true);
});

test("rejects reused business keys with different action, references, mode, or payload", () => {
  assert.equal(operationIntentMatches(intent, { ...intent, operationType: "fulfill_remesa" }), false);
  assert.equal(operationIntentMatches(intent, { ...intent, documentId: "doc-2" }), false);
  assert.equal(operationIntentMatches(intent, { ...intent, mode: "live" }), false);
  assert.equal(operationIntentMatches(intent, {
    ...intent,
    payloadJson: JSON.stringify({ remesaNumber: "990002" })
  }), false);
});

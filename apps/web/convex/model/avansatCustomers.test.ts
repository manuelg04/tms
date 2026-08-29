import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeAvansatCustomerBatch,
  canonicalizeAvansatCustomerPayload,
  decideAvansatCustomerRecordWrite,
  decideAvansatCustomerWrite
} from "./avansatCustomers.js";

test("canonicalizes customer payloads independently of object key order", () => {
  const first = canonicalizeAvansatCustomerPayload({
    customer: { code: "9001", name: "CLIENTE UNO", status: "active" },
    location: { city: "Bogotá", address: "Calle 1" },
    source: { taxRegime: "Común", flags: { iso: false, basc: true } }
  });
  const second = canonicalizeAvansatCustomerPayload({
    source: { flags: { basc: true, iso: false }, taxRegime: "Común" },
    location: { address: "Calle 1", city: "Bogotá" },
    customer: { status: "active", name: "CLIENTE UNO", code: "9001" }
  });

  assert.equal(first, second);
});

test("decides insert, update, and unchanged from source content hashes", () => {
  assert.equal(decideAvansatCustomerWrite(undefined, "a".repeat(64)), "insert");
  assert.equal(decideAvansatCustomerWrite("a".repeat(64), "a".repeat(64)), "unchanged");
  assert.equal(decideAvansatCustomerWrite("a".repeat(64), "b".repeat(64)), "update");
  assert.throws(() => decideAvansatCustomerWrite("bad", "b".repeat(64)), /hash/i);
});

test("canonicalizes batch positions and row hashes", () => {
  assert.equal(
    canonicalizeAvansatCustomerBatch(2, [
      { document: "9001", contentHash: "a".repeat(64) },
      { document: "9002", contentHash: "b".repeat(64) }
    ]),
    JSON.stringify([2, [["9001", "a".repeat(64)], ["9002", "b".repeat(64)]]])
  );
});

test("updates a matching legacy record that has no Avansat source hash", () => {
  assert.equal(decideAvansatCustomerRecordWrite(true, undefined, "a".repeat(64), false), "update");
  assert.equal(decideAvansatCustomerRecordWrite(true, "a".repeat(64), "a".repeat(64), true), "unchanged");
  assert.equal(decideAvansatCustomerRecordWrite(true, "a".repeat(64), "a".repeat(64), false), "update");
  assert.equal(decideAvansatCustomerRecordWrite(false, undefined, "a".repeat(64), false), "insert");
});

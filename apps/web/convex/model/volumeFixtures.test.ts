import assert from "node:assert/strict";
import test from "node:test";
import { syntheticDispatch } from "./volumeFixtures.js";

test("creates reproducible volume records with text identifiers", () => {
  const first = syntheticDispatch("phase6", 42, 1_720_000_000_000);
  const repeated = syntheticDispatch("phase6", 42, 1_720_000_000_000);

  assert.deepEqual(first, repeated);
  assert.equal(first.code, "VOL-PHASE6-000042");
  assert.equal(first.orderNumber, "0000042");
  assert.equal(first.manifestNumber, "0000042");
  assert.equal(typeof first.orderNumber, "string");
});

test("spreads representative records across stages and routes", () => {
  const records = Array.from({ length: 24 }, (_, index) => syntheticDispatch("phase6", index, 1_720_000_000_000));

  assert.ok(new Set(records.map((record) => record.status)).size >= 3);
  assert.ok(new Set(records.map((record) => record.originCity)).size >= 3);
  assert.ok(new Set(records.map((record) => record.destinationCity)).size >= 3);
});

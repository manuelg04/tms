import test from "node:test";
import assert from "node:assert/strict";
import { formatConsecutivo, parseConsecutivo, countersForOperation } from "./consecutivos";

test("formato con padding por tipo (segun legacy: 000044579 / 42196 / 0041464)", () => {
  assert.equal(formatConsecutivo("orden_cargue", 44580), "000044580");
  assert.equal(formatConsecutivo("remesa", 42197), "42197");
  assert.equal(formatConsecutivo("manifiesto", 41465), "0041465");
});

test("parse tolera padding y basura", () => {
  assert.equal(parseConsecutivo("000044580"), 44580);
  assert.equal(parseConsecutivo("42197"), 42197);
  assert.equal(parseConsecutivo(""), null);
  assert.equal(parseConsecutivo("IV42196"), null);
});

test("cada operacion consume sus contadores", () => {
  assert.deepEqual(countersForOperation("loading-order"), ["orden_cargue"]);
  assert.deepEqual(countersForOperation("remesa"), ["remesa"]);
  assert.deepEqual(countersForOperation("manifest"), ["manifiesto"]);
  assert.deepEqual(countersForOperation("driver-vehicle"), []);
});

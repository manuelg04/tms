import test from "node:test";
import assert from "node:assert/strict";
import { claimNextConsecutive, formatConsecutive } from "./consecutiveRange";

test("formats a consecutive preserving leading zeros as text", () => {
  assert.equal(formatConsecutive({ prefix: "", padding: 6 }, 123), "000123");
  assert.equal(formatConsecutive({ prefix: "OC-", padding: 5 }, 7), "OC-00007");
});

test("keeps digits intact when the value exceeds the padding", () => {
  assert.equal(formatConsecutive({ prefix: "", padding: 3 }, 12345), "12345");
});

test("claims the next value and advances the range", () => {
  const claim = claimNextConsecutive({ prefix: "RM", padding: 4, nextValue: 41 });

  assert.equal(claim.formatted, "RM0041");
  assert.equal(claim.numeric, 41);
  assert.equal(claim.nextValue, 42);
});

test("rejects a claim when the range is exhausted", () => {
  assert.throws(
    () => claimNextConsecutive({ prefix: "", padding: 4, nextValue: 100, endValue: 99 }),
    /rango de consecutivos agotado/i
  );
});

test("allows claiming the final value of a bounded range", () => {
  const claim = claimNextConsecutive({ prefix: "", padding: 4, nextValue: 99, endValue: 99 });

  assert.equal(claim.formatted, "0099");
  assert.equal(claim.nextValue, 100);
});

test("rejects ranges with invalid configuration", () => {
  assert.throws(() => claimNextConsecutive({ prefix: "", padding: 4, nextValue: 0 }), /rango de consecutivos inválido/i);
  assert.throws(() => claimNextConsecutive({ prefix: "", padding: -1, nextValue: 1 }), /rango de consecutivos inválido/i);
  assert.throws(() => claimNextConsecutive({ prefix: "", padding: 4, nextValue: 1.5 }), /rango de consecutivos inválido/i);
});

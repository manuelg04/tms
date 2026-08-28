import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCatalogPreflightSafe,
  assertCatalogSourceBounds,
  assertDevelopmentConvexTarget,
  importTotalsEqual,
  parseEnvContent,
  verifyCatalogReadback
} from "./rndc-catalog-runtime.js";

test("environment parsing removes quotes and inline comments", () => {
  assert.deepEqual(parseEnvContent('A="one"\nB=two # note\nC=three\n'), {
    A: "one",
    B: "two",
    C: "three"
  });
});

test("only a matching Convex development deployment is accepted", () => {
  assert.doesNotThrow(() =>
    assertDevelopmentConvexTarget("dev:safe-catalog-123", "https://safe-catalog-123.convex.cloud")
  );
  assert.throws(
    () => assertDevelopmentConvexTarget("prod:live-catalog-123", "https://live-catalog-123.convex.cloud"),
    /desarrollo/
  );
  assert.throws(
    () => assertDevelopmentConvexTarget("dev:safe-catalog-123", "https://different.convex.cloud"),
    /no corresponde/
  );
});

test("read-back requires every input row to be current or superseded by a newer source row", () => {
  const result = verifyCatalogReadback(
    [
      { key: "001", secondaryKey: "01", sourceRegisteredAt: "2026-01-01T00:00:00", contentHash: "a".repeat(64) },
      { key: "001", secondaryKey: "02", sourceRegisteredAt: "2025-01-01T00:00:00", contentHash: "b".repeat(64) }
    ],
    [
      { key: "001", secondaryKey: "01", sourceRegisteredAt: "2026-01-01T00:00:00", contentHash: "a".repeat(64) },
      { key: "001", secondaryKey: "02", sourceRegisteredAt: "2026-01-01T00:00:00", contentHash: "c".repeat(64) },
      { key: "999", secondaryKey: "99", sourceRegisteredAt: "2020-01-01T00:00:00", contentHash: "d".repeat(64) }
    ]
  );

  assert.deepEqual(result, { inputRows: 2, storedRows: 3, matched: 1, superseded: 1, extras: 1 });
});

test("read-back rejects missing, stale, conflicting, and duplicate stored rows", () => {
  const expected = [{ key: "231", sourceRegisteredAt: "2025-02-21T15:42:33", contentHash: "a".repeat(64) }];

  assert.throws(() => verifyCatalogReadback(expected, []), /falta la llave/);
  assert.throws(
    () =>
      verifyCatalogReadback(expected, [
        { key: "231", sourceRegisteredAt: "2024-02-21T15:42:33", contentHash: "a".repeat(64) }
      ]),
    /anterior/
  );
  assert.throws(
    () =>
      verifyCatalogReadback(expected, [
        { key: "231", sourceRegisteredAt: "2025-02-21T15:42:33", contentHash: "b".repeat(64) }
      ]),
    /contenido diferente/
  );
  assert.throws(
    () =>
      verifyCatalogReadback(expected, [
        { key: "231", sourceRegisteredAt: "2025-02-21T15:42:33", contentHash: "a".repeat(64) },
        { key: "231", sourceRegisteredAt: "2025-02-21T15:42:33", contentHash: "a".repeat(64) }
      ]),
    /duplicada/
  );
});

test("preflight rejects an equal-date conflict before the first catalog write", () => {
  const expected = [{ key: "231", sourceRegisteredAt: "2025-02-21T15:42:33", contentHash: "a".repeat(64) }];

  assert.doesNotThrow(() => assertCatalogPreflightSafe(expected, []));
  assert.doesNotThrow(() =>
    assertCatalogPreflightSafe(expected, [
      { key: "231", sourceRegisteredAt: "2026-02-21T15:42:33", contentHash: "b".repeat(64) }
    ])
  );
  assert.throws(
    () =>
      assertCatalogPreflightSafe(expected, [
        { key: "231", sourceRegisteredAt: "2025-02-21T15:42:33", contentHash: "b".repeat(64) }
      ]),
    /preflight/
  );
});

test("import totals compare by value rather than JSON property order", () => {
  const left = {
    vehicleLines: { batchesApplied: 2, inserted: 3, updated: 0, unchanged: 0, outdated: 0 },
    insurers: { batchesApplied: 1, inserted: 1, updated: 0, unchanged: 0, outdated: 0 },
    packages: { batchesApplied: 1, inserted: 1, updated: 0, unchanged: 0, outdated: 0 },
    bodyTypes: { batchesApplied: 1, inserted: 1, updated: 0, unchanged: 0, outdated: 0 }
  };
  const right = {
    bodyTypes: { unchanged: 0, updated: 0, outdated: 0, inserted: 1, batchesApplied: 1 },
    packages: { unchanged: 0, updated: 0, outdated: 0, inserted: 1, batchesApplied: 1 },
    insurers: { unchanged: 0, updated: 0, outdated: 0, inserted: 1, batchesApplied: 1 },
    vehicleLines: { unchanged: 0, updated: 0, outdated: 0, inserted: 3, batchesApplied: 2 }
  };

  assert.equal(importTotalsEqual(left, right), true);
  right.vehicleLines.inserted = 4;
  assert.equal(importTotalsEqual(left, right), false);
});

test("catalog source bounds reject suspiciously truncated or oversized global masters", () => {
  const valid = {
    vehicleLines: { normalizedRows: 18632, batchCount: 187 },
    insurers: { normalizedRows: 108, batchCount: 2 },
    packages: { normalizedRows: 31, batchCount: 1 },
    bodyTypes: { normalizedRows: 94, batchCount: 1 }
  };

  assert.doesNotThrow(() => assertCatalogSourceBounds(valid));
  assert.throws(
    () => assertCatalogSourceBounds({ ...valid, vehicleLines: { normalizedRows: 17999, batchCount: 180 } }),
    /vehicleLines/
  );
  assert.throws(
    () => assertCatalogSourceBounds({ ...valid, vehicleLines: { normalizedRows: 50001, batchCount: 501 } }),
    /vehicleLines/
  );
});

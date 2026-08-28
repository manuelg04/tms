import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalizeRndcCatalogPayload } from "../../convex/model/rndcCatalogs.js";
import {
  chunkCatalogRows,
  deterministicCatalogRunId,
  hashCatalogBatch,
  hashCatalogManifest,
  prepareBodyTypeRows,
  prepareInsurerRows,
  preparePackageRows,
  prepareVehicleLineRows
} from "./rndc-reference-ingestion.js";

test("prepared catalog rows use the same canonical payload as Convex", () => {
  const [prepared] = prepareVehicleLineRows([
    {
      makeCode: "001",
      makeName: undefined,
      lineCode: "02",
      lineName: "LÍNEA DOS",
      grossWeightKg: 0,
      sourceRegisteredAt: "2026-08-27T10:00:00"
    }
  ]);
  const canonical = canonicalizeRndcCatalogPayload({
    makeCode: "001",
    makeName: null,
    lineCode: "02",
    lineName: "LÍNEA DOS",
    grossWeightKg: 0
  });

  assert.equal(prepared.contentHash, createHash("sha256").update(canonical).digest("hex"));
});

test("prepared insurer rows preserve an unknown optional type", () => {
  const [prepared] = prepareInsurerRows([
    {
      insurerNit: "9002004353",
      name: "CARDIF COLOMBIA SEGUROS GENERALES S.A.",
      insurerType: undefined,
      sourceRegisteredAt: "2014-05-30T17:49:26"
    }
  ]);
  const canonical = canonicalizeRndcCatalogPayload({
    insurerNit: "9002004353",
    name: "CARDIF COLOMBIA SEGUROS GENERALES S.A.",
    insurerType: null
  });

  assert.equal(prepared.contentHash, createHash("sha256").update(canonical).digest("hex"));
});

test("prepared package rows hash unknown optional values as null", () => {
  const [prepared] = preparePackageRows([
    {
      code: "3H",
      description: "Jerrican",
      fullDescription: "Jerrican en plástico",
      definition: "Envase poligonal",
      minimumEmptyWeightKg: 0,
      maximumEmptyWeightKg: 6500,
      hazardous: undefined,
      packageTypeCode: undefined,
      packageTypeName: undefined,
      materialCode: undefined,
      materialName: undefined,
      operationType: ".",
      sourceRegisteredAt: "2025-03-12T14:52:39"
    }
  ]);
  const canonical = canonicalizeRndcCatalogPayload({
    code: "3H",
    description: "Jerrican",
    fullDescription: "Jerrican en plástico",
    definition: "Envase poligonal",
    minimumEmptyWeightKg: 0,
    maximumEmptyWeightKg: 6500,
    hazardous: null,
    packageTypeCode: null,
    packageTypeName: null,
    materialCode: null,
    materialName: null,
    operationType: "."
  });

  assert.equal(prepared.contentHash, createHash("sha256").update(canonical).digest("hex"));
});

test("prepared body-type rows include a stable content hash", () => {
  const [prepared] = prepareBodyTypeRows([
    {
      code: "231",
      description: "PORTA CONTENEDOR",
      sourceRegisteredAt: "2025-02-21T15:42:33"
    }
  ]);

  assert.match(prepared.contentHash, /^[0-9a-f]{64}$/);
});

test("catalog rows are split into bounded batches without loss", () => {
  const rows = Array.from({ length: 205 }, (_, index) => ({ code: String(index) }));

  assert.deepEqual(chunkCatalogRows(rows, 100).map((batch) => batch.length), [100, 100, 5]);
  assert.throws(() => chunkCatalogRows(rows, 201), /entre 1 y 200/);
});

test("batch hashes bind row content and source chronology", () => {
  const first = prepareBodyTypeRows([
    { code: "231", description: "PORTA CONTENEDOR", sourceRegisteredAt: "2025-02-21T15:42:33" }
  ]);
  const second = [{ ...first[0], sourceRegisteredAt: "2026-02-21T15:42:33" }];
  const canonicalPayload = canonicalizeRndcCatalogPayload({ code: "231", description: "PORTA CONTENEDOR" });
  const expected = createHash("sha256")
    .update(JSON.stringify(["body_type", [[first[0].sourceRegisteredAt, canonicalPayload, first[0].contentHash]]]))
    .digest("hex");

  assert.equal(hashCatalogBatch("body_type", first), expected);
  assert.equal(hashCatalogBatch("body_type", first), hashCatalogBatch("body_type", first));
  assert.notEqual(hashCatalogBatch("body_type", first), hashCatalogBatch("body_type", second));
  assert.throws(() => hashCatalogBatch("packaging", first), /hash de contenido/);
});

test("catalog manifest hashes bind the ordered batch sequence", () => {
  const batchHashes = ["a".repeat(64), "b".repeat(64)];
  const expected = createHash("sha256").update(JSON.stringify(["vehicle_line", batchHashes])).digest("hex");

  assert.equal(hashCatalogManifest("vehicle_line", batchHashes), expected);
  assert.notEqual(hashCatalogManifest("vehicle_line", batchHashes), hashCatalogManifest("vehicle_line", [...batchHashes].reverse()));
});

test("catalog run identifiers are stable UUIDs for the same manifest", () => {
  const first = { vehicleLines: { sha256: "a" }, insurers: { sha256: "b" } };
  const reordered = { insurers: { sha256: "b" }, vehicleLines: { sha256: "a" } };

  assert.match(deterministicCatalogRunId(first), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(deterministicCatalogRunId(first), deterministicCatalogRunId(reordered));
  assert.notEqual(deterministicCatalogRunId(first), deterministicCatalogRunId({ ...first, insurers: { sha256: "c" } }));
});

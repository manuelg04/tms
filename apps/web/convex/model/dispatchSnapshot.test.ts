import test from "node:test";
import assert from "node:assert/strict";
import { buildDispatchSnapshot, canonicalJson } from "./dispatchSnapshot";

test("canonical json is deterministic regardless of key order", () => {
  const a = canonicalJson({ b: 2, a: { d: [1, 2], c: "x" } });
  const b = canonicalJson({ a: { c: "x", d: [1, 2] }, b: 2 });

  assert.equal(a, b);
});

test("canonical json omits undefined values and rejects unsupported ones", () => {
  assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}');
  assert.throws(() => canonicalJson({ a: () => 1 }), /no serializable/i);
  assert.throws(() => canonicalJson({ a: Number.NaN }), /no serializable/i);
});

test("a snapshot does not change when the source data is edited afterwards", () => {
  const source = { remitente: { nombre: "ITALCOL S.A", telefono: "6051234" }, pesoTn: "32.5" };
  const snapshot = buildDispatchSnapshot("orden_cargue", source, { takenAt: 1720000000000 });

  source.remitente.nombre = "OTRO REMITENTE";
  source.pesoTn = "1";

  const persisted = JSON.parse(snapshot.payloadJson) as { data: { remitente: { nombre: string }; pesoTn: string } };

  assert.equal(persisted.data.remitente.nombre, "ITALCOL S.A");
  assert.equal(persisted.data.pesoTn, "32.5");
});

test("equal data produces the same fingerprint and different data a different one", () => {
  const meta = { takenAt: 1720000000000 };
  const one = buildDispatchSnapshot("remesa", { numero: "0041983", peso: "34" }, meta);
  const two = buildDispatchSnapshot("remesa", { peso: "34", numero: "0041983" }, meta);
  const three = buildDispatchSnapshot("remesa", { peso: "34", numero: "0041984" }, meta);

  assert.equal(one.fingerprint, two.fingerprint);
  assert.notEqual(one.fingerprint, three.fingerprint);
});

test("snapshot payload records kind and capture time", () => {
  const snapshot = buildDispatchSnapshot("manifiesto", { fleteTotal: "3500000" }, { takenAt: 1720000000123 });
  const persisted = JSON.parse(snapshot.payloadJson) as { kind: string; takenAt: number };

  assert.equal(persisted.kind, "manifiesto");
  assert.equal(persisted.takenAt, 1720000000123);
});

test("snapshot preserves leading zeros because identifiers stay text", () => {
  const snapshot = buildDispatchSnapshot("remesa", { numero: "0000123", codigoDane: "05001000" }, { takenAt: 1 });
  const persisted = JSON.parse(snapshot.payloadJson) as { data: { numero: string; codigoDane: string } };

  assert.equal(persisted.data.numero, "0000123");
  assert.equal(persisted.data.codigoDane, "05001000");
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildDispatchSnapshot, canonicalJson, snapshotDataMatches, snapshotDataOf } from "./dispatchSnapshot";

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

test("snapshot data can be read back from the persisted payload", () => {
  const snapshot = buildDispatchSnapshot("orden_cargue", { orderNumber: "0000001", weightTons: "32.5" }, { takenAt: 1720000000000 });

  assert.deepEqual(snapshotDataOf(snapshot.payloadJson), { orderNumber: "0000001", weightTons: "32.5" });
  assert.equal(snapshotDataOf(undefined), null);
  assert.equal(snapshotDataOf("no es json"), null);
  assert.equal(snapshotDataOf('{"kind":"remesa","takenAt":1}'), null);
});

test("an unedited draft matches its snapshot even when capture times differ", () => {
  const draft = { orderNumber: "0000001", sender: { name: "ITALCOL S.A", identificationNumber: "890900" }, expeditionDate: "2026-07-13" };
  const snapshot = buildDispatchSnapshot("orden_cargue", draft, { takenAt: 1720000000000 });

  assert.equal(snapshotDataMatches(snapshot.payloadJson, { ...draft }), true);
  assert.equal(snapshotDataMatches(snapshot.payloadJson, { expeditionDate: "2026-07-13", sender: { identificationNumber: "890900", name: "ITALCOL S.A" }, orderNumber: "0000001" }), true);
});

test("a draft edited after the snapshot no longer matches, so a rejected emission must re-capture before retrying", () => {
  const draft = { manifestNumber: "0000009", freightTotal: "3500000", paymentResponsible: "Destinatario" };
  const snapshot = buildDispatchSnapshot("manifiesto", draft, { takenAt: 1720000000000 });
  const corrected = { ...draft, freightTotal: "3800000" };

  assert.equal(snapshotDataMatches(snapshot.payloadJson, corrected), false);
});

test("undefined fields in the candidate do not break the comparison", () => {
  const snapshot = buildDispatchSnapshot("remesa", { number: "00001", weightTons: "34" }, { takenAt: 1 });

  assert.equal(snapshotDataMatches(snapshot.payloadJson, { number: "00001", weightTons: "34", volumeM3: undefined }), true);
  assert.equal(snapshotDataMatches(undefined, { number: "00001" }), false);
  assert.equal(snapshotDataMatches(snapshot.payloadJson, { number: "00001" }), false);
});

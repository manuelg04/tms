import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeRndcCatalogPayload, cleanRndcReference, decideRndcCatalogWrite } from "./rndcCatalogs.js";

test("inserts when no catalog record exists", () => {
  const incoming = {
    sourceRegisteredAt: "2026-08-27T10:00:00",
    payload: { code: "0", description: "Paquete" }
  };

  assert.equal(decideRndcCatalogWrite(null, incoming), "insert");
});

test("leaves identical content from the same source date unchanged", () => {
  const existing = {
    sourceRegisteredAt: "2026-08-27T10:00:00",
    payload: { code: "0", description: "Paquete" }
  };
  const incoming = {
    sourceRegisteredAt: "2026-08-27T10:00:00",
    payload: { code: "0", description: "Paquete" }
  };

  assert.equal(decideRndcCatalogWrite(existing, incoming), "unchanged");
});

test("updates changed content from a newer source date", () => {
  const existing = {
    sourceRegisteredAt: "2011-05-03T15:43:01",
    payload: { nit: "8600377079", name: "AIG SEGUROS GENERALES S. A." }
  };
  const incoming = {
    sourceRegisteredAt: "2018-08-06T09:15:23",
    payload: { nit: "8600377079", name: "SBS SEGUROS COLOMBIA" }
  };

  assert.equal(decideRndcCatalogWrite(existing, incoming), "update");
});

test("rejects content from an older source date as outdated", () => {
  const existing = {
    sourceRegisteredAt: "2025-02-21T15:42:33",
    payload: { code: "231", description: "PORTA CONTENEDOR" }
  };
  const incoming = {
    sourceRegisteredAt: "2011-08-17T10:21:59",
    payload: { code: "231", description: "PORTACONTENEDORES" }
  };

  assert.equal(decideRndcCatalogWrite(existing, incoming), "outdated");
});

test("flags different content from the same source date as a conflict", () => {
  const existing = {
    sourceRegisteredAt: "2026-08-27T10:00:00",
    payload: { code: "4C", description: "Caja de madera" }
  };
  const incoming = {
    sourceRegisteredAt: "2026-08-27T10:00:00",
    payload: { code: "4C", description: "Caja plástica" }
  };

  assert.equal(decideRndcCatalogWrite(existing, incoming), "conflict");
});

test("ignores payload key order and database metadata when comparing content", () => {
  const existing = {
    _id: "catalog-record",
    _creationTime: 10,
    createdAt: 20,
    updatedAt: 30,
    sourceRegisteredAt: "2026-08-27T10:00:00",
    payload: { code: "4C", description: "Caja de madera", hazardous: true }
  };
  const incoming = {
    receivedAt: 40,
    sourceRegisteredAt: "2026-08-27T10:00:00",
    payload: { hazardous: true, description: "Caja de madera", code: "4C" }
  };

  assert.equal(decideRndcCatalogWrite(existing, incoming), "unchanged");
});

test("canonicalizes insignificant whitespace in string payload values", () => {
  const spaced = canonicalizeRndcCatalogPayload({ code: " 4C ", description: "Caja   de\tmadera " });
  const clean = canonicalizeRndcCatalogPayload({ code: "4C", description: "Caja de madera" });

  assert.equal(spaced, clean);
});

test("reference normalization treats RNDC zero placeholders as missing", () => {
  assert.equal(cleanRndcReference(undefined), undefined);
  assert.equal(cleanRndcReference("   "), undefined);
  assert.equal(cleanRndcReference("0"), undefined);
  assert.equal(cleanRndcReference(" 001 "), "001");
});

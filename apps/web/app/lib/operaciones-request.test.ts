import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseMoney,
  parseTons,
  dispatcherTerms,
  matchesDispatcher,
  pickByDocument,
  pickByName,
  pickByPlate,
  pickMunicipality,
  pickPackaging,
  requestObservations,
  requestedDriverId,
  splitRoute,
  type OperacionesRequest
} from "./operaciones-request";

test("splits the worksheet route into origin and destination", () => {
  assert.deepEqual(splitRoute({ route: "YUMBO - BARRANQUILLA" }), { origin: "YUMBO", destination: "BARRANQUILLA" });
  assert.deepEqual(splitRoute({ route: "Cali / Bogotá" }), { origin: "Cali", destination: "Bogotá" });
  assert.deepEqual(splitRoute({ route: "CALI - X", origin: "BUGA", destination: "TULUA" }), { origin: "BUGA", destination: "TULUA" });
  assert.deepEqual(splitRoute({ route: "CARTAGENA" }), { origin: "CARTAGENA", destination: undefined });
});

test("reads tons from free text", () => {
  assert.equal(parseTons("34 TON"), "34");
  assert.equal(parseTons("34,5 toneladas"), "34.5");
  assert.equal(parseTons("34.000 KG"), "34");
  assert.equal(parseTons("32500"), "32.5");
  assert.equal(parseTons("por definir"), undefined);
});

test("reads money from free text", () => {
  assert.equal(parseMoney("4.500.000"), 4500000);
  assert.equal(parseMoney("$ 4,500,000.00"), 4500000);
  assert.equal(parseMoney("4500000"), 4500000);
  assert.equal(parseMoney("a convenir"), undefined);
});

test("only suggests a master when the match is unambiguous", () => {
  assert.equal(pickByPlate([{ plate: "ABC123" }, { plate: "ABC124" }], "abc-123")?.plate, "ABC123");
  assert.equal(pickByPlate([{ plate: "ABC1231" }], "ABC123"), null);
  assert.equal(pickByName([{ name: "CEMENTOS DEL VALLE S.A.S." }], "Cementos del Valle")?.name, "CEMENTOS DEL VALLE S.A.S.");
  assert.equal(pickByName([{ name: "CEMENTOS DEL VALLE SAS" }, { name: "CEMENTOS DEL VALLE S.A." }], "Cementos del Valle"), null);
  assert.equal(pickByName([{ name: "ARGOS" }], "Cementos del Valle"), null);
});

test("matches municipalities and packaging by exact name", () => {
  const divisions = [
    { name: "YUMBO", isMunicipality: true, municipalityName: "YUMBO" },
    { name: "YUMBO ZONA INDUSTRIAL", isMunicipality: false, municipalityName: "YUMBO" }
  ];
  assert.equal(pickMunicipality(divisions, "Yumbo")?.name, "YUMBO");
  assert.equal(pickMunicipality(divisions, "Cali"), null);
  assert.equal(pickPackaging([{ code: "17", description: "GRANEL SOLIDO" }, { code: "0", description: "PAQUETES" }], "granel solido")?.code, "17");
});

test("joins the worksheet notes for the order observations", () => {
  const request = { remesaObservations: "Entregar en bodega 3", odc: "4500123", policy: "POL-9" } as OperacionesRequest;
  assert.equal(requestObservations(request), "Entregar en bodega 3 · ODC: 4500123 · Póliza: POL-9");
  assert.equal(requestObservations({} as OperacionesRequest), undefined);
});

test("finds the requested driver by exact document", () => {
  const rows = [{ document: "10836874381" }, { document: "1083687438" }];
  assert.equal(pickByDocument(rows, "1.083.687.438")?.document, "1083687438");
  assert.equal(pickByDocument(rows, "108368743"), null);
  assert.equal(pickByDocument(rows, undefined), null);
  assert.equal(pickByDocument(undefined, "1083687438"), null);
});

test("never assigns a different driver than the one in the worksheet request", () => {
  const linked = [{ _id: "linked", document: "111" }];
  assert.equal(requestedDriverId({ requestedDocument: "222", matched: { _id: "found" }, linked }), "found");
  assert.equal(requestedDriverId({ requestedDocument: "222", matched: null, linked }), undefined);
  assert.equal(requestedDriverId({ requestedDocument: "1.1.1", matched: null, linked }), "linked");
  assert.equal(requestedDriverId({ requestedDocument: undefined, matched: null, linked }), "linked");
  assert.equal(requestedDriverId({ requestedDocument: " ", linked: [...linked, { _id: "other", document: "333" }] }), undefined);
});

test("limits the worksheet inbox to the enabled dispatcher", () => {
  const terms = dispatcherTerms(" Mantilla , =diego ");
  assert.deepEqual(terms, ["MANTILLA", "=DIEGO"]);
  assert.equal(matchesDispatcher({ requestedBy: "Diego Antonio Mantilla", dispatcherName: "otro" }, terms), true);
  assert.equal(matchesDispatcher({ requestedBy: "Alvaro", dispatcherName: "diego" }, terms), true);
  assert.equal(matchesDispatcher({ requestedBy: "Diego Pérez", dispatcherName: "Diego Pérez" }, terms), false);
  assert.equal(matchesDispatcher({ requestedBy: "Ana Mantillana", dispatcherName: undefined }, terms), false);
  assert.equal(matchesDispatcher({ requestedBy: undefined, dispatcherName: undefined }, terms), false);
  assert.equal(matchesDispatcher({ requestedBy: "Alvaro", dispatcherName: "alvaro" }, dispatcherTerms(undefined)), true);
  assert.deepEqual(dispatcherTerms(" , = "), []);
});

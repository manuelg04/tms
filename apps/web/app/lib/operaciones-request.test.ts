import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseMoney,
  parseTons,
  dispatcherTerms,
  expandCity,
  inboxFilter,
  isRequestedSince,
  requestsSince,
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

test("splits tight hyphens and abbreviations and never repeats the origin", () => {
  assert.deepEqual(splitRoute({ route: "BOGOTÁ-PCUESTA" }), { origin: "BOGOTÁ", destination: "PIEDECUESTA" });
  assert.deepEqual(splitRoute({ route: "BTA-BGA" }), { origin: "BOGOTA", destination: "BUCARAMANGA" });
  assert.deepEqual(splitRoute({ route: "BOGOTA - BOGOTÁ" }), { origin: "BOGOTA", destination: undefined });
  assert.deepEqual(splitRoute({ route: "BOGOTA-TUNJA-SOGAMOSO" }), { origin: "BOGOTA-TUNJA-SOGAMOSO", destination: undefined });
  assert.deepEqual(splitRoute({ route: "BOGOTÁ-PCUESTA", origin: "BOGOTA", destination: "BOGOTA" }), { origin: "BOGOTA", destination: undefined });
});

test("matches a municipality by its unique name prefix", () => {
  const divisions = [
    { name: "BOGOTA, D.C.", isMunicipality: true, municipalityName: "BOGOTA" },
    { name: "PIEDECUESTA", isMunicipality: true, municipalityName: "PIEDECUESTA" }
  ];
  assert.equal(pickMunicipality(divisions, "Bogotá")?.name, "BOGOTA, D.C.");
  assert.equal(pickMunicipality(divisions, expandCity("PCUESTA"))?.name, "PIEDECUESTA");
  assert.equal(pickMunicipality([{ name: "SAN GIL", isMunicipality: true, municipalityName: "SAN GIL" }, { name: "SAN ALBERTO", isMunicipality: true, municipalityName: "SAN ALBERTO" }], "San"), null);
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

test("hides worksheet requests saved before the pilot start date", () => {
  const since = requestsSince("2026-11-14");
  assert.equal(since, Date.parse("2026-11-14T00:00:00-05:00"));
  assert.equal(requestsSince(" "), undefined);
  assert.equal(requestsSince("14/11/2026"), undefined);
  assert.equal(isRequestedSince({ requestedAt: Date.parse("2026-11-11T10:02:00-05:00"), updatedAt: Date.parse("2026-11-14T08:00:00-05:00") }, since), false);
  assert.equal(isRequestedSince({ requestedAt: Date.parse("2026-11-14T00:00:00-05:00"), updatedAt: 0 }, since), true);
  assert.equal(isRequestedSince({ requestedAt: undefined, updatedAt: Date.parse("2026-11-13T23:59:00-05:00") }, since), false);
  assert.equal(isRequestedSince({ requestedAt: 1, updatedAt: 1 }, undefined), true);
});

test("combines the dispatcher and start date limits for the inbox", () => {
  const base = { expedienteId: "kn7", status: "loading_order_available", statusLabel: "", updatedAt: 0, isPortTrip: false, driver: {}, owner: {}, vehicle: {}, ticketApproved: false, termsAccepted: false, documents: { loadingOrder: false, officialManifest: false, officialRemesa: false } };
  const filter = inboxFilter({ OPERACIONES_ONLY_DISPATCHER: "mantilla", OPERACIONES_REQUESTS_SINCE: "2026-11-14" });
  assert.equal(filter.limited, true);
  assert.equal(filter.accepts({ ...base, dispatcherName: "Diego Antonio Mantilla", requestedAt: Date.parse("2026-11-14T09:00:00-05:00") }), true);
  assert.equal(filter.accepts({ ...base, dispatcherName: "Diego Antonio Mantilla", requestedAt: Date.parse("2026-11-11T10:02:00-05:00") }), false);
  assert.equal(filter.accepts({ ...base, dispatcherName: "Jorge Ariel Diaz", requestedAt: Date.parse("2026-11-14T09:00:00-05:00") }), false);
  assert.equal(inboxFilter({}).limited, false);
  assert.equal(inboxFilter({}).accepts({ ...base, requestedAt: 1 }), true);
});

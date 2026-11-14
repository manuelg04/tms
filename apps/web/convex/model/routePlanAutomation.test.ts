import assert from "node:assert/strict";
import test from "node:test";
import { automaticRouteChoice, bogotaDeparture, routeCityKey, tripRouteCandidates } from "./routePlanAutomation";

const routes = [
  { _id: "r30", origin: "CUCUTA (Nort)", destination: "CARTAGENA DE INDIAS (Boli)" },
  { _id: "r1284", origin: "CUCUTA (Nort)", destination: "CARTAGENA DE INDIAS (Boli)" },
  { _id: "r1610", origin: "ZIPAQUIRA (Cund)", destination: "DOSQUEBRADAS (Risa)" },
  { _id: "r7", origin: "SAN JOSE DE CUCUTA (Nort)", destination: "BOGOTA, D.C. (Bogo)" }
];

test("city keys ignore accents, department and what follows a comma", () => {
  assert.equal(routeCityKey("Cúcuta, Norte de Santander"), "CUCUTA");
  assert.equal(routeCityKey("BOGOTA, D.C. (Bogo)"), "BOGOTA");
  assert.equal(routeCityKey("  Cartagena   de Indias (Boli) "), "CARTAGENA DE INDIAS");
});

test("exact city matches win over partial ones", () => {
  assert.deepEqual(tripRouteCandidates(routes, "Cúcuta", "Cartagena de Indias").map((route) => route._id), ["r30", "r1284"]);
  assert.deepEqual(tripRouteCandidates(routes, "Zipaquirá", "Dosquebradas").map((route) => route._id), ["r1610"]);
});

test("partial matches are used only when nothing matches exactly", () => {
  assert.deepEqual(tripRouteCandidates(routes, "Cúcuta", "Bogotá").map((route) => route._id), ["r7"]);
  assert.deepEqual(tripRouteCandidates(routes, "", "Bogotá"), []);
  assert.deepEqual(tripRouteCandidates(routes, "Pasto", "Ipiales"), []);
});

test("free text cities with the department after the name still find their route", () => {
  const catalogue = [
    { _id: "a", origin: "YUMBO (Vall)", destination: "PIEDECUESTA (Sant)", originCode: "76892000", destinationCode: "68547000" },
    { _id: "b", origin: "YUMBO (Vall)", destination: "BOGOTA, D.C. (Bogo)", originCode: "76892000", destinationCode: "11001000" },
    { _id: "c", origin: "ZARAGOZA (Anti)", destination: "BOGOTA, D.C. (Bogo)", originCode: "5895000", destinationCode: "11001000" }
  ];
  assert.deepEqual(tripRouteCandidates(catalogue, "Yumbo", "PIEDECUESTA SANTANDER").map((route) => route._id), ["a"]);
  assert.deepEqual(tripRouteCandidates(catalogue, "Yumbo", "BOGOTA BOGOTA D. C.").map((route) => route._id), ["b"]);
  assert.deepEqual(
    tripRouteCandidates(catalogue, { city: "Zaragoza Antioquia", code: "05895000" }, { city: "otra", code: "11001000" }).map((route) => route._id),
    ["c"]
  );
});

test("a single route is chosen alone and several routes only suggest the last one used", () => {
  assert.deepEqual(automaticRouteChoice([], null), { status: "none", suggestedRouteId: null });
  assert.deepEqual(automaticRouteChoice([routes[2]], null), { status: "single", suggestedRouteId: "r1610" });
  assert.deepEqual(automaticRouteChoice(routes.slice(0, 2), "r1284"), { status: "several", suggestedRouteId: "r1284" });
  assert.deepEqual(automaticRouteChoice(routes.slice(0, 2), "r999"), { status: "several", suggestedRouteId: null });
});

test("departure uses Bogota local time to the minute", () => {
  assert.equal(bogotaDeparture(Date.parse("2026-11-13T23:14:59Z")), "2026-11-13T18:14");
  assert.equal(bogotaDeparture(Date.parse("2026-11-14T03:05:00Z")), "2026-11-13T22:05");
});

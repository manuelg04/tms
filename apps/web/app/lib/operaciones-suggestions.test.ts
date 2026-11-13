import assert from "node:assert/strict";
import { test } from "node:test";
import type { OperacionesRequest } from "./operaciones-request";
import { suggestionSummary, suggestionsFromRequest, withConsignmentSuggestions, withManifestSuggestions } from "./operaciones-suggestions";

const request = {
  policy: "POL-2026-118",
  odc: "4500123",
  remesaObservations: "Entregar en bodega 3",
  advanceText: "2.000.000",
  freightText: "4.500.000",
  weightText: "34 TON",
  ticketApproved: false
} as OperacionesRequest;

test("takes policy, advance and freight from the worksheet", () => {
  assert.deepEqual(suggestionsFromRequest(request), {
    policy: "POL-2026-118",
    observations: "Entregar en bodega 3 · ODC: 4500123 · Póliza: POL-2026-118",
    advance: "2000000",
    freight: "4500000",
    weightTons: "34",
    ticketApproved: false
  });
});

test("the values agreed in Operaciones win over the worksheet text", () => {
  const agreed = suggestionsFromRequest({ ...request, advanceValue: 1800000, freightValue: 4300000, freightTons: 33.4 });
  assert.equal(agreed.advance, "1800000");
  assert.equal(agreed.freight, "4300000");
  assert.equal(agreed.weightTons, "33.4");
});

test("never replaces what the user already wrote", () => {
  const suggestions = suggestionsFromRequest(request);
  assert.deepEqual(withConsignmentSuggestions({ policyNumber: "MIA-1" }, suggestions), {
    policyNumber: "MIA-1",
    generalObservations: "Entregar en bodega 3 · ODC: 4500123 · Póliza: POL-2026-118"
  });
  assert.deepEqual(withManifestSuggestions({ freightTotal: "5000000", advance: "0" }, suggestions), { freightTotal: "5000000", advance: "2000000" });
  assert.deepEqual(withManifestSuggestions({ advance: "900000" }, suggestions), { advance: "900000", freightTotal: "4500000" });
  assert.deepEqual(withManifestSuggestions({ advance: "900000" }, null), { advance: "900000" });
});

test("describes what was suggested on each stage", () => {
  const suggestions = suggestionsFromRequest(request);
  assert.deepEqual(suggestionSummary("remesas", suggestions), ["póliza POL-2026-118", "observaciones de la planilla"]);
  assert.equal(suggestionSummary("manifiesto", suggestions).length, 2);
});

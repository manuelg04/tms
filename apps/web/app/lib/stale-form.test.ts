import assert from "node:assert/strict";
import { test } from "node:test";
import { changedDraftFields, formIsStale, staleDraftProblem } from "../../convex/model/draftRevision";
import { captureOpenedForm, staleFormChanges, type StaleSource } from "./stale-form";

function source(overrides: Partial<StaleSource["expediente"]> = {}, remesa: Partial<StaleSource["remesas"][number]> = {}): StaleSource {
  return {
    expediente: { loadingOrderDraft: { weightTons: "34", sender: { siteCode: "27" } }, manifestDraft: { freightTotal: "3000000" }, ...overrides },
    remesas: [{ _id: "rem1", number: "90001", sequence: 1, draft: { loading: { latitude: "4.6", longitude: "-74.1" } }, draftRevision: 2, ...remesa }]
  };
}

test("the server refuses a save made from a form opened before someone else saved", () => {
  assert.equal(staleDraftProblem("remesa", 2, 2), null);
  assert.equal(staleDraftProblem("remesa", undefined, 7), null);
  assert.equal(staleDraftProblem("orden_cargue", 0, undefined), null);
  assert.match(staleDraftProblem("remesa", 2, 3, "90001") ?? "", /La remesa 90001 cambió desde que abriste este formulario/);
  assert.match(staleDraftProblem("manifiesto", 0, 1) ?? "", /El manifiesto cambió/);
});

test("a form is stale only when the saved document is newer than the one it opened", () => {
  assert.equal(formIsStale(2, 2), false);
  assert.equal(formIsStale(3, 2), false);
  assert.equal(formIsStale(2, 3), true);
  assert.equal(formIsStale(0, undefined), false);
});

test("an open remesa form notices that the coordinates were saved by someone else", () => {
  const opened = captureOpenedForm("remesas:0", source());
  assert.equal(staleFormChanges("remesas", opened, source()), null);
  const live = source({}, { draft: { loading: { latitude: "4.7", longitude: "-74.1" } }, draftRevision: 3 });
  assert.deepEqual(staleFormChanges("remesas", opened, live), ["remesa 90001: sitio de cargue"]);
  assert.equal(staleFormChanges("manifiesto", opened, live), null);
  opened.remesas.rem1 += 1;
  assert.equal(staleFormChanges("remesas", opened, live), null);
});

test("a change in the order also invalidates the remesa form that inherits from it", () => {
  const opened = captureOpenedForm("remesas:0", source());
  const live = source({ loadingOrderDraft: { weightTons: "30", sender: { siteCode: "27" } }, loadingOrderRevision: 1 });
  assert.deepEqual(staleFormChanges("remesas", opened, live), ["orden de cargue: peso"]);
  assert.deepEqual(staleFormChanges("orden_cargue", opened, live), ["orden de cargue: peso"]);
  const manifestLive = source({ manifestDraft: { freightTotal: "3500000" }, manifestRevision: 1 });
  assert.deepEqual(staleFormChanges("manifiesto", opened, manifestLive), ["manifiesto: flete"]);
});

test("changed fields ignore empty values and key order", () => {
  assert.deepEqual(changedDraftFields({ a: "1", b: { x: 1, y: "" } }, { b: { y: undefined, x: 1 }, a: "1" }, {}), []);
  assert.deepEqual(changedDraftFields({ a: "1" }, { a: "2", c: "3" }, { a: "campo A" }), ["campo A", "Otros datos"]);
});

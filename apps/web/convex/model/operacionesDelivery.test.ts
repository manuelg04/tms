import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOperacionesDeliveryPlan } from "./operacionesDelivery";

const expediente = {};

test("nothing is delivered while the documents are drafts", () => {
  const plan = buildOperacionesDeliveryPlan({
    code: "DSP-000200",
    expediente,
    documents: [{ _id: "d1", kind: "orden_cargue", number: "000048379", officialState: "draft", updatedAt: 1 }]
  });
  assert.deepEqual(plan, []);
});

test("an authorized loading order is delivered by itself", () => {
  const plan = buildOperacionesDeliveryPlan({
    code: "DSP-000200",
    expediente,
    documents: [{ _id: "d1", kind: "orden_cargue", number: "000048379", officialState: "authorized", updatedAt: 1 }]
  });
  assert.deepEqual(plan, [
    {
      kind: "loading_order",
      deliveryKey: "DSP-000200:orden:000048379",
      label: "Orden de cargue",
      number: "000048379",
      documentId: "d1",
      fileName: "orden-cargue-000048379.pdf"
    }
  ]);
});

test("manifest and remesa add their numbers and both PDFs", () => {
  const plan = buildOperacionesDeliveryPlan({
    code: "DSP-000200",
    expediente,
    documents: [
      { _id: "d1", kind: "orden_cargue", number: "000048379", officialState: "authorized", updatedAt: 1 },
      { _id: "d2", kind: "remesa", number: "45945", officialState: "authorized", updatedAt: 2 },
      { _id: "d3", kind: "manifiesto", number: "0045202", officialState: "authorized", updatedAt: 3 }
    ]
  });
  assert.deepEqual(plan.map((item) => item.kind), ["loading_order", "manifest_numbers", "official_remesa", "official_manifest"]);
  assert.deepEqual(plan[1], {
    kind: "manifest_numbers",
    deliveryKey: "DSP-000200:numeros:0045202:45945",
    label: "Números de manifiesto y remesa",
    number: "0045202 / 45945",
    manifestNumber: "0045202",
    remesaNumber: "45945"
  });
});

test("an annulled manifest is not delivered and a replacement gets its own key", () => {
  const documents = [
    { _id: "d2", kind: "remesa", number: "45945", officialState: "authorized", updatedAt: 2 },
    { _id: "d3", kind: "manifiesto", number: "0000036", officialState: "annulled", updatedAt: 3 },
    { _id: "d4", kind: "manifiesto", number: "0000044", officialState: "authorized", updatedAt: 4 }
  ];
  const plan = buildOperacionesDeliveryPlan({ code: "DSP-000135", expediente: { manifestDocumentId: "d4" }, documents });
  assert.equal(plan.find((item) => item.kind === "official_manifest")?.deliveryKey, "DSP-000135:manifiesto:0000044");
  const annulled = buildOperacionesDeliveryPlan({ code: "DSP-000135", expediente: { manifestDocumentId: "d3" }, documents });
  assert.equal(annulled.find((item) => item.kind === "official_manifest"), undefined);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFulfillmentPlan,
  validateLogisticsTimeline,
  validateFulfillmentQuantities,
  type LogisticsTimelineInput
} from "./fulfillmentWorkflow.js";

function completeTimeline(): LogisticsTimelineInput {
  return {
    origin: {
      arrival: 1_000,
      entry: 2_000,
      start: 3_000,
      end: 4_000,
      exit: 5_000
    },
    destination: {
      arrival: 6_000,
      entry: 7_000,
      start: 8_000,
      end: 9_000,
      exit: 10_000
    },
    finalDelivery: 11_000
  };
}

test("accepts five ordered origin events five ordered destination events and final delivery", () => {
  assert.deepEqual(validateLogisticsTimeline(completeTimeline()), []);
});

test("rejects an event that occurs before the previous logistics event", () => {
  const timeline = completeTimeline();
  timeline.origin.start = 1_500;

  assert.deepEqual(validateLogisticsTimeline(timeline), [
    "El inicio de cargue no puede ocurrir antes de la entrada a cargue."
  ]);
});

test("keeps final delivery distinct from arrival at the unloading site", () => {
  const timeline = completeTimeline();
  timeline.finalDelivery = 5_500;

  assert.deepEqual(validateLogisticsTimeline(timeline), [
    "La entrega final no puede ocurrir antes de terminar la operación de descargue."
  ]);
});

test("fulfillment plan resumes with remaining consignments before the manifest", () => {
  const plan = buildFulfillmentPlan({
    consignments: [
      { id: "r1", fulfillmentState: "fulfilled" },
      { id: "r2", fulfillmentState: "not_requested" }
    ],
    manifest: { id: "m1", fulfillmentState: "not_requested" }
  });

  assert.deepEqual(plan, [
    { kind: "remesa", id: "r2" },
    { kind: "manifiesto", id: "m1" }
  ]);
});

test("manifest fulfillment remains blocked while a consignment is pending or rejected", () => {
  assert.deepEqual(buildFulfillmentPlan({
    consignments: [
      { id: "r1", fulfillmentState: "fulfilled" },
      { id: "r2", fulfillmentState: "pending" }
    ],
    manifest: { id: "m1", fulfillmentState: "not_requested" }
  }), []);
});

test("a fully fulfilled dispatch has no fulfillment steps", () => {
  assert.deepEqual(buildFulfillmentPlan({
    consignments: [{ id: "r1", fulfillmentState: "fulfilled" }],
    manifest: { id: "m1", fulfillmentState: "fulfilled" }
  }), []);
});

test("an authorized Viaje Vacío can close its manifest without remesas", () => {
  assert.deepEqual(buildFulfillmentPlan({
    consignments: [],
    manifest: { id: "m-empty", fulfillmentState: "not_requested" },
    allowEmptyManifest: true
  }), [{ kind: "manifiesto", id: "m-empty" }]);
});

test("accepts delivered missing surplus and returned quantities when they are nonnegative", () => {
  assert.deepEqual(validateFulfillmentQuantities({
    deliveredQuantity: "980",
    missingQuantity: "20",
    surplusQuantity: "0",
    returnedQuantity: "0"
  }), []);
});

test("rejects negative or nonnumeric fulfillment quantities", () => {
  assert.deepEqual(validateFulfillmentQuantities({
    deliveredQuantity: "-1",
    missingQuantity: "dos",
    surplusQuantity: "0",
    returnedQuantity: "0"
  }), [
    "La cantidad entregada debe ser un número mayor o igual a cero.",
    "La cantidad faltante debe ser un número mayor o igual a cero."
  ]);
});

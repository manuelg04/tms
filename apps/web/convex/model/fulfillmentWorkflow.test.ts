import assert from "node:assert/strict";
import test from "node:test";
import {
  bogotaDateTimeParts,
  buildFulfillmentPlan,
  validateEntryTimes,
  validateFulfillmentQuantities
} from "./fulfillmentWorkflow.js";

const HOUR = 3_600_000;

test("entry times are never derived and must both be recorded", () => {
  assert.deepEqual(validateEntryTimes({}, 100 * HOUR), [
    "Registra la fecha y hora de entrada al cargue.",
    "Registra la fecha y hora de entrada al descargue."
  ]);
  assert.deepEqual(validateEntryTimes({ loadingEntryAt: 10 * HOUR, unloadingEntryAt: 20 * HOUR }, 100 * HOUR), []);
});

test("entry times reject future moments and an unloading entry that is not after loading", () => {
  assert.deepEqual(validateEntryTimes({ loadingEntryAt: 10 * HOUR, unloadingEntryAt: 101 * HOUR }, 100 * HOUR), [
    "La entrada al descargue no puede ser una fecha futura."
  ]);
  assert.deepEqual(validateEntryTimes({ loadingEntryAt: 20 * HOUR, unloadingEntryAt: 20 * HOUR }, 100 * HOUR), [
    "La entrada al descargue debe ser posterior a la entrada al cargue."
  ]);
});

test("a suspended consignment only needs the loading entry", () => {
  assert.deepEqual(validateEntryTimes({ suspended: true, loadingEntryAt: 10 * HOUR }, 100 * HOUR), []);
});

test("operation times format in Bogota local time", () => {
  assert.deepEqual(bogotaDateTimeParts(Date.UTC(2026, 6, 10, 16, 2)), { date: "10/07/2026", time: "11:02" });
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

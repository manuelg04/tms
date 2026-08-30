import assert from "node:assert/strict";
import test from "node:test";
import {
  bogotaDateTimeParts,
  buildFulfillmentPlan,
  deriveOperationTimes,
  validateFulfillmentQuantities,
  validateOperationTimes
} from "./fulfillmentWorkflow.js";

const HOUR = 3_600_000;

test("operation times default to the agreed appointments and hours", () => {
  const times = deriveOperationTimes(
    { loadingAppointmentAt: 100 * HOUR, loadingAgreedHours: "1.5", unloadingAppointmentAt: 110 * HOUR, unloadingAgreedHours: "2" },
    undefined,
    { loadingAt: 0, unloadingAt: 0 }
  );

  assert.deepEqual(times, {
    loadingArrivalAt: 100 * HOUR,
    loadingEntryAt: 100 * HOUR,
    loadingExitAt: 101.5 * HOUR,
    unloadingArrivalAt: 110 * HOUR,
    unloadingEntryAt: 110 * HOUR,
    unloadingExitAt: 112 * HOUR
  });
});

test("operation times keep operator overrides and never place unloading before loading", () => {
  const times = deriveOperationTimes(
    { loadingAppointmentAt: 100 * HOUR, unloadingAppointmentAt: 90 * HOUR },
    { loadingExitAt: 103 * HOUR },
    { loadingAt: 0, unloadingAt: 0 }
  );

  assert.equal(times.loadingExitAt, 103 * HOUR);
  assert.equal(times.unloadingArrivalAt, 103 * HOUR);
  assert.equal(times.unloadingExitAt, 105 * HOUR);
});

test("operation times fall back to the service order schedule when no appointment exists", () => {
  const times = deriveOperationTimes({}, undefined, { loadingAt: 50 * HOUR, unloadingAt: 60 * HOUR });

  assert.equal(times.loadingArrivalAt, 50 * HOUR);
  assert.equal(times.unloadingArrivalAt, 60 * HOUR);
});

test("operation times must follow the trip order", () => {
  assert.deepEqual(validateOperationTimes({ loadingArrivalAt: 10, loadingEntryAt: 20, loadingExitAt: 30, unloadingArrivalAt: 40, unloadingEntryAt: 50, unloadingExitAt: 60 }), []);
  assert.deepEqual(validateOperationTimes({ loadingExitAt: 30, unloadingArrivalAt: 20 }), ["La llegada al descargue no puede ser antes de la salida del cargue."]);
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

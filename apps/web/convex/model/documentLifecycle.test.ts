import test from "node:test";
import assert from "node:assert/strict";

type Lifecycle = {
  officialState: string;
  fulfillmentState: string;
  correctionState: string;
  annulmentState: string;
  reconciliationState: string;
};

type LifecycleModule = {
  initialDocumentLifecycle?: () => Lifecycle;
  applyDocumentEvent?: (lifecycle: Lifecycle, event: string) => Lifecycle;
};

const modulePath = "./documentLifecycle";
const lifecycleModule = (await import(modulePath).catch(() => ({}))) as LifecycleModule;
const initialDocumentLifecycle =
  lifecycleModule.initialDocumentLifecycle ??
  (() => ({
    officialState: "missing",
    fulfillmentState: "missing",
    correctionState: "missing",
    annulmentState: "missing",
    reconciliationState: "missing"
  }));
const applyDocumentEvent = lifecycleModule.applyDocumentEvent ?? ((lifecycle) => lifecycle);

test("an RNDC rejection changes the attempt but not the official document state", () => {
  const authorized: Lifecycle = {
    officialState: "authorized",
    fulfillmentState: "not_requested",
    correctionState: "none",
    annulmentState: "none",
    reconciliationState: "not_needed"
  };

  assert.deepEqual(applyDocumentEvent(authorized, "attempt_rejected"), authorized);
});

test("a rejected fulfillment preserves an authorized manifest", () => {
  const authorized: Lifecycle = {
    officialState: "authorized",
    fulfillmentState: "not_requested",
    correctionState: "none",
    annulmentState: "none",
    reconciliationState: "not_needed"
  };
  const pending = applyDocumentEvent(authorized, "fulfillment_started");
  const rejected = applyDocumentEvent(pending, "fulfillment_rejected");

  assert.equal(rejected.officialState, "authorized");
  assert.equal(rejected.fulfillmentState, "rejected");
});

test("correction and annulment have independent lifecycle fields", () => {
  const authorized: Lifecycle = {
    officialState: "authorized",
    fulfillmentState: "not_requested",
    correctionState: "none",
    annulmentState: "none",
    reconciliationState: "not_needed"
  };
  const correcting = applyDocumentEvent(authorized, "correction_started");
  const corrected = applyDocumentEvent(correcting, "correction_succeeded");

  assert.equal(corrected.officialState, "authorized");
  assert.equal(corrected.correctionState, "corrected");

  const annulling = applyDocumentEvent(corrected, "annulment_started");
  const annulled = applyDocumentEvent(annulling, "annulment_succeeded");

  assert.equal(annulled.officialState, "annulled");
  assert.equal(annulled.annulmentState, "annulled");
  assert.equal(annulled.correctionState, "corrected");
});

test("a reconciliation mismatch never overwrites the official state", () => {
  const authorized: Lifecycle = {
    officialState: "authorized",
    fulfillmentState: "not_requested",
    correctionState: "none",
    annulmentState: "none",
    reconciliationState: "pending"
  };
  const mismatch = applyDocumentEvent(authorized, "reconciliation_mismatch");

  assert.equal(mismatch.officialState, "authorized");
  assert.equal(mismatch.reconciliationState, "mismatch");
});

test("fulfillment cannot complete before official authorization", () => {
  assert.throws(
    () => applyDocumentEvent(initialDocumentLifecycle(), "fulfillment_succeeded"),
    /invalid document transition/i
  );
});

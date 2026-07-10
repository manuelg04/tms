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

test("discarding an uncertain dry-run submission restores its draft state", () => {
  const pending: Lifecycle = {
    officialState: "pending",
    fulfillmentState: "not_requested",
    correctionState: "none",
    annulmentState: "none",
    reconciliationState: "not_needed"
  };

  assert.equal(applyDocumentEvent(pending, "submission_abandoned").officialState, "draft");
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

test("annulling a fulfillment reopens the document without annulling it", () => {
  const fulfilled: Lifecycle = {
    officialState: "fulfilled",
    fulfillmentState: "fulfilled",
    correctionState: "none",
    annulmentState: "none",
    reconciliationState: "not_needed"
  };
  const reversing = applyDocumentEvent(fulfilled, "fulfillment_annulment_started");
  const reopened = applyDocumentEvent(reversing, "fulfillment_annulment_succeeded");

  assert.equal(reversing.officialState, "fulfilled");
  assert.equal(reversing.fulfillmentState, "annulment_pending");
  assert.equal(reopened.officialState, "authorized");
  assert.equal(reopened.fulfillmentState, "not_requested");
  assert.equal(reopened.annulmentState, "none");
});

test("a rejected fulfillment annulment preserves the fulfilled document", () => {
  const fulfilled: Lifecycle = {
    officialState: "fulfilled",
    fulfillmentState: "fulfilled",
    correctionState: "none",
    annulmentState: "none",
    reconciliationState: "not_needed"
  };
  const reversing = applyDocumentEvent(fulfilled, "fulfillment_annulment_started");
  const rejected = applyDocumentEvent(reversing, "fulfillment_annulment_rejected");

  assert.equal(rejected.officialState, "fulfilled");
  assert.equal(rejected.fulfillmentState, "fulfilled");
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

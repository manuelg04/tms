import assert from "node:assert/strict";
import test from "node:test";
import { actionableNotification } from "./actionableNotification.js";

test("creates actions for rejection reconciliation fulfillment and evidence failures", () => {
  assert.deepEqual(actionableNotification("attempt_rejected", "exp-1"), {
    category: "rejection",
    title: "Documento RNDC rechazado",
    actionLabel: "Revisar rechazo",
    actionHref: "/expedientes/exp-1"
  });
  assert.equal(actionableNotification("reconciliation_started", "exp-1")?.actionLabel, "Conciliar resultado");
  assert.equal(actionableNotification("submission_succeeded", "exp-1")?.category, "fulfillment");
  assert.equal(actionableNotification("evidence_failed", "exp-1")?.category, "evidence");
});

test("does not create noise for intermediate lifecycle events", () => {
  assert.equal(actionableNotification("submission_started", "exp-1"), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { classifyDrainResult } from "./pending-emission-drain";

test("a completed emission leaves the queue", () => {
  assert.deepEqual(classifyDrainResult(200, { ok: true }), { outcome: "done" });
});

test("an outage or an emission in progress is retried later", () => {
  assert.equal(classifyDrainResult(202, { queued: true, reason: "rndc_unavailable" }).outcome, "retry");
  assert.equal(classifyDrainResult(409, { reason: "in_flight", nextAction: "esperar" }).outcome, "retry");
  assert.equal(classifyDrainResult(500, { error: "boom" }).outcome, "retry");
  assert.equal(classifyDrainResult(409, { nextAction: "reintentar", steps: [{ outcome: "failed", error: "sin respuesta" }] }).outcome, "retry");
});

test("a rejection, missing data or an uncertain result waits for a person", () => {
  assert.deepEqual(
    classifyDrainResult(409, { nextAction: "revisar_rechazo", steps: [{ outcome: "authorized" }, { outcome: "rejected", error: "REM100 peso inválido" }] }),
    { outcome: "attention", error: "REM100 peso inválido" }
  );
  assert.deepEqual(
    classifyDrainResult(409, { reason: "missing_fields", nextAction: "completar_datos", blockers: [{ documentNumber: "00045", missingFields: ["cargo.weightTons"] }] }),
    { outcome: "attention", error: "Faltan datos en 00045: cargo.weightTons" }
  );
  assert.equal(classifyDrainResult(409, { reason: "uncertain", nextAction: "conciliar", blockers: ["Hay una operación incierta"] }).outcome, "attention");
  assert.equal(classifyDrainResult(409, { reason: "masters_not_registered", error: "Hay maestros sin registrar" }).outcome, "attention");
});

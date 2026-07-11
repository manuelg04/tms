import assert from "node:assert/strict";
import test from "node:test";
import {
  dispatchPrimaryAction,
  dispatchStageMeta,
  operationalBlocker,
  type DispatchPresentationInput
} from "./dispatchPresentation.js";

function input(overrides: Partial<DispatchPresentationInput> = {}): DispatchPresentationInput {
  return {
    stage: "orden_cargue",
    blockers: [],
    hasRejectedOperation: false,
    hasUncertainOperation: false,
    hasOperationInFlight: false,
    printed: false,
    ...overrides
  };
}

test("each operational stage exposes one clear primary action", () => {
  assert.equal(dispatchPrimaryAction(input({ stage: "orden_cargue" })).label, "Continuar orden de cargue");
  assert.equal(dispatchPrimaryAction(input({ stage: "remesas" })).label, "Continuar remesas");
  assert.equal(dispatchPrimaryAction(input({ stage: "vehiculo_conductor" })).label, "Asignar vehículo y conductor");
  assert.equal(dispatchPrimaryAction(input({ stage: "manifiesto" })).label, "Preparar manifiesto");
  assert.equal(dispatchPrimaryAction(input({ stage: "envio_rndc" })).label, "Revisar y enviar");
  assert.equal(dispatchPrimaryAction(input({ stage: "cargue_descargue" })).label, "Registrar tiempos");
  assert.equal(dispatchPrimaryAction(input({ stage: "cumplido_inicial" })).label, "Cumplir remesas");
  assert.equal(dispatchPrimaryAction(input({ stage: "cumplido_final" })).label, "Cumplir manifiesto");
  assert.equal(dispatchPrimaryAction(input({ stage: "cumplido" })).label, "Imprimir documentos");
});

test("an uncertain operation always changes the primary action to reconciliation", () => {
  const action = dispatchPrimaryAction(input({ stage: "envio_rndc", hasUncertainOperation: true }));

  assert.equal(action.kind, "reconcile");
  assert.equal(action.label, "Conciliar resultado");
  assert.equal(action.disabled, false);
});

test("a rejected operation changes the primary action to rejection review", () => {
  const action = dispatchPrimaryAction(input({ stage: "envio_rndc", hasRejectedOperation: true }));

  assert.equal(action.kind, "review_rejection");
  assert.equal(action.label, "Revisar rechazo");
});

test("an operation in flight disables the primary action", () => {
  const action = dispatchPrimaryAction(input({ stage: "envio_rndc", hasOperationInFlight: true }));

  assert.equal(action.label, "Envío en curso");
  assert.equal(action.disabled, true);
});

test("stage metadata describes complete current and blocked states without relying on color", () => {
  const current = dispatchStageMeta("manifiesto", "manifiesto");
  const complete = dispatchStageMeta("remesas", "manifiesto");
  const blocked = dispatchStageMeta("envio_rndc", "manifiesto");

  assert.equal(current.state, "current");
  assert.equal(current.stateLabel, "Etapa actual");
  assert.equal(complete.state, "complete");
  assert.equal(complete.stateLabel, "Completada");
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.stateLabel, "Bloqueada");
});

test("technical missing field names are translated into operational blockers", () => {
  assert.equal(operationalBlocker("Peso (TN)"), "Completa el peso de la mercancía en la orden de cargue.");
  assert.equal(operationalBlocker("Remesa 2: Destinatario"), "Remesa 2: completa el destinatario.");
});

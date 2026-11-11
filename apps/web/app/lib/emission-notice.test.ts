import assert from "node:assert/strict";
import test from "node:test";
import { emissionNotice } from "./emission-notice";

test("an accepted emission names each authorized document", () => {
  const notice = emissionNotice(200, {
    mode: "dry-run",
    steps: [
      { action: "emit_loading_order", documentNumber: "0000081", outcome: "authorized", radicado: "904100350" },
      { action: "emit_remesa", documentNumber: "00056", outcome: "authorized" }
    ]
  });
  assert.equal(notice.tone, "ok");
  assert.equal(notice.text, "Guardado y transmitido (modo prueba): Orden de cargue 0000081 (radicado 904100350), Remesa 00056.");
});

test("an outage tells the operator the document is queued", () => {
  const notice = emissionNotice(202, { queued: true, reason: "rndc_unavailable" });
  assert.equal(notice.tone, "wait");
  assert.match(notice.text, /quedó en cola/);
});

test("missing data keeps the draft and says what is missing", () => {
  const notice = emissionNotice(409, { reason: "not_prepared", blockers: ["Falta asignar el vehículo"] });
  assert.equal(notice.tone, "wait");
  assert.equal(notice.text, "Guardado como borrador; todavía no se transmite. Selecciona un vehículo del maestro.");
});

test("a rejection after a partial chain reports both results", () => {
  const notice = emissionNotice(409, {
    nextAction: "revisar_rechazo",
    steps: [
      { action: "emit_loading_order", documentNumber: "0000081", outcome: "authorized" },
      { action: "emit_remesa", documentNumber: "00056", outcome: "rejected", error: "REM100 peso inválido" }
    ]
  });
  assert.equal(notice.tone, "bad");
  assert.equal(notice.text, "Orden de cargue 0000081 con autorización del RNDC. El RNDC rechazó remesa 00056: REM100 peso inválido. Corrige el dato y vuelve a guardar.");
});

test("an uncertain result asks for reconciliation instead of a resend", () => {
  const notice = emissionNotice(409, { steps: [{ action: "issue_manifest", documentNumber: "0000041", outcome: "uncertain" }] });
  assert.equal(notice.tone, "bad");
  assert.match(notice.text, /Conciliar resultado/);
});

test("pending data reported while preparing the document is shown as a draft", () => {
  const notice = emissionNotice(409, {
    error: "El documento tiene datos pendientes y no puede emitirse",
    detail: { code: "VALIDATION", data: { blockers: ["El despacho no tiene remesas"], scope: "remesas" } },
    steps: []
  });
  assert.equal(notice.tone, "wait");
  assert.equal(notice.text, "Guardado como borrador; todavía no se transmite. Agrega al menos una remesa al despacho.");
});

import assert from "node:assert/strict";
import test from "node:test";
import { amountInWords, DEFAULT_MONEY_LIMITS, manifestMoneyReview, moneyConfirmationBlocker, resolveMoneyConfirmation, resolveMoneyLimits } from "./moneyChecks";
import { manifestMissingFields } from "./dispatchWorkflow";

const complete = { issueDate: "2026-11-13", estimatedDeliveryDate: "2026-11-15", operationScope: "intermunicipal" as const, manifestType: "G", paymentResponsible: "Cliente" };

test("un flete habitual no genera avisos ni bloqueos", () => {
  const review = manifestMoneyReview({ freightTotal: "4760000", advance: "3332000", fopatContribution: "4760" });
  assert.deepEqual(review, { blockers: [], warnings: [], confirmationKey: "" });
});

test("un flete con un cero de más pide confirmación", () => {
  const review = manifestMoneyReview({ freightTotal: "60000000", advance: "3000000" });
  assert.equal(review.blockers.length, 0);
  assert.equal(review.warnings.length, 1);
  assert.equal(review.warnings[0].field, "freightTotal");
  assert.match(review.warnings[0].message, /cero de más/);
  assert.equal(review.confirmationKey, "60000000:3000000");
});

test("un flete con un cero de menos pide confirmación", () => {
  const review = manifestMoneyReview({ freightTotal: "476000", advance: "0" });
  assert.match(review.warnings[0].message, /falte un cero/);
});

test("el anticipo por encima del porcentaje habitual pide confirmación", () => {
  const review = manifestMoneyReview({ freightTotal: "5000000", advance: "4600000" });
  assert.equal(review.warnings.length, 1);
  assert.equal(review.warnings[0].field, "advance");
  assert.match(review.warnings[0].message, /92 %/);
  assert.equal(manifestMoneyReview({ freightTotal: "5000000", advance: "4250000" }).warnings.length, 0);
});

test("el anticipo mayor que el flete bloquea", () => {
  const review = manifestMoneyReview({ freightTotal: "2187768", advance: "3360000" });
  assert.equal(review.blockers.length, 1);
  assert.match(review.blockers[0], /no puede ser mayor que el flete/);
});

test("las retenciones que dejan el neto negativo bloquean", () => {
  const review = manifestMoneyReview({ freightTotal: "5000000", advance: "4000000", withholdingSource: "1000000", withholdingIca: "10", fopatContribution: "5000" });
  assert.match(review.blockers[0], /neto a pagar quedaría negativo/);
  assert.equal(manifestMoneyReview({ freightTotal: "5000000", advance: "4000000", withholdingSource: "1000000", withholdingIca: "10", fopatContribution: "5000", adjustments: "100000" }).blockers.length, 0);
});

test("el viaje vacío no pide confirmación de rango", () => {
  assert.equal(manifestMoneyReview({ manifestType: "W", freightTotal: "100000" }).warnings.length, 0);
});

test("la confirmación solo vale para los valores confirmados", () => {
  const review = manifestMoneyReview({ freightTotal: "60000000", advance: "0" });
  assert.match(moneyConfirmationBlocker(review, undefined) ?? "", /el flete de \$60\.000\.000/);
  assert.match(moneyConfirmationBlocker(review, "6000000:0") ?? "", /fuera de lo habitual/);
  assert.equal(moneyConfirmationBlocker(review, "60000000:0"), undefined);
});

test("el manifiesto queda bloqueado hasta confirmar el valor fuera de rango", () => {
  const draft = { ...complete, freightTotal: "60000000", advance: "0" };
  assert.equal(manifestMissingFields(draft).length, 1);
  assert.deepEqual(manifestMissingFields({ ...draft, moneyConfirmation: { key: "60000000:0" } }), []);
  assert.equal(manifestMissingFields({ ...draft, freightTotal: "61000000", moneyConfirmation: { key: "60000000:0" } }).length, 1);
  assert.deepEqual(manifestMissingFields(draft, undefined, { freightMin: 500000, freightMax: 80000000, advanceMaxPercent: 85 }), []);
});

test("los topes inválidos vuelven a los valores por defecto", () => {
  assert.deepEqual(resolveMoneyLimits(undefined), DEFAULT_MONEY_LIMITS);
  assert.deepEqual(resolveMoneyLimits({ freightMax: 30000000 }), { ...DEFAULT_MONEY_LIMITS, freightMax: 30000000 });
  assert.deepEqual(resolveMoneyLimits({ freightMin: 9000000, freightMax: 1000000 }), DEFAULT_MONEY_LIMITS);
});

test("el monto se escribe en letras", () => {
  assert.equal(amountInWords("60000000"), "sesenta millones de pesos");
  assert.equal(amountInWords("6000000"), "seis millones de pesos");
  assert.equal(amountInWords("1000000"), "un millón de pesos");
  assert.equal(amountInWords("4760000"), "cuatro millones setecientos sesenta mil pesos");
  assert.equal(amountInWords("2187768"), "dos millones ciento ochenta y siete mil setecientos sesenta y ocho pesos");
  assert.equal(amountInWords("21031000"), "veintiún millones treinta y un mil pesos");
  assert.equal(amountInWords("100100"), "cien mil cien pesos");
  assert.equal(amountInWords("1000"), "mil pesos");
  assert.equal(amountInWords("1"), "un peso");
  assert.equal(amountInWords("0"), "cero pesos");
  assert.equal(amountInWords("1500000000"), "mil quinientos millones de pesos");
  assert.equal(amountInWords(""), "");
});

test("el servidor guarda quién confirmó y descarta confirmaciones de otros valores", () => {
  const review = manifestMoneyReview({ freightTotal: "60000000", advance: "0" });
  const create = (key: string) => ({ key, confirmedBy: "ana", confirmedAt: 2 });
  const previous = { key: "60000000:0", confirmedBy: "luis", confirmedAt: 1 };
  assert.deepEqual(resolveMoneyConfirmation(review, "60000000:0", undefined, create), { key: "60000000:0", confirmedBy: "ana", confirmedAt: 2 });
  assert.equal(resolveMoneyConfirmation(review, "60000000:0", previous, create), previous);
  assert.equal(resolveMoneyConfirmation(review, undefined, previous, create), undefined);
  assert.equal(resolveMoneyConfirmation(review, "6000000:0", undefined, create), undefined);
  assert.equal(resolveMoneyConfirmation(manifestMoneyReview({ freightTotal: "6000000", advance: "0" }), "6000000:0", previous, create), undefined);
});

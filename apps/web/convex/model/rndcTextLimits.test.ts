import assert from "node:assert/strict";
import { test } from "node:test";
import { consignmentBlockers, manifestBlockers, manifestTextBlockers } from "./emissionChecks";
import { RNDC_TEXT_LIMITS, fitRndcText, rndcTextBlocker, rndcTextExcess } from "./rndcTextLimits";

const mtmStandardText = `${"EL CONDUCTOR DEBE REPORTARSE EN CADA PUESTO DE CONTROL Y NO PUEDE TRANSITAR DE NOCHE. ".repeat(6)}FIN`;

test("the manifest observations stop at the 500 characters the RNDC accepts (MAN330)", () => {
  assert.equal(RNDC_TEXT_LIMITS.manifestObservations, 500);
  assert.equal(rndcTextBlocker("manifestObservations", "a".repeat(500)), null);
  assert.equal(rndcTextExcess("manifestObservations", "a".repeat(513)), 13);
  assert.match(rndcTextBlocker("manifestObservations", "a".repeat(513)) ?? "", /tiene 513 caracteres y el RNDC acepta máximo 500\. Recorta 13/);
  assert.equal(rndcTextBlocker("manifestObservations", undefined), null);
});

test("a long default text is cut at a word boundary within the limit", () => {
  assert.ok(mtmStandardText.length > 500);
  const fitted = fitRndcText("manifestObservations", mtmStandardText);
  assert.ok(fitted.length <= 500);
  assert.ok(mtmStandardText.startsWith(fitted));
  assert.equal(fitted.endsWith(" "), false);
  assert.equal(fitRndcText("manifestObservations", "corto"), "corto");
  assert.equal(fitRndcText("cargoShortDescription", "x".repeat(80)).length, 60);
});

test("a manifest draft with long observations is blocked before emitting", () => {
  const draft = { issueDate: "2026-11-14", estimatedDeliveryDate: "2026-11-15", operationScope: "intermunicipal" as const, manifestType: "G", freightTotal: "3000000", netPayable: "3000000", paymentResponsible: "EMPRESA" };
  assert.deepEqual(manifestTextBlockers({ ...draft, observations: "a".repeat(500) }), []);
  const blockers = manifestBlockers({ ...draft, observations: mtmStandardText }, 1, undefined, undefined);
  assert.equal(blockers.filter((blocker) => blocker.startsWith("Observaciones del manifiesto")).length, 1);
});

test("remesa texts that go to the RNDC follow the dictionary limits", () => {
  const order = { cargoDescription: "CEMENTO GRIS USO GENERAL EN SACOS DE 50 KILOGRAMOS PARA DISTRIBUCION NACIONAL", weightTons: "34" };
  const blockers = consignmentBlockers({ consignmentClass: "terrestre_carga", policyNumber: "1".repeat(21) }, order);
  assert.ok(blockers.some((blocker) => blocker.startsWith("Descripción de la mercancía") && blocker.includes("máximo 60")));
  assert.ok(blockers.some((blocker) => blocker.startsWith("Número de póliza") && blocker.includes("máximo 20")));
  const fine = consignmentBlockers({ consignmentClass: "terrestre_carga", policyNumber: "AB002905", remissions: [{ description: "CEMENTO GRIS" }] }, order);
  assert.equal(fine.some((blocker) => blocker.includes("máximo")), false);
  assert.match(rndcTextBlocker("fulfillmentObservations", "a".repeat(201)) ?? "", /máximo 200/);
  assert.match(rndcTextBlocker("annulmentObservations", "a".repeat(201)) ?? "", /máximo 200/);
});

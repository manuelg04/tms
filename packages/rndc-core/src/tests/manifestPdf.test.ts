import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildMtmReferenceScenario, generateManifestDocument, loadConfig, manifestAmountInWords, manifestIsPending, manifestQrText, manifestRadicationStamp, renderManifestPdf } from "../index.js";

const authorization = {
  loadingOrderAuthorization: "PENDIENTE",
  remesaAuthorization: "PENDIENTE",
  manifestAuthorization: "100000001",
  seguridadQr: "AAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  observacionesQr: "",
  acceptances: []
};

test("el QR del manifiesto sigue el formato del RNDC", () => {
  const scenario = buildMtmReferenceScenario(loadConfig());
  scenario.expeditionDate = "09/11/2026";
  scenario.vehicle.plate = "ABC123";
  scenario.vehicle.trailerPlate = "R00001";
  scenario.vehicle.configuration = "3S3";
  scenario.sender.cityName = "CAMPO DOS TIBU NORTE DE SANTANDER";
  scenario.recipient.cityName = "GIRON SANTANDER";
  scenario.cargo.productName = "TORTA DE PALMISTE";
  scenario.driver.id = "10000001";
  scenario.company.name = "M.T.M. S.A.S.";

  assert.equal(manifestQrText(scenario, authorization), [
    "MEC:100000001",
    "Fecha:2026/11/09",
    "Placa:ABC123",
    "Remolque:R00001",
    "Config:3S3",
    "Orig:CAMPO DOS TIBU NORTE",
    "Dest:GIRON SANTANDER",
    "Mercancia:TORTA DE PALMISTE",
    "Conductor:10000001",
    "Empresa:M.T.M. S.A.S.",
    "Seguro:AAAAAAAAAAAAAAAAAAAAAAAAAAA="
  ].join("\r\n"));
  assert.match(manifestQrText(scenario, { ...authorization, observacionesQr: "NOTA" }), /\r\nObs:NOTA\r\nSeguro:/);
});

test("valor en letras y fecha de radicación del manifiesto", () => {
  assert.equal(manifestAmountInWords(5780000), "CINCO MILLONES SETECIENTOS OCHENTA MIL PESOS");
  assert.equal(manifestRadicationStamp(new Date("2026-11-09T22:51:00Z")), "2026/11/09 05:51 pm");
});

test("el manifiesto se genera apaisado y crece con varias remesas", async () => {
  const directory = await mkdtemp(join(tmpdir(), "manifiesto-"));
  const scenario = buildMtmReferenceScenario(loadConfig());
  const single = await generateManifestDocument(scenario, authorization, directory, "dry-run");
  const singlePdf = (await readFile(single.path)).toString("latin1");
  assert.match(singlePdf, /\/MediaBox \[0 0 855 612\]/);

  scenario.manifestNumber = `${scenario.manifestNumber}9`;
  scenario.manifestRemesas = [{ number: "1" }, { number: "2" }, { number: "3" }, { number: "4" }];
  const multiple = await generateManifestDocument(scenario, authorization, directory, "dry-run");
  const height = Number(/\/MediaBox \[0 0 855 ([\d.]+)\]/.exec((await readFile(multiple.path)).toString("latin1"))?.[1]);
  assert.ok(height > 612);
});

test("el manifiesto sin autorización se marca pendiente y no lleva QR ni número simulado", async () => {
  const scenario = buildMtmReferenceScenario(loadConfig());
  const pending = { ...authorization, manifestAuthorization: "PENDIENTE", seguridadQr: "PENDIENTE" };
  assert.equal(manifestIsPending(pending), true);
  assert.equal(manifestIsPending(authorization), false);
  assert.equal(manifestIsPending(authorization, { pending: true }), true);
  const pdf = await renderManifestPdf(scenario, pending, "live");
  assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.match(pdf.toString("latin1"), /\/MediaBox \[0 0 855 612\]/);
  const authorized = await renderManifestPdf(scenario, authorization, "live");
  assert.ok(authorized.length > pdf.length);
});

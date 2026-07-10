import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../rndc/config.js";
import { runDemoFlow, runMtmProductionFlow } from "../rndc/flow.js";

test("dry-run flow creates evidence and PDFs without live credentials", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-"));
  const result = await runDemoFlow(loadConfig({
    mode: "dry-run",
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    username: "",
    password: "",
    companyNit: "900773684",
    companyDv: "9",
    companyRndcNit: "9007736849"
  }));

  assert.equal(result.ok, true);
  assert.equal(result.steps.length, 9);
  assert.equal(result.documents.length, 3);
  assert.equal(result.documents[0].kind, "loading-order");
  assert.equal(result.steps.at(-2)?.name, "remesa");
  assert.equal(result.steps.at(-1)?.name, "manifest");
  assert.match(result.remesaAuthorization ?? "", /^9\d{8}$/);
  assert.match(result.manifestAuthorization ?? "", /^9\d{8}$/);
  assert.ok(result.evidencePath);
  assert.ok(existsSync(result.evidencePath));
  const savedEvidence = JSON.parse(await readFile(result.evidencePath, "utf8"));
  assert.equal(savedEvidence.evidencePath, result.evidencePath);
  assert.equal(typeof savedEvidence.cargoNumber, "string");
  assert.equal(typeof savedEvidence.tripNumber, "string");
  assert.match(savedEvidence.cargoNumber, /^IC\d{6}$/);
  assert.match(savedEvidence.tripNumber, /^IV\d{6}$/);

  for (const document of result.documents) {
    assert.ok(existsSync(document.path));
    assert.ok(statSync(document.path).size > 1000);
  }

  for (const step of result.steps) {
    assert.ok(step.requestPath && existsSync(step.requestPath));
    assert.ok(step.responsePath && existsSync(step.responsePath));
    assert.equal(step.accepted, true);
    assert.equal(step.response.endpointUrl, "http://rndcpruebas.mintransporte.gov.co:8080/soap/IBPMServices");
  }
});

test("legacy scenario flows refuse live mode before creating evidence or contacting RNDC", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-live-flow-block-"));
  const config = loadConfig({
    mode: "live",
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    username: "LIVE_USER",
    password: "LIVE_PASSWORD",
    companyNit: "900773684",
    companyDv: "9",
    companyRndcNit: "9007736849"
  });

  await assert.rejects(runDemoFlow(config), /durable request context/i);
  await assert.rejects(runMtmProductionFlow(config), /durable request context/i);
  assert.equal(existsSync(join(base, "runs")), false);
});

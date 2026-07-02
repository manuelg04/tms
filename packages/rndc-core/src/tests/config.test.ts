import assert from "node:assert/strict";
import test from "node:test";
import { endpointTargetFor, endpointUrlFor, loadConfig, wstestUrlFor } from "../rndc/config.js";

test("routes test records to the RNDC 2026 test endpoint", () => {
  const config = loadConfig({ environment: "test" });
  const request = { tipo: 1, procesoId: 4 };

  assert.equal(endpointTargetFor(config, request), "test");
  assert.equal(endpointUrlFor(config, request), "http://rndcpruebas.mintransporte.gov.co:8080/soap/IBPMServices");
  assert.equal(wstestUrlFor(config, request), "https://rndc.mintransporte.gov.co/wstest/defaultpruebas.aspx");
});

test("routes production remesa and manifest records to the secondary RNDC endpoint", () => {
  const config = loadConfigWithoutGlobalWstest({ environment: "primary" });

  for (const procesoId of [3, 4]) {
    const request = { tipo: 1, procesoId };

    assert.equal(endpointTargetFor(config, request), "secondary");
    assert.equal(endpointUrlFor(config, request), "http://rndcws2.mintransporte.gov.co:8080/soap/IBPMServices");
    assert.equal(wstestUrlFor(config, request), "https://rndc.mintransporte.gov.co/wstest/default2.aspx");
  }
});

test("routes production master records to primary and consultations to plc", () => {
  const config = loadConfigWithoutGlobalWstest({ environment: "primary" });
  const masterRequest = { tipo: 1, procesoId: 11 };
  const queryRequest = { tipo: 3, procesoId: 4 };

  assert.equal(endpointTargetFor(config, masterRequest), "primary");
  assert.equal(endpointUrlFor(config, masterRequest), "http://rndcws.mintransporte.gov.co:8080/soap/IBPMServices");
  assert.equal(endpointTargetFor(config, queryRequest), "queries");
  assert.equal(endpointUrlFor(config, queryRequest), "http://plc.mintransporte.gov.co:8080/soap/IBPMServices");
});

test("live mode requires the company identity to be explicit", () => {
  const previousNit = process.env.RNDC_COMPANY_NIT;
  const previousDv = process.env.RNDC_COMPANY_DV;
  delete process.env.RNDC_COMPANY_NIT;
  delete process.env.RNDC_COMPANY_DV;

  try {
    assert.throws(() => loadConfig({ mode: "live" }), /RNDC_COMPANY_NIT/);
    assert.doesNotThrow(() => loadConfig({ mode: "live", companyNit: "900773684", companyDv: "9" }));
    assert.doesNotThrow(() => loadConfig({ mode: "dry-run" }));
  } finally {
    if (previousNit !== undefined) {
      process.env.RNDC_COMPANY_NIT = previousNit;
    }

    if (previousDv !== undefined) {
      process.env.RNDC_COMPANY_DV = previousDv;
    }
  }
});

function loadConfigWithoutGlobalWstest(overrides: Parameters<typeof loadConfig>[0]) {
  const previous = process.env.RNDC_WSTEST_URL;
  delete process.env.RNDC_WSTEST_URL;

  try {
    return loadConfig(overrides);
  } finally {
    if (previous === undefined) {
      delete process.env.RNDC_WSTEST_URL;
    } else {
      process.env.RNDC_WSTEST_URL = previous;
    }
  }
}

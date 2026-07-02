import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createRndcApp } from "../index.js";

process.env.CONVEX_URL = "";
process.env.RNDC_INGEST_KEY = "";

test("posts a remesa form through the RNDC backend in dry run mode", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-api-"));
  const app = createRndcApp({
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    mode: "dry-run"
  });
  const server = createServer(app);
  server.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.notEqual(typeof address, "string");
    const port = (address as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/rndc/forms/remesa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        remesaNumber: "42196",
        cargoNumber: "000044579",
        driver: { idType: "C", id: "80756632" },
        vehicle: { plate: "JVK276" }
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.operation, "remesa");
    assert.equal(body.mode, "dry-run");
    assert.deepEqual(body.steps.map((step: { name: string; procesoId: number }) => [step.name, step.procesoId]), [
      ["issue-remesa", 3]
    ]);
    assert.match(body.evidencePath, /result\.json$/);
    assert.equal(body.documents[0].kind, "remesa");
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("rejects incomplete live-mode forms before contacting RNDC", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-api-live-"));
  const app = createRndcApp({
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    mode: "live",
    username: "LIVE_USER",
    password: "LIVE_PASSWORD",
    companyNit: "900773684",
    companyDv: "9",
    companyRndcNit: "9007736849"
  });
  const server = createServer(app);
  server.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    const port = (address as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/rndc/forms/remesa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        remesaNumber: "42196",
        driver: { idType: "C", id: "80756632" },
        vehicle: { plate: "JVK276" }
      })
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.ok(Array.isArray(body.missingFields));
    assert.ok(body.missingFields.includes("cargoNumber"));
    assert.ok(body.missingFields.includes("sender.id"));
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("requires the API key on RNDC routes when configured", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-api-key-"));
  const app = createRndcApp({
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    mode: "dry-run"
  });
  const server = createServer(app);
  server.listen(0);
  await once(server, "listening");
  process.env.RNDC_API_KEY = "test-key";

  try {
    const address = server.address();
    const port = (address as AddressInfo).port;
    const denied = await fetch(`http://127.0.0.1:${port}/rndc/forms/reference`);
    const allowed = await fetch(`http://127.0.0.1:${port}/rndc/forms/reference`, {
      headers: { "X-Api-Key": "test-key" }
    });

    assert.equal(denied.status, 401);
    assert.equal(allowed.status, 200);
  } finally {
    delete process.env.RNDC_API_KEY;
    server.close();
    await once(server, "close");
  }
});

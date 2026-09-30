import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRndcApp } from "../index.js";

test("mirror reads SOAP while emission remains dry-run, preserves evidence, and rejects unauthorized scopes", async () => {
  const calls: string[] = [];
  let fail = false;
  let soapOpen = true;
  const soap = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += String(part);
    calls.push(body);
    await new Promise((resolve) => setTimeout(resolve, 50));
    res.setHeader("Content-Type", "text/xml");
    if (fail) {
      res.statusCode = 500;
      res.end("unavailable");
      return;
    }
    res.end(
      "<root><documento><INGRESOID>1001</INGRESOID><FECHAING>29/09/2026 11:00:00 a. m.</FECHAING><NUMMANIFIESTOCARGA>000044</NUMMANIFIESTOCARGA><NUMPLACA>TST001</NUMPLACA></documento></root>",
    );
  });
  await new Promise<void>((resolve) => soap.listen(0, "127.0.0.1", resolve));
  process.env.AUTH_MODE = "demo";
  process.env.RNDC_SERVICE_TOKEN =
    "mirror-test-service-token-more-than-32-chars";
  process.env.RNDC_MIRROR_ENABLED = "true";
  process.env.RNDC_MIRROR_ORGANIZATION_ID = "test-organization";
  const outputDir = await mkdtemp(join(tmpdir(), "tms-mirror-api-"));
  const app = createRndcApp(
    {
      mode: "dry-run",
      timeoutMs: 10,
      username: "mirror-user",
      password: "mirror-password",
      companyRndcNit: "9000000011",
      endpointUrlOverride: `http://127.0.0.1:${(soap.address() as AddressInfo).port}`,
      outputDir,
    },
    { logger: () => undefined },
  );
  const backend = await new Promise<ReturnType<typeof app.listen>>(
    (resolve) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    },
  );
  const url = `http://127.0.0.1:${(backend.address() as AddressInfo).port}/rndc/mirror?process=4&from=2026-09-01&to=2026-09-29`;
  const headers = {
    Authorization: `Bearer ${process.env.RNDC_SERVICE_TOKEN}`,
    "X-TMS-Expected-Mode": "dry-run",
    "X-TMS-Organization-Id": "test-organization",
  };
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal(
      (
        await fetch(url, {
          headers: { ...headers, "X-TMS-Organization-Id": "other" },
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(url.replace("process=4", "process=1"), { headers })).status,
      400,
    );
    const response = await fetch(url, { headers }),
      data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.records.length, 1);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /&lt;tipo&gt;3&lt;\/tipo&gt;/);
    assert.match(calls[0], /2026\/09\/30/);
    const evidence = await readFile(
      join(outputDir, "mirror", data.id, "request.xml"),
      "utf8",
    );
    assert.ok(!evidence.includes("mirror-password"));
    assert.ok(!JSON.stringify(data).includes("mirror-password"));
    fail = true;
    assert.equal((await fetch(url, { headers })).status, 502);
    const ready = await fetch(url.replace(/\/rndc\/mirror\?.*/, "/readyz"));
    assert.equal((await ready.json()).mode, "dry-run");
    await new Promise<void>((resolve) => soap.close(() => resolve()));
    soapOpen = false;
    const disconnected = await fetch(url, { headers });
    const failure = await disconnected.json();
    assert.equal(disconnected.status, 502);
    assert.match(failure.error, /Could not reach RNDC endpoint/);
    assert.ok(!JSON.stringify(failure).includes("mirror-password"));
  } finally {
    await new Promise<void>((resolve) => backend.close(() => resolve()));
    if (soapOpen)
      await new Promise<void>((resolve) => soap.close(() => resolve()));
  }
});

test("standalone startup routes mirror reads to the query endpoint while retaining dry-run", async () => {
  const paths: string[] = [];
  const soap = createServer((req, res) => {
    paths.push(req.url ?? "");
    res.end(
      "<root><documento><INGRESOID>1002</INGRESOID><FECHAING>29/09/2026 11:00</FECHAING><NUMMANIFIESTOCARGA>45</NUMMANIFIESTOCARGA></documento></root>",
    );
  });
  await new Promise<void>((resolve) => soap.listen(0, "127.0.0.1", resolve));
  const reservation = createServer();
  await new Promise<void>((resolve) =>
    reservation.listen(0, "127.0.0.1", resolve),
  );
  const port = (reservation.address() as AddressInfo).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const base = `http://127.0.0.1:${(soap.address() as AddressInfo).port}`;
  const token = "standalone-mirror-service-token-more-than-32-chars";
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    AUTH_MODE: "demo",
    RNDC_MODE: "dry-run",
    RNDC_ENV: "test",
    RNDC_USERNAME: "startup-mirror-user",
    RNDC_PASSWORD: "startup-mirror-password",
    RNDC_SERVICE_TOKEN: token,
    RNDC_MIRROR_ENABLED: "true",
    RNDC_MIRROR_ORGANIZATION_ID: "startup-organization",
    RNDC_TEST_ENDPOINT_URL: `${base}/test`,
    RNDC_QUERIES_ENDPOINT_URL: `${base}/queries`,
    RNDC_OUTPUT_DIR: await mkdtemp(join(tmpdir(), "tms-mirror-startup-")),
  };
  delete childEnv.RNDC_ENDPOINT_URL;
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../index.js", import.meta.url))],
    {
      env: childEnv,
      stdio: "ignore",
    },
  );
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    let available = false;
    for (let i = 0; i < 100 && !available; i++) {
      available = await fetch(`http://127.0.0.1:${port}/healthz`)
        .then((r) => r.ok)
        .catch(() => false);
      if (!available) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(available, "El servidor independiente debe iniciar");
    const response = await fetch(
      `http://127.0.0.1:${port}/rndc/mirror?process=4&from=2026-09-29&to=2026-09-29`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-TMS-Expected-Mode": "dry-run",
          "X-TMS-Organization-Id": "startup-organization",
        },
      },
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).records.length, 1);
    assert.deepEqual(paths, ["/queries"]);
  } finally {
    child.kill("SIGTERM");
    await exited;
    await new Promise<void>((resolve) => soap.close(() => resolve()));
  }
});

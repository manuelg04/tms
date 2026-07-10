import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { ServerResponse } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duplex, Readable } from "node:stream";
import test from "node:test";
import { createRndcApp } from "../index.js";

process.env.CONVEX_URL = "";
process.env.RNDC_INGEST_KEY = "";
process.env.AUTH_MODE = "service";
process.env.RNDC_SERVICE_TOKEN = "test-service-token-with-more-than-32-characters";

class MockSocket extends Duplex {
  readonly chunks: Buffer[] = [];

  _read(): void {}

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }
}

type MockIncomingMessage = IncomingMessage & {
  headers: IncomingHttpHeaders;
  socket: Socket;
  connection: Socket;
  httpVersion: string;
  httpVersionMajor: number;
  httpVersionMinor: number;
};

type JsonResponse = {
  status: number;
  body: Record<string, unknown>;
};

async function requestJson(app: ReturnType<typeof createRndcApp>, path: string, options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<JsonResponse> {
  const mockSocket = new MockSocket();
  const socket = mockSocket as unknown as Socket;
  const body = options.body === undefined ? "" : JSON.stringify(options.body);
  const headers = Object.fromEntries(Object.entries({
    Authorization: `Bearer ${process.env.RNDC_SERVICE_TOKEN}`,
    ...options.headers
  }).map(([key, value]) => [key.toLowerCase(), value]));
  const req = Readable.from(body ? [Buffer.from(body)] : []) as MockIncomingMessage;
  Object.assign(req, {
    method: options.method ?? "GET",
    url: path,
    headers: {
      ...headers,
      ...(body ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) } : {})
    },
    socket,
    connection: socket,
    httpVersion: "1.1",
    httpVersionMajor: 1,
    httpVersionMinor: 1
  });

  const res = new ServerResponse(req);
  res.assignSocket(socket);
  const finished = new Promise<void>((resolve) => {
    res.on("finish", resolve);
  });
  (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
  await finished;

  const raw = Buffer.concat(mockSocket.chunks).toString("utf8");
  const responseBody = raw.split("\r\n\r\n").slice(1).join("\r\n\r\n");
  return { status: res.statusCode, body: JSON.parse(responseBody) as Record<string, unknown> };
}

test("posts a remesa form through the RNDC backend in dry run mode", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-api-"));
  const app = createRndcApp({
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    mode: "dry-run"
  });
  const response = await requestJson(app, "/rndc/forms/remesa", {
    method: "POST",
    body: {
      remesaNumber: "42196",
      cargoNumber: "000044579",
      driver: { idType: "C", id: "80756632" },
      vehicle: { plate: "JVK276" }
    }
  });
  const body = response.body;

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.operation, "remesa");
  assert.equal(body.mode, "dry-run");
  assert.deepEqual((body.steps as { name: string; procesoId: number }[]).map((step) => [step.name, step.procesoId]), [
    ["issue-remesa", 3]
  ]);
  assert.match(body.evidencePath as string, /result\.json$/);
  assert.equal((body.documents as { kind: string }[])[0].kind, "remesa");
});

test("builds a manifest form with every saved remesa", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-api-multi-remesa-"));
  const app = createRndcApp({
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    mode: "dry-run"
  });
  const response = await requestJson(app, "/rndc/forms/manifest", {
    method: "POST",
    body: {
      manifestNumber: "0041464",
      remesaNumber: "42196",
      manifestRemesas: [
        { number: "42196", quantityKg: 17000, productName: "Carga A" },
        { number: "42197", quantityKg: 17000, productName: "Carga B" }
      ]
    }
  });
  const steps = response.body.steps as { procesoId: number; requestPath: string }[];
  const manifestStep = steps.find((step) => step.procesoId === 4);

  assert.ok(manifestStep);
  const xml = await readFile(manifestStep.requestPath, "utf8");

  assert.equal(response.status, 200);
  assert.match(xml, /<CONSECUTIVOREMESA>42196<\/CONSECUTIVOREMESA>/);
  assert.match(xml, /<CONSECUTIVOREMESA>42197<\/CONSECUTIVOREMESA>/);
});

test("keeps the selected remesa number when a broader manifest remesa list is present", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-api-selected-remesa-"));
  const app = createRndcApp({
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    mode: "dry-run"
  });
  const response = await requestJson(app, "/rndc/forms/remesa", {
    method: "POST",
    body: {
      remesaNumber: "42197",
      cargoNumber: "000044579",
      manifestRemesas: [{ number: "42196" }, { number: "42197" }]
    }
  });
  const step = (response.body.steps as { requestPath: string }[])[0];
  const xml = await readFile(step.requestPath, "utf8");

  assert.equal(response.status, 200);
  assert.match(xml, /<CONSECUTIVOREMESA>42197<\/CONSECUTIVOREMESA>/);
  assert.doesNotMatch(xml, /<CONSECUTIVOREMESA>42196<\/CONSECUTIVOREMESA>/);
});

test("validates durable evidence references before sending and stores the completed form evidence", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-api-durable-evidence-"));
  process.env.CONVEX_URL = "https://convex.example";
  process.env.RNDC_INGEST_KEY = "test-ingest-key";
  const stored: Array<{ context: Record<string, string | undefined>; evidencePath: unknown }> = [];
  const app = createRndcApp({
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    mode: "dry-run"
  }, {
    evidenceStore: async (result, context) => {
      stored.push({
        context,
        evidencePath: (result as Record<string, unknown>).evidencePath
      });
      return {
        stored: true,
        artifacts: [{
          artifactId: "artifact-1",
          kind: "other",
          fileName: "result.json",
          sha256: "hash",
          size: 10,
          existing: false
        }]
      };
    }
  });

  try {
    const invalid = await requestJson(app, "/rndc/forms/remesa", {
      method: "POST",
      headers: { "X-TMS-Durable-Operation": "true" },
      body: { remesaNumber: "42196" }
    });
    const valid = await requestJson(app, "/rndc/forms/remesa", {
      method: "POST",
      headers: {
        "X-TMS-Durable-Operation": "true",
        "X-TMS-Organization-Id": "org-1",
        "X-TMS-Expediente-Id": "exp-1",
        "X-TMS-Document-Id": "doc-1",
        "X-TMS-Operation-Id": "op-1"
      },
      body: { remesaNumber: "42196" }
    });

    assert.equal(invalid.status, 400);
    assert.equal(stored.length, 1);
    assert.deepEqual(stored[0].context, {
      organizationId: "org-1",
      expedienteId: "exp-1",
      documentId: "doc-1",
      operationId: "op-1"
    });
    assert.match(stored[0].evidencePath as string, /result\.json$/);
    assert.deepEqual(valid.body.durableEvidence, {
      stored: true,
      artifacts: [{
        artifactId: "artifact-1",
        kind: "other",
        fileName: "result.json",
        sha256: "hash",
        size: 10,
        existing: false
      }]
    });
  } finally {
    process.env.CONVEX_URL = "";
    process.env.RNDC_INGEST_KEY = "";
  }
});

test("posts fulfill remesa and fulfill manifest forms in dry run mode", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-api-fulfill-"));
  const app = createRndcApp({
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    mode: "dry-run"
  });
  const remesa = await requestJson(app, "/rndc/forms/fulfill-remesa", {
    method: "POST",
    body: {
      remesaNumber: "42196",
      manifestNumber: "0041464",
      compliance: {
        remesaType: "C",
        loadedQuantityKg: 34000,
        deliveredQuantityKg: 33900,
        unloadingArrivalDate: "25/06/2026",
        unloadingArrivalTime: "12:06",
        unloadingEntryDate: "25/06/2026",
        unloadingEntryTime: "12:36",
        unloadingExitDate: "25/06/2026",
        unloadingExitTime: "14:06"
      }
    }
  });
  const remesaBody = remesa.body;
  const manifest = await requestJson(app, "/rndc/forms/fulfill-manifest", {
    method: "POST",
    body: {
      manifestNumber: "0041464",
      compliance: {
        manifestType: "C",
        documentsDeliveryDate: "30/06/2026"
      }
    }
  });
  const manifestBody = manifest.body;

  assert.equal(remesa.status, 200);
  assert.equal(remesaBody.ok, true);
  assert.equal(remesaBody.operation, "fulfill-remesa");
  assert.equal(remesaBody.mode, "dry-run");
  assert.deepEqual((remesaBody.steps as { name: string; procesoId: number }[]).map((step) => [step.name, step.procesoId]), [
    ["fulfill-remesa", 5]
  ]);
  assert.deepEqual(remesaBody.documents, []);

  assert.equal(manifest.status, 200);
  assert.equal(manifestBody.ok, true);
  assert.equal(manifestBody.operation, "fulfill-manifest");
  assert.equal(manifestBody.mode, "dry-run");
  assert.deepEqual((manifestBody.steps as { name: string; procesoId: number }[]).map((step) => [step.name, step.procesoId]), [
    ["fulfill-manifest", 6]
  ]);
  assert.deepEqual(manifestBody.documents, []);
});

test("rejects incomplete live-mode forms before contacting RNDC", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-api-live-"));
  process.env.CONVEX_URL = "https://example.invalid";
  process.env.RNDC_INGEST_KEY = "test-ingest-key";
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
  const response = await requestJson(app, "/rndc/forms/remesa", {
    method: "POST",
    body: {
      remesaNumber: "42196",
      driver: { idType: "C", id: "80756632" },
      vehicle: { plate: "JVK276" }
    }
  });
  const body = response.body;

  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.ok(Array.isArray(body.missingFields));
  assert.ok(body.missingFields.includes("cargoNumber"));
  assert.ok(body.missingFields.includes("sender.id"));
  process.env.CONVEX_URL = "";
  process.env.RNDC_INGEST_KEY = "";
});

test("rejects suspended fulfill forms without required suspension reasons in live mode", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-api-live-fulfill-"));
  process.env.CONVEX_URL = "https://example.invalid";
  process.env.RNDC_INGEST_KEY = "test-ingest-key";
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
  const remesa = await requestJson(app, "/rndc/forms/fulfill-remesa", {
    method: "POST",
    body: {
      remesaNumber: "42196",
      manifestNumber: "0041464",
      compliance: {
        remesaType: "S",
        loadedQuantityKg: 34000
      }
    }
  });
  const remesaBody = remesa.body;
  const manifest = await requestJson(app, "/rndc/forms/fulfill-manifest", {
    method: "POST",
    body: {
      manifestNumber: "0041464",
      compliance: {
        manifestType: "S",
        documentsDeliveryDate: "30/06/2026"
      }
    }
  });
  const manifestBody = manifest.body;

  assert.equal(remesa.status, 400);
  assert.equal(remesaBody.ok, false);
  assert.ok(Array.isArray(remesaBody.missingFields));
  assert.ok(remesaBody.missingFields.includes("compliance.remesaSuspensionReason"));
  assert.equal(manifest.status, 400);
  assert.equal(manifestBody.ok, false);
  assert.ok(Array.isArray(manifestBody.missingFields));
  assert.ok(manifestBody.missingFields.includes("compliance.manifestSuspensionReason"));
  assert.ok(manifestBody.missingFields.includes("compliance.suspensionConsequence"));
  process.env.CONVEX_URL = "";
  process.env.RNDC_INGEST_KEY = "";
});

test("supports the legacy API key only with an explicit dry-run flag", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-api-key-"));
  process.env.RNDC_API_KEY = "test-key";
  process.env.RNDC_ENABLE_LEGACY_API_KEY = "true";
  const app = createRndcApp({
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    mode: "dry-run"
  });

  try {
    const denied = await requestJson(app, "/rndc/forms/reference", {
      headers: { Authorization: "" }
    });
    const allowed = await requestJson(app, "/rndc/forms/reference", {
      headers: { Authorization: "", "X-Api-Key": "test-key" }
    });

    assert.equal(denied.status, 401);
    assert.equal(allowed.status, 200);
  } finally {
    delete process.env.RNDC_API_KEY;
    delete process.env.RNDC_ENABLE_LEGACY_API_KEY;
  }
});

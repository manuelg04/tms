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

test("rejects a gateway mode mismatch before running an RNDC form", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-api-mode-mismatch-"));
  const app = createRndcApp({
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    mode: "dry-run"
  });
  const response = await requestJson(app, "/rndc/forms/remesa", {
    method: "POST",
    headers: { "X-TMS-Expected-Mode": "live" },
    body: { remesaNumber: "42196" }
  });

  assert.equal(response.status, 409);
  assert.equal((response.body.error as Record<string, unknown>).code, "RNDC_MODE_MISMATCH");
});

test("requires an expected mode on every durable RNDC request", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-api-mode-required-"));
  const app = createRndcApp({
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    mode: "dry-run"
  });
  const response = await requestJson(app, "/rndc/forms/remesa", {
    method: "POST",
    headers: {
      "X-TMS-Durable-Operation": "true",
      "X-TMS-Organization-Id": "org-1",
      "X-TMS-Expediente-Id": "exp-1",
      "X-TMS-Operation-Id": "op-1"
    },
    body: { remesaNumber: "42196" }
  });

  assert.equal(response.status, 400);
  assert.equal((response.body.error as Record<string, unknown>).code, "RNDC_EXPECTED_MODE_REQUIRED");
});

test("rejects live RNDC writes that do not have a durable operation", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-api-live-durable-required-"));
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
    headers: { "X-TMS-Expected-Mode": "live" },
    body: { remesaNumber: "42196" }
  });

  assert.equal(response.status, 403);
  assert.equal((response.body.error as Record<string, unknown>).code, "DURABLE_OPERATION_REQUIRED");
  process.env.CONVEX_URL = "";
  process.env.RNDC_INGEST_KEY = "";
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

test("rejects incomplete persisted expediente forms in dry run instead of using reference data", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-api-persisted-payload-"));
  process.env.CONVEX_URL = "https://convex.example";
  process.env.RNDC_INGEST_KEY = "test-ingest-key";
  let evidenceCalls = 0;
  const app = createRndcApp({
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    mode: "dry-run"
  }, {
    durableContextValidator: async () => true,
    evidenceStore: async () => {
      evidenceCalls += 1;
      return { stored: true, artifacts: [] };
    }
  });

  try {
    const response = await requestJson(app, "/rndc/forms/remesa", {
      method: "POST",
      headers: {
        "X-TMS-Durable-Operation": "true",
        "X-TMS-Expected-Mode": "dry-run",
        "X-TMS-Organization-Id": "org-1",
        "X-TMS-Expediente-Id": "exp-1",
        "X-TMS-Document-Id": "doc-1",
        "X-TMS-Operation-Id": "op-1",
        "X-TMS-Operation-Type": "emit_remesa",
        "X-TMS-Lease-Owner": "worker-1",
        "X-Correlation-Id": "op-1"
      },
      body: { remesaNumber: "42196" }
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.ok, false);
    assert.ok(Array.isArray(response.body.missingFields));
    assert.ok(response.body.missingFields.includes("cargoNumber"));
    assert.ok(response.body.missingFields.includes("sender.id"));
    assert.equal(evidenceCalls, 0);
  } finally {
    process.env.CONVEX_URL = "";
    process.env.RNDC_INGEST_KEY = "";
  }
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
    durableContextValidator: async () => true,
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
        "X-TMS-Expected-Mode": "dry-run",
        "X-TMS-Organization-Id": "org-1",
        "X-TMS-Expediente-Id": "exp-1",
        "X-TMS-Document-Id": "doc-1",
        "X-TMS-Operation-Id": "op-1",
        "X-TMS-Operation-Type": "emit_remesa",
        "X-TMS-Lease-Owner": "worker-1",
        "X-Correlation-Id": "op-1"
      },
      body: {
        remesaNumber: "42196",
        cargoNumber: "000044579",
        loadingAppointmentDate: "10/07/2026",
        loadingAppointmentTime: "08:00",
        unloadingAppointmentDate: "11/07/2026",
        unloadingAppointmentTime: "16:00",
        sender: { idType: "N", id: "900123456", siteCode: "001" },
        recipient: { idType: "N", id: "900654321", siteCode: "001" },
        cargo: {
          shortDescription: "CARGA GENERAL",
          merchandiseCode: "009988",
          packageCode: "1",
          natureCode: "1",
          quantityKg: 34000
        },
        cargoPolicy: {
          number: "POL-VALID-1",
          expirationDate: "31/12/2026",
          insurerNit: "860002400"
        }
      }
    });

    assert.equal(invalid.status, 400);
    assert.equal(stored.length, 1);
    assert.deepEqual(stored[0].context, {
      organizationId: "org-1",
      expedienteId: "exp-1",
      documentId: "doc-1",
      operationId: "op-1",
      expectedMode: "dry-run",
      operationType: "emit_remesa",
      leaseOwner: "worker-1"
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

test("durable forms never inherit omitted values from the MTM reference scenario", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-api-no-reference-fallback-"));
  process.env.CONVEX_URL = "https://convex.example";
  process.env.RNDC_INGEST_KEY = "test-ingest-key";
  const app = createRndcApp({
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    mode: "dry-run"
  }, {
    durableContextValidator: async () => true,
    evidenceStore: async () => ({ stored: true, artifacts: [] })
  });

  try {
    const response = await requestJson(app, "/rndc/forms/manifest", {
      method: "POST",
      headers: durableHeaders("dry-run", "op-no-reference-fallback", "emit_manifest"),
      body: {
        manifestNumber: "0099001",
        tripNumber: "VIAJE-9001",
        remesaNumber: "REM-9001",
        cargoNumber: "CARGO-9001",
        expeditionDate: "10/07/2026",
        balancePaymentDate: "15/07/2026",
        driver: { idType: "C", id: "1000000001" },
        vehicle: { plate: "ABC123" },
        vehicleHolder: { idType: "C", id: "1000000002" },
        sender: { cityCode: "68001000" },
        recipient: { cityCode: "11001000" },
        money: { freightValue: 1250000, advanceValue: 250000, icaRetentionPerMille: 0 }
      }
    });
    const steps = response.body.steps as { requestPath: string }[];
    const xml = (await Promise.all(steps.map((step) => readFile(step.requestPath, "utf8")))).join("\n");

    assert.equal(response.status, 200);
    assert.doesNotMatch(xml, /R41537/);
    assert.doesNotMatch(xml, /CARGAMENTO ENTREGADO EN BUEN ESTADO Y COMPLETO/);
    assert.doesNotMatch(xml, /<RETENCIONICAMANIFIESTOCARGA>3<\/RETENCIONICAMANIFIESTOCARGA>/);
    assert.doesNotMatch(xml, /<RETENCIONFOPAT>4760<\/RETENCIONFOPAT>/);
  } finally {
    process.env.CONVEX_URL = "";
    process.env.RNDC_INGEST_KEY = "";
  }
});

test("rejects non-finite required numeric strings before building durable RNDC XML", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-api-invalid-numeric-"));
  process.env.CONVEX_URL = "https://convex.example";
  process.env.RNDC_INGEST_KEY = "test-ingest-key";
  const app = createRndcApp({
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    mode: "dry-run"
  }, { durableContextValidator: async () => true });

  try {
    const response = await requestJson(app, "/rndc/forms/remesa", {
      method: "POST",
      headers: durableHeaders("dry-run", "op-invalid-numeric", "emit_remesa"),
      body: {
        remesaNumber: "42196",
        cargoNumber: "000044579",
        loadingAppointmentDate: "10/07/2026",
        loadingAppointmentTime: "08:00",
        unloadingAppointmentDate: "11/07/2026",
        unloadingAppointmentTime: "16:00",
        sender: { idType: "N", id: "900123456", siteCode: "001" },
        recipient: { idType: "N", id: "900654321", siteCode: "001" },
        cargo: {
          shortDescription: "CARGA GENERAL",
          merchandiseCode: "009988",
          packageCode: "1",
          natureCode: "1",
          quantityKg: "Infinity"
        },
        cargoPolicy: {
          number: "POL-VALID-1",
          expirationDate: "31/12/2026",
          insurerNit: "860002400"
        }
      }
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.ok, false);
    assert.ok((response.body.missingFields as string[]).includes("cargo.quantityKg"));
  } finally {
    process.env.CONVEX_URL = "";
    process.env.RNDC_INGEST_KEY = "";
  }
});

test("blocks live document writes even when a durable context already exists", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-api-form-transport-"));
  process.env.CONVEX_URL = "https://example.invalid";
  process.env.RNDC_INGEST_KEY = "test-ingest-key";
  const app = createRndcApp({
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    mode: "live",
    transport: "soap",
    environment: "test",
    endpointUrlOverride: "http://127.0.0.1:1/rndc",
    timeoutMs: 100,
    username: "LIVE_USER",
    password: "LIVE_PASSWORD",
    companyNit: "900773684",
    companyDv: "9",
    companyRndcNit: "9007736849"
  }, { durableContextValidator: async () => true });

  try {
    const response = await requestJson(app, "/rndc/forms/remesa", {
      method: "POST",
      headers: durableHeaders("live", "op-form-transport", "emit_remesa"),
      body: {
        remesaNumber: "42196",
        cargoNumber: "000044579",
        loadingAppointmentDate: "10/07/2026",
        loadingAppointmentTime: "08:00",
        unloadingAppointmentDate: "11/07/2026",
        unloadingAppointmentTime: "16:00",
        sender: { idType: "N", id: "900123456", siteCode: "001" },
        recipient: { idType: "N", id: "900654321", siteCode: "001" },
        cargo: {
          shortDescription: "CARGA GENERAL",
          merchandiseCode: "009988",
          packageCode: "1",
          natureCode: "1",
          quantityKg: 34000
        },
        cargoPolicy: {
          number: "POL-VALID-1",
          expirationDate: "31/12/2026",
          insurerNit: "860002400"
        }
      }
    });
    assert.equal(response.status, 403);
    assert.equal((response.body.error as Record<string, unknown>).code, "LIVE_WRITES_DISABLED");
  } finally {
    process.env.CONVEX_URL = "";
    process.env.RNDC_INGEST_KEY = "";
  }
});

test("durable remesas use the persisted cargo policy instead of deriving one from a scenario seed", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-api-cargo-policy-"));
  process.env.CONVEX_URL = "https://convex.example";
  process.env.RNDC_INGEST_KEY = "test-ingest-key";
  const app = createRndcApp({
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    mode: "dry-run"
  }, {
    durableContextValidator: async () => true,
    evidenceStore: async () => ({ stored: true, artifacts: [] })
  });

  try {
    const response = await requestJson(app, "/rndc/forms/remesa", {
      method: "POST",
      headers: durableHeaders("dry-run", "op-cargo-policy", "emit_remesa"),
      body: {
        seed: "SHOULD-NOT-BECOME-A-POLICY",
        remesaNumber: "REM-9001",
        cargoNumber: "CARGO-9001",
        loadingAppointmentDate: "10/07/2026",
        loadingAppointmentTime: "08:00",
        unloadingAppointmentDate: "11/07/2026",
        unloadingAppointmentTime: "16:00",
        sender: { idType: "N", id: "900123456", siteCode: "001" },
        recipient: { idType: "N", id: "900654321", siteCode: "001" },
        cargo: {
          shortDescription: "CARGA GENERAL",
          merchandiseCode: "009988",
          packageCode: "1",
          natureCode: "1",
          quantityKg: 34000
        },
        vehicle: {
          soatExpirationDate: "30/11/2026",
          insurerNit: "800100200"
        },
        cargoPolicy: {
          number: "POL-9001",
          expirationDate: "31/12/2026",
          insurerNit: "860002400"
        }
      }
    });
    const step = (response.body.steps as { requestPath: string }[])[0];
    const xml = await readFile(step.requestPath, "utf8");

    assert.equal(response.status, 200);
    assert.match(xml, /<NUMPOLIZATRANSPORTE>POL-9001<\/NUMPOLIZATRANSPORTE>/);
    assert.doesNotMatch(xml, /159/);
  } finally {
    process.env.CONVEX_URL = "";
    process.env.RNDC_INGEST_KEY = "";
  }
});

test("rejects an untrusted durable operation context before building or sending RNDC data", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-api-durable-context-"));
  process.env.CONVEX_URL = "https://convex.example";
  process.env.RNDC_INGEST_KEY = "test-ingest-key";
  let evidenceCalls = 0;
  const app = createRndcApp({
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    mode: "dry-run"
  }, {
    durableContextValidator: async () => false,
    evidenceStore: async () => {
      evidenceCalls += 1;
      return { stored: true, artifacts: [] };
    }
  });

  try {
    const response = await requestJson(app, "/rndc/forms/remesa", {
      method: "POST",
      headers: {
        "X-TMS-Durable-Operation": "true",
        "X-TMS-Expected-Mode": "dry-run",
        "X-TMS-Organization-Id": "org-1",
        "X-TMS-Expediente-Id": "exp-1",
        "X-TMS-Document-Id": "doc-1",
        "X-TMS-Operation-Id": "op-1",
        "X-TMS-Operation-Type": "emit_remesa",
        "X-TMS-Lease-Owner": "worker-1",
        "X-Correlation-Id": "op-1"
      },
      body: { remesaNumber: "42196" }
    });

    assert.equal(response.status, 409);
    assert.equal((response.body.error as Record<string, unknown>).code, "INVALID_DURABLE_OPERATION_CONTEXT");
    assert.equal(evidenceCalls, 0);
  } finally {
    process.env.CONVEX_URL = "";
    process.env.RNDC_INGEST_KEY = "";
  }
});

test("rejects a durable operation when its persisted action does not match the RNDC route", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-api-durable-route-"));
  process.env.CONVEX_URL = "https://convex.example";
  process.env.RNDC_INGEST_KEY = "test-ingest-key";
  const app = createRndcApp({
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    mode: "dry-run"
  }, {
    durableContextValidator: async () => true,
    evidenceStore: async () => ({ stored: true, artifacts: [] })
  });

  try {
    const response = await requestJson(app, "/rndc/forms/remesa", {
      method: "POST",
      headers: {
        "X-TMS-Durable-Operation": "true",
        "X-TMS-Expected-Mode": "dry-run",
        "X-TMS-Organization-Id": "org-1",
        "X-TMS-Expediente-Id": "exp-1",
        "X-TMS-Document-Id": "doc-1",
        "X-TMS-Operation-Id": "op-1",
        "X-TMS-Operation-Type": "emit_manifest",
        "X-TMS-Lease-Owner": "worker-1",
        "X-Correlation-Id": "op-1"
      },
      body: { remesaNumber: "42196" }
    });

    assert.equal(response.status, 409);
    assert.equal((response.body.error as Record<string, unknown>).code, "DURABLE_OPERATION_ROUTE_MISMATCH");
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

test("blocks incomplete live-mode forms before validation or RNDC contact", async () => {
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
  }, { durableContextValidator: async () => true });
  const response = await requestJson(app, "/rndc/forms/remesa", {
    method: "POST",
    headers: durableHeaders("live", "op-live-incomplete", "emit_remesa"),
    body: {
      remesaNumber: "42196",
      driver: { idType: "C", id: "80756632" },
      vehicle: { plate: "JVK276" }
    }
  });
  const body = response.body;

  assert.equal(response.status, 403);
  assert.equal((body.error as Record<string, unknown>).code, "LIVE_WRITES_DISABLED");
  process.env.CONVEX_URL = "";
  process.env.RNDC_INGEST_KEY = "";
});

test("blocks suspended live fulfill forms before validation or RNDC contact", async () => {
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
  }, { durableContextValidator: async () => true });
  const remesa = await requestJson(app, "/rndc/forms/fulfill-remesa", {
    method: "POST",
    headers: durableHeaders("live", "op-live-fulfill-remesa", "fulfill_remesa"),
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
    headers: durableHeaders("live", "op-live-fulfill-manifest", "fulfill_manifest"),
    body: {
      manifestNumber: "0041464",
      compliance: {
        manifestType: "S",
        documentsDeliveryDate: "30/06/2026"
      }
    }
  });
  const manifestBody = manifest.body;

  assert.equal(remesa.status, 403);
  assert.equal((remesaBody.error as Record<string, unknown>).code, "LIVE_WRITES_DISABLED");
  assert.equal(manifest.status, 403);
  assert.equal((manifestBody.error as Record<string, unknown>).code, "LIVE_WRITES_DISABLED");
  process.env.CONVEX_URL = "";
  process.env.RNDC_INGEST_KEY = "";
});

test("rejects unsupported fulfillment types before building durable RNDC XML", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-api-invalid-fulfillment-type-"));
  process.env.CONVEX_URL = "https://convex.example";
  process.env.RNDC_INGEST_KEY = "test-ingest-key";
  const app = createRndcApp({
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    mode: "dry-run"
  }, { durableContextValidator: async () => true });

  try {
    const remesa = await requestJson(app, "/rndc/forms/fulfill-remesa", {
      method: "POST",
      headers: durableHeaders("dry-run", "op-invalid-remesa-type", "fulfill_remesa"),
      body: {
        remesaNumber: "42196",
        manifestNumber: "0041464",
        compliance: { remesaType: "X", loadedQuantityKg: 34000 }
      }
    });
    const manifest = await requestJson(app, "/rndc/forms/fulfill-manifest", {
      method: "POST",
      headers: durableHeaders("dry-run", "op-invalid-manifest-type", "fulfill_manifest"),
      body: {
        manifestNumber: "0041464",
        compliance: { manifestType: "X", documentsDeliveryDate: "30/06/2026" }
      }
    });

    assert.equal(remesa.status, 400);
    assert.ok((remesa.body.missingFields as string[]).includes("compliance.remesaType"));
    assert.equal(manifest.status, 400);
    assert.ok((manifest.body.missingFields as string[]).includes("compliance.manifestType"));
  } finally {
    process.env.CONVEX_URL = "";
    process.env.RNDC_INGEST_KEY = "";
  }
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

function durableHeaders(mode: "dry-run" | "live", operationId: string, operationType: string): Record<string, string> {
  return {
    "X-TMS-Durable-Operation": "true",
    "X-TMS-Expected-Mode": mode,
    "X-TMS-Organization-Id": "org-1",
    "X-TMS-Expediente-Id": "exp-1",
    "X-TMS-Document-Id": "doc-1",
    "X-TMS-Operation-Id": operationId,
    "X-TMS-Operation-Type": operationType,
    "X-TMS-Lease-Owner": `worker-${operationId}`,
    "X-Correlation-Id": operationId
  };
}

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { ServerResponse } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duplex, Readable } from "node:stream";
import test from "node:test";
import { buildMtmReferenceScenario, loadConfig } from "@tms/rndc-core";
import type { RndcConfig } from "@tms/rndc-core";
import { createRndcApp } from "../index.js";

const serviceToken = "phase-one-service-token-with-more-than-32-characters";

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

type TestResponse = {
  status: number;
  body: unknown;
  text: string;
};

type RequestOptions = {
  headers?: Record<string, string>;
  body?: unknown;
};

async function request(app: ReturnType<typeof createRndcApp>, path: string, options: RequestOptions = {}): Promise<TestResponse> {
  const mockSocket = new MockSocket();
  const socket = mockSocket as unknown as Socket;
  const serializedBody = options.body === undefined ? "" : JSON.stringify(options.body);
  const headers = Object.fromEntries(Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  const req = Readable.from(serializedBody ? [Buffer.from(serializedBody)] : []) as MockIncomingMessage;
  Object.assign(req, {
    method: "POST",
    url: path,
    headers: {
      ...headers,
      ...(serializedBody ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(serializedBody)) } : {})
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
  (app as unknown as (incoming: IncomingMessage, outgoing: ServerResponse) => void)(req, res);
  await finished;

  const raw = Buffer.concat(mockSocket.chunks).toString("utf8");
  const text = raw.split("\r\n\r\n").slice(1).join("\r\n\r\n");
  let body: unknown;

  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = text;
  }

  return { status: res.statusCode, body, text };
}

async function withEnvironment<T>(changes: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(changes).map((name) => [name, process.env[name]]));

  for (const [name, value] of Object.entries(changes)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  try {
    return await run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

async function dryRunConfig(prefix: string): Promise<Partial<RndcConfig>> {
  const base = await mkdtemp(join(tmpdir(), prefix));
  return {
    mode: "dry-run",
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs")
  };
}

async function liveConfig(prefix: string): Promise<Partial<RndcConfig>> {
  const base = await mkdtemp(join(tmpdir(), prefix));
  return {
    mode: "live",
    transport: "soap",
    environment: "test",
    endpointUrlOverride: "http://127.0.0.1:1/rndc",
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    username: "LIVE_USER",
    password: "LIVE_PASSWORD",
    companyNit: "900773684",
    companyDv: "9",
    companyRndcNit: "9007736849"
  };
}

function record(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

function authorizedHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${serviceToken}` };
}

function durableAuthorizedHeaders(operationId: string, operationType: string): Record<string, string> {
  return {
    ...authorizedHeaders(),
    "X-TMS-Durable-Operation": "true",
    "X-TMS-Expected-Mode": "live",
    "X-TMS-Organization-Id": "org-1",
    "X-TMS-Expediente-Id": "exp-1",
    "X-TMS-Document-Id": "doc-1",
    "X-TMS-Operation-Id": operationId,
    "X-TMS-Operation-Type": operationType,
    "X-TMS-Lease-Owner": `worker-${operationId}`,
    "X-Correlation-Id": operationId
  };
}

test("phase one routes require service authentication", async () => {
  await withEnvironment({ AUTH_MODE: "service", RNDC_SERVICE_TOKEN: serviceToken }, async () => {
    const app = createRndcApp(await dryRunConfig("tms-rndc-phase-one-auth-"));
    const response = await request(app, "/rndc/corrections/remesa", {
      body: {
        remesaNumber: "97102",
        reasonCode: 1,
        change: { code: 1, appointmentDate: "10/07/2026", appointmentTime: "14:30" }
      }
    });

    assert.equal(response.status, 401);
    assert.equal(record(record(response.body).error).code, "SERVICE_AUTH_REQUIRED");
  });
});

test("process 38 route validates input and persists masked dry-run evidence", async () => {
  await withEnvironment({ AUTH_MODE: "service", RNDC_SERVICE_TOKEN: serviceToken }, async () => {
    const config = await dryRunConfig("tms-rndc-phase-one-correction-");
    const app = createRndcApp(config);
    const invalid = await request(app, "/rndc/corrections/remesa", {
      headers: authorizedHeaders(),
      body: { remesaNumber: "97102", reasonCode: 1, change: { code: 1 } }
    });
    const response = await request(app, "/rndc/corrections/remesa", {
      headers: authorizedHeaders(),
      body: {
        remesaNumber: "97102",
        reasonCode: 1,
        change: { code: 1, appointmentDate: "10/07/2026", appointmentTime: "14:30" }
      }
    });
    const body = record(response.body);
    const requestEvidence = await readFile(record(body.request).path as string, "utf8");
    const saved = JSON.parse(await readFile(body.evidencePath as string, "utf8")) as Record<string, unknown>;

    assert.equal(invalid.status, 400);
    assert.equal(record(record(invalid.body).error).code, "VALIDATION_ERROR");
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.operation, "remesa-correction");
    assert.equal(record(body.request).procesoId, 38);
    assert.match(requestEvidence, /<procesoid>38<\/procesoid>/);
    assert.match(requestEvidence, /<CONSECUTIVOREMESA>97102<\/CONSECUTIVOREMESA>/);
    assert.match(requestEvidence, /<username>\*\*\*<\/username>/);
    assert.match(requestEvidence, /<password>\*\*\*<\/password>/);
    assert.equal(saved.operation, "remesa-correction");
    assert.equal(response.text.includes(serviceToken), false);
  });
});

test("live corrections are blocked before transport or evidence creation", async () => {
  await withEnvironment({
    AUTH_MODE: "service",
    RNDC_SERVICE_TOKEN: serviceToken,
    CONVEX_URL: "https://example.invalid",
    RNDC_INGEST_KEY: "test-ingest-key"
  }, async () => {
    const app = createRndcApp(await liveConfig("tms-rndc-phase-one-failed-evidence-"), {
      durableContextValidator: async () => true
    });
    const response = await request(app, "/rndc/corrections/remesa", {
      headers: durableAuthorizedHeaders("op-failed-evidence", "correct_remesa"),
      body: {
        remesaNumber: "97102",
        reasonCode: 1,
        change: { code: 1, appointmentDate: "10/07/2026", appointmentTime: "14:30" }
      }
    });
    const body = record(response.body);

    assert.equal(response.status, 403);
    assert.equal(record(body.error).code, "LIVE_WRITES_DISABLED");
    assert.equal(body.request, undefined);
  });
});

test("targeted annulment sends only the selected RNDC process", async () => {
  await withEnvironment({ AUTH_MODE: "service", RNDC_SERVICE_TOKEN: serviceToken }, async () => {
    const app = createRndcApp(await dryRunConfig("tms-rndc-phase-one-annulment-"));
    const response = await request(app, "/rndc/annulments/targeted", {
      headers: authorizedHeaders(),
      body: {
        target: "manifest",
        manifestNumber: "9702001",
        reasonCode: "S",
        observations: "ANULACION AUTORIZADA POR OPERACIONES"
      }
    });
    const body = record(response.body);
    const requestEvidence = await readFile(record(body.request).path as string, "utf8");

    assert.equal(response.status, 200);
    assert.equal(body.operation, "targeted-annulment");
    assert.equal(record(body.request).procesoId, 32);
    assert.match(requestEvidence, /<NUMMANIFIESTOCARGA>9702001<\/NUMMANIFIESTOCARGA>/);
    assert.doesNotMatch(requestEvidence, /CONSECUTIVOREMESA|CONSECUTIVOINFORMACIONVIAJE|CONSECUTIVOINFORMACIONCARGA/);
  });
});

test("reconciliation and acceptance routes issue typed type-3 queries", async () => {
  await withEnvironment({ AUTH_MODE: "service", RNDC_SERVICE_TOKEN: serviceToken }, async () => {
    const app = createRndcApp(await dryRunConfig("tms-rndc-phase-one-queries-"));
    const reconciliation = await request(app, "/rndc/reconciliation", {
      headers: authorizedHeaders(),
      body: { documentType: "manifest", documentNumber: "M321" }
    });
    const acceptance = await request(app, "/rndc/acceptances/query", {
      headers: authorizedHeaders(),
      body: { manifestRadicado: "48043700", from: "2026/07/01", to: "2026/07/09" }
    });
    const reconciliationBody = record(reconciliation.body);
    const acceptanceBody = record(acceptance.body);
    const reconciliationXml = await readFile(record(reconciliationBody.request).path as string, "utf8");
    const acceptanceXml = await readFile(record(acceptanceBody.request).path as string, "utf8");

    assert.equal(reconciliation.status, 200);
    assert.equal(reconciliationBody.operation, "reconciliation");
    assert.deepEqual(reconciliationBody.records, [{ RESULTADO: "CONSULTA RNDC DRY-RUN" }]);
    assert.match(reconciliationXml, /<tipo>3<\/tipo>/);
    assert.match(reconciliationXml, /<procesoid>4<\/procesoid>/);
    assert.match(reconciliationXml, /<NUMMANIFIESTOCARGA>&apos;M321&apos;<\/NUMMANIFIESTOCARGA>/);

    assert.equal(acceptance.status, 200);
    assert.equal(acceptanceBody.operation, "acceptance-query");
    assert.deepEqual(acceptanceBody.records, []);
    assert.match(acceptanceXml, /<tipo>3<\/tipo>/);
    assert.match(acceptanceXml, /<procesoid>73<\/procesoid>/);
    assert.match(acceptanceXml, /<INGRESOIDMANIFIESTO>48043700<\/INGRESOIDMANIFIESTO>/);
  });
});

test("manifest forms calculate FOPAT from the base value and persist the assessment", async () => {
  await withEnvironment({ AUTH_MODE: "service", RNDC_SERVICE_TOKEN: serviceToken }, async () => {
    const app = createRndcApp(await dryRunConfig("tms-rndc-phase-one-fopat-manifest-"));
    const response = await request(app, "/rndc/forms/manifest", {
      headers: authorizedHeaders(),
      body: {
        money: { freightValue: 4_760_000, fopatRetention: 999_999 },
        fopat: {
          operationType: "G",
          isOwnFleet: false,
          grossVehicleWeightKg: 41_000,
          vehicleConfigurationEligible: true
        }
      }
    });
    const body = record(response.body);
    const assessment = record(body.fopat);
    const result = record(assessment.result);
    const manifestStep = (body.steps as Record<string, unknown>[]).find((step) => step.name === "issue-manifest");
    assert.ok(manifestStep);
    const requestEvidence = await readFile(manifestStep.requestPath as string, "utf8");
    const saved = record(JSON.parse(await readFile(body.evidencePath as string, "utf8")) as unknown);

    assert.equal(response.status, 200);
    assert.equal(assessment.basis, 4_760_000);
    assert.equal(assessment.submittedAmount, 999_999);
    assert.equal(result.status, "applicable");
    assert.equal(result.amount, 4760);
    assert.match(requestEvidence, /<RETENCIONFOPAT>4760<\/RETENCIONFOPAT>/);
    assert.doesNotMatch(requestEvidence, /999999/);
    assert.deepEqual(saved.fopat, body.fopat);
  });
});

test("fulfill-manifest forms calculate FOPAT from the adjusted value", async () => {
  await withEnvironment({ AUTH_MODE: "service", RNDC_SERVICE_TOKEN: serviceToken }, async () => {
    const app = createRndcApp(await dryRunConfig("tms-rndc-phase-one-fopat-fulfill-"));
    const response = await request(app, "/rndc/forms/fulfill-manifest", {
      headers: authorizedHeaders(),
      body: {
        money: { freightValue: 4_760_000, fopatRetention: 1 },
        compliance: {
          additionalLoadHoursValue: 10_000,
          additionalUnloadHoursValue: 5_000,
          additionalFreightValue: 20_000,
          freightDiscountValue: 5_000
        },
        fopat: {
          operationType: "G",
          isOwnFleet: false,
          grossVehicleWeightKg: 41_000,
          vehicleConfigurationEligible: true
        }
      }
    });
    const body = record(response.body);
    const assessment = record(body.fopat);
    const result = record(assessment.result);
    const step = (body.steps as Record<string, unknown>[])[0];
    const requestEvidence = await readFile(step.requestPath as string, "utf8");

    assert.equal(response.status, 200);
    assert.equal(assessment.basis, 4_790_000);
    assert.equal(result.amount, 4790);
    assert.match(requestEvidence, /<RETENCIONFOPAT>4790<\/RETENCIONFOPAT>/);
  });
});

test("dry-run continues with a FOPAT warning while live mode fails closed before evidence or sending", async () => {
  await withEnvironment({
    AUTH_MODE: "service",
    RNDC_SERVICE_TOKEN: serviceToken,
    CONVEX_URL: "https://example.invalid",
    RNDC_INGEST_KEY: "test-ingest-key"
  }, async () => {
    const dryConfig = await dryRunConfig("tms-rndc-phase-one-fopat-dry-review-");
    const dry = await request(createRndcApp(dryConfig), "/rndc/forms/manifest", {
      headers: authorizedHeaders(),
      body: {}
    });
    const dryBody = record(dry.body);
    const dryAssessment = record(dryBody.fopat);
    const dryResult = record(dryAssessment.result);
    const dryManifestStep = (dryBody.steps as Record<string, unknown>[]).find((step) => step.name === "issue-manifest");
    assert.ok(dryManifestStep);
    const dryXml = await readFile(dryManifestStep.requestPath as string, "utf8");

    assert.equal(dry.status, 200);
    assert.equal(dryResult.status, "review-required");
    assert.equal(typeof dryAssessment.warning, "string");
    assert.match(dryXml, /<RETENCIONFOPAT>0<\/RETENCIONFOPAT>/);

    const liveOverrides = await liveConfig("tms-rndc-phase-one-fopat-live-review-");
    const liveOutput = liveOverrides.outputDir as string;
    const scenario = buildMtmReferenceScenario(loadConfig(liveOverrides));
    const live = await request(createRndcApp(liveOverrides, {
      durableContextValidator: async () => true
    }), "/rndc/forms/manifest", {
      headers: durableAuthorizedHeaders("op-fopat-live", "emit_manifest"),
      body: scenario
    });
    const liveBody = record(live.body);

    assert.equal(live.status, 403);
    assert.equal(record(liveBody.error).code, "LIVE_WRITES_DISABLED");
    assert.equal(liveBody.fopat, undefined);
    assert.equal(existsSync(liveOutput), false);
  });
});

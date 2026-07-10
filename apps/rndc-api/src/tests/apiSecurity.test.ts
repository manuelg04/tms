import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { ServerResponse } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duplex, Readable } from "node:stream";
import test from "node:test";
import { loadConfig } from "@tms/rndc-core";
import type { RndcConfig } from "@tms/rndc-core";
import { assertRuntimeCanStart, createRndcApp, readRndcRuntimeSettings } from "../index.js";
import type { RndcLogEntry } from "../index.js";

const serviceToken = "test-service-token-with-more-than-32-characters";

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
  headers: ReturnType<ServerResponse["getHeaders"]>;
};

type RequestOptions = {
  method?: string;
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
    method: options.method ?? "GET",
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
  let body: unknown = undefined;

  if (text !== "") {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }

  return { status: res.statusCode, body, text, headers: res.getHeaders() };
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
    outputDir: join(base, "runs"),
    pdfDir: join(base, "pdfs"),
    username: "LIVE_USER",
    password: "LIVE_PASSWORD",
    companyNit: "900773684",
    companyDv: "9",
    companyRndcNit: "9007736849"
  };
}

function recordBody(response: TestResponse): Record<string, unknown> {
  assert.equal(typeof response.body, "object");
  assert.notEqual(response.body, null);
  assert.equal(Array.isArray(response.body), false);
  return response.body as Record<string, unknown>;
}

test("health probes expose only liveness and preserve safe request identifiers", async () => {
  await withEnvironment({ RNDC_SERVICE_TOKEN: serviceToken }, async () => {
    const app = createRndcApp(await dryRunConfig("tms-rndc-health-"));
    const healthz = await request(app, "/healthz", {
      headers: {
        "X-Request-Id": "gateway-request-123",
        "X-Correlation-Id": "operation-456"
      }
    });
    const legacy = await request(app, "/health");

    assert.equal(healthz.status, 200);
    assert.deepEqual(healthz.body, { ok: true, status: "alive" });
    assert.equal(healthz.headers["x-request-id"], "gateway-request-123");
    assert.equal(healthz.headers["x-correlation-id"], "operation-456");
    assert.equal(legacy.status, 200);
    assert.deepEqual(legacy.body, { ok: true, status: "alive" });
  });
});

test("readiness validates service authentication without exposing secret values", async () => {
  await withEnvironment({ AUTH_MODE: "demo", RNDC_SERVICE_TOKEN: undefined }, async () => {
    const app = createRndcApp(await dryRunConfig("tms-rndc-ready-auth-"));
    const response = await request(app, "/readyz");
    const body = recordBody(response);

    assert.equal(response.status, 503);
    assert.deepEqual(body.issues, ["SERVICE_AUTH_NOT_CONFIGURED"]);
    assert.equal(response.text.includes(serviceToken), false);
  });

  await withEnvironment({ AUTH_MODE: "demo", RNDC_SERVICE_TOKEN: serviceToken }, async () => {
    const app = createRndcApp(await dryRunConfig("tms-rndc-ready-ok-"));
    const response = await request(app, "/readyz");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true, status: "ready", mode: "dry-run" });
  });
});

test("live mode is not ready with demo authentication or missing durable storage", async () => {
  await withEnvironment({
    AUTH_MODE: "demo",
    RNDC_SERVICE_TOKEN: serviceToken,
    CONVEX_URL: "https://example.invalid",
    RNDC_INGEST_KEY: "test-ingest-key"
  }, async () => {
    const app = createRndcApp(await liveConfig("tms-rndc-ready-demo-"));
    const response = await request(app, "/readyz");
    const body = recordBody(response);

    assert.equal(response.status, 503);
    assert.deepEqual(body.issues, ["DEMO_AUTH_FORBIDDEN_IN_LIVE"]);
  });

  await withEnvironment({
    AUTH_MODE: "service",
    RNDC_SERVICE_TOKEN: serviceToken,
    CONVEX_URL: undefined,
    RNDC_INGEST_KEY: undefined
  }, async () => {
    const app = createRndcApp(await liveConfig("tms-rndc-ready-storage-"));
    const response = await request(app, "/readyz");
    const body = recordBody(response);

    assert.equal(response.status, 503);
    assert.deepEqual(body.issues, ["DURABLE_STORAGE_NOT_CONFIGURED"]);
  });
});

test("operational routes require a bearer service token", async () => {
  await withEnvironment({ AUTH_MODE: "service", RNDC_SERVICE_TOKEN: serviceToken }, async () => {
    const app = createRndcApp(await dryRunConfig("tms-rndc-service-auth-"));
    const denied = await request(app, "/rndc/forms/reference", {
      headers: { "X-Correlation-Id": "reference-request" }
    });
    const allowed = await request(app, "/rndc/forms/reference", {
      headers: { Authorization: `Bearer ${serviceToken}` }
    });
    const deniedBody = recordBody(denied);

    assert.equal(denied.status, 401);
    assert.deepEqual(deniedBody.error, {
      code: "SERVICE_AUTH_REQUIRED",
      message: "Service authentication required"
    });
    assert.equal(deniedBody.correlationId, "reference-request");
    assert.equal(typeof deniedBody.requestId, "string");
    assert.equal(allowed.status, 200);
  });
});

test("legacy API keys require an explicit local dry-run compatibility flag", async () => {
  await withEnvironment({
    AUTH_MODE: "service",
    RNDC_SERVICE_TOKEN: serviceToken,
    RNDC_API_KEY: "legacy-test-key",
    RNDC_ENABLE_LEGACY_API_KEY: undefined,
    NODE_ENV: "test"
  }, async () => {
    const app = createRndcApp(await dryRunConfig("tms-rndc-legacy-key-off-"));
    const response = await request(app, "/rndc/forms/reference", {
      headers: { "X-Api-Key": "legacy-test-key" }
    });

    assert.equal(response.status, 401);
  });

  await withEnvironment({
    AUTH_MODE: "service",
    RNDC_SERVICE_TOKEN: undefined,
    RNDC_API_KEY: "legacy-test-key",
    RNDC_ENABLE_LEGACY_API_KEY: "true",
    NODE_ENV: "test"
  }, async () => {
    const app = createRndcApp(await dryRunConfig("tms-rndc-legacy-key-on-"));
    const response = await request(app, "/rndc/forms/reference", {
      headers: { "X-Api-Key": "legacy-test-key" }
    });

    assert.equal(response.status, 200);
  });

  await withEnvironment({
    AUTH_MODE: "service",
    RNDC_SERVICE_TOKEN: serviceToken,
    RNDC_API_KEY: "legacy-test-key",
    RNDC_ENABLE_LEGACY_API_KEY: "true",
    NODE_ENV: "test",
    CONVEX_URL: "https://example.invalid",
    RNDC_INGEST_KEY: "test-ingest-key"
  }, async () => {
    const app = createRndcApp(await liveConfig("tms-rndc-legacy-key-live-"));
    const response = await request(app, "/rndc/forms/reference", {
      headers: { "X-Api-Key": "legacy-test-key" }
    });

    assert.equal(response.status, 401);
  });
});

test("the generic message endpoint is disabled unless explicitly enabled for local dry-run", async () => {
  await withEnvironment({
    AUTH_MODE: "service",
    RNDC_SERVICE_TOKEN: serviceToken,
    RNDC_ENABLE_LEGACY_MESSAGE: undefined,
    NODE_ENV: "test"
  }, async () => {
    const app = createRndcApp(await dryRunConfig("tms-rndc-message-off-"));
    const response = await request(app, "/rndc/message", {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceToken}` },
      body: { tipo: 2, procesoId: 11, variables: {} }
    });
    const body = recordBody(response);

    assert.equal(response.status, 404);
    assert.deepEqual(body.error, {
      code: "LEGACY_ENDPOINT_DISABLED",
      message: "Legacy endpoint is disabled"
    });
  });

  await withEnvironment({
    AUTH_MODE: "service",
    RNDC_SERVICE_TOKEN: serviceToken,
    RNDC_ENABLE_LEGACY_MESSAGE: "true",
    NODE_ENV: "test"
  }, async () => {
    const app = createRndcApp(await dryRunConfig("tms-rndc-message-on-"));
    const response = await request(app, "/rndc/message", {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceToken}` },
      body: { tipo: 2, procesoId: 11, variables: {} }
    });

    assert.notEqual(response.status, 404);
    assert.equal(recordBody(response).mode, "dry-run");
  });
});

test("unsafe live configuration blocks operations before form handling", async () => {
  await withEnvironment({
    AUTH_MODE: "demo",
    RNDC_SERVICE_TOKEN: serviceToken,
    CONVEX_URL: "https://example.invalid",
    RNDC_INGEST_KEY: "test-ingest-key"
  }, async () => {
    const app = createRndcApp(await liveConfig("tms-rndc-live-blocked-"));
    const response = await request(app, "/rndc/forms/remesa", {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceToken}` },
      body: {}
    });
    const body = recordBody(response);

    assert.equal(response.status, 503);
    assert.deepEqual(body.error, {
      code: "LIVE_MODE_NOT_READY",
      message: "Live RNDC operations are not ready"
    });
  });
});

test("generated PDF evidence requires service authentication", async () => {
  await withEnvironment({ AUTH_MODE: "service", RNDC_SERVICE_TOKEN: serviceToken }, async () => {
    const config = await dryRunConfig("tms-rndc-pdf-auth-");
    const pdfDir = config.pdfDir;
    assert.ok(pdfDir);
    await mkdir(pdfDir, { recursive: true });
    await writeFile(join(pdfDir, "evidence.pdf"), "masked evidence", "utf8");
    const app = createRndcApp(config);
    const denied = await request(app, "/pdf/evidence.pdf");
    const allowed = await request(app, "/pdf/evidence.pdf", {
      headers: { Authorization: `Bearer ${serviceToken}` }
    });

    assert.equal(denied.status, 401);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.text, "masked evidence");
  });
});

test("live server startup fails closed when authentication or storage is unsafe", async () => {
  await withEnvironment({
    AUTH_MODE: "demo",
    RNDC_SERVICE_TOKEN: serviceToken,
    CONVEX_URL: undefined,
    RNDC_INGEST_KEY: undefined
  }, async () => {
    const config = loadConfig(await liveConfig("tms-rndc-startup-guard-"));
    const settings = readRndcRuntimeSettings();

    assert.throws(
      () => assertRuntimeCanStart(config, settings),
      /DEMO_AUTH_FORBIDDEN_IN_LIVE.*DURABLE_STORAGE_NOT_CONFIGURED/
    );
  });
});

test("structured request logs keep identifiers but exclude tokens and query values", async () => {
  await withEnvironment({ AUTH_MODE: "service", RNDC_SERVICE_TOKEN: serviceToken }, async () => {
    const entries: RndcLogEntry[] = [];
    const app = createRndcApp(await dryRunConfig("tms-rndc-logging-"), {
      logger: (entry) => entries.push(entry)
    });
    const response = await request(app, "/rndc/forms/reference?credential=must-not-appear", {
      headers: {
        Authorization: `Bearer ${serviceToken}`,
        "X-Request-Id": "logged-request",
        "X-Correlation-Id": "logged-operation"
      }
    });
    const denied = await request(app, "/rndc/forms/reference?credential=also-must-not-appear", {
      headers: {
        "X-Request-Id": "denied-request",
        "X-Correlation-Id": "denied-operation"
      }
    });

    assert.equal(response.status, 200);
    assert.equal(denied.status, 401);
    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.event, "request.completed");
    assert.equal(entries[0]?.requestId, "logged-request");
    assert.equal(entries[0]?.correlationId, "logged-operation");
    assert.equal(entries[0]?.path, "/rndc/forms/reference");
    assert.equal(entries[0]?.status, 200);
    assert.equal(entries[1]?.path, "/rndc/forms/reference");
    assert.equal(entries[1]?.status, 401);
    const serialized = JSON.stringify(entries);
    assert.equal(serialized.includes(serviceToken), false);
    assert.equal(serialized.includes("must-not-appear"), false);
    assert.equal(serialized.includes("also-must-not-appear"), false);
  });
});

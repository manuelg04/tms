import { randomUUID, timingSafeEqual } from "node:crypto";
import type express from "express";
import type { RndcConfig } from "@tms/rndc-core";

export const runtimeSafetyIssueCodes = [
  "SERVICE_AUTH_NOT_CONFIGURED",
  "AUTH_MODE_INVALID",
  "DEMO_AUTH_FORBIDDEN_IN_LIVE",
  "RNDC_CREDENTIALS_NOT_CONFIGURED",
  "DURABLE_STORAGE_NOT_CONFIGURED"
] as const;

export type RuntimeSafetyIssue = typeof runtimeSafetyIssueCodes[number];

export type RuntimeSafetyReport =
  | {
      ready: true;
      mode: RndcConfig["mode"];
      issues: [];
    }
  | {
      ready: false;
      mode: RndcConfig["mode"];
      issues: RuntimeSafetyIssue[];
    };

export type RndcAuthMode = "demo" | "service" | "invalid";

export type RndcRuntimeSettings = {
  authMode: RndcAuthMode;
  serviceToken?: string;
  legacyApiKey?: string;
  legacyApiKeyEnabled: boolean;
  legacyMessageEnabled: boolean;
  nodeEnvironment: string;
  convexUrl?: string;
  convexIngestKey?: string;
  allowedOrigins: string[];
};

export type RndcRequestContext = {
  requestId: string;
  correlationId: string;
  startedAt: number;
};

export type RndcLogEntry = {
  level: "info" | "warn" | "error";
  event: "request.completed" | "request.error" | "server.started";
  timestamp: string;
  requestId?: string;
  correlationId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  code?: string;
  port?: number;
};

export type RndcLogger = (entry: RndcLogEntry) => void;

export type RndcAppHooks = {
  logger?: RndcLogger;
};

export type ApiErrorCode =
  | "SERVICE_AUTH_REQUIRED"
  | "LIVE_MODE_NOT_READY"
  | "LIVE_WRITES_DISABLED"
  | "RNDC_EXPECTED_MODE_REQUIRED"
  | "RNDC_MODE_MISMATCH"
  | "DURABLE_OPERATION_ROUTE_MISMATCH"
  | "DURABLE_OPERATION_REQUIRED"
  | "LEGACY_ENDPOINT_DISABLED"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

const requestContexts = new WeakMap<express.Request, RndcRequestContext>();
const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function readRndcRuntimeSettings(environment: NodeJS.ProcessEnv = process.env): RndcRuntimeSettings {
  return {
    authMode: parseAuthMode(environment.AUTH_MODE),
    serviceToken: nonEmpty(environment.RNDC_SERVICE_TOKEN),
    legacyApiKey: nonEmpty(environment.RNDC_API_KEY),
    legacyApiKeyEnabled: parseEnabled(environment.RNDC_ENABLE_LEGACY_API_KEY),
    legacyMessageEnabled: parseEnabled(environment.RNDC_ENABLE_LEGACY_MESSAGE),
    nodeEnvironment: environment.NODE_ENV ?? "development",
    convexUrl: nonEmpty(environment.CONVEX_URL),
    convexIngestKey: nonEmpty(environment.RNDC_INGEST_KEY),
    allowedOrigins: parseOrigins(environment.WEB_ORIGIN)
  };
}

export function assessRuntimeSafety(config: RndcConfig, settings: RndcRuntimeSettings): RuntimeSafetyReport {
  const issues: RuntimeSafetyIssue[] = [];

  if (!hasConfiguredServiceAuthentication(config, settings)) {
    issues.push("SERVICE_AUTH_NOT_CONFIGURED");
  }

  if (settings.authMode === "invalid") {
    issues.push("AUTH_MODE_INVALID");
  }

  if (config.mode === "live") {
    if (settings.authMode === "demo") {
      issues.push("DEMO_AUTH_FORBIDDEN_IN_LIVE");
    }

    if (!hasLiveCredentials(config)) {
      issues.push("RNDC_CREDENTIALS_NOT_CONFIGURED");
    }

    if (!settings.convexUrl || !settings.convexIngestKey) {
      issues.push("DURABLE_STORAGE_NOT_CONFIGURED");
    }
  }

  if (issues.length === 0) {
    return { ready: true, mode: config.mode, issues: [] };
  }

  return { ready: false, mode: config.mode, issues };
}

export function assertRuntimeCanStart(config: RndcConfig, settings: RndcRuntimeSettings): void {
  if (config.mode !== "live") {
    return;
  }

  const report = assessRuntimeSafety(config, settings);

  if (!report.ready) {
    throw new Error(`Unsafe live RNDC configuration: ${report.issues.join(", ")}`);
  }
}

export function isLegacyApiKeyAllowed(config: RndcConfig, settings: RndcRuntimeSettings): boolean {
  return config.mode === "dry-run"
    && settings.nodeEnvironment !== "production"
    && settings.legacyApiKeyEnabled
    && Boolean(settings.legacyApiKey);
}

export function isLegacyMessageAllowed(config: RndcConfig, settings: RndcRuntimeSettings): boolean {
  return config.mode === "dry-run"
    && settings.nodeEnvironment !== "production"
    && settings.legacyMessageEnabled;
}

export function authenticateServiceRequest(req: express.Request, config: RndcConfig, settings: RndcRuntimeSettings): boolean {
  const bearerToken = readBearerToken(req.headers.authorization);

  if (settings.serviceToken && settings.serviceToken.length >= 32 && bearerToken && safeEqual(bearerToken, settings.serviceToken)) {
    return true;
  }

  const legacyHeader = singleHeader(req.headers["x-api-key"]);
  return Boolean(
    legacyHeader
      && settings.legacyApiKey
      && isLegacyApiKeyAllowed(config, settings)
      && safeEqual(legacyHeader, settings.legacyApiKey)
  );
}

export function requestContextMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const requestId = safeIdentifier(singleHeader(req.headers["x-request-id"])) ?? randomUUID();
  const correlationId = safeIdentifier(singleHeader(req.headers["x-correlation-id"])) ?? requestId;
  requestContexts.set(req, { requestId, correlationId, startedAt: Date.now() });
  res.setHeader("X-Request-Id", requestId);
  res.setHeader("X-Correlation-Id", correlationId);
  next();
}

export function getRequestContext(req: express.Request): RndcRequestContext {
  return requestContexts.get(req) ?? {
    requestId: randomUUID(),
    correlationId: randomUUID(),
    startedAt: Date.now()
  };
}

export function sendApiError(
  req: express.Request,
  res: express.Response,
  status: number,
  code: ApiErrorCode,
  message: string
): void {
  const context = getRequestContext(req);
  res.status(status).json({
    ok: false,
    error: { code, message },
    requestId: context.requestId,
    correlationId: context.correlationId
  });
}

export function createJsonLogger(output: Pick<NodeJS.WriteStream, "write"> = process.stdout): RndcLogger {
  return (entry) => {
    output.write(`${JSON.stringify(entry)}\n`);
  };
}

function hasConfiguredServiceAuthentication(config: RndcConfig, settings: RndcRuntimeSettings): boolean {
  if (settings.serviceToken && settings.serviceToken.length >= 32) {
    return true;
  }

  return isLegacyApiKeyAllowed(config, settings);
}

function hasLiveCredentials(config: RndcConfig): boolean {
  return [config.username, config.password, config.companyNit, config.companyDv, config.companyRndcNit]
    .every((value) => value.trim() !== "" && value !== "DRY_RUN_USER" && value !== "DRY_RUN_PASSWORD");
}

function parseAuthMode(value: string | undefined): RndcAuthMode {
  if (value === undefined || value.trim() === "" || value === "demo") {
    return "demo";
  }

  if (value === "service") {
    return "service";
  }

  return "invalid";
}

function parseEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function parseOrigins(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value.split(",").map((origin) => origin.trim()).filter((origin) => origin !== "");
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function safeIdentifier(value: string | undefined): string | undefined {
  return value && requestIdPattern.test(value) ? value : undefined;
}

function readBearerToken(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const match = /^Bearer ([^\s]+)$/i.exec(value);
  return match?.[1];
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

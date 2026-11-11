import express from "express";
import type { RndcConfig } from "@tms/rndc-core";
import {
  assessRuntimeSafety,
  authenticateServiceRequest,
  getRequestContext,
  isLegacyMessageAllowed,
  readRndcRuntimeSettings,
  sendApiError
} from "./runtimeSecurity.js";
import type { RndcLogger, RndcRuntimeSettings } from "./runtimeSecurity.js";
import { readDurableEvidenceContext } from "./durableEvidence.js";
import type { DurableContextValidator } from "./durableEvidence.js";

export function securityHeaders(_req: express.Request, res: express.Response, next: express.NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
}

export function createRequestLoggingMiddleware(logger: RndcLogger | undefined): express.RequestHandler {
  return (req, res, next) => {
    if (logger) {
      const context = getRequestContext(req);
      const path = req.path;
      res.on("finish", () => {
        logger({
          level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
          event: "request.completed",
          timestamp: new Date().toISOString(),
          requestId: context.requestId,
          correlationId: context.correlationId,
          method: req.method,
          path,
          status: res.statusCode,
          durationMs: Date.now() - context.startedAt
        });
      });
    }

    next();
  };
}

export function createDurableEvidenceMiddleware(
  settings: RndcRuntimeSettings,
  validateContext: DurableContextValidator
): express.RequestHandler {
  return async (req, res, next) => {
    const durableContext = readDurableEvidenceContext((name) => req.header(name));

    if (!durableContext.requested) {
      next();
      return;
    }

    const requestContext = getRequestContext(req);

    if ("error" in durableContext) {
      res.status(400).json({
        ok: false,
        error: {
          code: "INVALID_DURABLE_EVIDENCE_CONTEXT",
          message: durableContext.error
        },
        requestId: requestContext.requestId,
        correlationId: requestContext.correlationId
      });
      return;
    }

    if (!settings.convexUrl || !settings.convexIngestKey) {
      res.status(503).json({
        ok: false,
        error: {
          code: "DURABLE_STORAGE_NOT_CONFIGURED",
          message: "Durable evidence storage is not configured"
        },
        requestId: requestContext.requestId,
        correlationId: requestContext.correlationId
      });
      return;
    }

    if (req.header("X-Correlation-Id") !== durableContext.context.operationId) {
      res.status(400).json({
        ok: false,
        error: {
          code: "INVALID_DURABLE_OPERATION_CONTEXT",
          message: "Durable operation correlation does not match"
        },
        requestId: requestContext.requestId,
        correlationId: requestContext.correlationId
      });
      return;
    }

    const routeOperationType = durableOperationTypeForRequest(req);

    if (!routeOperationType || routeOperationType !== durableContext.context.operationType) {
      res.status(409).json({
        ok: false,
        error: {
          code: "DURABLE_OPERATION_ROUTE_MISMATCH",
          message: "Durable operation type does not match the RNDC route"
        },
        requestId: requestContext.requestId,
        correlationId: requestContext.correlationId
      });
      return;
    }

    if (!await validateContext({
      ...durableContext.context,
      payloadJson: JSON.stringify(req.body ?? {})
    })) {
      res.status(409).json({
        ok: false,
        error: {
          code: "INVALID_DURABLE_OPERATION_CONTEXT",
          message: "Durable operation context is not active or does not match"
        },
        requestId: requestContext.requestId,
        correlationId: requestContext.correlationId
      });
      return;
    }

    next();
  };
}

export function durableOperationTypeForRequest(req: express.Request): string | undefined {
  const path = req.originalUrl.split("?", 1)[0];
  const fixed: Record<string, string> = {
    "/rndc/forms/loading-order": "emit_cargo",
    "/rndc/forms/remesa": "emit_remesa",
    "/rndc/forms/trip": "emit_trip",
    "/rndc/forms/manifest": "emit_manifest",
    "/rndc/forms/manifest-issue": "emit_manifest",
    "/rndc/forms/fulfill-remesa": "fulfill_remesa",
    "/rndc/forms/fulfill-manifest": "fulfill_manifest",
    "/rndc/forms/driver-vehicle": "upsert_vehicle",
    "/rndc/forms/driver": "upsert_third_party",
    "/rndc/forms/vehicle": "upsert_vehicle",
    "/rndc/forms/party": "upsert_third_party",
    "/rndc/corrections/remesa": "correct_remesa",
    "/rndc/reconciliation": "reconcile",
    "/rndc/acceptances/query": "query_acceptance"
  };

  if (path in fixed) {
    return fixed[path];
  }

  if (path !== "/rndc/annulments/targeted" || !req.body || typeof req.body !== "object") {
    return undefined;
  }

  const target = (req.body as Record<string, unknown>).target;
  const targets: Record<string, string> = {
    "cargo-information": "annul_cargo",
    "trip-information": "annul_trip",
    remesa: "annul_remesa",
    manifest: "annul_manifest",
    "remesa-compliance": "annul_remesa_fulfillment",
    "remesa-initial-compliance": "annul_remesa_initial_fulfillment",
    "manifest-compliance": "annul_manifest_fulfillment"
  };
  return typeof target === "string" ? targets[target] : undefined;
}

export function createLegacyCorsMiddleware(config: RndcConfig, settings: RndcRuntimeSettings): express.RequestHandler {
  const enabled = config.mode === "dry-run"
    && settings.nodeEnvironment !== "production"
    && settings.legacyApiKeyEnabled
    && settings.allowedOrigins.length > 0;

  return (req, res, next) => {
    const origin = req.headers.origin;

    if (!enabled || !origin || !settings.allowedOrigins.includes(origin)) {
      next();
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Api-Key, X-Request-Id, X-Correlation-Id");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Vary", "Origin");

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
}

export function createServiceAuthenticationMiddleware(
  readConfig: () => RndcConfig,
  settings: RndcRuntimeSettings
): express.RequestHandler {
  return (req, res, next) => {
    if (authenticateServiceRequest(req, readConfig(), settings)) {
      next();
      return;
    }

    res.setHeader("WWW-Authenticate", "Bearer");
    sendApiError(req, res, 401, "SERVICE_AUTH_REQUIRED", "Service authentication required");
  };
}

export function createExpectedModeMiddleware(readConfig: () => RndcConfig): express.RequestHandler {
  return (req, res, next) => {
    const expectedMode = req.header("X-TMS-Expected-Mode")?.trim();

    if (req.header("X-TMS-Durable-Operation") === "true" && !expectedMode) {
      sendApiError(req, res, 400, "RNDC_EXPECTED_MODE_REQUIRED", "Durable RNDC requests must declare the expected mode");
      return;
    }

    const config = readConfig();
    const runtimeReady = assessRuntimeSafety(config, readRndcRuntimeSettings()).ready;
    const durableOperationType = durableOperationTypeForRequest(req);

    if (config.mode === "live" && runtimeReady && req.method !== "GET" && req.header("X-TMS-Durable-Operation") !== "true") {
      sendApiError(req, res, 403, "DURABLE_OPERATION_REQUIRED", "Live RNDC writes require a durable operation");
      return;
    }

    if (
      config.mode === "live"
      && runtimeReady
      && req.method !== "GET"
      && req.header("X-TMS-Durable-Operation") === "true"
      && durableOperationType
      && durableOperationType !== "reconcile"
      && durableOperationType !== "query_acceptance"
    ) {
      sendApiError(req, res, 403, "LIVE_WRITES_DISABLED", "Official RNDC writes remain disabled until canonical recovery is complete");
      return;
    }

    if (!expectedMode || expectedMode === config.mode) {
      next();
      return;
    }

    sendApiError(req, res, 409, "RNDC_MODE_MISMATCH", "RNDC gateway and backend modes do not match");
  };
}

export function createOperationalReadinessMiddleware(
  readConfig: () => RndcConfig,
  settings: RndcRuntimeSettings
): express.RequestHandler {
  return (req, res, next) => {
    const report = assessRuntimeSafety(readConfig(), settings);

    if (report.ready) {
      next();
      return;
    }

    sendApiError(req, res, 503, "LIVE_MODE_NOT_READY", report.mode === "live"
      ? "Live RNDC operations are not ready"
      : "RNDC operations are not ready");
  };
}

export function createLegacyMessageMiddleware(
  readConfig: () => RndcConfig,
  settings: RndcRuntimeSettings
): express.RequestHandler {
  return (req, res, next) => {
    if (isLegacyMessageAllowed(readConfig(), settings)) {
      next();
      return;
    }

    sendApiError(req, res, 404, "LEGACY_ENDPOINT_DISABLED", "Legacy endpoint is disabled");
  };
}

export function createDryRunOnlyMiddleware(readConfig: () => RndcConfig): express.RequestHandler {
  return (req, res, next) => {
    if (readConfig().mode === "dry-run") {
      next();
      return;
    }

    sendApiError(req, res, 404, "LEGACY_ENDPOINT_DISABLED", "Legacy endpoint is disabled");
  };
}

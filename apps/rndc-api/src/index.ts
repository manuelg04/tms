import express from "express";
import { registerMirrorRoutes } from "./mirrorRoutes.js";
import { fileURLToPath } from "node:url";
import {
  buildDriverMessages,
  buildDriverVehicleMessages,
  buildPartyMessages,
  buildVehicleMessages,
  buildFulfillManifestMessages,
  buildFulfillRemesaMessages,
  buildLoadingOrderMessages,
  buildManifestIssueMessages,
  buildManifestMessages,
  buildMtmReferenceScenario,
  buildRemesaMessages,
  buildTripMessages,
  loadConfig,
  RndcClient,
  runDemoFlow
} from "@tms/rndc-core";
import type { RndcConfig } from "@tms/rndc-core";
import { registerPhaseOneRoutes } from "./phaseOneRoutes.js";
import {
  assertRuntimeCanStart,
  assessRuntimeSafety,
  createJsonLogger,
  readRndcRuntimeSettings,
  requestContextMiddleware,
  sendApiError
} from "./runtimeSecurity.js";
import type { RndcAppHooks } from "./runtimeSecurity.js";
import { storeDurableEvidenceToConvex, validateDurableContextWithConvex } from "./durableEvidence.js";
import type { DurableContextValidator, DurableEvidenceStore } from "./durableEvidence.js";
import { scenarioToForm } from "./formScenario.js";
import { securityHeaders, createRequestLoggingMiddleware, createDurableEvidenceMiddleware, createLegacyCorsMiddleware, createServiceAuthenticationMiddleware, createExpectedModeMiddleware, createOperationalReadinessMiddleware, createLegacyMessageMiddleware, createDryRunOnlyMiddleware } from "./middleware.js";
import { submitForm, summarizeFlow } from "./formOperations.js";
import { createAvailabilityChecker } from "./availability.js";
import type { RndcAvailability } from "./availability.js";

type RndcAppRuntimeHooks = RndcAppHooks & {
  evidenceStore?: DurableEvidenceStore;
  durableContextValidator?: DurableContextValidator;
  availability?: () => Promise<RndcAvailability>;
};

export function createRndcApp(overrides: Partial<RndcConfig> = {}, hooks: RndcAppRuntimeHooks = {}): express.Express {
  const app = express();
  const readConfig = () => loadConfig(overrides);
  const initialConfig = readConfig();
  const runtimeSettings = readRndcRuntimeSettings();
  const evidenceStore = hooks.evidenceStore ?? storeDurableEvidenceToConvex;
  const durableContextValidator = hooks.durableContextValidator ?? validateDurableContextWithConvex;
  const requireServiceAuthentication = createServiceAuthenticationMiddleware(readConfig, runtimeSettings);
  const requireOperationalReadiness = createOperationalReadinessMiddleware(readConfig, runtimeSettings);

  app.disable("x-powered-by");
  app.use(requestContextMiddleware);
  app.use(securityHeaders);
  app.use(createRequestLoggingMiddleware(hooks.logger));
  app.use(createLegacyCorsMiddleware(initialConfig, runtimeSettings));
  app.use(express.json({ limit: "1mb" }));
  app.get(["/healthz", "/health"], (_req, res) => {
    res.json({ ok: true, status: "alive" });
  });

  app.get("/readyz", (_req, res) => {
    const report = assessRuntimeSafety(readConfig(), runtimeSettings);

    if (report.ready) {
      res.json({ ok: true, status: "ready", mode: report.mode });
      return;
    }

    res.status(503).json({
      ok: false,
      status: "not_ready",
      mode: report.mode,
      issues: report.issues
    });
  });

  app.use("/rndc", requireServiceAuthentication);
  app.use("/rndc", createExpectedModeMiddleware(readConfig));
  app.use("/rndc", createDurableEvidenceMiddleware(runtimeSettings, durableContextValidator));
  registerMirrorRoutes(app, readConfig);
  app.use("/pdf", requireServiceAuthentication, express.static(initialConfig.pdfDir, {
    dotfiles: "deny",
    fallthrough: true,
    index: false,
    setHeaders: (res) => {
      res.setHeader("Content-Disposition", "attachment");
    }
  }));

  const checkAvailability = hooks.availability ?? createAvailabilityChecker(readConfig);
  app.get("/rndc/availability", (_req, res, next) => {
    checkAvailability().then((availability) => res.json({ ok: true, ...availability })).catch(next);
  });

  app.get("/rndc/forms/reference", requireOperationalReadiness, (_req, res) => {
    const config = readConfig();
    const scenario = buildMtmReferenceScenario(config);
    res.json({
      ok: true,
      mode: config.mode,
      transport: config.transport,
      environment: config.environment,
      company: scenario.company,
      form: scenarioToForm(scenario),
      codes: {
        idTypes: [
          { value: "C", label: "Cedula de ciudadania" },
          { value: "N", label: "NIT" },
          { value: "E", label: "Cedula de extranjeria" },
          { value: "P", label: "Pasaporte" }
        ],
        operation: "G",
        capacityUnit: 1,
        packageCode: scenario.cargo.packageCode,
        natureCode: scenario.cargo.natureCode,
        vehicleConfigurationCode: scenario.vehicle.rndcConfigurationCode
      }
    });
  });

  app.post("/rndc/forms/loading-order", requireOperationalReadiness, (req, res, next) => {
    void submitForm(req, res, next, readConfig, "loading-order", buildLoadingOrderMessages, evidenceStore);
  });

  app.post("/rndc/forms/remesa", requireOperationalReadiness, (req, res, next) => {
    void submitForm(req, res, next, readConfig, "remesa", buildRemesaMessages, evidenceStore);
  });

  app.post("/rndc/forms/manifest", requireOperationalReadiness, (req, res, next) => {
    void submitForm(req, res, next, readConfig, "manifest", buildManifestMessages, evidenceStore);
  });

  app.post("/rndc/forms/trip", requireOperationalReadiness, (req, res, next) => {
    void submitForm(req, res, next, readConfig, "trip", buildTripMessages, evidenceStore);
  });

  app.post("/rndc/forms/manifest-issue", requireOperationalReadiness, (req, res, next) => {
    void submitForm(req, res, next, readConfig, "manifest-issue", buildManifestIssueMessages, evidenceStore);
  });

  app.post("/rndc/forms/fulfill-remesa", requireOperationalReadiness, (req, res, next) => {
    void submitForm(req, res, next, readConfig, "fulfill-remesa", buildFulfillRemesaMessages, evidenceStore);
  });

  app.post("/rndc/forms/fulfill-manifest", requireOperationalReadiness, (req, res, next) => {
    void submitForm(req, res, next, readConfig, "fulfill-manifest", buildFulfillManifestMessages, evidenceStore);
  });

  app.post("/rndc/forms/driver-vehicle", requireOperationalReadiness, (req, res, next) => {
    void submitForm(req, res, next, readConfig, "driver-vehicle", buildDriverVehicleMessages, evidenceStore);
  });

  app.post("/rndc/forms/driver", requireOperationalReadiness, (req, res, next) => {
    void submitForm(req, res, next, readConfig, "driver", buildDriverMessages, evidenceStore);
  });

  app.post("/rndc/forms/vehicle", requireOperationalReadiness, (req, res, next) => {
    void submitForm(req, res, next, readConfig, "vehicle", buildVehicleMessages, evidenceStore);
  });

  app.post("/rndc/forms/party", requireOperationalReadiness, (req, res, next) => {
    void submitForm(req, res, next, readConfig, "party", buildPartyMessages, evidenceStore);
  });

  registerPhaseOneRoutes(app, readConfig, requireOperationalReadiness, evidenceStore);

  app.post("/rndc/message", createLegacyMessageMiddleware(readConfig, runtimeSettings), requireOperationalReadiness, async (req, res, next) => {
    try {
      const config = readConfig();
      const client = new RndcClient(config);
      const response = await client.sendMessage({
        tipo: req.body.tipo,
        procesoId: req.body.procesoId,
        variables: req.body.variables,
        documento: req.body.documento,
        documentorango: req.body.documentorango
      });
      res.status(response.ok ? 200 : 422).json(response);
    } catch (error) {
      next(error);
    }
  });

  app.post("/rndc/flows/demo", createDryRunOnlyMiddleware(readConfig), requireOperationalReadiness, async (_req, res, next) => {
    try {
      const config = readConfig();
      const result = await runDemoFlow(config);
      res.status(result.ok ? 200 : 422).json(summarizeFlow(result));
    } catch (error) {
      next(error);
    }
  });

  app.use((req, res) => {
    sendApiError(req, res, 404, "NOT_FOUND", "Route not found");
  });

  app.use((_error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    sendApiError(req, res, 500, "INTERNAL_ERROR", "Unexpected server error");
  });

  return app;
}

const currentFile = fileURLToPath(import.meta.url);

if (process.argv[1] === currentFile) {
  const port = Number(process.env.PORT ?? 3017);
  const config = loadConfig();
  const runtimeSettings = readRndcRuntimeSettings();
  const logger = createJsonLogger();
  assertRuntimeCanStart(config, runtimeSettings);
  createRndcApp({}, { logger }).listen(port, () => {
    logger({
      level: "info",
      event: "server.started",
      timestamp: new Date().toISOString(),
      port
    });
  });
}

export type { FormOperation } from "./formOperations.js";
export { assertRuntimeCanStart, assessRuntimeSafety, createJsonLogger, readRndcRuntimeSettings } from "./runtimeSecurity.js";
export type { RndcAppHooks, RndcAuthMode, RndcLogEntry, RndcLogger, RndcRequestContext, RndcRuntimeSettings, RuntimeSafetyIssue, RuntimeSafetyReport } from "./runtimeSecurity.js";



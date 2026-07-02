import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RndcConfig, RndcEndpointTarget, RndcEnvironment, RndcMessageRequest, RndcMode, RndcTransport } from "./types.js";

loadEnv();

const endpoints: Record<RndcEndpointTarget, string> = {
  test: "http://rndcpruebas.mintransporte.gov.co:8080/soap/IBPMServices",
  primary: "http://rndcws.mintransporte.gov.co:8080/soap/IBPMServices",
  secondary: "http://rndcws2.mintransporte.gov.co:8080/soap/IBPMServices",
  queries: "http://plc.mintransporte.gov.co:8080/soap/IBPMServices"
};

const wstestUrls: Record<RndcEndpointTarget, string> = {
  test: "https://rndc.mintransporte.gov.co/wstest/defaultpruebas.aspx",
  primary: "https://rndc.mintransporte.gov.co/wstest/default.aspx",
  secondary: "https://rndc.mintransporte.gov.co/wstest/default2.aspx",
  queries: "https://rndc.mintransporte.gov.co/wstest/default3.aspx"
};

export function loadConfig(overrides: Partial<RndcConfig> = {}): RndcConfig {
  const environment = overrides.environment ?? parseEnvironment(process.env.RNDC_ENV);
  const mode = overrides.mode ?? parseMode(process.env.RNDC_MODE);

  if (mode === "live") {
    requireExplicitCompanyIdentity(overrides);
  }

  const transport = overrides.transport ?? parseTransport(process.env.RNDC_TRANSPORT);
  const endpointUrls = overrides.endpointUrls ?? {
    test: process.env.RNDC_TEST_ENDPOINT_URL ?? endpoints.test,
    primary: process.env.RNDC_PRIMARY_ENDPOINT_URL ?? endpoints.primary,
    secondary: process.env.RNDC_SECONDARY_ENDPOINT_URL ?? endpoints.secondary,
    queries: process.env.RNDC_QUERIES_ENDPOINT_URL ?? endpoints.queries
  };
  const configuredWstestUrls = overrides.wstestUrls ?? {
    test: process.env.RNDC_TEST_WSTEST_URL ?? wstestUrls.test,
    primary: process.env.RNDC_PRIMARY_WSTEST_URL ?? wstestUrls.primary,
    secondary: process.env.RNDC_SECONDARY_WSTEST_URL ?? wstestUrls.secondary,
    queries: process.env.RNDC_QUERIES_WSTEST_URL ?? wstestUrls.queries
  };
  const endpointUrlOverride = overrides.endpointUrlOverride ?? overrides.endpointUrl ?? process.env.RNDC_ENDPOINT_URL;
  const wstestUrlOverride = overrides.wstestUrlOverride ?? overrides.wstestUrl ?? process.env.RNDC_WSTEST_URL;
  const defaultTarget = environmentTarget(environment);
  const endpointUrl = endpointUrlOverride ?? endpointUrls[defaultTarget];
  const wstestUrl = wstestUrlOverride ?? configuredWstestUrls[defaultTarget];
  const username = overrides.username ?? process.env.RNDC_USERNAME ?? "DRY_RUN_USER";
  const password = overrides.password ?? process.env.RNDC_PASSWORD ?? "DRY_RUN_PASSWORD";
  const companyNit = overrides.companyNit ?? process.env.RNDC_COMPANY_NIT ?? "900773684";
  const companyDv = overrides.companyDv ?? process.env.RNDC_COMPANY_DV ?? "9";
  const companyRndcNit = overrides.companyRndcNit ?? process.env.RNDC_COMPANY_RNDC_NIT ?? `${companyNit}${companyDv}`;
  const timeoutMs = overrides.timeoutMs ?? Number(process.env.RNDC_TIMEOUT_MS ?? 30000);
  const outputDir = resolve(overrides.outputDir ?? process.env.RNDC_OUTPUT_DIR ?? "runs");
  const pdfDir = resolve(overrides.pdfDir ?? process.env.RNDC_PDF_DIR ?? "output/pdf");
  const localDataDir = resolve(overrides.localDataDir ?? process.env.RNDC_LOCAL_DATA_DIR ?? "local/rndc-masters");

  return {
    mode,
    transport,
    environment,
    endpointUrl,
    wstestUrl,
    endpointUrls,
    wstestUrls: configuredWstestUrls,
    endpointUrlOverride,
    wstestUrlOverride,
    username,
    password,
    companyNit,
    companyDv,
    companyRndcNit,
    timeoutMs,
    outputDir,
    pdfDir,
    localDataDir
  };
}

export function endpointFor(environment: RndcEnvironment): string {
  return endpoints[environmentTarget(environment)];
}

export function endpointTargetFor(config: RndcConfig, request: RndcMessageRequest): RndcEndpointTarget {
  if (config.environment === "test") {
    return "test";
  }

  if (config.environment === "secondary") {
    return "secondary";
  }

  const tipo = Number(request.tipo);
  const procesoId = Number(request.procesoId);

  if (tipo !== 1) {
    return "queries";
  }

  if (procesoId === 3 || procesoId === 4) {
    return "secondary";
  }

  return "primary";
}

export function endpointUrlFor(config: RndcConfig, request: RndcMessageRequest): string {
  return config.endpointUrlOverride ?? config.endpointUrls[endpointTargetFor(config, request)];
}

export function wstestUrlFor(config: RndcConfig, request: RndcMessageRequest): string {
  return config.wstestUrlOverride ?? config.wstestUrls[endpointTargetFor(config, request)];
}

export function requireLiveCredentials(config: RndcConfig): void {
  if (config.mode !== "live") {
    return;
  }

  const missing = [
    ["RNDC_USERNAME", config.username],
    ["RNDC_PASSWORD", config.password],
    ["RNDC_COMPANY_NIT", config.companyNit],
    ["RNDC_COMPANY_DV", config.companyDv],
    ["RNDC_COMPANY_RNDC_NIT", config.companyRndcNit]
  ].filter(([, value]) => !value || value === "DRY_RUN_USER" || value === "DRY_RUN_PASSWORD");

  if (missing.length > 0) {
    throw new Error(`Missing RNDC configuration: ${missing.map(([name]) => name).join(", ")}`);
  }
}

function requireExplicitCompanyIdentity(overrides: Partial<RndcConfig>): void {
  const missing = [
    ["RNDC_COMPANY_NIT", overrides.companyNit ?? process.env.RNDC_COMPANY_NIT],
    ["RNDC_COMPANY_DV", overrides.companyDv ?? process.env.RNDC_COMPANY_DV]
  ].filter(([, value]) => value === undefined || value === "");

  if (missing.length > 0) {
    throw new Error(`Live mode requires explicit company identity. Missing: ${missing.map(([name]) => name).join(", ")}`);
  }
}

function parseEnvironment(value: string | undefined): RndcEnvironment {
  if (value === "primary" || value === "secondary" || value === "test") {
    return value;
  }

  return "test";
}

function parseMode(value: string | undefined): RndcMode {
  if (value === "live") {
    return "live";
  }

  return "dry-run";
}

function parseTransport(value: string | undefined): RndcTransport {
  if (value === "wstest") {
    return "wstest";
  }

  return "soap";
}

function environmentTarget(environment: RndcEnvironment): RndcEndpointTarget {
  if (environment === "secondary") {
    return "secondary";
  }

  if (environment === "primary") {
    return "primary";
  }

  return "test";
}

function loadEnv(): void {
  const starts = [process.cwd(), dirname(fileURLToPath(import.meta.url))];
  const loaded = new Set<string>();

  for (const start of starts) {
    let current = resolve(start);

    while (true) {
      const envPath = resolve(current, ".env");

      if (existsSync(envPath)) {
        if (!loaded.has(envPath)) {
          loadDotenv({ path: envPath, override: false });
          loaded.add(envPath);
        }

        break;
      }

      const parent = dirname(current);

      if (parent === current || existsSync(resolve(current, "package-lock.json"))) {
        break;
      }

      current = parent;
    }
  }
}

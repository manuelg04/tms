import { endpointUrlFor } from "@tms/rndc-core";
import type { RndcConfig } from "@tms/rndc-core";

export type RndcAvailability = {
  available: boolean;
  mode: RndcConfig["mode"];
  checkedAt: string;
  detail?: string;
};

type Probe = (url: string, timeoutMs: number) => Promise<{ ok: boolean; text: string; status: number }>;

const CACHE_MS = 15_000;
const PROBE_TIMEOUT_MS = 6_000;

export function createAvailabilityChecker(readConfig: () => RndcConfig, probe: Probe = fetchProbe, now: () => number = Date.now) {
  let cached: { at: number; value: RndcAvailability } | undefined;

  return async function check(): Promise<RndcAvailability> {
    const config = readConfig();
    const current = now();

    if (cached && cached.value.mode === config.mode && current - cached.at < CACHE_MS) {
      return cached.value;
    }

    const value = await assess(config, probe, new Date(current).toISOString());
    cached = { at: current, value };
    return value;
  };
}

async function assess(config: RndcConfig, probe: Probe, checkedAt: string): Promise<RndcAvailability> {
  if (config.mode === "dry-run") {
    const outage = process.env.NODE_ENV !== "production" && process.env.RNDC_SIMULATE_OUTAGE === "true";
    return outage
      ? { available: false, mode: config.mode, checkedAt, detail: "Caída del RNDC simulada para pruebas" }
      : { available: true, mode: config.mode, checkedAt };
  }

  const wsdlUrl = endpointUrlFor(config, { tipo: 1, procesoId: 4 }).replace("/soap/IBPMServices", "/ws");

  try {
    const response = await probe(wsdlUrl, Math.min(PROBE_TIMEOUT_MS, config.timeoutMs));
    const available = response.ok && response.text.includes("AtenderMensajeRNDC");
    return available
      ? { available, mode: config.mode, checkedAt }
      : { available, mode: config.mode, checkedAt, detail: `El servicio del RNDC respondió con estado ${response.status}` };
  } catch (error) {
    return {
      available: false,
      mode: config.mode,
      checkedAt,
      detail: error instanceof Error ? error.message : "No fue posible conectar con el RNDC"
    };
  }
}

async function fetchProbe(url: string, timeoutMs: number): Promise<{ ok: boolean; text: string; status: number }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  return { ok: response.ok, text: await response.text(), status: response.status };
}

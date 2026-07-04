import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DemoScenario } from "../rndc/types.js";

export function applyScenarioOverlay(scenario: DemoScenario, overlay: unknown): DemoScenario {
  if (!isPlainObject(overlay)) {
    throw new Error("Scenario overlay must be a plain object");
  }

  return mergeValues(scenario, overlay) as DemoScenario;
}

export async function loadScenarioOverlay(): Promise<unknown | undefined> {
  const value = process.env.RNDC_SCENARIO_FILE;

  if (!value || value.trim() === "") {
    return undefined;
  }

  const overlayPath = resolve(process.env.INIT_CWD ?? process.cwd(), value);

  try {
    return JSON.parse(await readFile(overlayPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to load RNDC scenario overlay from ${overlayPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function mergeValues(base: unknown, overlay: unknown): unknown {
  if (isPlainObject(base) && isPlainObject(overlay)) {
    const result: Record<string, unknown> = { ...base };

    for (const [key, value] of Object.entries(overlay)) {
      result[key] = key in result ? mergeValues(result[key], value) : cloneValue(value);
    }

    return result;
  }

  return cloneValue(overlay);
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = cloneValue(nestedValue);
    }

    return result;
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

import type { FormState } from "./operations-config";

export function readPath(source: Record<string, unknown>, path: string): string {
  let current: unknown = source;

  for (const part of path.split(".")) {
    if (!isRecord(current)) {
      return "";
    }

    current = current[part];
  }

  return current === undefined || current === null ? "" : String(current);
}

export function setPath(source: FormState, path: string, value: string): FormState {
  const next = structuredClone(source) as FormState;
  const parts = path.split(".");
  let current: Record<string, unknown> = next;

  for (const part of parts.slice(0, -1)) {
    const child = current[part];

    if (!isRecord(child)) {
      current[part] = {};
    }

    current = current[part] as Record<string, unknown>;
  }

  current[parts.at(-1) ?? path] = value;
  return next;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

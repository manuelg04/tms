export type SnapshotKind = "orden_cargue" | "remesa" | "manifiesto" | "cumplido_remesa" | "cumplido_manifiesto" | "asignacion";

export type DispatchSnapshot = {
  payloadJson: string;
  fingerprint: string;
};

export function canonicalJson(value: unknown): string {
  const serialized = serialize(value);

  if (serialized === undefined) {
    throw new Error("Valor no serializable para fotografía");
  }

  return serialized;
}

export function buildDispatchSnapshot(kind: SnapshotKind, data: unknown, meta: { takenAt: number }): DispatchSnapshot {
  const payloadJson = canonicalJson({ kind, takenAt: meta.takenAt, data });
  return { payloadJson, fingerprint: fingerprintOf(payloadJson) };
}

function serialize(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error("Valor no serializable para fotografía");
      }
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new Error("Valor no serializable para fotografía");
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => serialize(item) ?? "null");
    return `[${items.join(",")}]`;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new Error("Valor no serializable para fotografía");
  }

  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => {
      const serialized = serialize((value as Record<string, unknown>)[key]);
      return serialized === undefined ? undefined : `${JSON.stringify(key)}:${serialized}`;
    })
    .filter((entry): entry is string => entry !== undefined);
  return `{${entries.join(",")}}`;
}

function fingerprintOf(payload: string): string {
  return `${fnv1a(payload, 0x811c9dc5)}${fnv1a(payload, 0x01000193)}`;
}

function fnv1a(payload: string, seed: number): string {
  let hash = seed >>> 0;

  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

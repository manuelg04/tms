export type RndcCatalogKind = "vehicle_line" | "insurer" | "packaging" | "body_type";

export type RndcCatalogPayloadValue = string | number | boolean | null;

export type RndcCatalogPayload = Readonly<Record<string, RndcCatalogPayloadValue>>;

export type RndcCatalogComparable = Readonly<{
  sourceRegisteredAt: string;
  payload: RndcCatalogPayload;
}>;

export type RndcCatalogWriteDecision = "insert" | "update" | "unchanged" | "outdated" | "conflict";

export function canonicalizeRndcCatalogPayload(payload: RndcCatalogPayload): string {
  return JSON.stringify(
    Object.keys(payload)
      .sort()
      .map((key) => [key, normalizePayloadValue(payload[key])])
  );
}

function normalizePayloadValue(value: RndcCatalogPayloadValue): RndcCatalogPayloadValue {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value;
}

export function decideRndcCatalogWrite(
  existing: RndcCatalogComparable | null,
  incoming: RndcCatalogComparable
): RndcCatalogWriteDecision {
  if (!existing) {
    return "insert";
  }
  if (incoming.sourceRegisteredAt > existing.sourceRegisteredAt) {
    return "update";
  }
  if (incoming.sourceRegisteredAt < existing.sourceRegisteredAt) {
    return "outdated";
  }
  if (canonicalizeRndcCatalogPayload(existing.payload) === canonicalizeRndcCatalogPayload(incoming.payload)) {
    return "unchanged";
  }
  return "conflict";
}

export function cleanRndcReference(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return !cleaned || cleaned === "0" ? undefined : cleaned;
}

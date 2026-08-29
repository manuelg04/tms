export type AvansatCustomerPayload = {
  customer: Record<string, unknown>;
  location?: Record<string, unknown> | null;
  source: Record<string, unknown>;
};

export type AvansatCustomerWriteDecision = "insert" | "update" | "unchanged";

export function canonicalizeAvansatCustomerBatch(
  batchIndex: number,
  rows: ReadonlyArray<{ document: string; contentHash: string }>
): string {
  if (!Number.isInteger(batchIndex) || batchIndex < 0) throw new Error("The Avansat customer batch index is invalid");
  return JSON.stringify([batchIndex, rows.map((row) => [row.document, row.contentHash])]);
}

export function canonicalizeAvansatCustomerPayload(payload: AvansatCustomerPayload): string {
  return stableJson({ customer: payload.customer, location: payload.location ?? null, source: payload.source });
}

export function decideAvansatCustomerWrite(existingHash: string | undefined, incomingHash: string): AvansatCustomerWriteDecision {
  assertHash(incomingHash);
  if (existingHash === undefined) return "insert";
  assertHash(existingHash);
  return existingHash === incomingHash ? "unchanged" : "update";
}

export function decideAvansatCustomerRecordWrite(
  recordExists: boolean,
  existingHash: string | undefined,
  incomingHash: string,
  storedFieldsMatch: boolean
): AvansatCustomerWriteDecision {
  if (!recordExists) return decideAvansatCustomerWrite(undefined, incomingHash);
  if (existingHash === undefined) {
    assertHash(incomingHash);
    return "update";
  }
  return decideAvansatCustomerWrite(existingHash, incomingHash) === "unchanged" && storedFieldsMatch
    ? "unchanged"
    : "update";
}

function assertHash(value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("The Avansat customer content hash is invalid");
}

function stableJson(value: unknown): string {
  const serialized = JSON.stringify(stableValue(value));
  if (serialized === undefined) throw new Error("The Avansat customer payload cannot be serialized");
  return serialized;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)])
    );
  }
  return value;
}

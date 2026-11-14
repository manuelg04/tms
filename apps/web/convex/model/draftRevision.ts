export type DraftKind = "orden_cargue" | "remesa" | "manifiesto";

const NAMES: Record<DraftKind, string> = {
  orden_cargue: "La orden de cargue",
  remesa: "La remesa",
  manifiesto: "El manifiesto"
};

export function currentRevision(stored: number | undefined): number {
  return stored ?? 0;
}

export function staleDraftProblem(kind: DraftKind, expected: number | undefined, stored: number | undefined, label?: string): string | null {
  if (expected === undefined || expected === currentRevision(stored)) return null;
  return `${NAMES[kind]}${label ? ` ${label}` : ""} cambió desde que abriste este formulario. Recarga los datos antes de guardar o emitir, para no borrar lo que otra persona guardó`;
}

export function formIsStale(opened: number, live: number | undefined): boolean {
  return currentRevision(live) > opened;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined && entry !== "")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${key}:${stable(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "";
}

export function changedDraftFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  labels: Record<string, string>
): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changed = [...keys].filter((key) => stable((before ?? {})[key]) !== stable((after ?? {})[key]));
  return [...new Set(changed.map((key) => labels[key] ?? "Otros datos"))];
}

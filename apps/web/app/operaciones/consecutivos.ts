import type { Operation } from "./operations-config";

export type CounterType = "orden_cargue" | "remesa" | "manifiesto";

export const counterFieldPath: Record<CounterType, string> = {
  orden_cargue: "cargoNumber",
  remesa: "remesaNumber",
  manifiesto: "manifestNumber"
};

const padding: Record<CounterType, number> = {
  orden_cargue: 9,
  remesa: 0,
  manifiesto: 7
};

export function formatConsecutivo(type: CounterType, n: number): string {
  return String(n).padStart(padding[type], "0");
}

export function parseConsecutivo(value: string): number | null {
  return /^\d+$/.test(value.trim()) ? Number.parseInt(value.trim(), 10) : null;
}

export function countersForOperation(operation: Operation): CounterType[] {
  if (operation === "loading-order") return ["orden_cargue"];
  if (operation === "remesa") return ["remesa"];
  if (operation === "manifest") return ["manifiesto"];
  return [];
}

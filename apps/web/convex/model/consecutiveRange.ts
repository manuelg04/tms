export type ConsecutiveFormat = {
  prefix: string;
  padding: number;
};

export type ConsecutiveRangeState = ConsecutiveFormat & {
  nextValue: number;
  endValue?: number;
};

export type ConsecutiveClaim = {
  formatted: string;
  numeric: number;
  nextValue: number;
};

export type ConsignmentNumberRecord = {
  expedienteId: string;
  sequence: number;
  number?: string;
};

export type ConsignmentNumberContext = {
  expedienteId: string;
  sequence: number;
};

export function formatConsecutive(format: ConsecutiveFormat, value: number): string {
  return `${format.prefix}${String(value).padStart(Math.max(format.padding, 0), "0")}`;
}

export function claimNextConsecutive(range: ConsecutiveRangeState): ConsecutiveClaim {
  if (
    !Number.isSafeInteger(range.nextValue) ||
    range.nextValue < 1 ||
    !Number.isSafeInteger(range.padding) ||
    range.padding < 0 ||
    (range.endValue !== undefined && !Number.isSafeInteger(range.endValue))
  ) {
    throw new Error("Rango de consecutivos inválido");
  }

  if (range.endValue !== undefined && range.nextValue > range.endValue) {
    throw new Error("Rango de consecutivos agotado");
  }

  return {
    formatted: formatConsecutive(range, range.nextValue),
    numeric: range.nextValue,
    nextValue: range.nextValue + 1
  };
}

export function resolveConsignmentNumberClaim(
  record: ConsignmentNumberRecord | null,
  context: ConsignmentNumberContext
): { kind: "create" } | { kind: "assign" } | { kind: "reuse"; number: string } {
  if (!Number.isInteger(context.sequence) || context.sequence < 1) {
    throw new Error("La secuencia de la remesa debe ser un entero positivo");
  }
  if (!record) {
    return { kind: "create" };
  }
  if (record.expedienteId !== context.expedienteId) {
    throw new Error("La remesa no pertenece a este despacho");
  }
  if (record.sequence !== context.sequence) {
    throw new Error("La secuencia de la remesa no coincide");
  }
  if (!record.number) {
    return { kind: "assign" };
  }
  if (!/^\d{5,}$/.test(record.number)) {
    throw new Error("El número de remesa debe tener al menos cinco dígitos");
  }
  return { kind: "reuse", number: record.number };
}

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

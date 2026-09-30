import { FormValidationError } from "../components/fields/form-validation";

export function value(data: FormData, key: string): string | undefined {
  const result = String(data.get(key) ?? "").trim();
  return result || undefined;
}

export function required(data: FormData, key: string): string {
  const result = value(data, key);
  if (!result) throw new FormValidationError(key);
  return result;
}

export function timestamp(data: FormData, key: string): number {
  const result = new Date(required(data, key)).getTime();
  if (!Number.isFinite(result)) throw new FormValidationError(key, "Selecciona una fecha válida.");
  return result;
}

export function optionalNumber(data: FormData, key: string): number | undefined {
  const text = value(data, key);
  if (text === undefined) return undefined;
  const result = Number(text);
  if (!Number.isFinite(result)) throw new FormValidationError(key, "Ingresa un número válido.");
  return result;
}

export function loadingWindowEnd(data: FormData): string {
  const min = required(data, "minLoadingDate");
  const max = required(data, "maxLoadingDate");
  if (max < min) throw new FormValidationError("maxLoadingDate", "La fecha máxima de cargue no puede ser anterior a la fecha mínima.");
  return max;
}

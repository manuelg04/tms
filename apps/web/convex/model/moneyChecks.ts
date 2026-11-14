export type MoneyLimits = {
  freightMin: number;
  freightMax: number;
  advanceMaxPercent: number;
};

export const DEFAULT_MONEY_LIMITS: MoneyLimits = {
  freightMin: 500_000,
  freightMax: 15_000_000,
  advanceMaxPercent: 85
};

export type MoneyReviewDraft = {
  manifestType?: string;
  emptyManifestReason?: string;
  freightTotal?: string;
  advance?: string;
  withholdingSource?: string;
  withholdingIca?: string;
  fopatContribution?: string;
  adjustments?: string;
};

export type MoneyWarning = {
  field: "freightTotal" | "advance";
  label: string;
  message: string;
};

export type MoneyReview = {
  blockers: string[];
  warnings: MoneyWarning[];
  confirmationKey: string;
};

export function resolveMoneyLimits(custom?: Partial<MoneyLimits> | null): MoneyLimits {
  const pick = (value: number | undefined, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
  const freightMin = pick(custom?.freightMin, DEFAULT_MONEY_LIMITS.freightMin);
  const freightMax = pick(custom?.freightMax, DEFAULT_MONEY_LIMITS.freightMax);
  const advanceMaxPercent = pick(custom?.advanceMaxPercent, DEFAULT_MONEY_LIMITS.advanceMaxPercent);
  if (freightMax <= freightMin || advanceMaxPercent > 100) return DEFAULT_MONEY_LIMITS;
  return { freightMin, freightMax, advanceMaxPercent };
}

export function formatPesos(value: number): string {
  return `$${String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

function amount(value: string | undefined): number | undefined {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits ? Number(digits) : undefined;
}

function perMille(value: string | undefined): number {
  const parsed = Number((value ?? "").trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function manifestMoneyReview(draft: MoneyReviewDraft | null | undefined, limits: MoneyLimits = DEFAULT_MONEY_LIMITS): MoneyReview {
  const review: MoneyReview = { blockers: [], warnings: [], confirmationKey: "" };
  const freight = amount(draft?.freightTotal);
  if (!draft || freight === undefined) return review;

  const advance = amount(draft.advance) ?? 0;
  const ica = Math.round(freight * perMille(draft.withholdingIca) / 1000);
  const deductions = advance + (amount(draft.withholdingSource) ?? 0) + ica + (amount(draft.fopatContribution) ?? 0) - (amount(draft.adjustments) ?? 0);

  if (advance > freight) {
    review.blockers.push(`El anticipo (${formatPesos(advance)}) no puede ser mayor que el flete (${formatPesos(freight)})`);
  } else if (deductions > freight) {
    review.blockers.push("El anticipo y las retenciones superan el flete: el neto a pagar quedaría negativo");
  }

  const emptyTrip = draft.manifestType === "W" || Boolean(draft.emptyManifestReason?.trim());
  if (emptyTrip) return review;

  if (freight > limits.freightMax) {
    review.warnings.push({
      field: "freightTotal",
      label: `el flete de ${formatPesos(freight)}`,
      message: `Supera lo habitual (hasta ${formatPesos(limits.freightMax)}). Revisa que no tenga un cero de más.`
    });
  } else if (freight < limits.freightMin) {
    review.warnings.push({
      field: "freightTotal",
      label: `el flete de ${formatPesos(freight)}`,
      message: `Está por debajo de lo habitual (desde ${formatPesos(limits.freightMin)}). Revisa que no le falte un cero.`
    });
  }

  if (freight > 0 && advance <= freight && advance * 100 > freight * limits.advanceMaxPercent) {
    const percent = Math.floor(advance * 100 / freight);
    review.warnings.push({
      field: "advance",
      label: `el anticipo de ${formatPesos(advance)}`,
      message: `Es el ${percent} % del flete; lo habitual es hasta ${limits.advanceMaxPercent} %.`
    });
  }

  if (review.warnings.length > 0) review.confirmationKey = `${freight}:${advance}`;
  return review;
}

export function moneyConfirmationBlocker(review: MoneyReview, confirmedKey: string | undefined): string | undefined {
  if (!review.confirmationKey || confirmedKey === review.confirmationKey) return undefined;
  return `Confirmar en el manifiesto ${review.warnings.map((warning) => warning.label).join(" y ")}, fuera de lo habitual`;
}

export function resolveMoneyConfirmation<Confirmation extends { key: string }>(
  review: MoneyReview,
  confirmedKey: string | undefined,
  previous: Confirmation | undefined,
  create: (key: string) => Confirmation
): Confirmation | undefined {
  if (!review.confirmationKey || confirmedKey !== review.confirmationKey) return undefined;
  return previous?.key === review.confirmationKey ? previous : create(review.confirmationKey);
}

const UNITS = ["", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiún", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function belowThousand(value: number): string {
  if (value === 100) return "cien";
  const rest = value % 100;
  const tens = rest < 30 ? UNITS[rest] : [TENS[Math.floor(rest / 10)], UNITS[rest % 10]].filter(Boolean).join(" y ");
  return [HUNDREDS[Math.floor(value / 100)], tens].filter(Boolean).join(" ");
}

function belowMillion(value: number): string {
  const thousands = Math.floor(value / 1000);
  const rest = value % 1000;
  const head = thousands === 0 ? "" : thousands === 1 ? "mil" : `${belowThousand(thousands)} mil`;
  return [head, belowThousand(rest)].filter(Boolean).join(" ");
}

export function amountInWords(value: string | number | undefined): string {
  const total = typeof value === "number" ? Math.round(value) : amount(value);
  if (total === undefined || !Number.isSafeInteger(total) || total < 0 || total > 999_999_999_999) return "";
  if (total === 0) return "cero pesos";
  const millions = Math.floor(total / 1_000_000);
  const rest = total % 1_000_000;
  const head = millions === 0 ? "" : millions === 1 ? "un millón" : `${belowMillion(millions)} millones`;
  const words = [head, belowMillion(rest)].filter(Boolean).join(" ");
  if (millions > 0 && rest === 0) return `${words} de pesos`;
  return total === 1 ? "un peso" : `${words} pesos`;
}

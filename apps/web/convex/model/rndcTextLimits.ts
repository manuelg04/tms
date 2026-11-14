export const RNDC_TEXT_LIMITS = {
  manifestObservations: 500,
  cargoShortDescription: 60,
  policyNumber: 20,
  fulfillmentObservations: 200,
  annulmentObservations: 200
} as const;

export type RndcTextField = keyof typeof RNDC_TEXT_LIMITS;

const FIELD_LABELS: Record<RndcTextField, string> = {
  manifestObservations: "Observaciones del manifiesto",
  cargoShortDescription: "Descripción de la mercancía",
  policyNumber: "Número de póliza",
  fulfillmentObservations: "Observaciones del cumplido",
  annulmentObservations: "Observaciones de la anulación"
};

export function rndcTextLength(value: string | undefined | null): number {
  return (value ?? "").trim().length;
}

export function rndcTextExcess(field: RndcTextField, value: string | undefined | null): number {
  return Math.max(0, rndcTextLength(value) - RNDC_TEXT_LIMITS[field]);
}

export function rndcTextBlocker(field: RndcTextField, value: string | undefined | null): string | null {
  const excess = rndcTextExcess(field, value);
  if (excess === 0) return null;
  return `${FIELD_LABELS[field]}: tiene ${rndcTextLength(value)} caracteres y el RNDC acepta máximo ${RNDC_TEXT_LIMITS[field]}. Recorta ${excess}`;
}

export function fitRndcText(field: RndcTextField, value: string): string {
  const text = value.trim();
  const limit = RNDC_TEXT_LIMITS[field];
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > limit * 0.8 ? cut.slice(0, lastSpace) : cut).trim();
}

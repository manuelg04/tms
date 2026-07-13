export type LogisticsTimelineInput = {
  origin: LogisticsSiteTimeline;
  destination: LogisticsSiteTimeline;
  finalDelivery?: number;
};

export type LogisticsSiteTimeline = {
  arrival?: number;
  entry?: number;
  start?: number;
  end?: number;
  exit?: number;
};

export type FulfillmentPlanInput = {
  consignments: Array<{ id: string; fulfillmentState: string }>;
  manifest: { id: string; fulfillmentState: string } | null;
  allowEmptyManifest?: boolean;
};

export type FulfillmentPlanStep = { kind: "remesa" | "manifiesto"; id: string };

export type FulfillmentQuantities = {
  deliveredQuantity?: string;
  missingQuantity?: string;
  surplusQuantity?: string;
  returnedQuantity?: string;
};

const siteEvents: Array<{
  key: keyof LogisticsSiteTimeline;
  label: string;
}> = [
  { key: "arrival", label: "llegada" },
  { key: "entry", label: "entrada" },
  { key: "start", label: "inicio" },
  { key: "end", label: "fin" },
  { key: "exit", label: "salida" }
];

export function validateLogisticsTimeline(input: LogisticsTimelineInput): string[] {
  const errors = [
    ...validateSite("cargue", input.origin),
    ...validateSite("descargue", input.destination)
  ];
  const destinationExit = input.destination.exit;

  if (
    input.finalDelivery !== undefined
    && destinationExit !== undefined
    && input.finalDelivery < destinationExit
  ) {
    errors.push("La entrega final no puede ocurrir antes de terminar la operación de descargue.");
  }

  return errors;
}

export function buildFulfillmentPlan(input: FulfillmentPlanInput): FulfillmentPlanStep[] {
  if (!input.manifest || (input.consignments.length === 0 && !input.allowEmptyManifest)) {
    return [];
  }

  if (input.consignments.length === 0) {
    return input.manifest.fulfillmentState === "fulfilled" ? [] : [{ kind: "manifiesto", id: input.manifest.id }];
  }

  if (input.consignments.some((item) => ["pending", "rejected", "annulment_pending"].includes(item.fulfillmentState))) {
    return [];
  }

  const remaining = input.consignments
    .filter((item) => item.fulfillmentState !== "fulfilled")
    .map((item) => ({ kind: "remesa" as const, id: item.id }));

  if (remaining.length > 0) {
    return [...remaining, { kind: "manifiesto", id: input.manifest.id }];
  }

  return input.manifest.fulfillmentState === "fulfilled"
    ? []
    : [{ kind: "manifiesto", id: input.manifest.id }];
}

export function validateFulfillmentQuantities(input: FulfillmentQuantities): string[] {
  const fields: Array<{ key: keyof FulfillmentQuantities; label: string }> = [
    { key: "deliveredQuantity", label: "entregada" },
    { key: "missingQuantity", label: "faltante" },
    { key: "surplusQuantity", label: "sobrante" },
    { key: "returnedQuantity", label: "devuelta" }
  ];

  return fields.flatMap(({ key, label }) => {
    const value = input[key];

    if (value === undefined || value.trim() === "") {
      return key === "deliveredQuantity"
        ? [`La cantidad ${label} debe ser un número mayor o igual a cero.`]
        : [];
    }

    const number = Number(value);
    return Number.isFinite(number) && number >= 0
      ? []
      : [`La cantidad ${label} debe ser un número mayor o igual a cero.`];
  });
}

function validateSite(siteLabel: string, site: LogisticsSiteTimeline): string[] {
  const errors: string[] = [];

  for (let index = 1; index < siteEvents.length; index += 1) {
    const previous = siteEvents[index - 1];
    const current = siteEvents[index];
    const previousValue = site[previous.key];
    const currentValue = site[current.key];

    if (currentValue !== undefined && previousValue !== undefined && currentValue < previousValue) {
      errors.push(`El ${current.label} de ${siteLabel} no puede ocurrir antes de la ${previous.label} a ${siteLabel}.`);
    }
  }

  return errors;
}

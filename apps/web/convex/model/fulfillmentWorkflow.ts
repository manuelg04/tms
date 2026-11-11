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


export type EntryTimesDraft = {
  suspended?: boolean;
  loadingEntryAt?: number;
  unloadingEntryAt?: number;
};

const CLOCK_TOLERANCE_MS = 60_000;

export function validateEntryTimes(draft: EntryTimesDraft, now: number): string[] {
  const errors: string[] = [];
  const { loadingEntryAt, unloadingEntryAt } = draft;

  if (loadingEntryAt === undefined) {
    errors.push("Registra la fecha y hora de entrada al cargue.");
  } else if (loadingEntryAt > now + CLOCK_TOLERANCE_MS) {
    errors.push("La entrada al cargue no puede ser una fecha futura.");
  }

  if (draft.suspended) {
    return errors;
  }

  if (unloadingEntryAt === undefined) {
    errors.push("Registra la fecha y hora de entrada al descargue.");
  } else if (unloadingEntryAt > now + CLOCK_TOLERANCE_MS) {
    errors.push("La entrada al descargue no puede ser una fecha futura.");
  }

  if (loadingEntryAt !== undefined && unloadingEntryAt !== undefined && unloadingEntryAt <= loadingEntryAt) {
    errors.push("La entrada al descargue debe ser posterior a la entrada al cargue.");
  }

  return errors;
}

export function bogotaDateTimeParts(value: number): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(value));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = pick("hour") === "24" ? "00" : pick("hour");
  return { date: `${pick("day")}/${pick("month")}/${pick("year")}`, time: `${hour}:${pick("minute")}` };
}

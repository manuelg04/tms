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


export type OperationTimes = {
  loadingArrivalAt: number;
  loadingEntryAt: number;
  loadingExitAt: number;
  unloadingArrivalAt: number;
  unloadingEntryAt: number;
  unloadingExitAt: number;
};

export type OperationTimesDraft = Partial<OperationTimes>;

export type OperationTimesSource = {
  loadingAppointmentAt?: number;
  loadingAgreedHours?: string;
  unloadingAppointmentAt?: number;
  unloadingAgreedHours?: string;
};

const HOUR_MS = 3_600_000;

function agreedHoursMs(value: string | undefined, fallbackHours: number): number {
  const text = (value ?? "").trim().replace(",", ".");
  const parsed = text === "" ? Number.NaN : Number(text);
  return (Number.isFinite(parsed) && parsed >= 0 ? parsed : fallbackHours) * HOUR_MS;
}

export function deriveOperationTimes(source: OperationTimesSource, draft: OperationTimesDraft | undefined, fallback: { loadingAt: number; unloadingAt: number }): OperationTimes {
  const loadingBase = source.loadingAppointmentAt ?? fallback.loadingAt;
  const loadingArrivalAt = draft?.loadingArrivalAt ?? loadingBase;
  const loadingEntryAt = draft?.loadingEntryAt ?? Math.max(loadingArrivalAt, loadingBase);
  const loadingExitAt = draft?.loadingExitAt ?? loadingEntryAt + agreedHoursMs(source.loadingAgreedHours, 1);
  const unloadingBase = Math.max(source.unloadingAppointmentAt ?? fallback.unloadingAt, loadingExitAt);
  const unloadingArrivalAt = draft?.unloadingArrivalAt ?? unloadingBase;
  const unloadingEntryAt = draft?.unloadingEntryAt ?? Math.max(unloadingArrivalAt, unloadingBase);
  const unloadingExitAt = draft?.unloadingExitAt ?? unloadingEntryAt + agreedHoursMs(source.unloadingAgreedHours, 2);
  return { loadingArrivalAt, loadingEntryAt, loadingExitAt, unloadingArrivalAt, unloadingEntryAt, unloadingExitAt };
}

export function validateOperationTimes(times: OperationTimesDraft): string[] {
  const errors: string[] = [];
  const ordered: Array<[keyof OperationTimes, keyof OperationTimes, string]> = [
    ["loadingArrivalAt", "loadingEntryAt", "La entrada al cargue no puede ser antes de la llegada."],
    ["loadingEntryAt", "loadingExitAt", "La salida del cargue no puede ser antes de la entrada."],
    ["loadingExitAt", "unloadingArrivalAt", "La llegada al descargue no puede ser antes de la salida del cargue."],
    ["unloadingArrivalAt", "unloadingEntryAt", "La entrada al descargue no puede ser antes de la llegada."],
    ["unloadingEntryAt", "unloadingExitAt", "La salida del descargue no puede ser antes de la entrada."]
  ];
  for (const [before, after, message] of ordered) {
    const left = times[before];
    const right = times[after];
    if (left !== undefined && right !== undefined && right < left) errors.push(message);
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

export type DrainOutcome = "done" | "retry" | "attention";

const attentionActions = new Set(["completar_datos", "registrar_maestros", "revisar_rechazo", "conciliar"]);
const attentionReasons = new Set(["missing_fields", "not_prepared", "masters_not_registered", "uncertain"]);

export function classifyDrainResult(status: number, body: unknown): { outcome: DrainOutcome; error?: string } {
  if (status === 200) {
    return { outcome: "done" };
  }

  const record = isRecord(body) ? body : {};
  const error = drainErrorText(record);
  const nextAction = typeof record.nextAction === "string" ? record.nextAction : undefined;
  const reason = typeof record.reason === "string" ? record.reason : undefined;

  if (record.queued === true || status >= 500 || nextAction === "esperar" || nextAction === "esperar_rndc" || nextAction === "reintentar" || reason === "in_flight") {
    return { outcome: "retry", error };
  }

  if ((nextAction && attentionActions.has(nextAction)) || (reason && attentionReasons.has(reason)) || status === 409 || status === 400 || status === 404) {
    return { outcome: "attention", error };
  }

  return { outcome: "retry", error };
}

export function drainErrorText(record: Record<string, unknown>): string | undefined {
  const steps = Array.isArray(record.steps) ? record.steps : [];
  const failing = steps.filter(isRecord).find((step) => step.outcome !== "authorized" && typeof step.error === "string");

  if (failing && typeof failing.error === "string") {
    return failing.error;
  }

  const nested = isRecord(record.detail) && isRecord(record.detail.data) && Array.isArray(record.detail.data.blockers) ? record.detail.data.blockers : [];
  const blockers = [...(Array.isArray(record.blockers) ? record.blockers : []), ...nested];
  const texts = blockers.flatMap((blocker) => {
    if (typeof blocker === "string") return [blocker];
    if (isRecord(blocker) && Array.isArray(blocker.missingFields)) {
      return [`Faltan datos en ${String(blocker.documentNumber ?? "el documento")}: ${blocker.missingFields.join(", ")}`];
    }
    return [];
  });

  if (texts.length > 0) {
    return texts.join(" · ");
  }

  if (typeof record.detail === "string") return record.detail;
  return typeof record.error === "string" ? record.error : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

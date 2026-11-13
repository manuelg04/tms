import { operationalBlocker } from "../../convex/model/dispatchPresentation";

export type EmissionNotice = { tone: "ok" | "bad" | "wait"; text: string };

const documentNames: Record<string, string> = {
  emit_loading_order: "Orden de cargue",
  emit_remesa: "Remesa",
  register_trip: "Información del viaje",
  issue_manifest: "Manifiesto"
};

type Step = { action?: unknown; documentNumber?: unknown; outcome?: unknown; radicado?: unknown; error?: unknown };

export function emissionNotice(status: number, body: unknown): EmissionNotice {
  const record = isRecord(body) ? body : {};
  const steps = (Array.isArray(record.steps) ? record.steps : []).filter(isRecord) as Step[];
  const internal = steps.filter((step) => step.outcome === "authorized" && step.action === "emit_loading_order").map(describeStep);
  const authorized = steps.filter((step) => step.outcome === "authorized" && step.action !== "register_trip" && step.action !== "emit_loading_order").map(describeStep);
  const saved = internal.length > 0 ? `${internal.join(", ")} guardada y lista para imprimir. ` : "";
  const done = `${saved}${authorized.length > 0 ? `${authorized.join(", ")} con autorización del RNDC. ` : ""}`;
  const trial = record.mode === "dry-run" ? " (modo prueba)" : "";

  if (status === 200) {
    return {
      tone: "ok",
      text: authorized.length > 0
        ? `${saved}Guardado y transmitido${trial}: ${authorized.join(", ")}.`
        : saved
          ? saved.trim()
          : `Guardado. Los documentos de esta etapa ya estaban listos${trial}.`
    };
  }

  if (record.queued === true) {
    return {
      tone: "wait",
      text: "Guardado. El RNDC no está disponible en este momento: el documento quedó en cola y se transmitirá solo cuando el servicio vuelva."
    };
  }

  const failing = steps.find((step) => step.outcome !== "authorized");

  if (failing?.outcome === "rejected") {
    return {
      tone: "bad",
      text: `${done}El RNDC rechazó ${describeStep(failing).toLowerCase()}: ${text(failing.error) ?? "sin detalle"}. Corrige el dato y vuelve a guardar.`
    };
  }

  if (failing?.outcome === "uncertain" || record.reason === "uncertain" || record.nextAction === "conciliar") {
    return {
      tone: "bad",
      text: `${done}El RNDC no confirmó el resultado del envío. Usa "Conciliar resultado" antes de volver a transmitir, para no duplicar el documento.`
    };
  }

  if (failing?.outcome === "in_progress" || record.reason === "in_flight" || record.nextAction === "esperar") {
    return { tone: "wait", text: `${done}Guardado. Ya hay una transmisión en curso para este despacho; espera su resultado.` };
  }

  if (failing?.action === "emit_loading_order") {
    return {
      tone: "bad",
      text: `No se pudo dejar lista la orden de cargue: ${text(failing.error) ?? "el servicio no respondió"}. Queda guardada como borrador; vuelve a intentarlo.`
    };
  }

  if (failing) {
    return {
      tone: "bad",
      text: `${done}No se pudo transmitir ${describeStep(failing).toLowerCase()}: ${text(failing.error) ?? "el servicio no respondió"}. Queda guardado; vuelve a intentarlo.`
    };
  }

  const nested = isRecord(record.detail) && isRecord(record.detail.data) ? record.detail.data.blockers : undefined;
  const blockers = [...blockerTexts(record.blockers), ...blockerTexts(nested)];

  if (blockers.length > 0 || isRecord(record.detail) || record.reason === "missing_fields" || record.reason === "not_prepared" || record.reason === "masters_not_registered") {
    const missing = blockers.length > 0 ? blockers.join(" ") : text(record.error) ?? "Faltan datos por completar.";
    return { tone: "wait", text: `${done}Guardado como borrador; todavía no se transmite. ${missing}` };
  }

  return {
    tone: "bad",
    text: `${done}Guardado, pero no se pudo transmitir: ${text(record.detail) ?? text(record.error) ?? "error inesperado"}.`
  };
}

function describeStep(step: Step): string {
  const name = documentNames[String(step.action)] ?? "Documento";
  const number = text(step.documentNumber);
  const radicado = text(step.radicado);
  return `${name}${number ? ` ${number}` : ""}${radicado ? ` (radicado ${radicado})` : ""}`;
}

function blockerTexts(blockers: unknown): string[] {
  if (!Array.isArray(blockers)) return [];
  return blockers.flatMap((blocker) => {
    if (typeof blocker === "string") return [withPeriod(operationalBlocker(blocker))];
    if (isRecord(blocker) && Array.isArray(blocker.missingFields)) {
      const name = documentNames[String(blocker.action)] ?? "Documento";
      return [`${name} ${text(blocker.documentNumber) ?? ""}: faltan ${blocker.missingFields.join(", ")}.`];
    }
    return [];
  });
}

function withPeriod(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

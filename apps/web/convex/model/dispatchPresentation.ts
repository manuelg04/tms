import type { DispatchStage } from "./dispatchWorkflow";

export type DispatchActionKind =
  | "continue"
  | "review"
  | "emit"
  | "record_logistics"
  | "fulfill_consignments"
  | "fulfill_manifest"
  | "print"
  | "reconcile"
  | "review_rejection"
  | "wait"
  | "view";

export type DispatchPresentationInput = {
  stage: DispatchStage;
  blockers: string[];
  hasRejectedOperation: boolean;
  hasUncertainOperation: boolean;
  hasOperationInFlight: boolean;
  printed: boolean;
};

export type DispatchPrimaryAction = {
  kind: DispatchActionKind;
  label: string;
  description: string;
  disabled: boolean;
};

export const guidedDispatchStages: Array<{ key: DispatchStage; label: string; shortLabel: string }> = [
  { key: "orden_cargue", label: "Orden de cargue", shortLabel: "Orden" },
  { key: "remesas", label: "Remesas", shortLabel: "Remesas" },
  { key: "vehiculo_conductor", label: "Vehículo y conductor", shortLabel: "Flota" },
  { key: "manifiesto", label: "Manifiesto", shortLabel: "Manifiesto" },
  { key: "envio_rndc", label: "Revisión y envío RNDC", shortLabel: "RNDC" },
  { key: "cargue_descargue", label: "Cargue y descargue", shortLabel: "Operación" },
  { key: "cumplido_inicial", label: "Cumplido inicial", shortLabel: "Remesas" },
  { key: "cumplido_final", label: "Cumplido final", shortLabel: "Cierre" }
];

const stageActions: Record<DispatchStage, DispatchPrimaryAction> = {
  orden_cargue: action("continue", "Continuar orden de cargue", "Completa cliente, ruta, citas y mercancía."),
  remesas: action("continue", "Continuar remesas", "Revisa la carga heredada y agrega sólo las diferencias."),
  vehiculo_conductor: action("continue", "Asignar vehículo y conductor", "Selecciona recursos vigentes del maestro."),
  manifiesto: action("continue", "Preparar manifiesto", "Completa la operación y la liquidación del viaje."),
  envio_rndc: action("emit", "Revisar y enviar", "Valida el despacho antes de iniciar la secuencia en modo prueba."),
  cargue_descargue: action("record_logistics", "Registrar tiempos", "Registra manualmente la operación en origen y destino."),
  cumplido_inicial: action("fulfill_consignments", "Cumplir remesas", "Confirma la entrega real de cada remesa."),
  cumplido_final: action("fulfill_manifest", "Cumplir manifiesto", "Cierra el manifiesto después de todas las remesas."),
  cumplido: action("print", "Imprimir documentos", "El despacho está cerrado y sus documentos permanecen disponibles."),
  anulado: action("view", "Ver documentos", "El despacho está anulado y permanece disponible para consulta.")
};

export function dispatchPrimaryAction(input: DispatchPresentationInput): DispatchPrimaryAction {
  if (input.hasUncertainOperation) {
    return action("reconcile", "Conciliar resultado", "Consulta el resultado oficial sin reenviar el documento.");
  }

  if (input.hasRejectedOperation) {
    return action("review_rejection", "Revisar rechazo", "Lee la causa, corrige el dato permitido y reanuda desde el último documento autorizado.");
  }

  if (input.hasOperationInFlight) {
    return action("wait", "Envío en curso", "La operación ya está registrada. Espera su resultado antes de continuar.", true);
  }

  return stageActions[input.stage];
}

export function dispatchStageMeta(
  stage: DispatchStage,
  currentStage: DispatchStage
): { state: "complete" | "current" | "blocked"; stateLabel: string } {
  const stageIndex = normalizedStageIndex(stage);
  const currentIndex = normalizedStageIndex(currentStage);

  if (currentStage === "anulado") {
    return { state: "blocked", stateLabel: "No disponible" };
  }

  if (currentStage === "cumplido" || stageIndex < currentIndex) {
    return { state: "complete", stateLabel: "Completada" };
  }

  if (stageIndex === currentIndex) {
    return { state: "current", stateLabel: "Etapa actual" };
  }

  return { state: "blocked", stateLabel: "Bloqueada" };
}

export function operationalBlocker(blocker: string): string {
  const remesa = /^Remesa (\d+): (.+)$/.exec(blocker);

  if (remesa) {
    return `Remesa ${remesa[1]}: ${lowercaseFirst(translateField(remesa[2]))}`;
  }

  const translations: Record<string, string> = {
    "Orden de cargue sin iniciar": "Inicia la orden de cargue para preparar el despacho.",
    Cliente: "Selecciona el cliente de la orden de cargue.",
    "Remitente con identificación": "Completa el remitente y su identificación.",
    "Destinatario con identificación": "Completa el destinatario y su identificación.",
    "Sitio y cita de cargue": "Completa el sitio y la cita de cargue.",
    "Sitio y cita de descargue": "Completa el sitio y la cita de descargue.",
    Mercancía: "Completa la descripción de la mercancía.",
    "Peso (TN)": "Completa el peso de la mercancía en la orden de cargue.",
    "Tipo de empaque": "Selecciona el tipo de empaque.",
    "El despacho no tiene remesas": "Agrega al menos una remesa al despacho.",
    "Falta asignar el vehículo": "Selecciona un vehículo del maestro.",
    "Falta asignar el conductor": "Selecciona un conductor del maestro.",
    "Manifiesto sin preparar": "Completa el manifiesto y la liquidación del viaje."
  };

  return translations[blocker] ?? blocker;
}

function action(
  kind: DispatchActionKind,
  label: string,
  description: string,
  disabled = false
): DispatchPrimaryAction {
  return { kind, label, description, disabled };
}

function normalizedStageIndex(stage: DispatchStage): number {
  if (stage === "cumplido") {
    return guidedDispatchStages.length;
  }

  if (stage === "anulado") {
    return guidedDispatchStages.length + 1;
  }

  return guidedDispatchStages.findIndex((item) => item.key === stage);
}

function translateField(field: string): string {
  const translations: Record<string, string> = {
    Destinatario: "Completa el destinatario.",
    Remitente: "Completa el remitente.",
    "Clase de remesa": "Selecciona la clase de remesa.",
    "Sitio y cita de descargue": "Completa el sitio y la cita de descargue.",
    "Remisiones con cantidad, descripción y peso": "Completa cantidad, descripción y peso de la carga."
  };

  return translations[field] ?? field;
}

function lowercaseFirst(value: string): string {
  return value ? `${value[0].toLocaleLowerCase("es")}${value.slice(1)}` : value;
}

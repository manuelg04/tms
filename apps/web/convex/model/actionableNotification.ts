export type ActionableNotificationCategory = "rejection" | "reconciliation" | "fulfillment" | "evidence";

export type ActionableNotification = {
  category: ActionableNotificationCategory;
  title: string;
  actionLabel: string;
  actionHref: string;
};

const rejectedEvents = new Set([
  "attempt_rejected",
  "fulfillment_rejected",
  "fulfillment_annulment_rejected",
  "correction_rejected",
  "annulment_rejected",
  "reconciliation_mismatch"
]);

export function actionableNotification(event: string, expedienteId: string): ActionableNotification | null {
  const actionHref = `/expedientes/${expedienteId}`;

  if (rejectedEvents.has(event)) {
    return { category: "rejection", title: "Documento RNDC rechazado", actionLabel: "Revisar rechazo", actionHref };
  }

  if (event === "reconciliation_started") {
    return { category: "reconciliation", title: "Resultado RNDC por conciliar", actionLabel: "Conciliar resultado", actionHref };
  }

  if (event === "submission_succeeded") {
    return { category: "fulfillment", title: "Documento pendiente de operación", actionLabel: "Continuar despacho", actionHref };
  }

  if (event === "evidence_failed") {
    return { category: "evidence", title: "Error al guardar evidencia", actionLabel: "Revisar evidencia", actionHref };
  }

  return null;
}

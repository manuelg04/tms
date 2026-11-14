export type RejectedOperation = {
  _id: string;
  status: string;
  operationType: string;
  mode: string;
  requestKey: string;
  businessKey: string;
  resultJson?: string;
  expedienteRemesaId?: string;
  documentId?: string;
};

export type LockedDocument = { _id: string; officialState?: string };

export function archivedKey(key: string, operationId: string): string {
  return `${key}:rechazada:${operationId}`;
}

export function rejectionUnlockProblem(
  operation: RejectedOperation,
  remesa: LockedDocument & { documentId?: string } | null,
  document: LockedDocument | null
): string | null {
  if (operation.operationType !== "emit_remesa" && operation.operationType !== "emit_manifest") return "Solo aplica a emisiones de remesa o manifiesto";
  if (operation.status !== "failed") return "La operación no terminó en rechazo";
  if (operation.businessKey.includes(":rechazada:")) return "La operación ya fue archivada";
  let result: { ok?: unknown; steps?: Array<{ accepted?: unknown }> } | null = null;
  try {
    result = operation.resultJson ? JSON.parse(operation.resultJson) : null;
  } catch {
    result = null;
  }
  if (!result || result.ok !== false || !Array.isArray(result.steps) || result.steps.length === 0) return "No hay respuesta del RNDC que confirme el rechazo";
  if (result.steps.some((step) => step.accepted !== false)) return "El RNDC aceptó algún paso; no se puede reabrir";
  if (!document) return "No se encontró el documento";
  if (operation.documentId !== document._id) return "La operación no corresponde a este documento";
  if (document.officialState !== "pending") return "El documento no está pendiente";
  if (operation.operationType === "emit_manifest") {
    if (remesa) return "Un manifiesto no se reabre junto con una remesa";
    return null;
  }
  if (!remesa) return "No se encontró la remesa";
  if (operation.expedienteRemesaId !== remesa._id || remesa.documentId !== document._id) return "La operación no corresponde a esta remesa";
  if (remesa.officialState !== "pending") return "La remesa no está pendiente";
  return null;
}

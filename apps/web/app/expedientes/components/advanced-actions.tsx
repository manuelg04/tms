export type AdvancedAction = "remesa_without_order" | "empty_manifest" | "transshipment" | "correct" | "annul" | "reconcile";

export function AdvancedActions({
  canManageOfficial,
  canManageStructural,
  exceptions,
  onAction
}: {
  canManageOfficial: boolean;
  canManageStructural: boolean;
  exceptions: Array<{ _id: string; type: string; status: string; reason: string; createdAt: number }>;
  onAction: (action: AdvancedAction) => void;
}) {
  return (
    <details className="advanced-actions">
      <summary>Correcciones, anulaciones y soporte</summary>
      <div className="advanced-actions-body">
        <div><strong>Acciones oficiales protegidas</strong><p>Cada acción exige motivo, observación, confirmación y deja evidencia y auditoría.</p></div>
        {canManageOfficial || canManageStructural ? <div className="advanced-action-buttons">{canManageStructural ? <><button className="ghost-button" onClick={() => onAction("remesa_without_order")} type="button">Remesa sin orden</button><button className="ghost-button" onClick={() => onAction("empty_manifest")} type="button">Manifiesto vacío</button><button className="ghost-button" onClick={() => onAction("transshipment")} type="button">Transbordo</button></> : null}{canManageOfficial ? <><button className="ghost-button" onClick={() => onAction("reconcile")} type="button">Conciliar</button><button className="ghost-button" onClick={() => onAction("correct")} type="button">Corregir remesa</button><button className="danger-action" onClick={() => onAction("annul")} type="button">Anular documento</button></> : null}</div> : <span className="role-lock">Tu rol permite consultar el historial, pero no modificar documentos oficiales.</span>}
        {exceptions.length > 0 ? <div className="advanced-exception-history"><strong>Excepciones registradas</strong>{exceptions.map((exception) => <div key={exception._id}><span>{exceptionLabel(exception.type)}</span><b>{statusLabel(exception.status)}</b><small>{exception.reason} · {new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(exception.createdAt)}</small></div>)}</div> : null}
      </div>
    </details>
  );
}

function exceptionLabel(type: string): string {
  const labels: Record<string, string> = { remesa_without_order: "Remesa sin orden", empty_manifest: "Manifiesto vacío", transshipment: "Transbordo", correction: "Corrección", annulment: "Anulación", reconciliation: "Conciliación" };
  return labels[type] ?? "Excepción";
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = { pending: "Pendiente", in_progress: "En curso", completed: "Completada", rejected: "Rechazada", uncertain: "Incierta", cancelled: "Cancelada" };
  return labels[status] ?? status;
}

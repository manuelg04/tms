export function AdvancedActions({ canManage, onAction }: { canManage: boolean; onAction: (action: "correct" | "annul" | "reconcile") => void }) {
  return (
    <details className="advanced-actions">
      <summary>Acciones avanzadas y soporte</summary>
      <div className="advanced-actions-body">
        <div><strong>Protegidas</strong><p>Las correcciones, conciliaciones y anulaciones conservan motivo, actor, fecha y evidencia.</p></div>
        {canManage ? <div className="advanced-action-buttons"><button className="ghost-button" onClick={() => onAction("reconcile")} type="button">Conciliar</button><button className="ghost-button" onClick={() => onAction("correct")} type="button">Corregir</button><button className="danger-action" onClick={() => onAction("annul")} type="button">Anular</button></div> : <span className="role-lock">Sólo administración puede ejecutar estas acciones.</span>}
      </div>
    </details>
  );
}

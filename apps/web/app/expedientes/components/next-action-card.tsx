import type { DispatchPrimaryAction } from "../../../convex/model/dispatchPresentation";
import { BlockerList } from "./blocker-list";

export function NextActionCard({ action, blockers, busy, formId, onAction }: { action: DispatchPrimaryAction; blockers: string[]; busy: boolean; formId?: string; onAction?: () => void }) {
  return (
    <section className="next-action-card" aria-labelledby="next-action-title">
      <div className="next-action-kicker"><span />Siguiente acción</div>
      <div className="next-action-body">
        <div>
          <h3 id="next-action-title">{action.label}</h3>
          <p>{action.description}</p>
        </div>
        <button
          className="primary-action"
          disabled={action.disabled || busy}
          form={formId}
          onClick={formId ? undefined : onAction}
          type={formId ? "submit" : "button"}
        >
          {busy ? "Procesando…" : action.label}
        </button>
      </div>
      {blockers.length > 0 ? <BlockerList blockers={blockers} /> : null}
    </section>
  );
}

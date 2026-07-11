import type { DispatchStage } from "../../../convex/model/dispatchWorkflow";
import { dispatchStageMeta, guidedDispatchStages } from "../../../convex/model/dispatchPresentation";

export function DispatchStageNav({ currentStage, onSelect, selectedStage }: { currentStage: DispatchStage; onSelect: (stage: DispatchStage) => void; selectedStage: DispatchStage }) {
  return (
    <nav className="dispatch-stage-nav" aria-label="Etapas del despacho">
      {guidedDispatchStages.map((stage, index) => {
        const meta = dispatchStageMeta(stage.key, currentStage);
        return (
          <button
            aria-current={stage.key === selectedStage ? "step" : undefined}
            className={`${meta.state} ${stage.key === selectedStage ? "selected" : ""}`}
            key={stage.key}
            onClick={() => onSelect(stage.key)}
            type="button"
          >
            <span className="stage-marker">{meta.state === "complete" ? "✓" : index + 1}</span>
            <span className="stage-copy"><strong>{stage.label}</strong><small>{meta.stateLabel}</small></span>
          </button>
        );
      })}
    </nav>
  );
}

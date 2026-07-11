import { operationalBlocker } from "../../../convex/model/dispatchPresentation";

export function BlockerList({ blockers }: { blockers: string[] }) {
  if (blockers.length === 0) {
    return <div className="blocker-clear"><span aria-hidden>✓</span> No hay bloqueos para la etapa actual.</div>;
  }

  return (
    <div className="blocker-list" role="alert">
      <strong>Antes de continuar</strong>
      <ul>{blockers.map((blocker) => <li key={blocker}>{operationalBlocker(blocker)}</li>)}</ul>
    </div>
  );
}

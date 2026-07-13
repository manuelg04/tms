import type { EmissionScope } from "../../../convex/model/dispatchWorkflow";
import type { DispatchStage } from "../../../convex/model/dispatchWorkflow";
import { StatusBadge } from "../status-badge";

export type DocumentHubItem = {
  key: string;
  title: string;
  description: string;
  number?: string;
  state: string;
  stage: DispatchStage;
  scope?: Exclude<EmissionScope, "todo">;
  blockers: string[];
  canEdit: boolean;
  pdfHref?: string;
};

export function DocumentHub({ busy, items, onEdit, onEmit }: {
  busy: boolean;
  items: DocumentHubItem[];
  onEdit: (stage: DispatchStage) => void;
  onEmit: (scope: Exclude<EmissionScope, "todo">) => void;
}) {
  return (
    <section aria-label="Documentos del despacho" className="document-hub">
      <div className="section-heading">
        <div><span className="eyebrow">Expediente modular</span><h3>Documentos del despacho</h3></div>
        <span>Cada documento avanza a su ritmo</span>
      </div>
      <div className="document-hub-grid">
        {items.map((item) => {
          const official = item.state === "authorized" || item.state === "fulfilled";
          const blocked = item.blockers.length > 0;
          return (
            <article className="document-hub-card" key={item.key}>
              <div className="document-hub-card-heading">
                <div><span>{item.description}</span><h4>{item.title}</h4></div>
                <StatusBadge status={item.state} />
              </div>
              <strong className="document-hub-number">{item.number ?? "Número pendiente"}</strong>
              {blocked ? <ul className="document-hub-blockers">{item.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <p className="document-hub-ready">{official ? "Documento oficial disponible" : "Sin bloqueos para esta etapa"}</p>}
              <div className="document-hub-actions">
                <button className="ghost-button" disabled={busy} onClick={() => onEdit(item.stage)} type="button">{item.canEdit ? "Editar" : "Ver"}</button>
                {item.scope ? <button className="primary-action" disabled={busy || blocked || official} onClick={() => onEmit(item.scope!)} title={blocked ? item.blockers[0] : undefined} type="button">{official ? "Autorizado" : "Emitir a RNDC"}</button> : null}
                {item.pdfHref ? <a className="ghost-button action-link" href={item.pdfHref}>PDF</a> : <span className="document-hub-no-pdf">PDF pendiente</span>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

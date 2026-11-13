import Link from "next/link";
import type { EmissionScope } from "../../../convex/model/dispatchWorkflow";
import type { DispatchStage } from "../../../convex/model/dispatchWorkflow";
import { moduleHref, type ModuleSlug } from "../../lib/module-links";
import { StatusBadge } from "../status-badge";
import { nextTripStep } from "./trip-documents";

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

const modules: Record<string, { slug: ModuleSlug; name: string } | undefined> = {
  order: { slug: "ordenes", name: "Órdenes de cargue" },
  consignments: { slug: "remesas", name: "Remesas" },
  manifest: { slug: "manifiestos", name: "Manifiestos" },
};

export function DocumentHub({ busy, items, expedienteId, remesaCount, canEdit, onOpenInline }: {
  busy: boolean;
  items: DocumentHubItem[];
  expedienteId: string;
  remesaCount: number;
  canEdit: boolean;
  onOpenInline: (stage: DispatchStage) => void;
}) {
  const next = nextTripStep(items, expedienteId, remesaCount);
  return (
    <section aria-label="Documentos del viaje" className="document-hub">
      <div className="section-heading trip-hub-heading">
        <div><h3>Documentos del viaje</h3><span>Cada documento se trabaja en su módulo; aquí ves cómo se relacionan.</span></div>
        {next && canEdit ? <Link className="primary-action action-link" href={next.href}>Sigue: {next.label}</Link> : next ? null : <span className="trip-hub-done">Viaje completo</span>}
      </div>
      <div className="document-hub-grid">
        {items.map((item) => {
          const official = item.state === "authorized" || item.state === "fulfilled";
          const module = modules[item.key];
          const exists = item.key === "consignments" ? remesaCount > 0 : Boolean(item.number);
          const target = { viaje: expedienteId };
          return (
            <article className="document-hub-card" key={item.key}>
              <div className="document-hub-card-heading">
                <div><span>{item.description}</span><h4>{item.title}</h4></div>
                <StatusBadge status={item.state} />
              </div>
              <strong className="document-hub-number">{item.number ?? (module ? "Sin crear" : "Pendiente")}</strong>
              {official ? <p className="document-hub-ready">{item.key === "fulfillment" ? "Cumplidos registrados" : "Autorizado por el RNDC"}</p> : item.blockers.length > 0 ? <ul className="document-hub-blockers">{item.blockers.slice(0, 3).map((blocker) => <li key={blocker}>{blocker}</li>)}{item.blockers.length > 3 ? <li>y {item.blockers.length - 3} más</li> : null}</ul> : <p className="document-hub-ready">Listo para continuar</p>}
              <div className="document-hub-actions">
                {module ? <>
                  {exists
                    ? <Link className="ghost-button action-link" href={moduleHref(module.slug, item.canEdit && canEdit ? "actualizar" : "listar", target)}>{item.canEdit && canEdit ? "Continuar" : "Abrir"}</Link>
                    : canEdit ? <Link className="ghost-button action-link" href={moduleHref(module.slug, "insertar", target)}>Crear</Link> : null}
                  {exists ? <Link className="ghost-button action-link" href={moduleHref(module.slug, "imprimir", target)}>{item.key === "manifest" && !official ? "Vista previa" : "Imprimir"}</Link> : null}
                </> : item.key === "fulfillment" && official
                  ? null
                  : <button className="ghost-button" disabled={busy || (item.key === "fulfillment" && !item.canEdit)} onClick={() => onOpenInline(item.stage)} title={item.blockers[0]} type="button">{item.key === "fulfillment" ? "Registrar cumplido" : item.canEdit ? "Cambiar" : "Ver"}</button>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

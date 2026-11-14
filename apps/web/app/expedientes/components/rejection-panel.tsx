import Link from "next/link";
import { moduleHref } from "../../lib/module-links";
import type { RejectedDocument } from "../../lib/rndc-rejection";

export function RejectionPanel({
  canEdit,
  expedienteId,
  linkToEditor,
  rejections
}: {
  canEdit: boolean;
  expedienteId: string;
  linkToEditor: boolean;
  rejections: RejectedDocument[];
}) {
  if (rejections.length === 0) return null;
  return (
    <div className="rejection-panel" role="alert">
      {rejections.map((rejection) => {
        const name = rejection.kind === "remesa" ? "la remesa" : "el manifiesto";
        return (
          <article key={rejection.documentId}>
            <div>
              <strong>El RNDC rechazó {name} {rejection.number ?? ""}{rejection.guide.code ? ` (${rejection.guide.code})` : ""}</strong>
              <p>{rejection.guide.message}</p>
              <p className="rejection-action">{rejection.editable ? rejection.guide.action : "El documento sigue en revisión: consulta el resultado oficial antes de reenviar, para no duplicarlo."}</p>
              {rejection.guide.message !== rejection.raw ? <small>Respuesta del RNDC: {rejection.raw}</small> : null}
            </div>
            {rejection.editable && canEdit && linkToEditor ? (
              <Link
                className="primary-action action-link"
                href={moduleHref(rejection.kind === "remesa" ? "remesas" : "manifiestos", "actualizar", { viaje: expedienteId, remesa: rejection.remesaId, doc: rejection.documentId })}
              >
                Corregir y reenviar
              </Link>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

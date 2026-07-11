type DocumentRow = { _id: string; kind: string; number?: string; rndcRadicado?: string; status: string; officialState?: string; fulfillmentState?: string; updatedAt: number };
type EventRow = { _id: string; title: string; details?: string; occurredAt: number };
type DeliveryRow = { _id: string; kind: string; capturedAt: number; artifact: { fileName: string; size: number } };

export function DocumentHistory({ deliveryEvidence, documents, events, technicalEvidence }: { deliveryEvidence: DeliveryRow[]; documents: DocumentRow[]; events: EventRow[]; technicalEvidence: Array<{ _id: string; fileName: string; createdAt: number }> }) {
  return (
    <section className="document-history" id="documentos-historial">
      <div className="section-heading"><div><span className="eyebrow">Siempre disponible</span><h3>Documentos e historial</h3></div><span>{documents.length} documentos</span></div>
      <div className="document-history-grid">
        <div>
          <h4>Documentos</h4>
          {documents.length === 0 ? <p className="inline-empty">Los documentos aparecerán a medida que avance el despacho.</p> : documents.map((document) => (
            <article className="history-document" key={document._id}>
              <span className="history-file-icon">DOC</span>
              <div><small>{document.kind.replaceAll("_", " ")}</small><strong>{document.number ?? "Número pendiente"}</strong><span>{document.rndcRadicado ? `Radicado ${document.rndcRadicado}` : "Sin radicado"}</span></div>
              <span className="document-state-text">{documentState(document)}</span>
            </article>
          ))}
          {deliveryEvidence.map((item) => <article className="history-document" key={item._id}><span className="history-file-icon">SOP</span><div><small>Soporte operativo</small><strong>{item.artifact.fileName}</strong><span>{formatDate(item.capturedAt)}</span></div></article>)}
        </div>
        <div>
          <h4>Historial de cambios</h4>
          <ol className="dispatch-timeline">
            {events.map((event) => <li key={event._id}><span /><div><strong>{event.title}</strong>{event.details ? <p>{event.details}</p> : null}<small>{formatDate(event.occurredAt)}</small></div></li>)}
          </ol>
        </div>
      </div>
      <details className="technical-evidence">
        <summary>Evidencia técnica RNDC <span>{technicalEvidence.length}</span></summary>
        <p>XML enmascarado, respuestas y archivos protegidos para soporte.</p>
        {technicalEvidence.map((item) => <div key={item._id}><strong>{item.fileName}</strong><span>{formatDate(item.createdAt)}</span></div>)}
      </details>
    </section>
  );
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function documentState(document: DocumentRow): string {
  if (document.fulfillmentState === "fulfilled") return "Cumplido";
  const state = document.officialState ?? document.status;
  const labels: Record<string, string> = {
    draft: "Borrador",
    pending: "Pendiente",
    sent: "Enviado",
    authorized: "Autorizado",
    rejected: "Rechazado",
    fulfilled: "Cumplido",
    annulled: "Anulado"
  };
  return labels[state] ?? state;
}

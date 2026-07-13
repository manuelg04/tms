"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { correctionDetailHref } from "../lib/document-workspace";
import { formatTimestamp, kindLabels, statusLabels } from "../lib/labels";

export default function CorrectionsPage() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const { results, status, loadMore } = usePaginatedQuery(
    api.dashboard.documentsPage,
    { search: deferredSearch || undefined },
    { initialNumItems: 25 }
  );

  return (
    <>
      <section className="corrections-workspace-hero">
        <div>
          <span className="eyebrow">Acciones oficiales protegidas</span>
          <h2>Resuelve excepciones sin perder el contexto del despacho</h2>
          <p>Encuentra el documento, revisa su historial y entra a una corrección, anulación o conciliación con todos los soportes a la vista.</p>
        </div>
        <div className="correction-safety-note"><strong>Nada se ejecuta desde este listado</strong><span>Cada acción abre una revisión, exige motivo y pide confirmación.</span></div>
      </section>

      <div className="filters correction-filters" role="search" aria-label="Buscar documentos para corrección">
        <input aria-label="Buscar documentos para corrección" onChange={(event) => setSearch(event.target.value)} placeholder="Número, radicado, despacho, placa o ruta" type="search" value={search} />
        {search ? <button className="text-button" onClick={() => setSearch("")} type="button">Limpiar búsqueda</button> : null}
      </div>

      <section className="panel corrections-workspace-list" aria-labelledby="corrections-list-title">
        <div className="section-heading"><div><span className="eyebrow">Documentos</span><h3 id="corrections-list-title">Disponibles para revisión</h3></div><span className="result-count">{results.length} visibles</span></div>
        {status === "LoadingFirstPage" ? <div className="skeleton">Buscando documentos…</div> : results.length === 0 ? <div className="empty-state">No hay documentos con esta búsqueda.</div> : (
          <div className="correction-document-list">
            {results.map((document) => {
              const canPrepareOfficialAction = document.status === "authorized" || document.status === "fulfilled";
              return <article className="correction-document-row" key={document._id}>
                <div className="correction-document-identity"><span>{kindLabels[document.kind] ?? document.kind}</span><strong>{document.number ?? document.trip?.code ?? "Sin número"}</strong><small>{document.rndcRadicado ? `Radicado ${document.rndcRadicado}` : "Sin radicado RNDC"}</small></div>
                <div className="correction-document-context"><span>{document.trip?.originCity ?? "Origen pendiente"} → {document.trip?.destinationCity ?? "Destino pendiente"}</span><small>{document.trip?.vehiclePlate ?? "Sin placa"} · {formatTimestamp(document.updatedAt)}</small></div>
                <span className={`badge ${document.status}`}>{statusLabels[document.status] ?? document.status}</span>
                {document.expedienteId ? (
                  <div className="correction-document-actions">
                    <Link className="ghost-button action-link" href={correctionDetailHref(document.expedienteId)}>Revisar acciones</Link>
                    {canPrepareOfficialAction && document.kind === "remesa" ? <Link className="text-button" href={correctionDetailHref(document.expedienteId, "correct")}>Preparar corrección</Link> : null}
                    {canPrepareOfficialAction ? <Link className="text-button danger-text" href={correctionDetailHref(document.expedienteId, "annul")}>Preparar anulación</Link> : null}
                  </div>
                ) : <span className="document-unlinked">Sin despacho relacionado</span>}
              </article>;
            })}
          </div>
        )}
      </section>

      {status === "CanLoadMore" || status === "LoadingMore" ? <button className="load-more" disabled={status === "LoadingMore"} onClick={() => loadMore(25)} type="button">{status === "LoadingMore" ? "Cargando…" : "Cargar 25 más"}</button> : null}
    </>
  );
}

"use client";

import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { DocumentTable } from "../components/document-table";
import { kindLabels, statusLabels } from "../lib/labels";

type KindFilter = "orden_cargue" | "remesa" | "manifiesto" | "cumplido" | "anulacion" | "";
type StatusFilter = "draft" | "pending" | "sent" | "authorized" | "rejected" | "fulfilled" | "annulled" | "";

export default function DocumentosPage() {
  const [kind, setKind] = useState<KindFilter>("");
  const [status, setStatus] = useState<StatusFilter>("");
  const { results, status: pageStatus, loadMore } = usePaginatedQuery(
    api.dashboard.documentsPage,
    {
      kind: kind === "" ? undefined : kind,
      status: status === "" ? undefined : status
    },
    { initialNumItems: 25 }
  );
  const filtered = kind !== "" || status !== "";

  return (
    <>
      <div className="filters" role="group" aria-label="Filtros de documentos">
        <select aria-label="Tipo de documento" onChange={(event) => setKind(event.target.value as KindFilter)} value={kind}>
          <option value="">Todos los tipos</option>
          {Object.entries(kindLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select aria-label="Estado" onChange={(event) => setStatus(event.target.value as StatusFilter)} value={status}>
          <option value="">Todos los estados</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <section className="panel" aria-label="Listado de documentos">
        {pageStatus === "LoadingFirstPage" ? (
          <div className="skeleton">Cargando documentos…</div>
        ) : (
          <DocumentTable emptyMessage={!filtered} rows={results} />
        )}
      </section>

      {pageStatus === "CanLoadMore" || pageStatus === "LoadingMore" ? (
        <button
          className="load-more"
          disabled={pageStatus === "LoadingMore"}
          onClick={() => loadMore(25)}
          type="button"
        >
          {pageStatus === "LoadingMore" ? "Cargando…" : "Cargar mas"}
        </button>
      ) : null}
    </>
  );
}

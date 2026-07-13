"use client";

import { useDeferredValue, useEffect, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { DocumentTable } from "../components/document-table";
import { kindLabels, statusLabels } from "../lib/labels";

type KindFilter = "orden_cargue" | "remesa" | "manifiesto" | "cumplido" | "anulacion" | "";
type StatusFilter = "draft" | "pending" | "sent" | "authorized" | "rejected" | "fulfilled" | "annulled" | "";

export default function DocumentosPage() {
  const [kind, setKind] = useState<KindFilter>("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const { results, status: pageStatus, loadMore } = usePaginatedQuery(
    api.dashboard.documentsPage,
    {
      kind: kind === "" ? undefined : kind,
      status: status === "" ? undefined : status,
      search: deferredSearch || undefined
    },
    { initialNumItems: 25 }
  );
  const filtered = kind !== "" || status !== "" || search.trim() !== "";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setKind((params.get("kind") ?? "") as KindFilter);
    setStatus((params.get("status") ?? "") as StatusFilter);
    setSearch(params.get("q") ?? "");
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim());
      if (kind) params.set("kind", kind);
      if (status) params.set("status", status);
      const query = params.toString();
      window.history.replaceState(null, "", query ? `/documentos?${query}` : "/documentos");
    }, 200);
    return () => window.clearTimeout(timer);
  }, [kind, search, status]);

  return (
    <>
      <div className="filters document-filters" role="search" aria-label="Filtros de documentos">
        <input aria-label="Buscar documentos" onChange={(event) => setSearch(event.target.value)} placeholder="Número, radicado, expediente, placa o ruta" type="search" value={search} />
        <select aria-label="Tipo de documento" onChange={(event) => setKind(event.target.value as KindFilter)} value={kind}>
          <option value="">Todos los tipos</option>
          {Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select aria-label="Estado" onChange={(event) => setStatus(event.target.value as StatusFilter)} value={status}>
          <option value="">Todos los estados</option>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {filtered ? <button className="text-button" onClick={() => { setKind(""); setStatus(""); setSearch(""); }} type="button">Limpiar filtros</button> : null}
      </div>

      <section className="panel" aria-label="Listado de documentos">
        {pageStatus === "LoadingFirstPage" ? <div className="skeleton">Cargando documentos…</div> : <DocumentTable emptyMessage={!filtered} rows={results} />}
      </section>

      {pageStatus === "CanLoadMore" || pageStatus === "LoadingMore" ? (
        <button className="load-more" disabled={pageStatus === "LoadingMore"} onClick={() => loadMore(25)} type="button">
          {pageStatus === "LoadingMore" ? "Cargando…" : results.length === 0 ? "Buscar en la siguiente página" : "Cargar 25 más"}
        </button>
      ) : null}
    </>
  );
}

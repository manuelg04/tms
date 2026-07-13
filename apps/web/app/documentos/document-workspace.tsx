"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { DocumentTable } from "../components/document-table";
import type { DocumentSection } from "../lib/document-workspace";
import { documentSections } from "../lib/document-workspace";
import { statusLabels } from "../lib/labels";

type StatusFilter = "draft" | "pending" | "sent" | "authorized" | "rejected" | "fulfilled" | "annulled" | "";

export function DocumentWorkspace({ section }: { section: DocumentSection }) {
  const [status, setStatus] = useState<StatusFilter>("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const { results, status: pageStatus, loadMore } = usePaginatedQuery(
    api.dashboard.documentsPage,
    {
      kind: section.kind,
      status: status === "" ? undefined : status,
      search: deferredSearch || undefined
    },
    { initialNumItems: 25 }
  );
  const filtered = status !== "" || search.trim() !== "";
  const sectionPath = section.slug === "todos" ? "/documentos" : `/documentos/${section.slug}`;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setStatus((params.get("status") ?? "") as StatusFilter);
    setSearch(params.get("q") ?? "");
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim());
      if (status) params.set("status", status);
      const query = params.toString();
      window.history.replaceState(null, "", query ? `${sectionPath}?${query}` : sectionPath);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [search, sectionPath, status]);

  return (
    <>
      <section className="document-workspace-hero">
        <div>
          <span className="eyebrow">Trabajo por documento</span>
          <h2>{section.label}</h2>
          <p>{section.description}</p>
        </div>
        <Link className="primary-action action-link" href="/expedientes/nuevo">Nueva orden de cargue</Link>
      </section>

      <nav className="document-section-tabs" aria-label="Tipos de documento">
        {documentSections.map((item) => (
          <Link
            aria-current={item.slug === section.slug ? "page" : undefined}
            className={item.slug === section.slug ? "active" : ""}
            href={item.slug === "todos" ? "/documentos" : `/documentos/${item.slug}`}
            key={item.slug}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="filters document-filters" role="search" aria-label={`Filtros de ${section.label.toLocaleLowerCase("es")}`}>
        <input aria-label={`Buscar en ${section.label}`} onChange={(event) => setSearch(event.target.value)} placeholder="Número, radicado, despacho, placa o ruta" type="search" value={search} />
        <select aria-label="Estado" onChange={(event) => setStatus(event.target.value as StatusFilter)} value={status}>
          <option value="">Todos los estados</option>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {filtered ? <button className="text-button" onClick={() => { setStatus(""); setSearch(""); }} type="button">Limpiar filtros</button> : null}
      </div>

      <section className="panel document-workspace-list" aria-label={`Listado de ${section.label.toLocaleLowerCase("es")}`}>
        {pageStatus === "LoadingFirstPage" ? <div className="skeleton">Cargando {section.label.toLocaleLowerCase("es")}…</div> : <DocumentTable emptyMessage={!filtered} rows={results} section={section} />}
      </section>

      {pageStatus === "CanLoadMore" || pageStatus === "LoadingMore" ? (
        <button className="load-more" disabled={pageStatus === "LoadingMore"} onClick={() => loadMore(25)} type="button">
          {pageStatus === "LoadingMore" ? "Cargando…" : results.length === 0 ? "Buscar en la siguiente página" : "Cargar 25 más"}
        </button>
      ) : null}
    </>
  );
}

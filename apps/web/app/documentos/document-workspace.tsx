"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePaginatedQuery, useQuery } from "../lib/convex-hooks";
import { fulfillmentHref } from "../lib/module-links";
import { useDemoUser } from "../providers";
import { api } from "../../convex/_generated/api";
import { DocumentTable } from "../components/document-table";
import type { DocumentSection } from "../lib/document-workspace";
import { documentSections } from "../lib/document-workspace";
import { statusLabels } from "../lib/labels";
import { isEmptyText, useDebounced } from "../lib/hooks";
import { Skeleton } from "../components/skeleton";
import "./document-registry.css";

type StatusFilter = "draft" | "pending" | "sent" | "authorized" | "rejected" | "fulfilled" | "annulled" | "";

export function DocumentWorkspace({ section }: { section: DocumentSection }) {
  const [status, setStatus] = useState<StatusFilter>("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDebounced(search.trim(), 250, isEmptyText);
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
      const target = query ? `${sectionPath}?${query}` : sectionPath;
      if (`${window.location.pathname}${window.location.search}` !== target) window.history.replaceState(null, "", target);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [search, sectionPath, status]);

  return (
    <>
      {section.slug === "cumplidos" ? <PendingFulfillments /> : (
        <section className="document-workspace-hero">
          <div>
            <span className="eyebrow">Consulta</span>
            <h2>{section.label}</h2>
            <p>{section.description}</p>
          </div>
          <Link className="primary-action action-link" href="/documentos/ordenes/insertar">Nueva orden de cargue</Link>
        </section>
      )}

      {section.slug === "cumplidos" ? <h3 className="fulfillment-history-title">Cumplidos registrados</h3> : null}

      <div className="filters document-filters" role="search" aria-label={`Filtros de ${section.label.toLocaleLowerCase("es")}`}>
        <input aria-label={`Buscar en ${section.label}`} onChange={(event) => setSearch(event.target.value)} placeholder="Número, radicado, despacho, placa o ruta" type="search" value={search} />
        <select aria-label="Estado" onChange={(event) => setStatus(event.target.value as StatusFilter)} value={status}>
          <option value="">Todos los estados</option>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {filtered ? <button className="text-button" onClick={() => { setStatus(""); setSearch(""); }} type="button">Limpiar filtros</button> : null}
      </div>

      <section className="panel document-workspace-list" aria-label={`Listado de ${section.label.toLocaleLowerCase("es")}`}>
        {pageStatus === "LoadingFirstPage" ? <Skeleton label={`Cargando ${section.label.toLocaleLowerCase("es")}`} /> : <DocumentTable emptyMessage={!filtered} rows={results} section={section} />}
      </section>

      {pageStatus === "CanLoadMore" || pageStatus === "LoadingMore" ? (
        <button className="load-more" disabled={pageStatus === "LoadingMore"} onClick={() => loadMore(25)} type="button">
          {pageStatus === "LoadingMore" ? "Cargando…" : results.length === 0 ? "Buscar en la siguiente página" : "Cargar 25 más"}
        </button>
      ) : null}
    </>
  );
}

function PendingFulfillments() {
  const { user } = useDemoUser();
  const pending = useQuery(api.documentRegistry.list, user ? { kind: "manifiesto", filters: { status: "authorized" }, page: 1, pageSize: 50 } : "skip");
  return (
    <section className="fulfillment-queue" aria-label="Manifiestos por cumplir">
      <header className="module-heading">
        <div className="module-heading-top">
          <div>
            <h2>Cumplidos</h2>
            <p>Aquí cierras el viaje cuando la carga se entrega: primero la remesa y luego el manifiesto. <strong>Terminas cuando el manifiesto pasa a Cumplido y sale de esta lista.</strong></p>
          </div>
        </div>
      </header>
      <div className="panel">
        <div className="panel-head"><h2>Manifiestos por cumplir</h2><span>{pending ? `${pending.total} pendientes` : ""}</span></div>
        {pending === undefined ? <Skeleton label="Cargando manifiestos por cumplir" /> : pending.rows.length === 0 ? (
          <div className="empty-state">No hay manifiestos autorizados esperando cumplido.</div>
        ) : (
          <div className="table-wrap">
            <table className="doc-table">
              <thead><tr><th>Manifiesto</th><th>Fecha</th><th>Placa</th><th>Cliente</th><th>Ruta</th><th aria-label="Acción" /></tr></thead>
              <tbody>
                {pending.rows.map((row) => (
                  <tr key={row.key}>
                    <td><div className="doc-kind">Manifiesto<small>{row.number || "—"}</small></div></td>
                    <td>{row.date || "—"}</td>
                    <td>{row.plate ? <span className="plate-chip">{row.plate}</span> : "—"}</td>
                    <td>{row.customer || "—"}</td>
                    <td><span className="route"><b>{row.origin || "?"}</b><span className="arrow">→</span><b>{row.destination || "?"}</b></span></td>
                    <td>{row.expedienteId ? <Link className="primary-action action-link" href={fulfillmentHref(row.expedienteId)}>Registrar cumplido</Link> : <span className="document-unlinked">Sin viaje</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

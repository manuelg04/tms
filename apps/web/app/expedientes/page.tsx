"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  dispatchFiltersFromSearchParams,
  dispatchFiltersToSearchParams,
  normalizeDispatchFilters,
  type DispatchFilters,
  type DispatchFilterKey
} from "../../convex/model/dispatchSearch";
import { guidedDispatchStages } from "../../convex/model/dispatchPresentation";
import { StatusBadge } from "./status-badge";

const stageOptions = [
  { value: "", label: "Todas las etapas" },
  ...guidedDispatchStages.map((stage) => ({ value: stage.key, label: stage.label })),
  { value: "pending_manifest", label: "Pendiente de manifiesto" },
  { value: "cumplido", label: "Cumplido" },
  { value: "anulado", label: "Anulado" }
];

const emptyFilters: DispatchFilters = {};

export default function DespachosPage() {
  const [filters, setFilters] = useState<DispatchFilters>(emptyFilters);
  const normalizedFilters = useMemo(() => normalizeDispatchFilters(filters), [filters]);
  const deferredFilters = useDeferredValue(normalizedFilters);
  const { results, status: pageStatus, loadMore } = usePaginatedQuery(
    api.dispatchSearch.page,
    { filters: deferredFilters },
    { initialNumItems: 25 }
  );

  useEffect(() => {
    setFilters(dispatchFiltersFromSearchParams(new URLSearchParams(window.location.search)));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = dispatchFiltersToSearchParams(filters);
      const query = params.toString();
      window.history.replaceState(null, "", query ? `/expedientes?${query}` : "/expedientes");
    }, 200);
    return () => window.clearTimeout(timer);
  }, [filters]);

  const exportQuery = useMemo(() => dispatchFiltersToSearchParams(normalizedFilters), [normalizedFilters]);
  const attention = results.filter((row) => row.rndcStatus === "Requiere atención" || row.rndcStatus === "Resultado incierto").length;
  const ready = results.filter((row) => row.stage === "envio_rndc").length;
  const inOperation = results.filter((row) => ["cargue_descargue", "cumplido_inicial", "cumplido_final"].includes(row.stage)).length;
  const hasFilters = Object.keys(normalizedFilters).length > 0;

  const updateFilter = (key: DispatchFilterKey, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const exportHref = (kind: string) => {
    const params = new URLSearchParams(exportQuery);
    params.set("kind", kind);
    return `/api/exports/dispatches?${params.toString()}`;
  };

  return (
    <>
      <section className="dispatch-queue-intro">
        <div>
          <span className="eyebrow">Cola de trabajo</span>
          <h2>Lo que necesita atención, en orden</h2>
          <p>La búsqueda, los filtros y las exportaciones consultan el historial completo sin cargarlo en el navegador.</p>
        </div>
        <div className="queue-header-actions">
          <details className="export-menu">
            <summary>Exportar Excel</summary>
            <div>
              <a href={exportHref("dispatches")}>Resumen de despachos</a>
              <a href={exportHref("orders")}>Órdenes de cargue</a>
              <a href={exportHref("consignments")}>Remesas</a>
              <a href={exportHref("manifests")}>Manifiestos</a>
            </div>
          </details>
          <Link className="primary-action action-link" href="/expedientes/nuevo">Nuevo despacho</Link>
        </div>
      </section>

      <section className="queue-metrics" aria-label="Resumen de la página visible">
        <QueueMetric label="Requieren atención" value={attention} tone={attention > 0 ? "bad" : "neutral"} />
        <QueueMetric label="Listos para enviar" value={ready} tone="wait" />
        <QueueMetric label="En operación" value={inOperation} tone="ok" />
        <QueueMetric label="Cargados en esta vista" value={results.length} tone="neutral" />
      </section>

      <section className="panel dispatch-queue-panel" aria-label="Cola de despachos">
        <div className="dispatch-filter-bar" role="search">
          <label className="filter-search">
            <span className="sr-only">Buscar despachos</span>
            <SearchIcon />
            <input
              onChange={(event) => updateFilter("search", event.target.value)}
              placeholder="Expediente, documento o ruta"
              type="search"
              value={filters.search ?? ""}
            />
          </label>
          <FilterInput label="Cliente" onChange={(value) => updateFilter("customer", value)} value={filters.customer} />
          <FilterInput label="Placa" onChange={(value) => updateFilter("plate", value)} value={filters.plate} />
          <FilterInput label="Conductor" onChange={(value) => updateFilter("driver", value)} value={filters.driver} />
          <FilterInput label="Origen" onChange={(value) => updateFilter("origin", value)} value={filters.origin} />
          <FilterInput label="Destino" onChange={(value) => updateFilter("destination", value)} value={filters.destination} />
          <label>
            <span className="sr-only">Filtrar por etapa</span>
            <select onChange={(event) => updateFilter("stage", event.target.value)} value={filters.stage ?? ""}>
              {stageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Filtrar por estado RNDC</span>
            <select onChange={(event) => updateFilter("status", event.target.value)} value={filters.status ?? ""}>
              <option value="">Todos los estados RNDC</option>
              <option value="Pendiente">Pendiente</option>
              <option value="En proceso">En proceso</option>
              <option value="Autorizado">Autorizado</option>
              <option value="Requiere atención">Requiere atención</option>
              <option value="Resultado incierto">Resultado incierto</option>
            </select>
          </label>
          <label className="date-filter"><span>Desde</span><input onChange={(event) => updateFilter("from", event.target.value)} type="date" value={filters.from ?? ""} /></label>
          <label className="date-filter"><span>Hasta</span><input onChange={(event) => updateFilter("to", event.target.value)} type="date" value={filters.to ?? ""} /></label>
          {hasFilters ? <button className="text-button" onClick={() => setFilters(emptyFilters)} type="button">Limpiar filtros</button> : null}
        </div>

        {pageStatus === "LoadingFirstPage" ? (
          <div className="skeleton">Organizando la cola de trabajo…</div>
        ) : results.length === 0 ? (
          <div className="expediente-empty">
            <strong>No hay despachos en esta página</strong>
            <p>{hasFilters ? "Ajusta los filtros o continúa buscando en el historial." : "Crea un nuevo despacho para comenzar."}</p>
            {pageStatus === "CanLoadMore" ? <button className="load-more" onClick={() => loadMore(25)} type="button">Buscar en la siguiente página</button> : <Link className="primary-action action-link" href="/expedientes/nuevo">Crear despacho</Link>}
          </div>
        ) : (
          <div className="dispatch-queue-list">
            {results.map((row) => (
              <article className={row.rndcStatus === "Requiere atención" || row.rndcStatus === "Resultado incierto" ? "dispatch-row attention" : "dispatch-row"} key={row.expediente._id}>
                <div className="dispatch-identity">
                  <div className="dispatch-code-line">
                    <Link href={`/expedientes/${row.expediente._id}`}>{row.expediente.code}</Link>
                    <StatusBadge status={row.expediente.status} />
                  </div>
                  <strong>{row.customerName}</strong>
                  <span>{row.originCity} <RouteArrow /> {row.destinationCity}</span>
                </div>
                <div className="dispatch-documents">
                  <DocumentProgress code="O" label="Orden" number={row.orderNumber} state={row.orderState ?? "draft"} />
                  <DocumentProgress code="R" label="Remesas" number={row.remesaNumbers.length > 0 ? row.remesaNumbers.join(", ") : undefined} state={aggregateState(row.remesaStates ?? [])} />
                  <DocumentProgress code="M" label="Manifiesto" number={row.manifestNumber} state={row.manifestState ?? "draft"} />
                </div>
                <div className="dispatch-assignment">
                  <QueueValue label="Vehículo" value={row.vehiclePlate ?? "Sin asignar"} />
                  <QueueValue label="Conductor" value={row.driverName ?? "Sin asignar"} />
                  <QueueValue label="Agencia" value={row.agencyCode || "Principal"} />
                </div>
                <div className="dispatch-progress">
                  <span className={`rndc-state ${statusClass(row.rndcStatus)}`}><StateIcon status={row.rndcStatus} />{row.rndcStatus}</span>
                  <strong>{stageLabel(row.stage)}</strong>
                  {row.blockers[0] ? <small>{row.blockers[0]}</small> : <small>Sin bloqueos pendientes</small>}
                </div>
                <Link className="queue-next-action" href={`/expedientes/${row.expediente._id}`}><span>{row.nextAction}</span><RouteArrow /></Link>
              </article>
            ))}
          </div>
        )}
      </section>

      {pageStatus === "CanLoadMore" || pageStatus === "LoadingMore" ? (
        <button className="load-more" disabled={pageStatus === "LoadingMore"} onClick={() => loadMore(25)} type="button">
          {pageStatus === "LoadingMore" ? "Cargando…" : "Cargar 25 más"}
        </button>
      ) : null}
    </>
  );
}

function FilterInput({ label, onChange, value }: { label: string; onChange: (value: string) => void; value?: string }) {
  return <label className="compact-filter"><span className="sr-only">{label}</span><input onChange={(event) => onChange(event.target.value)} placeholder={label} value={value ?? ""} /></label>;
}

function QueueMetric({ label, tone, value }: { label: string; tone: "bad" | "wait" | "ok" | "neutral"; value: number }) {
  return <div className={`queue-metric ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function QueueValue({ label, value }: { label: string; value: string }) {
  return <div className="queue-value"><span>{label}</span><strong>{value}</strong></div>;
}

function DocumentProgress({ code, label, number, state }: { code: string; label: string; number?: string; state: string }) {
  return <div className={`document-progress-chip ${documentStateClass(state)}`} title={`${label}: ${documentStateLabel(state)}`}><span>{code}</span><strong>{number ?? "—"}</strong><small>{documentStateLabel(state)}</small></div>;
}

function aggregateState(states: string[]): string {
  if (states.length === 0) return "draft";
  if (states.every((state) => state === "fulfilled")) return "fulfilled";
  if (states.every((state) => state === "authorized" || state === "fulfilled")) return "authorized";
  if (states.some((state) => state === "pending")) return "pending";
  if (states.some((state) => state === "annulled")) return "annulled";
  return "draft";
}

function documentStateClass(state: string): string {
  if (state === "authorized" || state === "fulfilled") return "ok";
  if (state === "pending") return "wait";
  if (state === "annulled") return "bad";
  return "neutral";
}

function documentStateLabel(state: string): string {
  const labels: Record<string, string> = { authorized: "Autorizado", fulfilled: "Cumplido", pending: "Pendiente", annulled: "Anulado", draft: "Borrador" };
  return labels[state] ?? state;
}

function stageLabel(stage: string): string {
  return stageOptions.find((option) => option.value === stage)?.label ?? stage;
}

function statusClass(status: string): string {
  if (status === "Autorizado") return "ok";
  if (status === "Requiere atención") return "bad";
  if (status === "Resultado incierto" || status === "En proceso") return "wait";
  return "neutral";
}

function SearchIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden><circle cx="8.5" cy="8.5" r="5" /><path d="m12.2 12.2 4 4" strokeLinecap="round" /></svg>;
}

function RouteArrow() {
  return <svg className="route-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M2.5 8h10M9 4.5 12.5 8 9 11.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function StateIcon({ status }: { status: string }) {
  if (status === "Autorizado") return <span aria-hidden>✓</span>;
  if (status === "Requiere atención") return <span aria-hidden>!</span>;
  if (status === "Resultado incierto") return <span aria-hidden>?</span>;
  return <span aria-hidden>•</span>;
}

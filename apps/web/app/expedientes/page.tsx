"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  dispatchFiltersFromSearchParams,
  dispatchFiltersToSearchParams,
  normalizeDispatchFilters,
  type DispatchFilters,
  type DispatchFilterKey
} from "../../convex/model/dispatchSearch";
import { guidedDispatchStages } from "../../convex/model/dispatchPresentation";

const PAGE_SIZE = 40;

const stageOptions = [
  { value: "", label: "Todas las etapas" },
  ...guidedDispatchStages.map((stage) => ({ value: stage.key, label: stage.label })),
  { value: "pending_manifest", label: "Pendiente de manifiesto" },
  { value: "cumplido", label: "Cumplido" },
  { value: "anulado", label: "Anulado" }
];

const stateTabs: Array<{ value: string; label: string; always?: boolean }> = [
  { value: "", label: "Todos", always: true },
  { value: "draft", label: "Borradores", always: true },
  { value: "ready", label: "Por enviar" },
  { value: "in_progress", label: "En proceso", always: true },
  { value: "completed", label: "Cerrados", always: true },
  { value: "cancelled", label: "Anulados" }
];

type Row = {
  expediente: { _id: string; code: string; status: string; updatedAt: number };
  serviceOrderCode: string;
  customerName: string;
  originCity: string;
  destinationCity: string;
  orderNumber?: string;
  remesaNumbers: string[];
  manifestNumber?: string;
  vehiclePlate?: string;
  driverName?: string;
  stage: string;
  blockers: string[];
  rndcStatus: string;
  nextAction: string;
  openNoveltyCount: number;
};

type RowState = { label: string; tone: "bad" | "wait" | "ok" | "done" | "muted"; detail?: string };

const emptyFilters: DispatchFilters = {};
const shortDate = new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short" });
const shortTime = new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit", hour12: false });

export default function DespachosPage() {
  const [filters, setFilters] = useState<DispatchFilters>(emptyFilters);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const normalizedFilters = useMemo(() => normalizeDispatchFilters(filters), [filters]);
  const deferredFilters = useDeferredValue(normalizedFilters);
  const counts = useQuery(api.dispatchSearch.counts, {});
  const { results, status: pageStatus, loadMore } = usePaginatedQuery(
    api.dispatchSearch.page,
    { filters: deferredFilters },
    { initialNumItems: PAGE_SIZE }
  );
  const rows = results as unknown as Row[];

  useEffect(() => {
    const initial = dispatchFiltersFromSearchParams(new URLSearchParams(window.location.search));
    setFilters(initial);
    if (hasAdvancedFilters(initial)) setAdvancedOpen(true);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const query = dispatchFiltersToSearchParams(filters).toString();
      window.history.replaceState(null, "", query ? `/expedientes?${query}` : "/expedientes");
    }, 200);
    return () => window.clearTimeout(timer);
  }, [filters]);

  const exportQuery = useMemo(() => dispatchFiltersToSearchParams(normalizedFilters), [normalizedFilters]);
  const advancedActive = hasAdvancedFilters(normalizedFilters);
  const hasFilters = Object.keys(normalizedFilters).length > 0;
  const updateFilter = (key: DispatchFilterKey, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const exportHref = (kind: string) => {
    const params = new URLSearchParams(exportQuery);
    params.set("kind", kind);
    return `/api/exports/dispatches?${params.toString()}`;
  };
  const totalAll = counts ? counts.draft + counts.ready + counts.in_progress + counts.completed + counts.cancelled : undefined;
  const countFor = (value: string) => (value === "" ? totalAll : counts?.[value as keyof typeof counts]) as number | undefined;

  return (
    <>
      <section className="dispatch-list-head">
        <div>
          <span className="eyebrow">Despachos</span>
          <h2>Listado de despachos</h2>
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

      <section className="panel dispatch-list-panel" aria-label="Listado de despachos">
        <div className="dispatch-toolbar">
          <div className="state-tabs" role="tablist" aria-label="Filtrar por estado del despacho">
            {stateTabs.filter((tab) => tab.always || (countFor(tab.value) ?? 0) > 0).map((tab) => (
              <button
                aria-selected={(filters.state ?? "") === tab.value}
                className={(filters.state ?? "") === tab.value ? "state-tab active" : "state-tab"}
                key={tab.value || "all"}
                onClick={() => updateFilter("state", tab.value)}
                role="tab"
                type="button"
              >
                {tab.label}
                {countFor(tab.value) !== undefined ? <span className="state-count">{formatCount(countFor(tab.value)!, counts?.capped)}</span> : null}
              </button>
            ))}
          </div>
          <div className="dispatch-toolbar-right">
            <label className="filter-search">
              <span className="sr-only">Buscar despachos</span>
              <SearchIcon />
              <input
                onChange={(event) => updateFilter("search", event.target.value)}
                placeholder="Buscar por despacho, placa, cliente o manifiesto"
                type="search"
                value={filters.search ?? ""}
              />
            </label>
            <button aria-expanded={advancedOpen} className={advancedActive ? "ghost-button filters-toggle active" : "ghost-button filters-toggle"} onClick={() => setAdvancedOpen((open) => !open)} type="button">
              {advancedOpen ? "Menos filtros" : advancedActive ? "Más filtros ●" : "Más filtros"}
            </button>
          </div>
        </div>

        {advancedOpen ? (
          <div className="dispatch-advanced-filters" role="search">
            <FilterInput label="Cliente" onChange={(value) => updateFilter("customer", value)} value={filters.customer} />
            <FilterInput label="Placa" onChange={(value) => updateFilter("plate", value)} value={filters.plate} />
            <FilterInput label="Conductor" onChange={(value) => updateFilter("driver", value)} value={filters.driver} />
            <FilterInput label="Origen" onChange={(value) => updateFilter("origin", value)} value={filters.origin} />
            <FilterInput label="Destino" onChange={(value) => updateFilter("destination", value)} value={filters.destination} />
            <label>
              <span>Etapa</span>
              <select aria-label="Filtrar por etapa" onChange={(event) => updateFilter("stage", event.target.value)} value={filters.stage ?? ""}>
                {stageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <span>Estado RNDC</span>
              <select aria-label="Filtrar por estado RNDC" onChange={(event) => updateFilter("status", event.target.value)} value={filters.status ?? ""}>
                <option value="">Todos</option>
                <option value="Pendiente">Pendiente</option>
                <option value="En proceso">En proceso</option>
                <option value="Autorizado">Autorizado</option>
                <option value="Requiere atención">Requiere atención</option>
                <option value="Resultado incierto">Resultado incierto</option>
              </select>
            </label>
            <label><span>Desde</span><input onChange={(event) => updateFilter("from", event.target.value)} type="date" value={filters.from ?? ""} /></label>
            <label><span>Hasta</span><input onChange={(event) => updateFilter("to", event.target.value)} type="date" value={filters.to ?? ""} /></label>
            {hasFilters ? <button className="text-button" onClick={() => setFilters(emptyFilters)} type="button">Limpiar filtros</button> : null}
          </div>
        ) : null}

        {pageStatus === "LoadingFirstPage" ? (
          <div className="skeleton">Cargando despachos…</div>
        ) : rows.length === 0 ? (
          <div className="expediente-empty">
            <strong>No hay despachos {hasFilters ? "con estos filtros" : "todavía"}</strong>
            <p>{hasFilters ? "Ajusta la búsqueda o revisa la siguiente página del historial." : "Crea un nuevo despacho para comenzar."}</p>
            {pageStatus === "CanLoadMore" ? <button className="load-more" onClick={() => loadMore(PAGE_SIZE)} type="button">Buscar en la siguiente página</button> : <Link className="primary-action action-link" href="/expedientes/nuevo">Crear despacho</Link>}
          </div>
        ) : (
          <div className="table-wrap dispatch-table-wrap">
            <table className="dispatch-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Despacho</th>
                  <th>Cliente</th>
                  <th>Ruta</th>
                  <th>Placa · Conductor</th>
                  <th>Estado</th>
                  <th>Documentos</th>
                  <th><span className="sr-only">Siguiente paso</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const state = rowState(row);
                  return (
                    <tr className={`dispatch-row tone-${state.tone}`} key={row.expediente._id}>
                      <td className="cell-date"><span>{shortDate.format(new Date(row.expediente.updatedAt))}</span><small>{shortTime.format(new Date(row.expediente.updatedAt))}</small></td>
                      <td className="cell-code"><Link href={`/expedientes/${row.expediente._id}`}>{row.expediente.code}</Link><small>{row.serviceOrderCode}</small></td>
                      <td className="cell-customer">{row.customerName}</td>
                      <td className="cell-route">{row.originCity} <span aria-hidden>→</span> {row.destinationCity}</td>
                      <td className="cell-fleet">{row.vehiclePlate ? <><span className="plate-chip">{row.vehiclePlate}</span><small>{row.driverName ?? "Sin conductor"}</small></> : <small className="muted">Sin asignar</small>}</td>
                      <td className="cell-state"><span className={`rndc-state state-${state.tone}`}><i aria-hidden />{state.label}</span>{state.detail ? <small>{state.detail}</small> : null}</td>
                      <td className="cell-docs">{documentNumbers(row)}</td>
                      <td className="cell-action"><Link aria-label={row.nextAction} className="queue-next-action" href={`/expedientes/${row.expediente._id}`} title={row.nextAction}>→</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {pageStatus !== "LoadingFirstPage" && rows.length > 0 ? (
          <div className="load-more-bar dispatch-load-more">
            <span className="load-more-count">{rows.length} {rows.length === 1 ? "despacho" : "despachos"}{pageStatus === "Exhausted" ? "" : " cargados"}</span>
            {pageStatus === "CanLoadMore" || pageStatus === "LoadingMore" ? (
              <button className="load-more" disabled={pageStatus === "LoadingMore"} onClick={() => loadMore(PAGE_SIZE)} type="button">{pageStatus === "LoadingMore" ? "Cargando…" : `Cargar ${PAGE_SIZE} más`}</button>
            ) : null}
          </div>
        ) : null}
      </section>
    </>
  );
}

function hasAdvancedFilters(filters: DispatchFilters): boolean {
  return (["customer", "plate", "driver", "origin", "destination", "stage", "status", "from", "to"] as DispatchFilterKey[]).some((key) => Boolean(filters[key]));
}

function formatCount(value: number, capped?: boolean): string {
  return capped && value >= 1000 ? "1000+" : String(value);
}

function stageShortLabel(stage: string): string {
  return guidedDispatchStages.find((entry) => entry.key === stage)?.label ?? stage;
}

function rowState(row: Row): RowState {
  if (row.expediente.status === "cancelled") return { label: "Anulado", tone: "muted" };
  if (row.rndcStatus === "Requiere atención" || row.rndcStatus === "Resultado incierto") return { label: "Requiere atención", tone: "bad", detail: row.blockers[0] ?? row.rndcStatus };
  if (row.openNoveltyCount > 0) return { label: "Con novedad", tone: "bad", detail: `${row.openNoveltyCount} ${row.openNoveltyCount === 1 ? "novedad abierta" : "novedades abiertas"}` };
  if (row.expediente.status === "completed" || row.stage === "cumplido_final" && row.blockers.length === 0) return { label: "Cerrado", tone: "done" };
  if (row.rndcStatus === "En proceso") return { label: "Enviando a RNDC", tone: "wait" };
  if (row.stage === "envio_rndc") return { label: "Por enviar", tone: "wait", detail: row.blockers[0] };
  if (["cumplido_inicial", "cumplido_final"].includes(row.stage)) return { label: "En ruta", tone: "ok", detail: stageShortLabel(row.stage) };
  if (row.expediente.status === "in_progress") return { label: "Documentos en curso", tone: "wait", detail: `Falta: ${stageShortLabel(row.stage).toLocaleLowerCase("es")}` };
  return { label: "Borrador", tone: "muted", detail: `Falta: ${stageShortLabel(row.stage).toLocaleLowerCase("es")}` };
}

function documentNumbers(row: Row) {
  const remesa = row.remesaNumbers.length > 1 ? `${row.remesaNumbers[0]} +${row.remesaNumbers.length - 1}` : row.remesaNumbers[0];
  if (row.manifestNumber) {
    return <><span className="doc-main" title="Manifiesto">M {row.manifestNumber}</span><small>{[row.orderNumber ? `O ${row.orderNumber}` : null, remesa ? `R ${remesa}` : null].filter(Boolean).join(" · ")}</small></>;
  }
  if (row.orderNumber || remesa) {
    return <><span className="doc-main" title="Orden de cargue / remesa">{row.orderNumber ? `O ${row.orderNumber}` : `R ${remesa}`}</span>{row.orderNumber && remesa ? <small>R {remesa}</small> : <small className="muted">Sin manifiesto</small>}</>;
  }
  return <small className="muted">Sin números aún</small>;
}

function FilterInput({ label, onChange, value }: { label: string; onChange: (value: string) => void; value?: string }) {
  return <label><span>{label}</span><input onChange={(event) => onChange(event.target.value)} type="search" value={value ?? ""} /></label>;
}

function SearchIcon() {
  return <svg aria-hidden fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
}

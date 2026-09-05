"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import {
  cellValue,
  filterTracking,
  queueColumns,
  readableColor,
  sortTracking,
  trackingColumns,
  type TrackingColumn,
  type TrackingDispatch,
  type TrackingFilters,
  type TrackingSort,
} from "../../../convex/model/tracking";
import { downloadTrackingExcel } from "../components/tracking-excel";

export default function TrackingPage() {
  const { isAuthenticated } = useConvexAuth();
  const data = useQuery(api.tracking.board, isAuthenticated ? {} : "skip");
  const [filters, setFilters] = useState<TrackingFilters>({});
  const [expanded, setExpanded] = useState(false);
  const filtered = useMemo(
    () => filterTracking(data?.rows ?? [], filters),
    [data?.rows, filters],
  );
  if (!data)
    return (
      <div className="skeleton" role="status">
        Cargando seguimiento…
      </div>
    );
  const enRoute = filtered.filter((r) => r.queue === "en_route"),
    pending = filtered.filter((r) => r.queue === "pending_arrival");
  return (
    <div className="tracking-workspace">
      <div className="tracking-heading">
        <div>
          <span className="eyebrow">Control de tráfico</span>
          <h2>Seguimiento</h2>
          <p>Despachos en ruta y pendientes por llegada</p>
        </div>
        <Link
          className="ghost-button action-link"
          href="/configuracion/alertas-visuales"
        >
          Alertas visuales
        </Link>
      </div>
      <section
        className="panel tracking-filters"
        aria-label="Filtros de búsqueda"
      >
        <div className="tracking-section-title">
          <h3>Filtros de búsqueda</h3>
          <button
            className="text-button"
            type="button"
            onClick={() => setFilters({})}
          >
            Limpiar filtros
          </button>
        </div>
        <div className="tracking-filter-grid">
          {trackingColumns
            .filter((c) => c.filter)
            .map((c) => (
              <label key={c.key}>
                <span>{c.label}</span>
                <input
                  type="text"
                  value={filters[c.key] ?? ""}
                  onChange={(e) =>
                    setFilters((current) => ({
                      ...current,
                      [c.key]: e.target.value,
                    }))
                  }
                />
              </label>
            ))}
        </div>
      </section>
      <div className="tracking-overview">
        <p>
          <strong>{filtered.length}</strong> despachos{" "}
          <span>· {data.rows.length} en total</span>
        </p>
        <div className="tracking-legend" aria-label="Alertas visuales">
          {data.alarms.map((a) => (
            <span key={a._id}>
              <i style={{ backgroundColor: `#${a.color}` }} />
              {a.name} = {a.minutes} Min
            </span>
          ))}
        </div>
      </div>
      <Queue
        rows={enRoute}
        total={data.rows.filter((r) => r.queue === "en_route").length}
        queue="en_route"
        alarms={data.alarms}
      />
      <section className="panel tracking-pending">
        <button
          className="tracking-expand"
          type="button"
          aria-expanded={expanded}
          aria-controls="pending-tracking"
          onClick={() => setExpanded(!expanded)}
        >
          <span>
            Pendientes por llegada <b>{pending.length}</b>
          </span>
          <span aria-hidden>{expanded ? "−" : "+"}</span>
        </button>
        <div id="pending-tracking" hidden={!expanded}>
          <Queue
            rows={pending}
            total={
              data.rows.filter((r) => r.queue === "pending_arrival").length
            }
            queue="pending_arrival"
            alarms={data.alarms}
          />
        </div>
      </section>
    </div>
  );
}

function Queue({
  rows,
  total,
  queue,
  alarms,
}: {
  rows: TrackingDispatch[];
  total: number;
  queue: "en_route" | "pending_arrival";
  alarms: Doc<"trackingAlarms">[];
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<TrackingSort>({
    key: queue === "en_route" ? "time" : "externalCode",
    direction: "desc",
  });
  const [exporting, setExporting] = useState(false),
    [error, setError] = useState("");
  const columns = queueColumns(queue),
    label =
      queue === "en_route" ? "Despachos en ruta" : "Pendientes por llegada";
  const visible = sortTracking(filterTracking(rows, {}, search, columns), sort);
  const toggleSort = (key: TrackingColumn) =>
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  async function exportRows() {
    setExporting(true);
    setError("");
    try {
      await downloadTrackingExcel(visible, queue);
    } catch {
      setError("No se pudo descargar el archivo. Inténtalo de nuevo.");
    } finally {
      setExporting(false);
    }
  }
  return (
    <section
      className={
        queue === "en_route" ? "panel tracking-queue" : "tracking-queue"
      }
      aria-label={label}
    >
      <div className="tracking-queue-toolbar">
        <h3>
          {label} <span>{visible.length}</span>
        </h3>
        <div>
          <label className="tracking-search">
            <span className="sr-only">Buscar en {label.toLowerCase()}</span>
            <input
              type="search"
              placeholder="Buscar en esta lista"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="ghost-button"
            disabled={exporting}
            onClick={() => void exportRows()}
          >
            {exporting ? "Descargando…" : "Excel"}
          </button>
        </div>
      </div>
      {error ? (
        <p className="tracking-message error" role="alert">
          {error}
        </p>
      ) : null}
      <div
        className="tracking-table-scroll"
        tabIndex={0}
        role="region"
        aria-label={`Tabla de ${label.toLowerCase()}`}
      >
        <table className="tracking-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  aria-sort={
                    sort.key === c.key
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button type="button" onClick={() => toggleSort(c.key)}>
                    {c.label}
                    <span aria-hidden>
                      {sort.key === c.key
                        ? sort.direction === "asc"
                          ? "↑"
                          : "↓"
                        : "↕"}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row._id}>
                {columns.map((c) => {
                  const alarm =
                    c.key === "externalCode"
                      ? alarms.find((a) => a.code === row.summary.alarmCode)
                      : undefined;
                  return (
                    <td
                      key={c.key}
                      className={
                        c.key === "externalCode"
                          ? "tracking-code"
                          : c.key === "plate"
                            ? "tracking-plate"
                            : ""
                      }
                      style={
                        alarm
                          ? {
                              backgroundColor: `#${alarm.color}`,
                              color: readableColor(alarm.color),
                            }
                          : undefined
                      }
                    >
                      {c.key === "externalCode" ? (
                        <Link href={`/control/seguimiento/${row._id}`}>
                          {row.externalCode}
                        </Link>
                      ) : (
                        cellValue(row, c.key)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!visible.length ? (
              <tr>
                <td colSpan={columns.length} className="tracking-empty">
                  {total
                    ? "No se hallan filas que coincidan con el criterio"
                    : "No hay despachos en esta lista."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="tracking-table-footer" role="status">
        Mostrando {visible.length ? 1 : 0} a {visible.length} de{" "}
        {visible.length} filas
        {visible.length !== total ? ` · ${total} en total` : ""}
      </div>
    </section>
  );
}

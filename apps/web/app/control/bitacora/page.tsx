"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { dayKey, formatDateTime, formatTime, relativeDue, relativePast, useNow } from "./components/format";
import "./bitacora.css";

type Tab = "en_ruta" | "entregado" | "todos";

export default function MonitoringBoard() {
  const { isAuthenticated } = useConvexAuth();
  const data = useQuery(api.monitoring.board, isAuthenticated ? {} : "skip");
  const [tab, setTab] = useState<Tab>("en_ruta");
  const [search, setSearch] = useState("");
  const now = useNow();
  const router = useRouter();

  const trips = data?.trips ?? [];
  const enRoute = trips.filter((t) => t.status === "en_ruta");
  const delivered = trips.filter((t) => t.status === "entregado");
  const late = enRoute.filter((t) => t.nextDueAt !== undefined && t.nextDueAt < now);
  const withNovelty = enRoute.filter((t) => t.lastReportHasNovelty);
  const deliveredToday = delivered.filter((t) => t.deliveredAt && dayKey(t.deliveredAt) === dayKey(now));

  const visible = useMemo(() => {
    const base = tab === "en_ruta" ? enRoute : tab === "entregado" ? delivered : trips;
    const needle = search.trim().toLocaleLowerCase("es");
    if (!needle) return base;
    return base.filter((t) =>
      [t.code, t.manifest, t.origin, t.destination, t.plate, t.driverName, t.customer, t.cargo]
        .filter(Boolean)
        .some((v) => String(v).toLocaleLowerCase("es").includes(needle)),
    );
  }, [tab, search, trips, enRoute, delivered]);

  if (!data)
    return (
      <div className="skeleton" role="status">
        Cargando bitácora…
      </div>
    );

  return (
    <div className="bm-workspace">
      <div className="bm-heading">
        <div>
          <span className="eyebrow">Control de tráfico</span>
          <h2>Bitácora de monitoreo en ruta</h2>
          <p>Reportes periódicos de seguridad con el conductor, novedades y cierre de entrega de cada viaje.</p>
        </div>
        {data.canReport ? (
          <div className="bm-heading-actions">
            <Link className="primary-action" href="/control/bitacora/nuevo">
              + Nuevo viaje
            </Link>
          </div>
        ) : null}
      </div>

      <div className="bm-metrics">
        <Metric label="Viajes en ruta" value={enRoute.length} foot="Con monitoreo activo" />
        <Metric label="Reportes vencidos" value={late.length} foot={late.length ? "Requieren llamada inmediata" : "Todos al día"} tone={late.length ? "late" : "ok"} />
        <Metric label="Con novedad" value={withNovelty.length} foot="Último reporte con novedad" tone={withNovelty.length ? "soon" : undefined} />
        <Metric label="Entregados hoy" value={deliveredToday.length} foot="Viajes cerrados" />
        <Metric label="Reportes registrados" value={trips.reduce((sum, t) => sum + t.reportCount, 0)} foot="Acumulado de la bitácora" />
      </div>

      <section className="panel" aria-label="Viajes monitoreados">
        <div className="bm-tabs" role="tablist">
          {(
            [
              ["en_ruta", "En ruta", enRoute.length],
              ["entregado", "Entregados", delivered.length],
              ["todos", "Todos", trips.length],
            ] as Array<[Tab, string, number]>
          ).map(([key, label, count]) => (
            <button key={key} role="tab" type="button" aria-selected={tab === key} onClick={() => setTab(key)}>
              {label} <span className="count">{count}</span>
            </button>
          ))}
          <div style={{ marginLeft: "auto", padding: "4px 0 8px" }}>
            <input aria-label="Buscar viaje" placeholder="Buscar placa, conductor, ruta…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ font: "inherit", fontSize: 12.5, padding: "6px 10px", border: "1px solid var(--line-strong)", borderRadius: 6, minWidth: 240 }} />
          </div>
        </div>
        <div className="table-wrap">
          <table className="bm-table">
            <thead>
              <tr>
                <th>Viaje</th>
                <th>Ruta</th>
                <th>Vehículo y conductor</th>
                <th>Cliente · mercancía</th>
                <th>Último reporte</th>
                <th>Próximo reporte</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((trip) => (
                <TripRow key={trip._id} trip={trip} now={now} onOpen={() => router.push(`/control/bitacora/${trip._id}`)} />
              ))}
              {!visible.length ? (
                <tr>
                  <td colSpan={7}>
                    <div className="bm-empty">
                      <strong>{search ? "Ningún viaje coincide con la búsqueda" : tab === "en_ruta" ? "No hay viajes en ruta" : "No hay viajes en esta vista"}</strong>
                      {data.canReport && !search ? "Crea un viaje para iniciar su bitácora de monitoreo." : ""}
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, foot, tone }: { label: string; value: number; foot: string; tone?: "late" | "soon" | "ok" }) {
  return (
    <div className={`bm-metric ${tone ?? ""}`}>
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
      <small>{foot}</small>
    </div>
  );
}

function TripRow({ trip, now, onOpen }: { trip: Doc<"monitoringTrips">; now: number; onOpen: () => void }) {
  const due = trip.status === "en_ruta" && trip.nextDueAt ? relativeDue(trip.nextDueAt, now) : null;
  return (
    <tr
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      tabIndex={0}
    >
      <td>
        <span className="primary mono">{trip.code}</span>
        <span className="secondary">{trip.manifest ? `Manifiesto ${trip.manifest}` : "Sin manifiesto"}</span>
      </td>
      <td>
        <span className="bm-route-cell primary">
          {trip.origin.split(",")[0]} <span className="arrow">→</span> {trip.destination.split(",")[0]}
        </span>
        <span className="secondary">Salida {formatDateTime(trip.departureAt)}{trip.waypoints.length ? ` · ${trip.waypoints.length} puntos` : ""}</span>
      </td>
      <td>
        <span className="plate-chip">{trip.plate}</span>
        <span className="secondary">{trip.driverName} · {trip.driverPhone}</span>
      </td>
      <td>
        <span className="primary">{trip.customer}</span>
        <span className="secondary">{trip.cargo}</span>
      </td>
      <td>
        {trip.lastReportAt ? (
          <>
            <span className="primary">{trip.lastReportSummary}</span>
            <span className="secondary">{formatTime(trip.lastReportAt)} · {relativePast(trip.lastReportAt, now)}</span>
          </>
        ) : (
          <span className="secondary">Sin reportes</span>
        )}
      </td>
      <td>
        {due ? (
          <>
            <span className={`bm-status ${due.state}`}>{due.label}</span>
            <span className="secondary">{formatTime(trip.nextDueAt!)} · cada {trip.intervalMinutes / 60} h</span>
          </>
        ) : trip.deliveredAt ? (
          <span className="secondary">Entregado {formatDateTime(trip.deliveredAt)}</span>
        ) : (
          <span className="secondary">—</span>
        )}
      </td>
      <td>
        <span className={`bm-status ${trip.status === "en_ruta" && trip.lastReportHasNovelty ? "novedad" : trip.status}`}>
          {trip.status === "entregado" ? "Entregado" : trip.lastReportHasNovelty ? "Con novedad" : "En ruta"}
        </span>
      </td>
    </tr>
  );
}

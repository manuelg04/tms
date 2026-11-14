"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import { Skeleton } from "../components/skeleton";
import { useQuery } from "../lib/convex-hooks";
import { splitRoute, type OperacionesRequest } from "../lib/operaciones-request";

type Inbox = { state: "loading" } | { state: "ready"; configured: boolean; items: OperacionesRequest[]; error?: string; onlyDispatcher?: boolean };

const shortDate = new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short" });
const shortTime = new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit", hour12: false });

export default function SolicitudesPage() {
  const [inbox, setInbox] = useState<Inbox>({ state: "loading" });
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/operaciones/solicitudes", { cache: "no-store" });
      const body = await response.json().catch(() => null) as { configured?: boolean; items?: OperacionesRequest[]; error?: string; onlyDispatcher?: boolean } | null;
      setInbox({
        state: "ready",
        configured: body?.configured !== false,
        items: Array.isArray(body?.items) ? body.items : [],
        onlyDispatcher: body?.onlyDispatcher === true,
        error: response.ok ? undefined : body?.error ?? "No fue posible consultar Operaciones"
      });
    } catch {
      setInbox({ state: "ready", configured: true, items: [], error: "No fue posible consultar Operaciones" });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const items = inbox.state === "ready" ? inbox.items : [];
  const ids = useMemo(() => items.map((item) => item.expedienteId), [items]);
  const links = useQuery(api.operaciones.linkedRequests, ids.length > 0 ? { operacionesExpedienteIds: ids } : "skip");
  const linkByRequest = useMemo(() => new Map((links ?? []).map((link) => [link.operacionesExpedienteId, link])), [links]);
  const pendingCount = items.filter((item) => !linkByRequest.has(item.expedienteId)).length;
  const rows = filter === "pending" ? items.filter((item) => !linkByRequest.has(item.expedienteId)) : items;

  return (
    <>
      <section className="dispatch-list-head">
        <div>
          <span className="eyebrow">MTM Operaciones</span>
          <h2>Solicitudes de planilla</h2>
        </div>
        <div className="queue-header-actions">
          <button className="ghost-button" disabled={refreshing} onClick={() => void load()} type="button">{refreshing ? "Actualizando…" : "Actualizar"}</button>
        </div>
      </section>

      <section className="panel dispatch-list-panel" aria-label="Solicitudes de planilla de Operaciones">
        <div className="dispatch-toolbar">
          <div className="state-tabs" role="tablist" aria-label="Filtrar solicitudes">
            <button aria-selected={filter === "pending"} className={filter === "pending" ? "state-tab active" : "state-tab"} onClick={() => setFilter("pending")} role="tab" type="button">
              Por crear<span className="state-count">{pendingCount}</span>
            </button>
            <button aria-selected={filter === "all"} className={filter === "all" ? "state-tab active" : "state-tab"} onClick={() => setFilter("all")} role="tab" type="button">
              Todas<span className="state-count">{items.length}</span>
            </button>
          </div>
        </div>

        {inbox.state === "loading" ? (
          <Skeleton label="Consultando solicitudes en Operaciones" />
        ) : !inbox.configured ? (
          <div className="expediente-empty">
            <strong>La conexión con Operaciones no está configurada</strong>
            <p>Falta definir la dirección y la llave de la integración en el servidor del TMS.</p>
          </div>
        ) : inbox.error ? (
          <div className="expediente-empty">
            <strong>Operaciones no respondió</strong>
            <p>{inbox.error}</p>
            <button className="load-more" onClick={() => void load()} type="button">Reintentar</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="expediente-empty">
            <strong>{filter === "pending" ? "No hay solicitudes por crear" : "No hay solicitudes de planilla"}</strong>
            <p>{inbox.onlyDispatcher ? "Por ahora solo se muestran las solicitudes nuevas del despachador habilitado para el piloto. Aparecen cuando guarda la planilla en Operaciones con el checklist del conductor aprobado." : "Aquí aparecen las solicitudes que los despachadores guardan en Operaciones cuando el checklist del conductor ya fue aprobado."}</p>
          </div>
        ) : (
          <div className="table-wrap dispatch-table-wrap">
            <table className="dispatch-table">
              <thead>
                <tr>
                  <th>Solicitada</th>
                  <th>Placa · Conductor</th>
                  <th>Cliente · Ruta</th>
                  <th>Carga</th>
                  <th>Estado en Operaciones</th>
                  <th>TMS</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const link = linkByRequest.get(item.expedienteId);
                  const route = splitRoute(item);
                  const when = new Date(item.requestedAt ?? item.updatedAt);
                  return (
                    <tr className={`dispatch-row tone-${link ? "ok" : "wait"}`} key={item.expedienteId}>
                      <td className="cell-date"><span>{shortDate.format(when)}</span><small>{shortTime.format(when)}</small></td>
                      <td className="cell-fleet"><span className="plate-chip">{item.vehicle.plate ?? "Sin placa"}</span><small>{item.driver.name ?? "Sin conductor"}{item.dispatcherName ? ` · pide ${item.dispatcherName}` : ""}</small></td>
                      <td className="cell-customer">{item.customerName ?? <span className="muted">Sin cliente</span>}<small>{route.origin ?? "—"} → {route.destination ?? "—"}</small></td>
                      <td className="cell-docs"><span className="doc-main">{item.product ?? "Sin producto"}</span><small>{[item.weightText, item.freightText ? `Flete ${item.freightText}` : null].filter(Boolean).join(" · ")}</small></td>
                      <td className="cell-state"><span className={`rndc-state state-${item.documents.loadingOrder ? "ok" : "wait"}`}><i aria-hidden />{item.statusLabel}</span></td>
                      <td className="cell-action solicitud-action">
                        {link
                          ? <Link className="text-button" href={`/expedientes/${link.expedienteId}`}>{link.code}</Link>
                          : <Link className="primary-action action-link" href={`/documentos/ordenes/insertar?solicitud=${encodeURIComponent(item.expedienteId)}`}>Crear orden de cargue</Link>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

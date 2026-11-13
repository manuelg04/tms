"use client";

import Link from "next/link";
import { useMutation, useQuery } from "./lib/convex-hooks";
import { api } from "../convex/_generated/api";
import { DocumentTable } from "./components/document-table";
import { resolveDocumentSection } from "./lib/document-workspace";
import { formatTimestamp } from "./lib/labels";
import { Skeleton } from "./components/skeleton";
import { PendingEmissionsPanel } from "./components/pending-emissions-panel";
import { useDemoUser } from "./providers";

export default function Home() {
  const { user } = useDemoUser();
  const overview = useQuery(api.dashboard.overview, {});
  const recent = useQuery(api.dashboard.recentDocuments, { limit: 12 });
  const notifications = useQuery(api.notifications.list, {});
  const markAllRead = useMutation(api.notifications.markAllRead);
  const hasUnread = notifications?.some((notification) => notification.status === "unread") ?? false;

  const canWork = user?.role === "admin" || user?.role === "operator";

  return (
    <>
      {canWork ? (
        <section className="start-here" aria-label="Qué vas a hacer">
          <div className="start-here-head">
            <h2>¿Qué vas a hacer?</h2>
            <p>Cada documento tiene su módulo en el menú. Un viaje se arma en este orden.</p>
          </div>
          <ol className="start-here-steps">
            <li><Link href="/documentos/ordenes/insertar"><span>1</span><strong>Orden de cargue</strong><em>Crea el viaje con cliente, carga, vehículo y conductor.</em></Link></li>
            <li><Link href="/documentos/remesas/insertar"><span>2</span><strong>Remesa</strong><em>Se hace a partir de una orden de cargue.</em></Link></li>
            <li><Link href="/documentos/manifiestos/insertar"><span>3</span><strong>Manifiesto</strong><em>Reúne las remesas y liquida el viaje.</em></Link></li>
            <li><Link href="/documentos/cumplidos"><span>4</span><strong>Cumplidos</strong><em>Cierra la remesa y el manifiesto al entregar.</em></Link></li>
          </ol>
        </section>
      ) : null}

      <section className="metric-strip" aria-label="Resumen de documentos">
        <article className="metric ok">
          <span className="eyebrow">Autorizados</span>
          <strong>{overview ? countLabel(overview.authorized, overview.capped) : "—"}</strong>
          <span className="foot">Documentos con radicado RNDC</span>
        </article>
        <article className="metric bad">
          <span className="eyebrow">Rechazados</span>
          <strong>{overview ? countLabel(overview.rejected, overview.capped) : "—"}</strong>
          <span className="foot">Requieren correccion y reenvio</span>
        </article>
        <article className="metric">
          <span className="eyebrow">Cumplidos</span>
          <strong>{overview ? countLabel(overview.fulfilled, overview.capped) : "—"}</strong>
          <span className="foot">Viajes cerrados ante el RNDC</span>
        </article>
        <article className="metric">
          <span className="eyebrow">Viajes</span>
          <strong>{overview ? countLabel(overview.totalTrips, overview.capped) : "—"}</strong>
          <span className="foot">
            {overview?.lastActivity ? `Última actividad ${formatTimestamp(overview.lastActivity)}` : "Sin actividad todavía"}
          </span>
        </article>
      </section>

      <PendingEmissionsPanel canSubmit={user?.role === "admin" || user?.role === "operator"} />

      <div className="dash-grid">
        <section className="panel" aria-label="Documentos recientes">
          <div className="panel-head">
            <h2>Documentos recientes</h2>
            <Link className="link" href="/documentos">
              Ver todos
            </Link>
          </div>
          {recent === undefined ? (
            <Skeleton label="Cargando documentos" />
          ) : (
            <DocumentTable rows={recent} section={resolveDocumentSection("todos")!} />
          )}
        </section>

        <section className="panel" aria-label="Notificaciones">
          <div className="panel-head">
            <h2>Notificaciones</h2>
            {hasUnread ? (
              <button className="text-button" onClick={() => void markAllRead({})} type="button">
                Marcar leidas
              </button>
            ) : null}
          </div>
          {notifications === undefined ? (
            <Skeleton label="Cargando" />
          ) : notifications.length === 0 ? (
            <div className="empty-state">
              Aquí verás cada respuesta del RNDC cuando emitas un documento.
            </div>
          ) : (
            <div className="notif-list">
              {notifications.map((notification) => (
                <div
                  className={notification.status === "unread" ? "notif-item unread" : "notif-item"}
                  key={notification._id}
                >
                  <span className="notif-dot" />
                  <div className="notif-body">
                    <strong>{notification.title}</strong>
                    <p>{notification.body}</p>
                    <time>{formatTimestamp(notification.createdAt)}</time>
                    {notification.actionHref && notification.actionLabel ? <Link className="notification-action" href={notification.actionHref}>{notification.actionLabel}</Link> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function countLabel(value: number, capped: boolean): string {
  return `${value.toLocaleString("es-CO")}${capped ? "+" : ""}`;
}

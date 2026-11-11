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

  return (
    <>
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
              Aquí verás cada respuesta del RNDC. Inicia o continúa el recorrido desde{" "}
              <Link href="/expedientes">Despachos</Link>.
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

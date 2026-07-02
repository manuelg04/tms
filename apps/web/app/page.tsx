"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { DocumentTable } from "./components/document-table";
import { formatTimestamp } from "./lib/labels";

export default function Home() {
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
          <strong>{overview?.authorized ?? "—"}</strong>
          <span className="foot">Documentos con radicado RNDC</span>
        </article>
        <article className="metric bad">
          <span className="eyebrow">Rechazados</span>
          <strong>{overview?.rejected ?? "—"}</strong>
          <span className="foot">Requieren correccion y reenvio</span>
        </article>
        <article className="metric">
          <span className="eyebrow">Cumplidos</span>
          <strong>{overview?.fulfilled ?? "—"}</strong>
          <span className="foot">Viajes cerrados ante el RNDC</span>
        </article>
        <article className="metric">
          <span className="eyebrow">Viajes</span>
          <strong>{overview?.totalTrips ?? "—"}</strong>
          <span className="foot">
            {overview?.lastActivity ? `Ultima actividad ${formatTimestamp(overview.lastActivity)}` : "Sin actividad todavia"}
          </span>
        </article>
      </section>

      <div className="dash-grid">
        <section className="panel" aria-label="Documentos recientes">
          <div className="panel-head">
            <h2>Documentos recientes</h2>
            <Link className="link" href="/documentos">
              Ver todos
            </Link>
          </div>
          {recent === undefined ? (
            <div className="skeleton">Cargando documentos…</div>
          ) : (
            <DocumentTable rows={recent} />
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
            <div className="skeleton">Cargando…</div>
          ) : notifications.length === 0 ? (
            <div className="empty-state">
              Aqui veras cada respuesta del RNDC. Emite un documento desde{" "}
              <Link href="/operaciones">Operaciones</Link>.
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

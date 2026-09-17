"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { routeProgress } from "../../../../convex/model/monitoring";
import dynamic from "next/dynamic";
import { ReportForm } from "../components/report-form";
import { DeliveryForm } from "../components/delivery-form";
import { channelLabels, dayKey, formatDate, formatDateTime, formatDuration, formatLongDate, formatTime, formatWeight, kindLabels, relativeDue, relativePast, useNow } from "../components/format";
import "../bitacora.css";

const TripMap = dynamic(() => import("../components/trip-map").then((m) => m.TripMap), { ssr: false, loading: () => <div className="skeleton" style={{ height: 420 }}>Cargando mapa…</div> });

type Report = NonNullable<ReturnType<typeof useQuery<typeof api.monitoring.detail>>>["reports"][number];

export default function MonitoringTripDetail({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = use(params);
  const { isAuthenticated } = useConvexAuth();
  const data = useQuery(api.monitoring.detail, isAuthenticated ? { tripId: tripId as Id<"monitoringTrips"> } : "skip");
  const deleteTrip = useMutation(api.monitoring.deleteTrip);
  const router = useRouter();
  const now = useNow();
  const [mode, setMode] = useState<"reporte" | "entrega">("reporte");
  const [notice, setNotice] = useState("");

  if (data === undefined)
    return (
      <div className="skeleton" role="status">
        Cargando bitácora…
      </div>
    );
  if (data === null)
    return (
      <div className="bm-workspace">
        <Link className="bm-back" href="/control/bitacora">← Bitácora de monitoreo</Link>
        <section className="panel bm-empty"><strong>Este viaje ya no existe</strong>Puede haber sido eliminado por un administrador.</section>
      </div>
    );
  const { trip, reports } = data;
  const route = [trip.origin, ...trip.waypoints, trip.destination];
  const visited = routeProgress(route, reports.map((r) => r.location));
  if (trip.status === "entregado") visited[visited.length - 1] = true;
  const lastVisited = visited.lastIndexOf(true);
  const due = trip.status === "en_ruta" && trip.nextDueAt ? relativeDue(trip.nextDueAt, now) : null;
  const delivery = reports.find((r) => r.kind === "entrega");
  const elapsed = (trip.deliveredAt ?? now) - trip.departureAt;
  const novelties = reports.filter((r) => r.hasNovelty).length;
  const grouped = reports.reduce<Array<{ day: string; items: Report[] }>>((acc, report) => {
    const key = dayKey(report.at);
    const last = acc[acc.length - 1];
    if (last && last.day === key) last.items.push(report);
    else acc.push({ day: key, items: [report] });
    return acc;
  }, []);

  async function removeTrip() {
    if (!window.confirm(`¿Eliminar el viaje ${trip.code} y toda su bitácora? Esta acción no se puede deshacer.`)) return;
    await deleteTrip({ tripId: trip._id });
    router.push("/control/bitacora");
  }

  return (
    <div className="bm-workspace">
      <Link className="bm-back" href="/control/bitacora">← Bitácora de monitoreo</Link>
      <div className="bm-heading">
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span className="bm-code">{trip.code}</span>
            <span className={`bm-status ${trip.status === "en_ruta" && trip.lastReportHasNovelty ? "novedad" : trip.status}`}>
              {trip.status === "entregado" ? "Entregado" : trip.lastReportHasNovelty ? "En ruta · con novedad" : "En ruta"}
            </span>
            {trip.manifest ? <span className="bm-code">Manifiesto {trip.manifest}</span> : null}
          </div>
          <div className="bm-route-title">
            <span>{trip.origin.split(",")[0]}</span>
            <span className="arrow">→</span>
            <span>{trip.destination.split(",")[0]}</span>
            <span className="plate-chip">{trip.plate}</span>
          </div>
          <p>
            {trip.driverName} · {trip.driverPhone} · {trip.customer} · {trip.cargo}
          </p>
        </div>
        <div className="bm-heading-actions">
          <Link className="ghost-button" href={`/control/bitacora/${trip._id}/imprimir`} style={{ textDecoration: "none" }}>
            Imprimir bitácora
          </Link>
          {data.isAdmin ? (
            <button className="ghost-button bm-danger" type="button" onClick={() => void removeTrip()}>
              Eliminar
            </button>
          ) : null}
        </div>
      </div>

      <div className="bm-metrics">
        <div className="bm-metric">
          <span className="eyebrow">Salida</span>
          <strong>{formatTime(trip.departureAt)}</strong>
          <small>{formatDate(trip.departureAt)}</small>
        </div>
        <div className="bm-metric">
          <span className="eyebrow">{trip.status === "entregado" ? "Duración del viaje" : "Tiempo en ruta"}</span>
          <strong>{formatDuration(elapsed)}</strong>
          <small>{trip.deliveredAt ? `Llegada ${formatDateTime(trip.deliveredAt)}` : trip.expectedArrivalAt ? `Estimado ${formatDateTime(trip.expectedArrivalAt)}` : "Sin llegada estimada"}</small>
        </div>
        <div className="bm-metric">
          <span className="eyebrow">Reportes</span>
          <strong>{reports.length}</strong>
          <small>{novelties ? `${novelties} con novedad` : "Sin novedades"}</small>
        </div>
        <div className="bm-metric">
          <span className="eyebrow">Último contacto</span>
          <strong>{trip.lastReportAt ? formatTime(trip.lastReportAt) : "—"}</strong>
          <small>{trip.lastReportAt ? `${relativePast(trip.lastReportAt, now)} · ${reports[reports.length - 1]?.location ?? ""}` : "Sin reportes"}</small>
        </div>
        <div className={`bm-metric ${due?.state ?? ""}`}>
          <span className="eyebrow">Próximo reporte</span>
          <strong>{due ? formatTime(trip.nextDueAt!) : trip.status === "entregado" ? "Cerrado" : "—"}</strong>
          <small>{due ? `${due.label} · cada ${trip.intervalMinutes / 60} h` : trip.deliveredAt ? `Entregado ${formatDateTime(trip.deliveredAt)}` : ""}</small>
        </div>
      </div>

      <section className="panel" aria-label="Avance en la ruta">
        <div className="bm-stepper">
          <ol>
            {route.map((stop, index) => {
              const isEnd = index === 0 || index === route.length - 1;
              const report = index === route.length - 1 && delivery ? delivery : reports.find((r) => visited[index] && stopMatches(stop, r.location));
              const classes = [
                visited[index] ? "visited" : "",
                index === lastVisited && trip.status === "en_ruta" ? "current" : "",
                index === route.length - 1 && trip.status === "entregado" ? "delivered" : "",
                visited[index] && !visited[index + 1] && index < route.length - 1 ? "next-pending" : "",
                isEnd ? "endpoint" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <li key={`${stop}-${index}`} className={classes}>
                  <span className="dot" aria-hidden />
                  <span className="stop">{stop.split(",")[0]}</span>
                  <span className="stop-time">{report ? formatTime(report.at) : index === 0 ? formatTime(trip.departureAt) : "pendiente"}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <section className="panel" aria-label="Mapa de la ruta">
        <div className="tracking-section-title" style={{ padding: "14px 22px" }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Ruta y reportes en el mapa</h3>
          <span style={{ color: "var(--ink-soft)", fontSize: 12 }}>Pines numerados en el orden de la ruta · clic en un pin para ver el reporte</span>
        </div>
        <TripMap tripId={trip._id} tripStatus={trip.status} />
      </section>

      <div className="bm-layout">
        <section className="panel" aria-label="Bitácora del viaje">
          <div className="tracking-section-title" style={{ padding: "16px 22px" }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Bitácora</h3>
            <span style={{ color: "var(--ink-soft)", fontSize: 12 }}>{reports.length} registros · orden cronológico</span>
          </div>
          <div className="bm-timeline">
            {grouped.map((group) => (
              <div key={group.day}>
                <div className="bm-day">{formatLongDate(group.items[0].at)}</div>
                {group.items.map((report) => (
                  <ReportEntry key={report._id} report={report} last={report._id === reports[reports.length - 1]?._id} />
                ))}
              </div>
            ))}
            {!reports.length ? (
              <div className="bm-empty">
                <strong>Aún no hay reportes</strong>
                Registra la primera llamada de control con el conductor.
              </div>
            ) : null}
          </div>
        </section>

        <aside className="bm-side">
          {notice ? <p className="bm-message success" role="status">{notice}</p> : null}
          {data.canReport ? (
            <section className="panel" aria-label="Registrar en la bitácora">
              <div className="bm-side-tabs" role="tablist">
                <button role="tab" type="button" aria-selected={mode === "reporte"} onClick={() => setMode("reporte")}>Reporte de control</button>
                <button role="tab" type="button" aria-selected={mode === "entrega"} onClick={() => setMode("entrega")}>Registrar entrega</button>
              </div>
              {mode === "reporte" ? (
                <ReportForm trip={trip} onSaved={() => setNotice("Reporte registrado en la bitácora.")} />
              ) : (
                <DeliveryForm trip={trip} onSaved={() => setNotice("Entrega registrada. El viaje quedó cerrado.")} />
              )}
            </section>
          ) : trip.status === "entregado" ? (
            <section className="panel bm-closed">
              <strong>Viaje entregado y cerrado</strong>
              La bitácora quedó en solo lectura. Puedes imprimirla o exportarla como soporte.
            </section>
          ) : null}
          <section className="panel bm-info" aria-label="Datos del viaje">
            <dl>
              <div><dt>Conductor</dt><dd>{trip.driverName}</dd></div>
              <div><dt>Celular</dt><dd>{trip.driverPhone}</dd></div>
              <div><dt>Documento</dt><dd className={trip.driverDocument ? "" : "muted"}>{trip.driverDocument ?? "—"}</dd></div>
              <div><dt>Vehículo</dt><dd>{trip.plate}{trip.trailerPlate ? ` · ${trip.trailerPlate}` : ""}</dd></div>
              <div className="wide"><dt>Cliente</dt><dd>{trip.customer}</dd></div>
              <div className="wide"><dt>Mercancía</dt><dd>{trip.cargo}</dd></div>
              <div className="wide"><dt>Ruta completa</dt><dd className="muted">{route.map((s) => s.split(",")[0]).join(" → ")}</dd></div>
              {trip.observations ? <div className="wide"><dt>Observaciones generales</dt><dd className="muted">{trip.observations}</dd></div> : null}
              <div className="wide"><dt>Bitácora abierta por</dt><dd className="muted">{trip.createdByName} · {formatDateTime(trip.createdAt)}</dd></div>
            </dl>
          </section>
          {delivery ? (
            <section className="panel bm-info" aria-label="Cierre de la entrega">
              <dl>
                <div className="wide"><dt>Entrega</dt><dd>{formatDateTime(delivery.at)} · {delivery.location}</dd></div>
                <div><dt>Recibido por</dt><dd>{delivery.receivedBy ?? "—"}</dd></div>
                <div><dt>Peso entregado</dt><dd>{delivery.deliveredWeightKg ? formatWeight(delivery.deliveredWeightKg) : "—"}</dd></div>
                <div className="wide"><dt>Estado de la carga</dt><dd style={{ color: delivery.cargoCondition === "conforme" ? "var(--ok)" : "var(--bad)" }}>{delivery.cargoCondition === "conforme" ? "Conforme" : "Con novedad"}</dd></div>
              </dl>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function stopMatches(stop: string, location: string): boolean {
  const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
  const a = norm(stop.split(",")[0]);
  const b = norm(location);
  return b.includes(a) || a.includes(b);
}

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === "whatsapp")
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path d="M2.5 13.5 3.4 10.6A5.5 5.5 0 1 1 5.4 12.6L2.5 13.5Z" strokeLinejoin="round" />
        <path d="M6 6.5c.3 1.6 1.6 2.9 3.2 3.2l.9-.9-1.2-.7-.6.5c-.5-.3-.9-.7-1.2-1.2l.5-.6-.7-1.2-.9.9Z" strokeLinejoin="round" />
      </svg>
    );
  if (channel === "presencial")
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path d="M8 14s4.5-4 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 10 8 14 8 14Z" strokeLinejoin="round" />
        <circle cx="8" cy="6.5" r="1.6" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M3.5 2.5h2.3l1 2.6-1.4 1.1a8 8 0 0 0 4.4 4.4l1.1-1.4 2.6 1v2.3a1 1 0 0 1-1.1 1A11 11 0 0 1 2.5 3.6a1 1 0 0 1 1-1.1Z" strokeLinejoin="round" />
    </svg>
  );
}

function ReportEntry({ report, last }: { report: Report; last: boolean }) {
  const severe = report.hasNovelty && /accidente|siniestro|sin contacto/i.test(report.noveltyType ?? "");
  return (
    <article className={`bm-entry ${report.kind} ${severe ? "severe" : ""} ${last ? "last" : ""}`}>
      <div className="bm-entry-time">{formatTime(report.at)}</div>
      <div className="bm-entry-rail">
        <span className="bm-entry-dot" aria-hidden />
      </div>
      <div className="bm-card">
        <div className="bm-card-head">
          <div className="bm-card-title">
            <span className="bm-kind">{report.kind === "novedad" ? report.noveltyType ?? "Novedad" : kindLabels[report.kind]}</span>
            <span>{report.location}</span>
          </div>
          <span className="bm-channel">
            <ChannelIcon channel={report.channel} />
            {channelLabels[report.channel]}
            {!report.contacted ? " · sin respuesta" : ""}
          </span>
        </div>
        <p>{report.observation}</p>
        {report.kind === "entrega" ? (
          <>
            <dl className="bm-delivery-grid">
              <div><dt>Recibido por</dt><dd>{report.receivedBy ?? "—"}</dd></div>
              <div><dt>Peso entregado</dt><dd>{report.deliveredWeightKg ? formatWeight(report.deliveredWeightKg) : "—"}</dd></div>
              <div><dt>Estado de la carga</dt><dd style={{ color: report.cargoCondition === "conforme" ? "var(--ok)" : "var(--bad)" }}>{report.cargoCondition === "conforme" ? "Conforme" : "Con novedad"}</dd></div>
            </dl>
            {report.documents?.length ? (
              <ul className="bm-doc-list">
                {report.documents.map((doc) => (
                  <li key={doc}>✓ {doc}</li>
                ))}
              </ul>
            ) : null}
            {report.attachmentUrls.length ? (
              <div className="bm-attachments">
                {report.attachmentUrls.map((file) => (
                  <a key={file.fileName + (file.url ?? "")} href={file.url ?? "#"} target="_blank" rel="noreferrer">
                    {file.url && file.contentType.startsWith("image/") ? <img src={file.url} alt={file.fileName} /> : <span className="file">PDF</span>}
                    <span>{file.fileName}</span>
                  </a>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
        <div className="bm-card-foot">
          <span>
            Registró <strong>{report.operatorName}</strong>
          </span>
          <span>{formatDate(report.at)}</span>
        </div>
      </div>
    </article>
  );
}

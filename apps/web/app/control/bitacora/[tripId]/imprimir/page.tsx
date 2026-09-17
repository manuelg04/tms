"use client";

import Link from "next/link";
import { use, useMemo } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { reportCompliance, routeProgress } from "../../../../../convex/model/monitoring";
import dynamic from "next/dynamic";
import { useDemoUser } from "../../../../providers";
import { channelLabels, formatDateTime, formatDuration, formatTime, formatWeight, kindLabels } from "../../components/format";
import "../../bitacora.css";

const TripMap = dynamic(() => import("../../components/trip-map").then((m) => m.TripMap), { ssr: false });

const shortDate = (ms: number) => new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", year: "numeric" }).format(ms);
const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es").trim();
const stopMatches = (stop: string, location: string) => {
  const a = norm(stop.split(",")[0]).replace(/\bd\.?c\.?$/i, "").trim();
  const b = norm(location);
  return b.includes(a) || (b.length >= 4 && a.includes(b));
};

function MissingTrip() {
  return (
    <div className="bm-workspace">
      <Link className="bm-back" href="/control/bitacora">← Bitácora de monitoreo</Link>
      <section className="panel bm-empty"><strong>Este viaje ya no existe</strong>Puede haber sido eliminado por un administrador.</section>
    </div>
  );
}

export default function PrintMonitoringTrip({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = use(params);
  const { isAuthenticated } = useConvexAuth();
  const { user } = useDemoUser();
  const data = useQuery(api.monitoring.detail, isAuthenticated ? { tripId: tripId as Id<"monitoringTrips"> } : "skip");
  const printedAt = useMemo(() => Date.now(), []);
  if (data === undefined)
    return (
      <div className="skeleton" role="status">
        Preparando documento…
      </div>
    );
  if (data === null) return <MissingTrip />;
  const { trip, reports } = data;
  const delivery = reports.find((r) => r.kind === "entrega");
  const partialDeliveries = reports.filter((r) => r.kind === "entrega_parcial");
  const novelties = reports.filter((r) => r.hasNovelty);
  const route = [trip.origin, ...trip.waypoints, trip.destination];
  const visited = routeProgress(route, reports.map((r) => r.location));
  if (trip.status === "entregado") visited[visited.length - 1] = true;
  const compliance = reportCompliance(reports, trip.intervalMinutes);
  const gaps = compliance.onTime + compliance.late;
  const endAt = trip.deliveredAt ?? reports[reports.length - 1]?.at ?? trip.departureAt;
  const operators = [...reports.reduce((map, r) => map.set(r.operatorName, (map.get(r.operatorName) ?? 0) + 1), new Map<string, number>())];
  const organization = data.organizationName || "Transportes MTM";
  const noContact = reports.filter((r) => !r.contacted).length;
  const imagesOf = (r: (typeof reports)[number] | undefined) => r?.attachmentUrls.filter((f) => f.url && f.contentType.startsWith("image/")) ?? [];
  const filesOf = (r: (typeof reports)[number] | undefined) => r?.attachmentUrls.filter((f) => !f.contentType.startsWith("image/")) ?? [];
  const renderDelivery = (r: (typeof reports)[number], title: string) => (
    <div key={r._id} className="bm-print-delivery">
      <h3>{title}</h3>
      <dl className="bm-print-grid">
        <div><dt>Fecha y hora</dt><dd>{formatDateTime(r.at)}</dd></div>
        <div><dt>Lugar de descargue</dt><dd>{r.location}</dd></div>
        <div><dt>Recibido por</dt><dd>{r.receivedBy ?? "—"}</dd></div>
        <div><dt>Peso entregado</dt><dd>{r.deliveredWeightKg ? formatWeight(r.deliveredWeightKg) : "—"}</dd></div>
        <div><dt>Estado de la carga</dt><dd className={r.cargoCondition === "conforme" ? "ok" : "late"}>{r.cargoCondition === "conforme" ? "Conforme" : "Con novedad"}</dd></div>
        <div><dt>Registró</dt><dd>{r.operatorName}</dd></div>
        <div style={{ gridColumn: "span 2" }}><dt>Documentos de soporte recibidos</dt><dd>{r.documents?.length ? r.documents.join(" · ") : "—"}</dd></div>
        <div style={{ gridColumn: "1 / -1" }}><dt>Observación del descargue</dt><dd style={{ fontWeight: 400 }}>{r.observation}</dd></div>
      </dl>
      {imagesOf(r).length ? (
        <div className="bm-print-photos">
          {imagesOf(r).map((file, index) => (
            <figure key={file.url ?? index}>
              <img src={file.url!} alt={file.fileName} />
              <figcaption>Anexo {index + 1} · {file.fileName}</figcaption>
            </figure>
          ))}
        </div>
      ) : null}
      {filesOf(r).length ? <p className="bm-print-note">Archivos adjuntos adicionales: {filesOf(r).map((f) => f.fileName).join(" · ")} (disponibles en el sistema).</p> : null}
    </div>
  );

  return (
    <div className="bm-workspace">
      <div className="bm-print-toolbar">
        <Link className="bm-back" href={`/control/bitacora/${trip._id}`}>← Volver a la bitácora</Link>
        <div className="bm-heading-actions">
          <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>Usa "Guardar como PDF" en el diálogo de impresión para enviarlo a la aseguradora.</span>
          <button className="primary-action" type="button" onClick={() => window.print()}>Imprimir / guardar PDF</button>
        </div>
      </div>

      <article className="bm-print-sheet">
        <header className="bm-print-head">
          <div>
            <div className="org">{organization}</div>
            <h1>Bitácora de monitoreo en ruta</h1>
            <div className="sub">Registro de reportes de seguridad con el conductor · Documento de evidencia para novedades y siniestros</div>
          </div>
          <div className="meta">
            <strong>{trip.code}</strong>
            <br />
            {trip.manifest ? `Manifiesto de carga ${trip.manifest}` : "Sin manifiesto asociado"}
            <br />
            Estado del viaje: <b>{trip.status === "entregado" ? "Entregado y cerrado" : "En ruta"}</b>
            <br />
            Generado {formatDateTime(printedAt)}{user ? ` por ${user.name}` : ""}
          </div>
        </header>

        <section className="bm-print-kpis">
          <div>
            <dt>Ruta</dt>
            <dd>{trip.origin.split(",")[0]} → {trip.destination.split(",")[0]}</dd>
            <small>{route.length} puntos de control</small>
          </div>
          <div>
            <dt>Salida</dt>
            <dd>{formatDateTime(trip.departureAt)}</dd>
            <small>{trip.origin}</small>
          </div>
          <div>
            <dt>{trip.deliveredAt ? "Entrega" : "Último registro"}</dt>
            <dd>{formatDateTime(endAt)}</dd>
            <small>{trip.deliveredAt ? delivery?.location : reports[reports.length - 1]?.location ?? "—"}</small>
          </div>
          <div>
            <dt>Duración</dt>
            <dd>{formatDuration(endAt - trip.departureAt)}</dd>
            <small>{trip.expectedArrivalAt ? `Estimada ${formatDateTime(trip.expectedArrivalAt)}` : "Sin llegada estimada"}</small>
          </div>
          <div>
            <dt>Reportes</dt>
            <dd>{reports.length}</dd>
            <small>{novelties.length} con novedad · {partialDeliveries.length ? `${partialDeliveries.length} entrega${partialDeliveries.length === 1 ? "" : "s"} parcial${partialDeliveries.length === 1 ? "" : "es"}` : `${noContact} sin contacto`}</small>
          </div>
          <div className={compliance.late ? "warn" : "ok"}>
            <dt>Cumplimiento</dt>
            <dd>{gaps ? `${compliance.onTime} de ${gaps}` : "—"}</dd>
            <small>{gaps ? `a tiempo · brecha máx. ${formatDuration(compliance.maxGapMinutes * 60000)}` : "Sin intervalos que evaluar"}</small>
          </div>
        </section>

        <h2><span>1</span>Datos del viaje</h2>
        <dl className="bm-print-grid">
          <div><dt>Placa</dt><dd>{trip.plate}{trip.trailerPlate ? ` · Remolque ${trip.trailerPlate}` : ""}</dd></div>
          <div><dt>Conductor</dt><dd>{trip.driverName}</dd></div>
          <div><dt>Documento</dt><dd>{trip.driverDocument ? `CC ${trip.driverDocument}` : "—"}</dd></div>
          <div><dt>Celular de contacto</dt><dd>{trip.driverPhone}</dd></div>
          <div><dt>Cliente</dt><dd>{trip.customer}</dd></div>
          <div><dt>Mercancía</dt><dd>{trip.cargo}</dd></div>
          <div><dt>Frecuencia acordada</dt><dd>Reporte cada {trip.intervalMinutes / 60} h</dd></div>
          <div><dt>Bitácora abierta por</dt><dd>{trip.createdByName} · {formatDateTime(trip.createdAt)}</dd></div>
          {trip.observations ? <div style={{ gridColumn: "1 / -1" }}><dt>Observaciones e instrucciones del viaje</dt><dd style={{ fontWeight: 400 }}>{trip.observations}</dd></div> : null}
        </dl>

        <h2><span>2</span>Ruta planeada y puntos de control</h2>
        <table className="bm-print-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Punto de control</th>
              <th>Reportado</th>
              <th>Hora</th>
              <th>Medio</th>
              <th>Novedad</th>
            </tr>
          </thead>
          <tbody>
            {route.map((stop, index) => {
              const report = index === route.length - 1 && delivery ? delivery : reports.find((r) => visited[index] && stopMatches(stop, r.location));
              const done = Boolean(report) || (index === 0 && reports.length > 0);
              const first = index === 0 ? reports[0] : undefined;
              const shown = report ?? first;
              return (
                <tr key={`${stop}-${index}`} className={done ? "" : "pending"}>
                  <td className="mono">{index + 1}</td>
                  <td>{stop}{index === 0 ? " (origen)" : index === route.length - 1 ? " (destino)" : ""}</td>
                  <td>{done ? <b className="ok">Sí</b> : <span className="muted">Sin reporte</span>}</td>
                  <td className="mono">{shown ? `${shortDate(shown.at)} ${formatTime(shown.at)}` : "—"}</td>
                  <td>{shown ? channelLabels[shown.channel] : "—"}</td>
                  <td>{shown ? (shown.hasNovelty ? shown.noveltyType ?? "Novedad" : "Sin novedad") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h2><span>3</span>Mapa de la ruta y los reportes</h2>
        <div className="bm-print-map">
          <TripMap tripId={trip._id} tripStatus={trip.status} interactive={false} height={380} />
        </div>

        <h2><span>4</span>Cronología completa de reportes</h2>
        <table className="bm-print-table bm-print-log">
          <thead>
            <tr>
              <th>#</th>
              <th>Fecha y hora</th>
              <th>Intervalo</th>
              <th>Lugar</th>
              <th>Tipo</th>
              <th>Medio / contacto</th>
              <th>Observación registrada</th>
              <th>Registró</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report, index) => {
              const row = compliance.rows[index];
              return (
                <tr key={report._id} className={report.hasNovelty ? "novedad" : report.kind === "entrega" || report.kind === "entrega_parcial" ? "entrega" : ""}>
                  <td className="mono">{index + 1}</td>
                  <td className="mono">{shortDate(report.at)}<br />{formatTime(report.at)}</td>
                  <td className="mono">
                    {row?.gapMinutes === null || row === undefined ? "—" : formatDuration(row.gapMinutes * 60000)}
                    {row?.onTime === false ? <><br /><b className="late">tardío</b></> : null}
                  </td>
                  <td>{report.location}</td>
                  <td>{report.kind === "novedad" ? <b>{report.noveltyType ?? "Novedad"}</b> : kindLabels[report.kind]}</td>
                  <td>{channelLabels[report.channel]}<br /><span className={report.contacted ? "muted" : "late"}>{report.contacted ? "Conductor contestó" : "Sin respuesta"}</span></td>
                  <td>{report.observation}</td>
                  <td>{report.operatorName}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="bm-print-note">Intervalo: tiempo transcurrido desde el reporte anterior. Se marca como tardío cuando supera la frecuencia acordada más 15 minutos de tolerancia.</p>

        <h2><span>5</span>Novedades registradas</h2>
        {novelties.length ? (
          <div className="bm-print-novelties">
            {novelties.map((report) => {
              const next = reports.find((r) => r.at > report.at);
              return (
                <article key={report._id} className="bm-print-novelty">
                  <header>
                    <strong>{report.noveltyType ?? "Novedad"}</strong>
                    <span>{formatDateTime(report.at)} · {report.location}</span>
                  </header>
                  <p>{report.observation}</p>
                  <footer>
                    <span>Registró {report.operatorName} · {channelLabels[report.channel]}{report.contacted ? "" : " · sin respuesta del conductor"}</span>
                    <span>{next ? `Seguimiento: ${formatDateTime(next.at)} en ${next.location} (${next.hasNovelty ? next.noveltyType ?? "novedad" : "sin novedad"})` : "Sin reporte posterior registrado"}</span>
                  </footer>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="bm-print-note">No se registraron novedades durante el viaje. Todos los reportes se recibieron sin incidentes.</p>
        )}

        <h2><span>6</span>Entregas{partialDeliveries.length ? ` (${partialDeliveries.length + (delivery ? 1 : 0)})` : ""}</h2>
        {partialDeliveries.map((r, index) => renderDelivery(r, `Entrega parcial ${index + 1} · ${r.location}`))}
        {delivery ? (
          renderDelivery(delivery, partialDeliveries.length ? `Entrega final · ${delivery.location}` : "Cierre de entrega")
        ) : (
          <p className="bm-print-note">El viaje aún no tiene entrega final registrada. Este documento refleja la bitácora hasta {formatDateTime(printedAt)}.</p>
        )}

        <h2><span>7</span>Trazabilidad del registro</h2>
        <dl className="bm-print-grid">
          <div><dt>Identificador interno</dt><dd className="mono">{trip._id}</dd></div>
          <div><dt>Registros en la bitácora</dt><dd>{reports.length}</dd></div>
          <div style={{ gridColumn: "span 2" }}><dt>Analistas que registraron</dt><dd>{operators.map(([name, count]) => `${name} (${count})`).join(" · ") || "—"}</dd></div>
          <div style={{ gridColumn: "1 / -1" }}><dt>Nota de integridad</dt><dd style={{ fontWeight: 400 }}>Cada reporte se almacena con la fecha y hora indicadas por el analista y la marca de tiempo del sistema al guardarlo, junto con el usuario autenticado que lo registró. La bitácora no permite editar ni borrar reportes individuales una vez guardados.</dd></div>
        </dl>

        <div className="bm-print-signatures">
          <div><strong>Analista de monitoreo</strong>{reports[reports.length - 1]?.operatorName ?? ""}</div>
          <div><strong>Jefe de seguridad</strong>Nombre y firma</div>
          <div><strong>Conductor</strong>{trip.driverName}</div>
        </div>
        <div className="bm-print-foot">
          <span>{organization} · Bitácora {trip.code} · generado por el TMS el {formatDateTime(printedAt)}</span>
          <span>Vigilado SuperTransporte</span>
        </div>
      </article>
    </div>
  );
}

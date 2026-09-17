"use client";

import Link from "next/link";
import { use } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { channelLabels, formatDateTime, formatDuration, formatTime, formatWeight, kindLabels } from "../../components/format";
import "../../bitacora.css";

function MissingTrip() {
  return (
    <div className="bm-workspace">
      <Link className="bm-back" href="/control/bitacora">← Bitácora de monitoreo</Link>
      <section className="panel bm-empty"><strong>Este viaje ya no existe</strong>Puede haber sido eliminado por un administrador.</section>
    </div>
  );
}

const shortDate = (ms: number) => new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", year: "numeric" }).format(ms);

export default function PrintMonitoringTrip({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = use(params);
  const { isAuthenticated } = useConvexAuth();
  const data = useQuery(api.monitoring.detail, isAuthenticated ? { tripId: tripId as Id<"monitoringTrips"> } : "skip");
  if (data === undefined)
    return (
      <div className="skeleton" role="status">
        Preparando documento…
      </div>
    );
  if (data === null) return <MissingTrip />;
  const { trip, reports } = data;
  const delivery = reports.find((r) => r.kind === "entrega");
  const route = [trip.origin, ...trip.waypoints, trip.destination];
  const printedAt = Date.now();
  return (
    <div className="bm-workspace">
      <div className="bm-print-toolbar">
        <Link className="bm-back" href={`/control/bitacora/${trip._id}`}>← Volver a la bitácora</Link>
        <button className="primary-action" type="button" onClick={() => window.print()}>Imprimir / guardar PDF</button>
      </div>
      <article className="bm-print-sheet">
        <header className="bm-print-head">
          <div>
            <div className="org">{data.organizationName || "Transportes MTM"}</div>
            <h1>Bitácora de monitoreo en ruta</h1>
            <div style={{ fontSize: 12, color: "#444" }}>Reportes de seguridad con el conductor · Departamento de seguridad y control de tráfico</div>
          </div>
          <div className="meta">
            <strong>{trip.code}</strong>
            <br />
            {trip.manifest ? `Manifiesto ${trip.manifest}` : "Sin manifiesto asociado"}
            <br />
            Estado: {trip.status === "entregado" ? "Entregado" : "En ruta"}
            <br />
            Impreso {formatDateTime(printedAt)}
          </div>
        </header>
        <dl className="bm-print-grid">
          <div><dt>Origen</dt><dd>{trip.origin}</dd></div>
          <div><dt>Destino</dt><dd>{trip.destination}</dd></div>
          <div><dt>Salida</dt><dd>{formatDateTime(trip.departureAt)}</dd></div>
          <div><dt>{trip.status === "entregado" ? "Entrega" : "Llegada estimada"}</dt><dd>{trip.deliveredAt ? formatDateTime(trip.deliveredAt) : trip.expectedArrivalAt ? formatDateTime(trip.expectedArrivalAt) : "—"}</dd></div>
          <div><dt>Placa</dt><dd>{trip.plate}{trip.trailerPlate ? ` · ${trip.trailerPlate}` : ""}</dd></div>
          <div><dt>Conductor</dt><dd>{trip.driverName}{trip.driverDocument ? ` · CC ${trip.driverDocument}` : ""}</dd></div>
          <div><dt>Celular</dt><dd>{trip.driverPhone}</dd></div>
          <div><dt>Frecuencia de reporte</dt><dd>Cada {trip.intervalMinutes / 60} h</dd></div>
          <div><dt>Cliente</dt><dd>{trip.customer}</dd></div>
          <div><dt>Mercancía</dt><dd>{trip.cargo}</dd></div>
          <div style={{ gridColumn: "span 2" }}><dt>Ruta de control</dt><dd>{route.map((s) => s.split(",")[0]).join(" → ")}</dd></div>
          {trip.observations ? <div style={{ gridColumn: "1 / -1" }}><dt>Observaciones generales</dt><dd style={{ fontWeight: 400 }}>{trip.observations}</dd></div> : null}
        </dl>

        <h2>Registro de reportes ({reports.length})</h2>
        <table className="bm-print-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Fecha</th>
              <th>Hora</th>
              <th>Lugar</th>
              <th>Tipo</th>
              <th>Medio</th>
              <th>Observación</th>
              <th>Registró</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report, index) => (
              <tr key={report._id} className={report.hasNovelty ? "novedad" : report.kind === "entrega" ? "entrega" : ""}>
                <td className="mono">{index + 1}</td>
                <td className="mono">{shortDate(report.at)}</td>
                <td className="mono">{formatTime(report.at)}</td>
                <td>{report.location}</td>
                <td>{report.kind === "novedad" ? report.noveltyType ?? "Novedad" : kindLabels[report.kind]}</td>
                <td>{channelLabels[report.channel]}{!report.contacted ? " (sin respuesta)" : ""}</td>
                <td>{report.observation}</td>
                <td>{report.operatorName}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {delivery ? (
          <>
            <h2>Cierre de la entrega</h2>
            <dl className="bm-print-grid">
              <div><dt>Fecha y hora</dt><dd>{formatDateTime(delivery.at)}</dd></div>
              <div><dt>Lugar de descargue</dt><dd>{delivery.location}</dd></div>
              <div><dt>Recibido por</dt><dd>{delivery.receivedBy ?? "—"}</dd></div>
              <div><dt>Peso entregado</dt><dd>{delivery.deliveredWeightKg ? formatWeight(delivery.deliveredWeightKg) : "—"}</dd></div>
              <div><dt>Estado de la carga</dt><dd>{delivery.cargoCondition === "conforme" ? "Conforme" : "Con novedad"}</dd></div>
              <div><dt>Duración total</dt><dd>{formatDuration(delivery.at - trip.departureAt)}</dd></div>
              <div style={{ gridColumn: "span 2" }}><dt>Documentos de soporte</dt><dd>{delivery.documents?.length ? delivery.documents.join(" · ") : "—"}</dd></div>
              {delivery.attachmentUrls.length ? <div style={{ gridColumn: "1 / -1" }}><dt>Adjuntos</dt><dd style={{ fontWeight: 400 }}>{delivery.attachmentUrls.map((f) => f.fileName).join(" · ")}</dd></div> : null}
            </dl>
          </>
        ) : null}

        <div className="bm-print-signatures">
          <div><strong>Analista de monitoreo</strong>{reports[reports.length - 1]?.operatorName ?? ""}</div>
          <div><strong>Jefe de seguridad</strong>Revisó</div>
          <div><strong>Conductor</strong>{trip.driverName}</div>
        </div>
        <div className="bm-print-foot">
          <span>Documento generado por el TMS · Bitácora {trip.code}</span>
          <span>Vigilado SuperTransporte</span>
        </div>
      </article>
    </div>
  );
}

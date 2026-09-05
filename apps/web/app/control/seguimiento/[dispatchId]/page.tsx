"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { use, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { CheckpointForm } from "../../components/checkpoint-form";

const RouteMap = dynamic(() => import("../../components/route-map"), {
  ssr: false,
  loading: () => <div className="skeleton">Cargando recorrido…</div>,
});
const sources = [
  { value: "tracking", label: "Seguimiento" },
  { value: "gps", label: "Interfaz GPS" },
  { value: "mobile", label: "Movil" },
  { value: "all", label: "Todas" },
] as const;

export default function TrackingDetail({
  params,
}: {
  params: Promise<{ dispatchId: string }>;
}) {
  const { dispatchId } = use(params),
    { isAuthenticated } = useConvexAuth();
  const data = useQuery(
    api.tracking.detail,
    isAuthenticated
      ? { dispatchId: dispatchId as Id<"trackingDispatches"> }
      : "skip",
  );
  const [source, setSource] = useState<"tracking" | "gps" | "mobile" | "all">(
    "tracking",
  );
  const [checkpoint, setCheckpoint] =
      useState<Doc<"trackingCheckpoints"> | null>(null),
    [saved, setSaved] = useState(false);
  if (!data)
    return (
      <div className="skeleton" role="status">
        Cargando despacho…
      </div>
    );
  const { dispatch, reports, checkpoints, notes, positions } = data;
  return (
    <div className="tracking-workspace">
      <Link className="tracking-back" href="/control/seguimiento">
        ← Seguimiento
      </Link>
      <div className="tracking-heading">
        <div>
          <span className="eyebrow">Información del despacho</span>
          <h2>Despacho {dispatch.externalCode}</h2>
          <p>
            {dispatch.summary.origin} <span aria-hidden>→</span>{" "}
            {dispatch.summary.destination}
          </p>
        </div>
        <span className="plate-chip">{dispatch.summary.plate}</span>
      </div>
      {saved ? (
        <p className="tracking-message success" role="status">
          Seguimiento registrado.
        </p>
      ) : null}
      <section className="panel tracking-information">
        <div className="tracking-section-title">
          <h3>Información principal</h3>
          <span>
            {dispatch.queue === "pending_arrival"
              ? "Pendiente por llegada"
              : dispatch.queue === "arrived"
                ? "Llegada registrada"
                : "En ruta"}
          </span>
        </div>
        <dl className="tracking-info-grid">
          {[
            { label: "Manifiesto", value: dispatch.summary.manifest },
            { label: "Conductor", value: dispatch.summary.driver },
            { label: "Cliente", value: dispatch.summary.customer },
            { label: "Celular", value: dispatch.summary.phone },
            ...dispatch.information,
          ].map((item, index) => (
            <div key={`${item.label}-${index}`}>
              <dt>{item.label}</dt>
              <dd>{item.value || "—"}</dd>
            </div>
          ))}
        </dl>
      </section>
      {checkpoint ? (
        <CheckpointForm
          key={checkpoint._id}
          checkpoint={checkpoint}
          dispatch={dispatch}
          incidents={data.incidents}
          onClose={() => setCheckpoint(null)}
          onSaved={() => {
            setCheckpoint(null);
            setSaved(true);
          }}
        />
      ) : null}
      <section className="panel" aria-label="Información del plan de ruta">
        <div className="tracking-section-title">
          <h3>Información del plan de ruta</h3>
          <div
            className="tracking-source-tabs"
            role="tablist"
            aria-label="Origen de los reportes"
          >
            {sources.map((s) => (
              <button
                type="button"
                role="tab"
                aria-selected={source === s.value}
                key={s.value}
                onClick={() => setSource(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div
          className="tracking-table-scroll"
          role="region"
          aria-label="Plan de ruta"
          tabIndex={0}
        >
          <table className="tracking-table tracking-history">
            <thead>
              <tr>
                {[
                  "Sitio de Seguimiento",
                  "Hora/Fecha Programada",
                  "Hora/Fecha Control",
                  "Tiempo",
                  "Novedad",
                  "Hora/Fecha Novedad",
                  "Usuario",
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reports
                .filter((r) => source === "all" || r.source === source)
                .map((report) => (
                  <tr key={report._id}>
                    <td>{report.site}</td>
                    <td>{report.scheduledAt}</td>
                    <td>{report.controlAt}</td>
                    <td>{report.timeText}</td>
                    <td>{report.incidentLabel}</td>
                    <td>{report.recordedAt}</td>
                    <td>{report.controller}</td>
                  </tr>
                ))}
              {checkpoints
                .filter((c) => !c.completed)
                .map((c) => (
                  <tr className="tracking-planned-row" key={c._id}>
                    <td>
                      <button
                        type="button"
                        className="text-button"
                        disabled={!data.canReport}
                        onClick={() => {
                          setCheckpoint(c);
                          setSaved(false);
                        }}
                      >
                        {c.label}
                        {c.kind === "virtual" && !/virtual/i.test(c.label)
                          ? " (Virtual)"
                          : ""}
                      </button>
                    </td>
                    <td>{c.scheduledAt}</td>
                    <td />
                    <td>Min(s)</td>
                    <td />
                    <td />
                    <td />
                  </tr>
                ))}
              {!checkpoints.length && !reports.length ? (
                <tr>
                  <td colSpan={7} className="tracking-empty">
                    No hay puntos de control ni reportes registrados.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      {positions.length ? (
        <section className="panel" aria-label="Recorrido del vehículo">
          <div className="tracking-section-title">
            <h3>Ver recorrido del vehículo</h3>
          </div>
          <RouteMap positions={positions} />
        </section>
      ) : null}
      <section className="panel" aria-label="Notas de controlador">
        <div className="tracking-section-title">
          <h3>Información de notas de controlador</h3>
          <span>{notes.length} notas</span>
        </div>
        <div
          className="tracking-table-scroll"
          role="region"
          aria-label="Tabla de notas de controlador"
          tabIndex={0}
        >
          <table className="tracking-table tracking-notes">
            <thead>
              <tr>
                {[
                  "Sitio de Seguimiento",
                  "Novedad",
                  "Observación",
                  "Fecha",
                  "Usuario",
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {notes.map((note) => (
                <tr key={note._id}>
                  <td>{note.site}</td>
                  <td>
                    {note.special ? "[NOV-ESP] " : ""}
                    {note.incident}
                  </td>
                  <td>{note.observation}</td>
                  <td>{note.recordedAt}</td>
                  <td>{note.controller}</td>
                </tr>
              ))}
              {!notes.length ? (
                <tr>
                  <td className="tracking-empty" colSpan={5}>
                    No hay notas de controlador.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel tracking-information">
        <dl className="tracking-bottom-info">
          {[
            { label: "Observaciones generales", value: dispatch.observations },
            { label: "Medios de comunicación", value: dispatch.communications },
            { label: "Protecciones especiales", value: dispatch.protections },
          ].map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value || "—"}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

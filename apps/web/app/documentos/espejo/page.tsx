"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth, useQuery, useMutation } from "../../lib/convex-hooks";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { convexErrorMessage } from "../../lib/convex-error";
import { optionalModules } from "../../lib/modules";
import "../../control/tracking.css";
import "../../rutas/routes.css";
import { Skeleton } from "../../components/skeleton";

const processes = [
  { id: 4, label: "Manifiestos" },
  { id: 3, label: "Remesas" },
  { id: 6, label: "Cumplidos de manifiestos" },
  { id: 5, label: "Cumplidos de remesas" },
  { id: 32, label: "Anulaciones de manifiestos" },
  { id: 9, label: "Anulaciones de remesas" },
  { id: 29, label: "Anulaciones de cumplidos de manifiestos" },
  { id: 28, label: "Anulaciones de cumplidos de remesas" },
];
function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function firstDay() {
  const date = new Date(`${today()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 29);
  return date.toISOString().slice(0, 10);
}
export default function MirrorPage() {
  const { isAuthenticated } = useConvexAuth(),
    router = useRouter(),
    openTracking = useMutation(api.mirror.openTracking);
  const [dispatchCode, setDispatchCode] = useState("");
  const [processId, setProcessId] = useState(4),
    [from, setFrom] = useState(firstDay),
    [to, setTo] = useState(today),
    [search, setSearch] = useState(""),
    [cursor, setCursor] = useState<string | undefined>(),
    [selected, setSelected] = useState<Id<"rndcMirrorRecords"> | null>(null);
  const data = useQuery(
      api.mirror.list,
      isAuthenticated
        ? { process: processId, from, to, search, cursor }
        : "skip",
    ),
    detail = useQuery(
      api.mirror.related,
      isAuthenticated && selected ? { recordId: selected } : "skip",
    );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const refreshing = useRef(false);
  async function refresh(all: boolean) {
    if (refreshing.current) return;
    refreshing.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const failures: string[] = [];
    let count = 0;
    try {
      for (const p of all
        ? processes
        : processes.filter((p) => p.id === processId)) {
        setMessage(`Consultando ${p.label.toLowerCase()}…`);
        try {
          const response = await fetch("/api/rndc/mirror", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ process: p.id, from, to }),
          });
          const result = await response.json();
          if (!response.ok || !result.ok)
            throw new Error(result.error ?? "Consulta fallida.");
          count += result.count;
        } catch (e) {
          failures.push(
            `${p.label}: ${convexErrorMessage(e, "No disponible.")}`,
          );
        }
      }
      setMessage(
        `Actualización terminada: ${count} registros consultados.${failures.length ? ` ${failures.length} consultas pendientes.` : ""}`,
      );
      setError(failures.join(" · "));
      setCursor(undefined);
    } finally {
      refreshing.current = false;
      setBusy(false);
    }
  }
  if (!data)
    return (
      <Skeleton label="Cargando espejo RNDC" />
    );
  const last = data.runs.find(
    (r) =>
      r.completed && r.process === processId && r.from <= from && r.to >= to,
  );
  return (
    <div className="tracking-workspace route-workspace">
      <div className="tracking-heading">
        <div>
          <span className="eyebrow">Documentos oficiales</span>
          <h2>Espejo RNDC</h2>
          <p>
            Documentos consultados y sus relaciones · última actualización{" "}
            {last
              ? new Date(last.createdAt).toLocaleString("es-CO", {
                  timeZone: "America/Bogota",
                })
              : "sin consulta completa para este período"}
          </p>
        </div>
      </div>
      <section className="panel">
        <div className="route-toolbar">
          <label>
            Tipo de documento
            <select
              value={processId}
              disabled={busy}
              onChange={(e) => {
                setProcessId(Number(e.target.value));
                setCursor(undefined);
                setSelected(null);
              }}
            >
              {processes.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ingreso RNDC desde
            <input
              type="date"
              value={from}
              disabled={busy}
              onChange={(e) => {
                setFrom(e.target.value);
                setCursor(undefined);
              }}
            />
          </label>
          <label>
            Hasta
            <input
              type="date"
              value={to}
              disabled={busy}
              onChange={(e) => {
                setTo(e.target.value);
                setCursor(undefined);
              }}
            />
          </label>
          <label>
            Buscar en esta página
            <input
              type="search"
              placeholder="Número, placa o radicado"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCursor(undefined);
              }}
            />
          </label>
          {data.canRefresh && (
            <div className="route-actions">
              <button
                className="primary-action"
                disabled={busy}
                onClick={() => void refresh(false)}
              >
                Consultar{" "}
                {processes.find((p) => p.id === processId)?.label.toLowerCase()}
              </button>
              <button
                className="ghost-button"
                disabled={busy}
                onClick={() => void refresh(true)}
              >
                Actualizar todos
              </button>
            </div>
          )}
        </div>
        <p className="mirror-runs">
          El período usa la fecha de ingreso al RNDC. Un cumplido puede
          corresponder a un viaje anterior. Las órdenes de carga y los planes de
          ruta se administran en la operación.
        </p>
        {message && (
          <p role="status" className="tracking-message success">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="tracking-message error">
            {error}
          </p>
        )}
        <div className="tracking-table-scroll">
          <table className="tracking-table">
            <thead>
              <tr>
                {[
                  "Manifiesto",
                  "Remesa",
                  "Placa",
                  "Fecha documento",
                  "Ingreso RNDC",
                  "Radicado",
                  "Consulta",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.records.map((r) => (
                <tr key={r._id}>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => setSelected(r._id)}
                    >
                      {r.fields.NUMMANIFIESTOCARGA ||
                        r.manifest ||
                        "Ver documento"}
                    </button>
                  </td>
                  <td>{r.fields.CONSECUTIVOREMESA || r.remesa || "—"}</td>
                  <td>{r.plate || "—"}</td>
                  <td>{r.documentDate || "—"}</td>
                  <td>{r.fields.FECHAING}</td>
                  <td>{r.radicado}</td>
                  <td>
                    {new Date(r.queriedAt).toLocaleString("es-CO", {
                      timeZone: "America/Bogota",
                    })}
                  </td>
                </tr>
              ))}
              {!data.records.length && (
                <tr>
                  <td colSpan={7} className="tracking-empty">
                    No hay documentos en esta página del espejo para el período
                    seleccionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="route-actions">
          <button
            className="ghost-button"
            disabled={!cursor}
            onClick={() => setCursor(undefined)}
          >
            Primera página
          </button>
          <button
            className="ghost-button"
            disabled={!data.nextCursor}
            onClick={() => setCursor(data.nextCursor ?? undefined)}
          >
            Siguiente página
          </button>
          <span>{data.records.length} registros en esta página</span>
        </div>
      </section>
      {selected && (
        <section className="panel" aria-label="Detalle del documento RNDC">
          <div className="tracking-section-title">
            <h3>Documento y relaciones</h3>
            <button className="ghost-button" onClick={() => setSelected(null)}>
              Cerrar detalle
            </button>
          </div>
          {!detail ? (
            <p role="status">Cargando relaciones…</p>
          ) : (
            <>
              <p>
                {processes.find((p) => p.id === detail.record.process)?.label} ·
                radicado {detail.record.radicado} · empresa{" "}
                {detail.record.companyRndcNit}
              </p>
              <dl className="mirror-record-fields">
                {Object.entries(detail.record.fields).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value || "—"}</dd>
                  </div>
                ))}
              </dl>
              <div className="mirror-related">
                <h4>Manifiesto, remesas y eventos consultados</h4>
                {Array.from(
                  new Map(
                    [...detail.manifestRecords, ...detail.remesaRecords].map(
                      (r) => [r._id, r],
                    ),
                  ).values(),
                ).map((r) => (
                  <p key={r._id}>
                    <button
                      className="text-button"
                      onClick={() => setSelected(r._id)}
                    >
                      {processes.find((p) => p.id === r.process)?.label} ·{" "}
                      {r.fields.NUMMANIFIESTOCARGA ||
                        r.fields.CONSECUTIVOREMESA ||
                        "Documento"}{" "}
                      · radicado {r.radicado}
                    </button>{" "}
                    · {r.date}
                  </p>
                ))}
                <p>
                  Se muestran relaciones presentes en el espejo. La ausencia de
                  un evento no confirma el estado actual del documento.
                </p>
              </div>
              {optionalModules.trafficControl && data.canRefresh && detail.record.process === 4 && (
                <form
                  className="route-actions"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (refreshing.current) return;
                    refreshing.current = true;
                    setBusy(true);
                    setError("");
                    try {
                      const id = await openTracking({
                        recordId: detail.record._id,
                        dispatchCode,
                      });
                      router.push(`/control/seguimiento/${id}`);
                    } catch (error) {
                      setError(
                        convexErrorMessage(
                          error,
                          "No se pudo abrir seguimiento.",
                        ),
                      );
                    } finally {
                      refreshing.current = false;
                      setBusy(false);
                    }
                  }}
                >
                  <label>
                    Código de despacho
                    <input
                      required
                      maxLength={80}
                      value={dispatchCode}
                      onChange={(e) => setDispatchCode(e.target.value)}
                    />
                  </label>
                  <button
                    className="primary-action"
                    disabled={busy}
                    type="submit"
                  >
                    Abrir seguimiento de este manifiesto
                  </button>
                  <p>
                    Usa el código operativo de la empresa. El número de
                    manifiesto se conserva por separado.
                  </p>
                </form>
              )}
              {detail.evidenceUrl && (
                <a
                  className="ghost-button action-link"
                  href={detail.evidenceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Descargar evidencia de consulta
                </a>
              )}
            </>
          )}
        </section>
      )}
      <section className="panel mirror-runs">
        <h3>Últimas consultas</h3>
        {data.runs.length ? (
          <ul>
            {data.runs.map((r) => (
              <li key={r._id}>
                {processes.find((p) => p.id === r.process)?.label} · {r.from} a{" "}
                {r.to} ·{" "}
                {r.completed
                  ? `${r.count} registros`
                  : "Importación incompleta"}{" "}
                ·{" "}
                {new Date(r.createdAt).toLocaleString("es-CO", {
                  timeZone: "America/Bogota",
                })}
              </li>
            ))}
          </ul>
        ) : (
          <p>No hay consultas guardadas.</p>
        )}
      </section>
    </div>
  );
}

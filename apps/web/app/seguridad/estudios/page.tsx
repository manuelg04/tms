"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { STUDY_STATUSES, STUDY_STATUS_LABELS, studyProgress, type StudyStatus } from "../../../convex/model/securityStudies";
import { formatDate, formatDateTime, relativePast, useNow } from "../../control/bitacora/components/format";
import "../../control/bitacora/bitacora.css";
import "./estudios.css";

type Tab = "abiertos" | StudyStatus | "todos";

export default function SecurityStudiesBoard() {
  const { isAuthenticated } = useConvexAuth();
  const data = useQuery(api.securityStudies.board, isAuthenticated ? {} : "skip");
  const [tab, setTab] = useState<Tab>("abiertos");
  const [search, setSearch] = useState("");
  const now = useNow();
  const router = useRouter();
  const studies = data?.studies ?? [];
  const byStatus = (status: StudyStatus) => studies.filter((s) => s.status === status);
  const open = studies.filter((s) => s.status === "pendiente" || s.status === "en_estudio");
  const withFindings = open.filter((s) => studyProgress(s).findings > 0);

  const visible = useMemo(() => {
    const base = tab === "abiertos" ? open : tab === "todos" ? studies : byStatus(tab);
    const needle = search.trim().toLocaleLowerCase("es");
    if (!needle) return base;
    return base.filter((s) => [s.code, s.driverName, s.driverDocument, s.customer, s.plate].filter(Boolean).some((v) => String(v).toLocaleLowerCase("es").includes(needle)));
  }, [tab, search, studies, open]);

  if (!data) return <div className="skeleton" role="status">Cargando estudios…</div>;
  const client = data.viewer === "client";

  return (
    <div className="bm-workspace">
      <div className="bm-heading">
        <div>
          <span className="eyebrow">{client ? "Vista de empresa cliente" : "Seguridad"}</span>
          <h2>{client ? `Conductores estudiados para ${data.customerName ?? "su empresa"}` : "Estudios de seguridad de conductores"}</h2>
          <p>{client ? "Resultado de los estudios de seguridad de los conductores propuestos para su operación. Vista de solo lectura." : "Expediente documental de cada conductor, consultas de antecedentes y decisión de aprobación según los criterios de cada empresa."}</p>
        </div>
        {data.canManage ? (
          <div className="bm-heading-actions">
            <Link className="primary-action" href="/seguridad/estudios/nuevo">+ Nuevo estudio</Link>
          </div>
        ) : null}
      </div>

      <div className="bm-metrics">
        <Metric label="Pendientes" value={byStatus("pendiente").length} foot="Sin iniciar consultas" tone={byStatus("pendiente").length ? "soon" : undefined} />
        <Metric label="En estudio" value={byStatus("en_estudio").length} foot="Consultas en curso" />
        <Metric label="Con hallazgos" value={withFindings.length} foot="Abiertos con antecedentes o multas" tone={withFindings.length ? "late" : "ok"} />
        <Metric label="Aprobados" value={byStatus("aprobado").length} foot="Conductores habilitados" tone="ok" />
        <Metric label="Rechazados" value={byStatus("rechazado").length} foot="Con motivo registrado" />
      </div>

      <section className="panel" aria-label="Estudios de seguridad">
        <div className="bm-tabs" role="tablist">
          {([["abiertos", "Abiertos", open.length], ...STUDY_STATUSES.map((s) => [s, STUDY_STATUS_LABELS[s], byStatus(s).length] as const), ["todos", "Todos", studies.length]] as Array<readonly [Tab, string, number]>).map(([key, label, count]) => (
            <button key={key} role="tab" type="button" aria-selected={tab === key} onClick={() => setTab(key)}>
              {label} <span className="count">{count}</span>
            </button>
          ))}
          <div style={{ marginLeft: "auto", padding: "4px 0 8px" }}>
            <input aria-label="Buscar estudio" placeholder="Buscar conductor, documento, empresa…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ font: "inherit", fontSize: 12.5, padding: "6px 10px", border: "1px solid var(--line-strong)", borderRadius: 6, minWidth: 260 }} />
          </div>
        </div>
        <div className="table-wrap">
          <table className="bm-table">
            <thead>
              <tr>
                <th>Estudio</th>
                <th>Conductor</th>
                <th>Empresa</th>
                <th>Consultas</th>
                <th>Estado</th>
                <th>Decisión</th>
                <th>Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((study) => (
                <StudyRow href={`/seguridad/estudios/${study._id}`} key={study._id} study={study} now={now} onOpen={() => router.push(`/seguridad/estudios/${study._id}`)} />
              ))}
              {!visible.length ? (
                <tr>
                  <td colSpan={7}>
                    <div className="bm-empty">
                      <strong>{search ? "Ningún estudio coincide con la búsqueda" : "No hay estudios en esta vista"}</strong>
                      {data.canManage && !search ? "Abre un estudio nuevo cuando llegue la hoja de vida de un conductor." : ""}
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

function StudyRow({ href, study, now, onOpen }: { href: string; study: Doc<"securityStudies">; now: number; onOpen: () => void }) {
  const progress = studyProgress(study);
  return (
    <tr onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }} tabIndex={0}>
      <td>
        <Link className="primary mono row-link" href={href} onClick={(event) => event.stopPropagation()}>{study.code}</Link>
        <span className="secondary">{study.plate ? `Placa ${study.plate}` : "Sin vehículo asignado"}</span>
      </td>
      <td>
        <span className="primary">{study.driverName}</span>
        <span className="secondary mono">CC {study.driverDocument}</span>
      </td>
      <td>
        <span className="primary">{study.customer}</span>
        <span className="secondary">{study.requestedBy ?? "—"}</span>
      </td>
      <td>
        <span className="es-progress">
          <span className="bar"><span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></span>
          {progress.done}/{progress.total}
          {progress.findings ? <span className="findings">· {progress.findings} hallazgo{progress.findings === 1 ? "" : "s"}</span> : null}
        </span>
      </td>
      <td><span className={`es-status ${study.status}`}>{STUDY_STATUS_LABELS[study.status]}</span></td>
      <td>
        {study.decidedAt ? (
          <>
            <span className="primary">{formatDate(study.decidedAt)}{study.validUntil ? ` · vigente hasta ${formatDate(study.validUntil)}` : ""}</span>
            <span className="secondary" title={study.decisionReason}>{study.decisionReason ? (study.decisionReason.length > 70 ? `${study.decisionReason.slice(0, 70)}…` : study.decisionReason) : study.decidedByName}</span>
          </>
        ) : (
          <span className="secondary">Sin decisión</span>
        )}
      </td>
      <td>
        <span className="primary">{relativePast(study.updatedAt, now)}</span>
        <span className="secondary">{formatDateTime(study.updatedAt)}</span>
      </td>
    </tr>
  );
}

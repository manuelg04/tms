"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { guidedDispatchStages } from "../../convex/model/dispatchPresentation";
import { StatusBadge } from "./status-badge";

const stageOptions = [
  { value: "", label: "Todas las etapas" },
  ...guidedDispatchStages.map((stage) => ({ value: stage.key, label: stage.label })),
  { value: "cumplido", label: "Cumplido" },
  { value: "anulado", label: "Anulado" }
];

export default function DespachosPage() {
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [rndcStatus, setRndcStatus] = useState("");
  const me = useQuery(api.access.me, {});
  const rows = useQuery(api.expedientes.list, me ? { organizationId: me.organizationId, limit: 200 } : "skip");
  const filtered = useMemo(() => {
    if (!rows) {
      return rows;
    }

    const needle = search.trim().toLocaleLowerCase("es");
    return rows.filter((row) => {
      const matchesSearch = !needle || [
        row.expediente.code,
        row.serviceOrderCode,
        row.orderNumber,
        row.remesaNumbers.join(" "),
        row.manifestNumber,
        row.customerName,
        row.vehiclePlate,
        row.driverName,
        row.originCity,
        row.destinationCity,
        row.agencyCode
      ].some((value) => value?.toLocaleLowerCase("es").includes(needle));
      return matchesSearch
        && (!stage || row.stage === stage)
        && (!rndcStatus || row.rndcStatus === rndcStatus);
    });
  }, [rows, search, stage, rndcStatus]);
  const attention = rows?.filter((row) => row.rndcStatus === "Requiere atención" || row.rndcStatus === "Resultado incierto").length ?? 0;
  const ready = rows?.filter((row) => row.stage === "envio_rndc").length ?? 0;
  const inOperation = rows?.filter((row) => ["cargue_descargue", "cumplido_inicial", "cumplido_final"].includes(row.stage)).length ?? 0;

  return (
    <>
      <section className="dispatch-queue-intro">
        <div>
          <span className="eyebrow">Cola de trabajo</span>
          <h2>Lo que necesita atención, en orden</h2>
          <p>Cada despacho muestra su etapa real, el estado RNDC y la única acción que lo hace avanzar.</p>
        </div>
        <Link className="primary-action action-link" href="/expedientes/nuevo">Nuevo despacho</Link>
      </section>

      <section className="queue-metrics" aria-label="Resumen de despachos">
        <QueueMetric label="Requieren atención" value={attention} tone={attention > 0 ? "bad" : "neutral"} />
        <QueueMetric label="Listos para enviar" value={ready} tone="wait" />
        <QueueMetric label="En operación" value={inOperation} tone="ok" />
        <QueueMetric label="Total visible" value={filtered?.length ?? 0} tone="neutral" />
      </section>

      <section className="panel dispatch-queue-panel" aria-label="Cola de despachos">
        <div className="dispatch-filter-bar" role="search">
          <label className="filter-search">
            <span className="sr-only">Buscar despachos</span>
            <SearchIcon />
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Expediente, documento, cliente, placa, conductor o ruta"
              type="search"
              value={search}
            />
          </label>
          <label>
            <span className="sr-only">Filtrar por etapa</span>
            <select onChange={(event) => setStage(event.target.value)} value={stage}>
              {stageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Filtrar por estado RNDC</span>
            <select onChange={(event) => setRndcStatus(event.target.value)} value={rndcStatus}>
              <option value="">Todos los estados RNDC</option>
              <option value="Pendiente">Pendiente</option>
              <option value="En proceso">En proceso</option>
              <option value="Autorizado">Autorizado</option>
              <option value="Requiere atención">Requiere atención</option>
              <option value="Resultado incierto">Resultado incierto</option>
            </select>
          </label>
          {(search || stage || rndcStatus) ? (
            <button className="text-button" onClick={() => { setSearch(""); setStage(""); setRndcStatus(""); }} type="button">Limpiar</button>
          ) : null}
        </div>

        {filtered === undefined ? (
          <div className="skeleton">Organizando la cola de trabajo…</div>
        ) : filtered.length === 0 ? (
          <div className="expediente-empty">
            <strong>No hay despachos con estos filtros</strong>
            <p>Cambia los filtros o crea un nuevo despacho para comenzar.</p>
            <Link className="primary-action action-link" href="/expedientes/nuevo">Crear despacho</Link>
          </div>
        ) : (
          <div className="dispatch-queue-list">
            {filtered.map((row) => (
              <article className={row.rndcStatus === "Requiere atención" || row.rndcStatus === "Resultado incierto" ? "dispatch-row attention" : "dispatch-row"} key={row.expediente._id}>
                <div className="dispatch-identity">
                  <div className="dispatch-code-line">
                    <Link href={`/expedientes/${row.expediente._id}`}>{row.expediente.code}</Link>
                    <StatusBadge status={row.expediente.status} />
                  </div>
                  <strong>{row.customerName}</strong>
                  <span>{row.originCity} <RouteArrow /> {row.destinationCity}</span>
                </div>

                <div className="dispatch-documents">
                  <QueueValue label="Orden" value={row.orderNumber ?? "Pendiente"} />
                  <QueueValue label="Remesas" value={row.remesaNumbers.length > 0 ? row.remesaNumbers.join(", ") : "Pendientes"} />
                  <QueueValue label="Manifiesto" value={row.manifestNumber ?? "Pendiente"} />
                </div>

                <div className="dispatch-assignment">
                  <QueueValue label="Vehículo" value={row.vehiclePlate ?? "Sin asignar"} />
                  <QueueValue label="Conductor" value={row.driverName ?? "Sin asignar"} />
                  <QueueValue label="Agencia" value={row.agencyCode || "Principal"} />
                </div>

                <div className="dispatch-progress">
                  <span className={`rndc-state ${statusClass(row.rndcStatus)}`}><StateIcon status={row.rndcStatus} />{row.rndcStatus}</span>
                  <strong>{stageLabel(row.stage)}</strong>
                  {row.blockers[0] ? <small>{row.blockers[0]}</small> : <small>Sin bloqueos pendientes</small>}
                </div>

                <Link className="queue-next-action" href={`/expedientes/${row.expediente._id}`}>
                  <span>{row.nextAction}</span>
                  <RouteArrow />
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function QueueMetric({ label, tone, value }: { label: string; tone: "bad" | "wait" | "ok" | "neutral"; value: number }) {
  return <div className={`queue-metric ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function QueueValue({ label, value }: { label: string; value: string }) {
  return <div className="queue-value"><span>{label}</span><strong>{value}</strong></div>;
}

function stageLabel(stage: string): string {
  return stageOptions.find((option) => option.value === stage)?.label ?? stage;
}

function statusClass(status: string): string {
  if (status === "Autorizado") return "ok";
  if (status === "Requiere atención") return "bad";
  if (status === "Resultado incierto" || status === "En proceso") return "wait";
  return "neutral";
}

function SearchIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden><circle cx="8.5" cy="8.5" r="5" /><path d="m12.2 12.2 4 4" strokeLinecap="round" /></svg>;
}

function RouteArrow() {
  return <svg className="route-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M2.5 8h10M9 4.5 12.5 8 9 11.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function StateIcon({ status }: { status: string }) {
  if (status === "Autorizado") return <span aria-hidden>✓</span>;
  if (status === "Requiere atención") return <span aria-hidden>!</span>;
  if (status === "Resultado incierto") return <span aria-hidden>?</span>;
  return <span aria-hidden>•</span>;
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { StatusBadge } from "./status-badge";

const statusOptions = [
  { value: "", label: "Todos los estados" },
  { value: "draft", label: "Borrador" },
  { value: "ready", label: "Listo" },
  { value: "in_progress", label: "En viaje" },
  { value: "completed", label: "Completado" },
  { value: "cancelled", label: "Cancelado" }
] as const;

type StatusFilter = typeof statusOptions[number]["value"];

export default function ExpedientesPage() {
  const [status, setStatus] = useState<StatusFilter>("");
  const [search, setSearch] = useState("");
  const me = useQuery(api.access.me, {});
  const rows = useQuery(
    api.expedientes.list,
    me ? {
      organizationId: me.organizationId,
      status: status === "" ? undefined : status,
      limit: 150
    } : "skip"
  );
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es");
    if (!rows || !needle) {
      return rows;
    }

    return rows.filter((row) => [
      row.expediente.code,
      row.serviceOrderCode,
      row.customerName,
      row.originCity,
      row.destinationCity
    ].some((value) => value.toLocaleLowerCase("es").includes(needle)));
  }, [rows, search]);

  return (
    <>
      <div className="page-actions">
        <div className="filters expediente-filters" role="search">
          <select
            aria-label="Estado del expediente"
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
            value={status}
          >
            {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <input
            aria-label="Buscar expedientes"
            className="filter-input"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por expediente, cliente o ruta"
            type="search"
            value={search}
          />
        </div>
        <Link className="primary-action action-link" href="/expedientes/nuevo">Nuevo expediente</Link>
      </div>

      <section className="panel expediente-list-panel" aria-label="Listado de expedientes">
        {filtered === undefined ? (
          <div className="skeleton">Cargando expedientes…</div>
        ) : filtered.length === 0 ? (
          <div className="expediente-empty">
            <span className="empty-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 7h7l2 2h9v11H3V7Z" strokeLinejoin="round" />
                <path d="M6 7V4h6l2 2h5v3" strokeLinejoin="round" />
              </svg>
            </span>
            <strong>No hay expedientes en esta vista</strong>
            <p>Crea una orden, asigna la flota y prepara las remesas desde un solo flujo.</p>
            <Link className="primary-action action-link" href="/expedientes/nuevo">Crear primer expediente</Link>
          </div>
        ) : (
          <div className="expediente-table-wrap">
            <table className="expediente-table">
              <thead>
                <tr>
                  <th>Expediente</th>
                  <th>Cliente</th>
                  <th>Ruta</th>
                  <th>Documentos</th>
                  <th>Estado</th>
                  <th><span className="sr-only">Abrir</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.expediente._id}>
                    <td>
                      <Link className="expediente-code" href={`/expedientes/${row.expediente._id}`}>{row.expediente.code}</Link>
                      <small>Orden {row.serviceOrderCode}</small>
                    </td>
                    <td>{row.customerName}</td>
                    <td><span className="route-inline">{row.originCity}<RouteArrow />{row.destinationCity}</span></td>
                    <td>
                      <span>{row.remesaCount} {row.remesaCount === 1 ? "remesa" : "remesas"}</span>
                      {row.openNoveltyCount > 0 ? <small className="novelty-count">{row.openNoveltyCount} novedades</small> : null}
                    </td>
                    <td><StatusBadge status={row.expediente.status} /></td>
                    <td><Link className="row-arrow" aria-label={`Abrir ${row.expediente.code}`} href={`/expedientes/${row.expediente._id}`}><RouteArrow /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function RouteArrow() {
  return (
    <svg className="route-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M2.5 8h10M9 4.5 12.5 8 9 11.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

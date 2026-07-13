"use client";

import Link from "next/link";
import { apiBase, formatTimestamp, kindLabels, statusLabels } from "../lib/labels";

export type DocumentRow = {
  _id: string;
  kind: string;
  status: string;
  number?: string;
  rndcRadicado?: string;
  mode?: "dry-run" | "live";
  pdfUrlPath?: string;
  pdfArtifactId?: string;
  errorText?: string;
  updatedAt: number;
  trip: {
    code: string;
    originCity?: string;
    destinationCity?: string;
    vehiclePlate?: string;
    driverName?: string;
  } | null;
};

export function DocumentTable({ rows, emptyMessage }: { rows: DocumentRow[]; emptyMessage?: boolean }) {
  if (rows.length === 0) {
    return (
      <div className="empty-state">
        {emptyMessage === false ? (
          "No hay documentos con este filtro."
        ) : (
          <>
            Sin documentos todavía. Inicia tu primer recorrido desde{" "}
            <Link href="/expedientes/nuevo">Nuevo despacho</Link>.
          </>
        )}
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="doc-table">
      <thead>
        <tr>
          <th>Documento</th>
          <th>Ruta</th>
          <th>Placa</th>
          <th>Radicado RNDC</th>
          <th>Estado</th>
          <th>Actualizado</th>
          <th aria-label="PDF" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row._id}>
            <td>
              <div className="doc-kind">
                {kindLabels[row.kind] ?? row.kind}
                <small>{row.number ?? "—"}</small>
              </div>
            </td>
            <td>
              {row.trip?.originCity || row.trip?.destinationCity ? (
                <span className="route">
                  <b>{row.trip?.originCity ?? "?"}</b>
                  <span className="arrow">→</span>
                  <b>{row.trip?.destinationCity ?? "?"}</b>
                </span>
              ) : (
                <span className="route">{row.trip?.code ?? "—"}</span>
              )}
            </td>
            <td>{row.trip?.vehiclePlate ? <span className="plate-chip">{row.trip.vehiclePlate}</span> : "—"}</td>
            <td>
              {row.rndcRadicado ? (
                <span className="radicado">{row.rndcRadicado}</span>
              ) : (
                <span className="radicado empty">sin radicado</span>
              )}
            </td>
            <td>
              <span className={`badge ${row.status}`} title={row.errorText}>
                {statusLabels[row.status] ?? row.status}
              </span>
            </td>
            <td className="cell-date">{formatTimestamp(row.updatedAt)}</td>
            <td>
              {row.pdfArtifactId ? <a className="pdf-link" href={`/api/evidence/${row.pdfArtifactId}`}>PDF</a> : row.pdfUrlPath ? <a className="pdf-link" href={`${apiBase}${row.pdfUrlPath}`} rel="noreferrer" target="_blank">PDF</a> : null}
            </td>
          </tr>
        ))}
      </tbody>
      </table>
    </div>
  );
}

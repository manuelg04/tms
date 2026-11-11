"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "../lib/convex-hooks";
import { api } from "../../convex/_generated/api";
import { formatTimestamp } from "../lib/labels";

const scopeLabels = { orden: "Orden de cargue", remesas: "Remesas", manifiesto: "Manifiesto" } as const;

export function PendingEmissionsPanel({ canSubmit }: { canSubmit: boolean }) {
  const pending = useQuery(api.pendingEmissions.list, {});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (!pending || pending.rows.length === 0) return null;

  async function drain() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/rndc/pending-emissions/drain", { method: "POST" });
      const body = (await response.json().catch(() => null)) as { available?: boolean; processed?: Array<{ outcome: string }> } | null;
      if (!response.ok || !body) setMessage("No fue posible iniciar la transmisión.");
      else if (body.available === false) setMessage("El RNDC sigue sin servicio. Los documentos siguen en cola.");
      else {
        const done = body.processed?.filter((item) => item.outcome === "done").length ?? 0;
        setMessage(done > 0 ? `${done} ${done === 1 ? "despacho transmitido" : "despachos transmitidos"}.` : "No había despachos listos para transmitir en este momento.");
      }
    } catch {
      setMessage("No fue posible iniciar la transmisión.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel pending-emissions" aria-label="Pendientes de transmitir al RNDC" id="pendientes-rndc">
      <div className="panel-head">
        <h2>Pendientes de transmitir al RNDC</h2>
        {canSubmit && pending.waiting > 0 ? (
          <button className="text-button" disabled={busy} onClick={() => void drain()} type="button">
            {busy ? "Transmitiendo…" : "Transmitir ahora"}
          </button>
        ) : null}
      </div>
      {message ? <p className="pending-emissions-message" role="status">{message}</p> : null}
      <div className="pending-emissions-list">
        {pending.rows.map((row) => (
          <Link className="pending-emissions-row" href={`/expedientes/${row.expedienteId}`} key={row._id}>
            <strong>{row.code}</strong>
            <span>Hasta {scopeLabels[row.scope].toLowerCase()} · pedido por {row.requestedByName} · {formatTimestamp(row.requestedAt)}</span>
            <em className={row.status === "attention" ? "bad" : "wait"}>
              {row.status === "attention" ? `Requiere revisión${row.lastError ? `: ${row.lastError}` : ""}` : "En cola"}
            </em>
          </Link>
        ))}
      </div>
    </section>
  );
}

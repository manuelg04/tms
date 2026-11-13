"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useQuery } from "../../lib/convex-hooks";
import "./operaciones-panel.css";

type Row = { key: string; label: string; number?: string; tone: "ok" | "wait" | "bad" | "muted"; state: string; detail?: string };

const expected: Array<{ kind: "loading_order" | "manifest_numbers" | "official_remesa" | "official_manifest"; label: string }> = [
  { kind: "loading_order", label: "Orden de cargue" },
  { kind: "manifest_numbers", label: "Números de manifiesto y remesa" },
  { kind: "official_remesa", label: "Remesa" },
  { kind: "official_manifest", label: "Manifiesto" }
];

export function OperacionesPanel({ expedienteId, canSend }: { expedienteId: Id<"expedientes">; canSend: boolean }) {
  const data = useQuery(api.operaciones.forDispatch, { expedienteId });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const refreshed = useRef(false);
  const send = useCallback(async (quiet: boolean) => {
    setSending(true);
    if (!quiet) setError("");
    try {
      const response = await fetch(`/api/operaciones/entregas/${expedienteId}`, { method: "POST" });
      if (!response.ok && !quiet) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        setError(body?.error ?? "No fue posible enviar los documentos a Operaciones");
      }
    } catch {
      if (!quiet) setError("No fue posible enviar los documentos a Operaciones");
    } finally {
      setSending(false);
    }
  }, [expedienteId]);
  const hasWaiting = Boolean(data?.deliveries.some((item) => item.status === "pending"));

  useEffect(() => {
    if (!canSend || !hasWaiting || refreshed.current) return;
    refreshed.current = true;
    void send(true);
  }, [canSend, hasWaiting, send]);

  if (!data) return null;

  const rows: Row[] = expected.map((entry) => {
    const ready = data.ready.find((item) => item.kind === entry.kind);
    const delivery = ready
      ? data.deliveries.find((item) => item.deliveryKey === ready.deliveryKey)
      : data.deliveries.filter((item) => item.kind === entry.kind).sort((left, right) => right.updatedAt - left.updatedAt)[0];
    const number = ready?.number ?? delivery?.number;

    if (delivery?.status === "applied") return { key: entry.kind, label: entry.label, number, tone: "ok", state: "En Operaciones", detail: delivery.message };
    if (delivery?.status === "pending") return { key: entry.kind, label: entry.label, number, tone: "wait", state: "Recibido, en espera", detail: delivery.message };
    if (delivery?.status === "failed") return { key: entry.kind, label: entry.label, number, tone: "bad", state: "No entró", detail: delivery.message };
    if (ready) return { key: entry.kind, label: entry.label, number, tone: "wait", state: "Listo para enviar" };
    return { key: entry.kind, label: entry.label, tone: "muted", state: "Aún no se emite en el TMS" };
  });
  const unsent = data.ready.some((item) => !data.deliveries.some((delivery) => delivery.deliveryKey === item.deliveryKey && delivery.status !== "failed"));
  const failed = data.deliveries.some((item) => item.status === "failed" && data.ready.some((ready) => ready.deliveryKey === item.deliveryKey));
  const action = unsent || failed ? "Enviar ahora" : hasWaiting ? "Actualizar estado" : null;

  return (
    <section className="panel operaciones-panel" aria-label="Documentos enviados a MTM Operaciones">
      <header>
        <div>
          <h3>MTM Operaciones</h3>
          <p>Este despacho nació de la solicitud de planilla de la placa {data.link.plate ?? "sin placa"}{data.link.driverName ? ` · ${data.link.driverName}` : ""}. Los documentos emitidos llegan solos a su expediente.</p>
        </div>
        {canSend && action ? <button className="ghost-button" disabled={sending} onClick={() => void send(false)} type="button">{sending ? "Consultando…" : action}</button> : null}
      </header>
      <ul>
        {rows.map((row) => (
          <li className={`tone-${row.tone}`} key={row.key}>
            <span className="operaciones-doc">{row.label}{row.number ? <em>{row.number}</em> : null}</span>
            <span className={`rndc-state state-${row.tone}`}><i aria-hidden />{row.state}</span>
            {row.detail ? <small>{row.detail}</small> : null}
          </li>
        ))}
      </ul>
      {error ? <p className="operaciones-error" role="alert">{error}</p> : null}
    </section>
  );
}

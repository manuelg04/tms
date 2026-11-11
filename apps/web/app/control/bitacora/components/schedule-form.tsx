"use client";

import { useState, type FormEvent } from "react";
import { useMutation } from "../../../lib/convex-hooks";
import { api } from "../../../../convex/_generated/api";
import type { Doc } from "../../../../convex/_generated/dataModel";
import { MAX_SCHEDULE_AHEAD_HOURS, SCHEDULE_REASONS, bogotaLocalInput, parseBogotaLocalInput } from "../../../../convex/model/monitoring";
import { convexErrorMessage } from "../../../lib/convex-error";
import { DateField } from "../../../components/fields/date-field";
import { formatInterval, formatTime } from "./format";

const intervals = [30, 60, 90, 120, 150, 180, 240, 360, 480, 720];
const MAX = 500;

export function ScheduleForm({ trip, onSaved, onAttempt }: { trip: Doc<"monitoringTrips">; onSaved: () => void; onAttempt?: () => void }) {
  const adjust = useMutation(api.monitoring.adjustSchedule);
  const [nextAt, setNextAt] = useState(() => bogotaLocalInput(trip.nextDueAt ?? Date.now() + trip.intervalMinutes * 60000));
  const [interval, setInterval] = useState(trip.intervalMinutes);
  const [reasonType, setReasonType] = useState<string>(SCHEDULE_REASONS[0]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [formKey, setFormKey] = useState(0);

  function preset(hours: number) {
    setNextAt(bogotaLocalInput(Date.now() + hours * 3600_000));
    setFormKey((k) => k + 1);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    onAttempt?.();
    try {
      if (!nextAt) throw new Error("Indica la hora del próximo reporte.");
      const ms = parseBogotaLocalInput(nextAt);
      if (reason.trim().length < 10) throw new Error("Explica el motivo del ajuste; queda registrado en la bitácora y en la impresión.");
      setBusy(true);
      await adjust({ tripId: trip._id, nextDueAt: ms, intervalMinutes: interval, reasonType, reason });
      setReason("");
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error && !("data" in cause) ? cause.message : convexErrorMessage(cause, "No se pudo ajustar la frecuencia."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="bm-form" onSubmit={(e) => void submit(e)}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "contents" }}>
        <p className="bm-form-intro">
          Hoy el próximo reporte está previsto para <b>{trip.nextDueAt ? formatTime(trip.nextDueAt) : "—"}</b> con frecuencia <b>{formatInterval(trip.intervalMinutes)}</b>. Ajusta la hora del próximo contacto y la frecuencia que aplica después.
        </p>
        <div className="bm-form-grid">
          <div className="field wide">
            <DateField key={formKey} className="field" label="Próximo reporte" name="nextDueAt" required value={nextAt} withTime onChange={(value) => { setNextAt(value); setError(""); }} />
            <div className="bm-presets" role="group" aria-label="Atajos de hora">
              {[["+1 h", 1], ["+2 h", 2], ["+4 h", 4], ["+8 h", 8]].map(([label, hours]) => (
                <button key={label} type="button" className="text-button" onClick={() => preset(Number(hours))}>{label}</button>
              ))}
              <button type="button" className="text-button" onClick={() => { const d = new Date(Date.now() - 5 * 3600_000); d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(6, 0, 0, 0); setNextAt(bogotaLocalInput(d.getTime() + 5 * 3600_000)); setFormKey((k) => k + 1); }}>Mañana 06:00</button>
            </div>
            <small className="bm-field-hint">Máximo {MAX_SCHEDULE_AHEAD_HOURS} horas desde ahora.</small>
          </div>
          <label className="field wide">
            <span>Frecuencia después de ese reporte</span>
            <select value={interval} onChange={(e) => setInterval(Number(e.target.value))}>
              {intervals.map((value) => <option key={value} value={value}>{formatInterval(value).replace(/^cada /, "Cada ")}{value === trip.intervalMinutes ? " (actual)" : ""}</option>)}
            </select>
          </label>
          <label className="field wide">
            <span>Motivo del ajuste</span>
            <select value={reasonType} onChange={(e) => setReasonType(e.target.value)}>
              {SCHEDULE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="field wide">
            <span>Justificación <small>queda en la bitácora y en el documento impreso</small></span>
            <textarea
              required
              maxLength={MAX}
              placeholder="Ej. Conductor pernocta en parqueadero vigilado del hotel en San Gil. Se retoma el monitoreo a las 06:00."
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, MAX))}
            />
            <small className="counter">{MAX - reason.length} caracteres disponibles</small>
          </label>
        </div>
        {error ? <p className="bm-message error" role="alert">{error}</p> : null}
        <div className="bm-form-actions">
          <button className="primary-action" type="submit">{busy ? "Guardando…" : "Guardar ajuste"}</button>
        </div>
      </fieldset>
    </form>
  );
}

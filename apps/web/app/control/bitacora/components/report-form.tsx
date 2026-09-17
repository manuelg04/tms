"use client";

import { useRef, useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Doc } from "../../../../convex/_generated/dataModel";
import { NOVELTY_TYPES, bogotaLocalInput, parseBogotaLocalInput } from "../../../../convex/model/monitoring";
import { convexErrorMessage } from "../../../lib/convex-error";

const MAX = 1000;

export function ReportForm({ trip, onSaved }: { trip: Doc<"monitoringTrips">; onSaved: () => void }) {
  const save = useMutation(api.monitoring.addReport);
  const [at, setAt] = useState(() => bogotaLocalInput(Date.now()));
  const [location, setLocation] = useState("");
  const [channel, setChannel] = useState<"llamada" | "whatsapp" | "otro">("llamada");
  const [contacted, setContacted] = useState(true);
  const [hasNovelty, setHasNovelty] = useState(false);
  const [noveltyType, setNoveltyType] = useState<string>(NOVELTY_TYPES[0]);
  const [observation, setObservation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestKey = useRef<string | null>(null);
  const suggestions = [...trip.waypoints, trip.destination.split(",")[0]];

  function setContact(value: boolean) {
    setContacted(value);
    if (!value) {
      setHasNovelty(true);
      setNoveltyType("Sin contacto con el conductor");
    } else if (noveltyType === "Sin contacto con el conductor") {
      setHasNovelty(false);
      setNoveltyType(NOVELTY_TYPES[0]);
    }
  }

  function reset() {
    setAt(bogotaLocalInput(Date.now()));
    setLocation("");
    setChannel("llamada");
    setContacted(true);
    setHasNovelty(false);
    setNoveltyType(NOVELTY_TYPES[0]);
    setObservation("");
    setError("");
    requestKey.current = null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    try {
      const ms = parseBogotaLocalInput(at);
      if (!location.trim()) throw new Error("Indica el lugar o municipio desde donde reporta el conductor.");
      if (!observation.trim()) throw new Error("Escribe qué se conversó en el reporte.");
      requestKey.current ??= crypto.randomUUID();
      setBusy(true);
      await save({
        tripId: trip._id,
        requestKey: requestKey.current,
        at: ms,
        location,
        channel,
        contacted,
        hasNovelty,
        noveltyType: hasNovelty ? noveltyType : undefined,
        observation,
      });
      reset();
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error && !("data" in reason) ? reason.message : convexErrorMessage(reason, "No se pudo guardar el reporte."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="bm-form" onSubmit={(e) => void submit(e)}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "contents" }}>
        <div className="bm-form-grid">
          <label className="field wide">
            <span>Fecha y hora del reporte</span>
            <input type="datetime-local" required value={at} onChange={(e) => { setAt(e.target.value); requestKey.current = null; }} />
          </label>
          <label className="field wide">
            <span>Lugar o municipio <small>¿por dónde va?</small></span>
            <input list="bm-route-suggestions" required placeholder="Ej. San Gil" value={location} onChange={(e) => { setLocation(e.target.value); requestKey.current = null; }} />
            <datalist id="bm-route-suggestions">
              {suggestions.map((s) => <option key={s} value={s} />)}
            </datalist>
          </label>
          <div className="field wide">
            <span>Medio de contacto</span>
            <div className="bm-segment" role="group" aria-label="Medio de contacto">
              {([["llamada", "Llamada"], ["whatsapp", "WhatsApp"], ["otro", "Otro"]] as const).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={channel === value} onClick={() => { setChannel(value); requestKey.current = null; }}>{label}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>¿Contestó el conductor?</span>
            <div className="bm-segment" role="group" aria-label="Contacto con el conductor">
              <button type="button" className="good" aria-pressed={contacted} onClick={() => { setContact(true); requestKey.current = null; }}>Sí</button>
              <button type="button" className="warn" aria-pressed={!contacted} onClick={() => { setContact(false); requestKey.current = null; }}>No</button>
            </div>
          </div>
          <div className="field">
            <span>Estado del viaje</span>
            <div className="bm-segment" role="group" aria-label="Estado del viaje">
              <button type="button" className="good" aria-pressed={!hasNovelty} onClick={() => { setHasNovelty(false); requestKey.current = null; }}>Sin novedad</button>
              <button type="button" className="warn" aria-pressed={hasNovelty} onClick={() => { setHasNovelty(true); requestKey.current = null; }}>Con novedad</button>
            </div>
          </div>
          {hasNovelty ? (
            <label className="field wide">
              <span>Tipo de novedad</span>
              <select value={noveltyType} onChange={(e) => { setNoveltyType(e.target.value); requestKey.current = null; }}>
                {[...NOVELTY_TYPES, "Sin contacto con el conductor"].filter((v, i, a) => a.indexOf(v) === i).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          ) : null}
          <label className="field wide">
            <span>Observación <small>qué se conversó</small></span>
            <textarea
              required
              maxLength={MAX}
              placeholder="Ej. Conductor reporta paso por San Gil. Vía en buen estado, carga sin novedad."
              value={observation}
              onChange={(e) => { setObservation(e.target.value.slice(0, MAX)); requestKey.current = null; }}
            />
            <small className="counter">{MAX - observation.length} caracteres disponibles</small>
          </label>
        </div>
        {error ? <p className="bm-message error" role="alert">{error}</p> : null}
        <div className="bm-form-actions">
          <button className="primary-action" type="submit">{busy ? "Guardando…" : "Guardar reporte"}</button>
          <button className="ghost-button" type="button" onClick={reset}>Limpiar</button>
        </div>
      </fieldset>
    </form>
  );
}

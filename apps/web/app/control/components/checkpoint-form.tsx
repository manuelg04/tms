"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import {
  bogotaDateTime,
  incidentLabel,
  normalizeTrackingText,
} from "../../../convex/model/tracking";
import { convexErrorMessage } from "../../lib/convex-error";
import { SearchPicker } from "./search-picker";

export function CheckpointForm({
  checkpoint,
  dispatch,
  incidents,
  onClose,
  onSaved,
}: {
  checkpoint: Doc<"trackingCheckpoints">;
  dispatch: Doc<"trackingDispatches">;
  incidents: Doc<"trackingIncidents">[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const save = useMutation(api.tracking.reportCheckpoint);
  const [selected, setSelected] = useState<Doc<"trackingIncidents"> | null>(
      null,
    ),
    [search, setSearch] = useState("");
  const [position, setPosition] = useState<"A" | "S">(
    checkpoint.kind === "delivery" ? "S" : "A",
  );
  const [site, setSite] = useState(
      checkpoint.kind === "physical" ? "" : checkpoint.label,
    ),
    [observation, setObservation] = useState("");
  const [now, setNow] = useState(() => bogotaDateTime()),
    [requested, setRequested] = useState(() => bogotaDateTime());
  const [revision, setRevision] = useState(dispatch.revision),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const requestKey = useRef<string | null>(null),
    inFlight = useRef(false);
  const places = useQuery(
    api.tracking.locations,
    site.trim().length >= 5 && checkpoint.kind !== "delivery"
      ? { search: site }
      : "skip",
  );
  const options = useMemo(
    () =>
      search.length >= 2 && !selected
        ? incidents
            .filter((i) =>
              normalizeTrackingText(i.name).includes(
                normalizeTrackingText(search),
              ),
            )
            .map((i) => ({ key: i.code, label: incidentLabel(i) }))
        : [],
    [incidents, search, selected],
  );
  const stale = revision !== dispatch.revision;
  useEffect(() => {
    document.getElementById("checkpoint-heading")?.focus();
  }, []);
  function changeIncident(code: string) {
    const incident = incidents.find((i) => i.code === code);
    if (!incident) return;
    setSelected(incident);
    setSearch(incidentLabel(incident));
    setPosition(checkpoint.kind === "delivery" ? "S" : "A");
    setSite(checkpoint.kind === "delivery" ? checkpoint.label : "");
    setObservation("");
    setNow(bogotaDateTime());
    setRequested(bogotaDateTime());
    setError("");
    requestKey.current = null;
  }
  function reset() {
    setPosition(checkpoint.kind === "delivery" ? "S" : "A");
    setSite(
      checkpoint.kind === "delivery" ||
        (checkpoint.kind === "virtual" && !selected)
        ? checkpoint.label
        : "",
    );
    setObservation("");
    setRequested(now);
    setError("");
    requestKey.current = null;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!selected) {
      setError("Selecciona una novedad de la lista.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    requestKey.current ??= crypto.randomUUID();
    try {
      await save({
        dispatchId: dispatch._id,
        checkpointId: checkpoint._id,
        incidentCode: selected.code,
        position,
        site,
        observation,
        requestedAt: selected.requestsTime ? requested : undefined,
        expectedRevision: revision,
        requestKey: requestKey.current,
      });
      onSaved();
    } catch (reason) {
      setError(
        convexErrorMessage(reason, "No se pudo guardar el seguimiento."),
      );
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  return (
    <section
      className="panel checkpoint-panel"
      aria-labelledby="checkpoint-heading"
    >
      <div className="tracking-section-title">
        <div>
          <span className="eyebrow">Sitio de seguimiento</span>
          <h3 id="checkpoint-heading" tabIndex={-1}>
            {checkpoint.label}
          </h3>
        </div>
        <button
          type="button"
          disabled={busy}
          className="ghost-button"
          onClick={onClose}
        >
          Volver al plan
        </button>
      </div>
      <form onSubmit={(e) => void submit(e)}>
        <fieldset disabled={busy}>
          <legend className="sr-only">
            Asignación del sitio de seguimiento y novedad
          </legend>
          <div className="tracking-form-grid">
            <label>
              <span>Fecha</span>
              <input readOnly value={now.slice(0, 10)} />
            </label>
            <label>
              <span>Hora</span>
              <input readOnly value={now.slice(11)} />
            </label>
            <div className="tracking-span-two">
              <SearchPicker
                label="Novedad"
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setSelected(null);
                  requestKey.current = null;
                }}
                options={options}
                onSelect={changeIncident}
              />
            </div>
            {selected?.requestsTime ? (
              <>
                <label>
                  <span>Tiempo Fecha</span>
                  <input
                    type="date"
                    required
                    value={requested.slice(0, 10)}
                    onChange={(e) => {
                      setRequested(`${e.target.value} ${requested.slice(11)}`);
                      requestKey.current = null;
                    }}
                  />
                </label>
                <label>
                  <span>Tiempo Hora</span>
                  <input
                    type="time"
                    required
                    value={requested.slice(11)}
                    onChange={(e) => {
                      setRequested(
                        `${requested.slice(0, 10)} ${e.target.value}`,
                      );
                      requestKey.current = null;
                    }}
                  />
                </label>
              </>
            ) : null}
            <label>
              <span>Antes/Sitio</span>
              <select
                value={position}
                onChange={(e) => {
                  setPosition(e.target.value as "A" | "S");
                  requestKey.current = null;
                }}
              >
                {checkpoint.kind !== "delivery" ? (
                  <option value="A">Antes</option>
                ) : null}
                <option value="S">Sitio</option>
              </select>
            </label>
            <SearchPicker
              label="Sitio"
              value={site}
              readOnly={
                checkpoint.kind === "delivery" ||
                (checkpoint.kind === "virtual" && !selected)
              }
              onChange={(value) => {
                setSite(value);
                requestKey.current = null;
              }}
              options={(places ?? []).map((p) => ({
                key: p.key,
                label: p.name,
              }))}
              onSelect={(key) => {
                setSite(places?.find((p) => p.key === key)?.name ?? site);
                requestKey.current = null;
              }}
            />
            <label className="tracking-full">
              <span id="tracking-observation-label">Observación</span>
              <textarea
                aria-labelledby="tracking-observation-label"
                aria-describedby="tracking-observation-count"
                rows={4}
                maxLength={500}
                value={observation}
                onChange={(e) => {
                  setObservation(e.target.value.slice(0, 500));
                  requestKey.current = null;
                }}
              />
              <small id="tracking-observation-count">
                Queda(n) {500 - observation.length} Caracter(es) para Escribir
              </small>
            </label>
          </div>
          {stale ? (
            <div role="alert" className="tracking-message">
              El seguimiento cambió mientras completabas el reporte. Revisa el
              historial actualizado antes de continuar.
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setRevision(dispatch.revision);
                  requestKey.current = null;
                  setError("");
                }}
              >
                Usar información actualizada
              </button>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="tracking-message error">
              {error}
            </p>
          ) : null}
          <div className="tracking-form-actions">
            <button
              type="submit"
              className="primary-action"
              disabled={stale || busy}
            >
              {busy ? "Guardando…" : "Aceptar"}
            </button>
            <button type="button" className="ghost-button" onClick={reset}>
              Borrar
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}

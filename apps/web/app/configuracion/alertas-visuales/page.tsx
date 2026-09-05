"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { normalizeAlarm, readableColor } from "../../../convex/model/tracking";
import { convexErrorMessage } from "../../lib/convex-error";
import "../../control/tracking.css";

const hex = ["00", "33", "66", "99", "CC", "FF"];
const palette = hex.flatMap((r) =>
  hex.flatMap((g) => hex.map((b) => r + g + b)),
);

export default function VisualAlarmsPage() {
  const { isAuthenticated } = useConvexAuth();
  const data = useQuery(api.tracking.alarms, isAuthenticated ? {} : "skip");
  const save = useMutation(api.tracking.saveAlarm),
    remove = useMutation(api.tracking.deleteAlarm);
  const [editing, setEditing] = useState<Doc<"trackingAlarms"> | "new" | null>(
      null,
    ),
    [deleting, setDeleting] = useState<Doc<"trackingAlarms"> | null>(null);
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    inFlight = useRef(false);
  useEffect(() => {
    if (deleting) dialog.current?.showModal();
    else dialog.current?.close();
  }, [deleting]);
  if (!data)
    return (
      <div className="skeleton" role="status">
        Cargando alertas visuales…
      </div>
    );
  async function deleteSelected() {
    if (!deleting || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await remove({
        alarmId: deleting._id,
        expectedRevision: deleting.revision,
      });
      setDeleting(null);
      setMessage("Alarma eliminada.");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="tracking-workspace">
      <Link className="tracking-back" href="/control/seguimiento">
        ← Seguimiento
      </Link>
      <div className="tracking-heading">
        <div>
          <span className="eyebrow">Configuración</span>
          <h2>Alertas visuales</h2>
          <p>Nombre, tiempo y color de las alarmas de seguimiento</p>
        </div>
        {data.canConfigure ? (
          <button
            type="button"
            className="primary-action"
            onClick={() => {
              setEditing("new");
              setMessage("");
            }}
          >
            Insertar alarma
          </button>
        ) : null}
      </div>
      {message ? (
        <p className="tracking-message success" role="status">
          {message}
        </p>
      ) : null}
      <section className="panel">
        <div className="tracking-section-title">
          <h3>Alarmas</h3>
          <span>{data.alarms.length} registros</span>
        </div>
        <div className="tracking-table-scroll">
          <table className="tracking-table alarm-table">
            <thead>
              <tr>
                <th>Código Alarma</th>
                <th>Nombre</th>
                <th>Tiempo de Alarma</th>
                <th>Color</th>
                {data.canConfigure ? <th>Acciones</th> : null}
              </tr>
            </thead>
            <tbody>
              {data.alarms.map((alarm) => (
                <tr key={alarm._id}>
                  <td>{alarm.code}</td>
                  <td>{alarm.name}</td>
                  <td>{alarm.minutes} Min</td>
                  <td>
                    <span
                      className="alarm-color"
                      style={{
                        backgroundColor: `#${alarm.color}`,
                        color: readableColor(alarm.color),
                      }}
                    >
                      {alarm.color}
                    </span>
                  </td>
                  {data.canConfigure ? (
                    <td>
                      <div className="alarm-actions">
                        <button
                          type="button"
                          className="text-button"
                          aria-label={`Actualizar ${alarm.name}`}
                          onClick={() => {
                            setEditing(alarm);
                            setMessage("");
                          }}
                        >
                          Actualizar
                        </button>
                        <button
                          type="button"
                          className="text-button alarm-delete"
                          aria-label={`Eliminar ${alarm.name}`}
                          onClick={() => {
                            setDeleting(alarm);
                            setError("");
                          }}
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
              {!data.alarms.length ? (
                <tr>
                  <td
                    className="tracking-empty"
                    colSpan={data.canConfigure ? 5 : 4}
                  >
                    No hay alarmas configuradas.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      {editing && data.canConfigure ? (
        <AlarmForm
          key={editing === "new" ? "new" : editing._id}
          alarm={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={async (values) => {
            await save({
              ...values,
              alarmId: editing === "new" ? undefined : editing._id,
              expectedRevision:
                editing === "new" ? undefined : editing.revision,
            });
            setEditing(null);
            setMessage("Alarma guardada.");
          }}
        />
      ) : null}
      <dialog
        ref={dialog}
        className="tracking-dialog"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setDeleting(null);
        }}
        aria-labelledby="delete-alarm-title"
      >
        <h3 id="delete-alarm-title">¿Desea eliminar la alarma?</h3>
        <p>
          {deleting?.name} · {deleting?.minutes} Min
        </p>
        {error ? (
          <p role="alert" className="tracking-message error">
            {error}
          </p>
        ) : null}
        <div className="tracking-form-actions">
          <button
            type="button"
            className="ghost-button"
            disabled={busy}
            onClick={() => setDeleting(null)}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={busy}
            onClick={() => void deleteSelected()}
          >
            {busy ? "Eliminando…" : "Eliminar"}
          </button>
        </div>
      </dialog>
    </div>
  );
}

function AlarmForm({
  alarm,
  onSave,
  onCancel,
}: {
  alarm: Doc<"trackingAlarms"> | null;
  onSave: (values: {
    name: string;
    minutes: string;
    color: string;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const initial = {
    name: alarm?.name ?? "",
    minutes: alarm ? String(alarm.minutes) : "",
    color: alarm?.color ?? "",
  };
  const [values, setValues] = useState(initial),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null),
    inFlight = useRef(false),
    paletteRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    setError("");
    try {
      normalizeAlarm(values);
    } catch (reason) {
      setError(errorText(reason));
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      await onSave(values);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  return (
    <section className="panel alarm-form">
      <div className="tracking-section-title">
        <h3 tabIndex={-1} ref={heading}>
          {alarm ? `Actualizar alarma ${alarm.code}` : "Insertar alarma"}
        </h3>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy}>
          <legend className="sr-only">Datos de la alarma</legend>
          <div className="tracking-form-grid">
            <label>
              <span>Nombre</span>
              <input
                required
                maxLength={10}
                value={values.name}
                onChange={(e) => setValues({ ...values, name: e.target.value })}
              />
            </label>
            <label>
              <span>Tiempo de Alarma</span>
              <input
                required
                type="text"
                inputMode="numeric"
                maxLength={3}
                value={values.minutes}
                onChange={(e) =>
                  setValues({ ...values, minutes: e.target.value })
                }
              />
            </label>
            <label>
              <span>Color</span>
              <input
                required
                maxLength={7}
                placeholder="33FF99"
                value={values.color}
                onChange={(e) =>
                  setValues({ ...values, color: e.target.value.toUpperCase() })
                }
              />
            </label>
            <details className="alarm-palette" ref={paletteRef}>
              <summary>Elegir color</summary>
              <div>
                {palette.map((color) => (
                  <button
                    type="button"
                    key={color}
                    title={color}
                    aria-label={`Color ${color}`}
                    style={{ backgroundColor: `#${color}` }}
                    onClick={() => {
                      setValues({ ...values, color });
                      if (paletteRef.current) paletteRef.current.open = false;
                    }}
                  />
                ))}
              </div>
            </details>
          </div>
          {error ? (
            <p role="alert" className="tracking-message error">
              {error}
            </p>
          ) : null}
          <div className="tracking-form-actions">
            <button type="submit" className="primary-action">
              {busy ? "Guardando…" : "Aceptar"}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setValues(initial);
                setError("");
              }}
            >
              Borrar
            </button>
            <button type="button" className="text-button" onClick={onCancel}>
              Cancelar
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
function errorText(error: unknown) {
  return convexErrorMessage(error, "No se pudo completar la operación.");
}

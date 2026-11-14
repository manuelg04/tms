"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "../../lib/convex-hooks";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { routeName } from "../../../convex/model/routes";
import { bogotaDeparture } from "../../../convex/model/routePlanAutomation";
import { convexErrorMessage } from "../../lib/convex-error";
import "./dispatch-route-plan.css";

export function DispatchRoutePlan({ expedienteId, origin, destination }: { expedienteId: Id<"expedientes">; origin: string; destination: string }) {
  const data = useQuery(api.dispatchRoutePlans.forDispatch, { expedienteId });
  const [editing, setEditing] = useState(false);

  if (!data) return null;
  const { plan, canAssign } = data;
  const showForm = canAssign && (editing || !plan);

  return (
    <section className="panel dispatch-route-plan" aria-label="Plan de ruta del despacho">
      <header className="dispatch-route-plan-head">
        <div>
          <h3>Plan de ruta</h3>
          <p>
            {plan
              ? `Ruta ${plan.routeCode} · ${routeName(plan)} · salida ${plan.departureAt.replace("T", " ")} · llegada ${plan.stops.at(-1)?.scheduledAt ?? ""}`
              : "Este despacho aún no tiene plan de ruta."}
          </p>
        </div>
        <div className="dispatch-route-plan-actions">
          {plan ? (
            <Link className="primary-action" href={`/expedientes/${expedienteId}/plan-de-ruta`}>
              Imprimir plan de ruta
            </Link>
          ) : null}
          {plan && canAssign ? (
            <button className="ghost-button" onClick={() => setEditing((current) => !current)} type="button">
              {editing ? "Cancelar" : "Cambiar ruta"}
            </button>
          ) : null}
          <Link className="text-button" href="/rutas">
            Rutas y puestos
          </Link>
        </div>
      </header>

      {plan ? (
        <ol className="dispatch-route-plan-stops">
          {plan.stops.map((stop) => (
            <li key={stop.key}>
              <strong>{stopTitle(stop)}</strong>
              <span>{stop.scheduledAt}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {showForm ? <AssignForm destination={destination} expedienteId={expedienteId} onAssigned={() => setEditing(false)} origin={origin} /> : null}
    </section>
  );
}

function AssignForm({ expedienteId, origin, destination, onAssigned }: { expedienteId: Id<"expedientes">; origin: string; destination: string; onAssigned: () => void }) {
  const [search, setSearch] = useState("");
  const [chosenRouteId, setRouteId] = useState<string | null>(null);
  const [departure, setDeparture] = useState(() => bogotaDeparture(Date.now()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const options = useQuery(api.dispatchRoutePlans.routeOptions, { origin, destination, search: search.trim() });
  const assign = useMutation(api.dispatchRoutePlans.assign);
  const suggestedRouteId = options?.suggestedRouteId ?? "";
  const routeId = chosenRouteId ?? suggestedRouteId;
  const route = options?.routes.find((entry) => entry._id === routeId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!route || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await assign({ expedienteId, routeId: route._id, departureAt: departure, expectedRouteRevision: route.revision, requestKey: crypto.randomUUID() });
      void fetch(`/api/operaciones/entregas/${expedienteId}?pendientes=1`, { method: "POST" }).catch(() => undefined);
      onAssigned();
    } catch (reason) {
      setError(convexErrorMessage(reason, "No se pudo asignar el plan de ruta."));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <form className="dispatch-route-plan-form" onSubmit={submit}>
      <label>
        Buscar ruta
        <input
          disabled={busy}
          onChange={(event) => {
            setSearch(event.target.value);
            setRouteId(event.target.value.trim() ? "" : null);
          }}
          placeholder="Código, origen, destino o vía"
          value={search}
        />
      </label>
      <label>
        Ruta
        <select aria-label="Ruta" disabled={busy || !options} onChange={(event) => setRouteId(event.target.value)} required value={routeId}>
          <option value="">{options ? "Selecciona una ruta" : "Cargando rutas…"}</option>
          {options?.routes.map((entry) => (
            <option key={entry._id} value={entry._id}>
              {entry.code} · {routeName(entry)} · {entry.stopCount} puestos
            </option>
          ))}
        </select>
        <small>
          {!options
            ? ""
            : options.routes.length === 0
              ? "No hay rutas activas con ese criterio."
              : options.matchesTrip
                ? suggestedRouteId && routeId === suggestedRouteId
                  ? options.routes.length === 1
                    ? "Es la única ruta del catálogo para este origen y destino."
                    : "Sugerida: la última ruta usada en este trayecto."
                  : "Rutas del catálogo para el origen y destino de este despacho."
                : options.truncated
                  ? "Hay más rutas; escribe para acotar la búsqueda."
                  : ""}
        </small>
      </label>
      <label>
        Fecha y hora de salida
        <input disabled={busy} onChange={(event) => setDeparture(event.target.value)} required type="datetime-local" value={departure} />
      </label>
      <button className="primary-action" disabled={busy || !route || !departure} type="submit">
        {busy ? "Asignando…" : "Asignar plan de ruta"}
      </button>
      {error ? (
        <p className="dispatch-route-plan-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function stopTitle(stop: { label: string; kind: "physical" | "virtual" | "delivery" }): string {
  return stop.kind === "virtual" && !/virtual/i.test(stop.label) ? `${stop.label} (Virtual)` : stop.label;
}

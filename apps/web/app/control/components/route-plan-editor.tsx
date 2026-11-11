"use client";

import Link from "next/link";
import { useState, useRef, type FormEvent } from "react";
import { useQuery, useMutation } from "../../lib/convex-hooks";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
  operationalRouteStops,
  routeName,
  routeSchedule,
} from "../../../convex/model/routes";
import { convexErrorMessage } from "../../lib/convex-error";
import "../../rutas/routes.css";

export function RoutePlanEditor({
  dispatch,
  canAssign,
}: {
  dispatch: Doc<"trackingDispatches">;
  canAssign: boolean;
}) {
  const catalogue = useQuery(api.routes.catalogue, {}),
    plan = useQuery(api.routes.plan, { dispatchId: dispatch._id }),
    assign = useMutation(api.routes.assignPlan);
  const official = useQuery(api.mirror.forDispatch, {
    dispatchId: dispatch._id,
  });
  const [routeId, setRouteId] = useState(""),
    [departure, setDeparture] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const saving = useRef(false);
  const route = catalogue?.routes.find((r) => r._id === routeId);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!route || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await assign({
        dispatchId: dispatch._id,
        routeId: route._id,
        departureAt: departure,
        expectedRevision: dispatch.revision,
        expectedRouteRevision: route.revision,
        requestKey: crypto.randomUUID(),
      });
      setMessage("Plan de ruta asignado.");
    } catch (err) {
      setError(convexErrorMessage(err, "No se pudo asignar el plan."));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  if (!catalogue || plan === undefined) return null;
  return (
    <section
      className="panel route-plan-editor"
      aria-label="Asignación del plan de ruta"
    >
      <div className="tracking-section-title">
        <h3>Plan de ruta asignado</h3>
        <Link className="text-button" href="/rutas">
          Rutas y puestos
        </Link>
      </div>
      {plan ? (
        <p>
          Ruta {plan.routeCode} · versión {plan.routeRevision} ·{" "}
          {routeName(plan)} · salida {plan.departureAt.replace("T", " ")} ·
          llegada planeada {plan.stops.at(-1)?.scheduledAt}
        </p>
      ) : (
        <p>
          El plan importado del despacho conserva sus puestos y horarios. Puedes
          asignar una ruta del catálogo mientras no haya controles reportados.
        </p>
      )}
      {message && (
        <p role="status" className="tracking-message success">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="tracking-message error">
          {error}
        </p>
      )}
      {official && official.length > 0 && (
        <p>
          RNDC consultado:{" "}
          {official
            .map(
              (r) =>
                `${r.process === 4 ? "Manifiesto" : r.process === 3 ? "Remesa" : r.process === 5 || r.process === 6 ? "Cumplido" : "Evento"} ${r.fields.CONSECUTIVOREMESA || r.fields.NUMMANIFIESTOCARGA || ""} · radicado ${r.radicado}`,
            )
            .join(" / ")}{" "}
          <Link href="/documentos/espejo">Ver espejo RNDC</Link>
        </p>
      )}
      {canAssign && (
        <form onSubmit={submit}>
          <label>
            Ruta
            <select
              aria-label="Ruta"
              required
              value={routeId}
              disabled={busy}
              onChange={(e) => setRouteId(e.target.value)}
            >
              <option value="">Selecciona una ruta</option>
              {catalogue.routes
                .filter((r) => r.active)
                .map((r) => (
                  <option key={r._id} value={r._id}>
                    {r.code} · {routeName(r)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Fecha y hora de salida
            <input
              type="datetime-local"
              required
              value={departure}
              disabled={busy}
              onChange={(e) => setDeparture(e.target.value)}
            />
          </label>
          <button
            className="primary-action"
            disabled={busy || !route}
            type="submit"
          >
            {busy ? "Asignando…" : "Asignar plan de ruta"}
          </button>
          {route && departure && (
            <p>
              {route.stops.length} puestos · llegada planeada{" "}
              {(() => {
                try {
                  return routeSchedule(
                    departure,
                    operationalRouteStops(route.stops, route.source).at(-1)!
                      .minutes,
                  );
                } catch {
                  return "Revisa los tiempos de esta ruta";
                }
              })()}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

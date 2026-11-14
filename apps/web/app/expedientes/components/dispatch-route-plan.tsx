"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "../../lib/convex-hooks";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { routeName } from "../../../convex/model/routes";
import { bogotaDeparture } from "../../../convex/model/routePlanAutomation";
import { convexErrorMessage } from "../../lib/convex-error";
import { uploadMasterPhoto } from "../../maestros/nuevo/forms/master-form-utils";
import "./dispatch-route-plan.css";

export function DispatchRoutePlan({ expedienteId, origin, destination }: { expedienteId: Id<"expedientes">; origin: string; destination: string }) {
  const data = useQuery(api.dispatchRoutePlans.forDispatch, { expedienteId });
  const [editing, setEditing] = useState(false);

  if (!data) return null;
  const { plan, canAssign, photos } = data;
  const missing: Array<{ target: "vehicle" | "driver"; label: string; available: boolean }> = [
    ...(photos.vehicle ? [] : [{ target: "vehicle" as const, label: "Foto del vehículo", available: photos.hasVehicle }]),
    ...(photos.driver ? [] : [{ target: "driver" as const, label: "Foto del conductor", available: photos.hasDriver }])
  ];
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

      {missing.length ? (
        <div className="dispatch-route-plan-photos" role="status">
          <strong>
            {missing.length === 2
              ? "El plan de ruta saldrá sin la foto del vehículo ni la del conductor."
              : `El plan de ruta saldrá sin la ${missing[0].target === "vehicle" ? "foto del vehículo" : "foto del conductor"}.`}
          </strong>
          <span>
            {canAssign
              ? "Súbela aquí y queda guardada en el maestro para los próximos viajes. Imagen JPG o PNG de máximo 2 MB."
              : "Pide a un operador que la suba desde este despacho."}
          </span>
          {canAssign ? (
            <div className="dispatch-route-plan-photo-inputs">
              {missing.map((item) => (
                <PhotoUpload available={item.available} expedienteId={expedienteId} key={item.target} label={item.label} target={item.target} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

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

function PhotoUpload({ expedienteId, target, label, available }: { expedienteId: Id<"expedientes">; target: "vehicle" | "driver"; label: string; available: boolean }) {
  const generateUploadUrl = useMutation(api.fleetMasters.generateMasterUploadUrl);
  const discard = useMutation(api.fleetMasters.discardMasterUploads);
  const attach = useMutation(api.dispatchRoutePlans.attachPhoto);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    let uploaded;
    try {
      if (!["image/jpeg", "image/png"].includes(file.type)) throw new Error("La imagen debe ser JPG o PNG.");
      if (file.size > 2 * 1024 * 1024) throw new Error("La imagen no puede superar 2 MB.");
      uploaded = await uploadMasterPhoto(generateUploadUrl, file);
      await attach({ expedienteId, target, photo: uploaded });
      void fetch(`/api/operaciones/entregas/${expedienteId}?pendientes=1`, { method: "POST" }).catch(() => undefined);
    } catch (reason) {
      if (uploaded) await discard({ storageIds: [uploaded.storageId] }).catch(() => undefined);
      setError(convexErrorMessage(reason, reason instanceof Error ? reason.message : "No se pudo guardar la foto."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <label>
      {label}
      <input
        accept="image/jpeg,image/png"
        disabled={busy || !available}
        onChange={(event) => {
          void upload(event.target.files?.[0]);
          event.target.value = "";
        }}
        type="file"
      />
      <small>
        {!available
          ? target === "vehicle"
            ? "Asigna primero el vehículo al despacho."
            : "Asigna primero el conductor al despacho."
          : busy
            ? "Subiendo…"
            : error}
      </small>
    </label>
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

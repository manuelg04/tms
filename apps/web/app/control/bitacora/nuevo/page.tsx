"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { DateField } from "../../../components/fields/date-field";
import { DriverField, MunicipalityField, VehicleField, divisionLabel, type DriverPick, type VehiclePick } from "../../../components/fields/lookup-fields";
import { convexErrorMessage } from "../../../lib/convex-error";
import { bogotaLocalInput, parseBogotaLocalInput } from "../../../../convex/model/monitoring";
import "../bitacora.css";

const intervals = [
  { value: 60, label: "Cada hora" },
  { value: 120, label: "Cada 2 horas" },
  { value: 150, label: "Cada 2 horas y media" },
  { value: 180, label: "Cada 3 horas" },
  { value: 240, label: "Cada 4 horas" },
];

export default function NewMonitoringTrip() {
  const router = useRouter();
  const createTrip = useMutation(api.monitoring.createTrip);
  const [origin, setOrigin] = useState<{ code?: string; name: string }>({ name: "" });
  const [destination, setDestination] = useState<{ code?: string; name: string }>({ name: "" });
  const [waypoints, setWaypoints] = useState<string[]>([]);
  const [waypointText, setWaypointText] = useState("");
  const [deliveryWaypoints, setDeliveryWaypoints] = useState<string[]>([]);
  const [vehicle, setVehicle] = useState<VehiclePick | null>(null);
  const [driver, setDriver] = useState<DriverPick | null>(null);
  const [plate, setPlate] = useState("");
  const [trailerPlate, setTrailerPlate] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverDocument, setDriverDocument] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [customer, setCustomer] = useState("");
  const [cargo, setCargo] = useState("");
  const [manifest, setManifest] = useState("");
  const [departure, setDeparture] = useState(() => bogotaLocalInput(Date.now()));
  const [expected, setExpected] = useState("");
  const [interval, setInterval] = useState(180);
  const [observations, setObservations] = useState("");
  const [registerDeparture, setRegisterDeparture] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function addWaypoint(name: string) {
    const clean = name.trim();
    if (!clean) return;
    setWaypoints((current) => (current.includes(clean) ? current : [...current, clean]));
    setWaypointText("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    try {
      if (!origin.name.trim()) throw new Error("Selecciona o escribe el origen del viaje.");
      if (!destination.name.trim()) throw new Error("Selecciona o escribe el destino del viaje.");
      if (!departure) throw new Error("Indica la fecha y hora de salida.");
      const departureAt = parseBogotaLocalInput(departure);
      const expectedArrivalAt = expected ? parseBogotaLocalInput(expected) : undefined;
      if (expectedArrivalAt !== undefined && expectedArrivalAt <= departureAt) throw new Error("La llegada estimada debe ser posterior a la salida.");
      setBusy(true);
      const tripId = await createTrip({
        manifest: manifest || undefined,
        origin: origin.name,
        destination: destination.name,
        waypoints,
        deliveryWaypoints: deliveryWaypoints.filter((w) => waypoints.includes(w)),
        plate,
        trailerPlate: trailerPlate || undefined,
        driverName,
        driverDocument: driverDocument || undefined,
        driverPhone,
        customer,
        cargo,
        departureAt,
        expectedArrivalAt,
        intervalMinutes: interval,
        observations: observations || undefined,
        registerDeparture,
      });
      router.push(`/control/bitacora/${tripId}`);
    } catch (reason) {
      setError(reason instanceof Error && !("data" in reason) ? reason.message : convexErrorMessage(reason, "No se pudo crear el viaje."));
      setBusy(false);
    }
  }

  return (
    <div className="bm-workspace">
      <Link className="bm-back" href="/control/bitacora">← Bitácora de monitoreo</Link>
      <div className="bm-heading">
        <div>
          <span className="eyebrow">Nuevo viaje</span>
          <h2>Abrir bitácora de monitoreo</h2>
          <p>Define la ruta, el vehículo y el conductor. Desde ese momento el analista registra cada llamada de control hasta la entrega.</p>
        </div>
      </div>
      <form className="bm-new-layout" onSubmit={(e) => void submit(e)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <fieldset className="field-section" disabled={busy}>
            <legend>Ruta</legend>
            <div className="field-grid semantic">
              <MunicipalityField className="field span-6" label="Origen" name="origin" required code={origin.code} onSelect={(d) => setOrigin({ code: d.code, name: divisionLabel(d) })} onClear={() => setOrigin({ name: "" })} />
              <MunicipalityField className="field span-6" label="Destino" name="destination" required code={destination.code} onSelect={(d) => setDestination({ code: d.code, name: divisionLabel(d) })} onClear={() => setDestination({ name: "" })} />
              <div className="field wide">
                <span>Puntos de control en la ruta <small>municipios donde se espera el reporte</small></span>
                <div className="bm-inline-add">
                  <input
                    placeholder="Ej. Piedecuesta, San Gil, Socorro…"
                    value={waypointText}
                    onChange={(e) => setWaypointText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addWaypoint(waypointText);
                      }
                    }}
                  />
                  <button className="ghost-button" type="button" onClick={() => addWaypoint(waypointText)}>Agregar</button>
                </div>
                {waypoints.length ? (
                  <>
                    <div className="bm-chips" style={{ marginTop: 8 }}>
                      {waypoints.map((w, i) => {
                        const delivery = deliveryWaypoints.includes(w);
                        return (
                          <span className={`bm-chip ${delivery ? "delivery" : ""}`} key={w}>
                            {i + 1}. {w}
                            <button
                              type="button"
                              className="bm-chip-toggle"
                              aria-pressed={delivery}
                              title={delivery ? "Quitar entrega en este punto" : "Marcar como sitio de entrega parcial"}
                              onClick={() => setDeliveryWaypoints(delivery ? deliveryWaypoints.filter((x) => x !== w) : [...deliveryWaypoints, w])}
                            >
                              {delivery ? "Entrega" : "+ entrega"}
                            </button>
                            <button aria-label={`Quitar ${w}`} type="button" onClick={() => { setWaypoints(waypoints.filter((x) => x !== w)); setDeliveryWaypoints(deliveryWaypoints.filter((x) => x !== w)); }}>×</button>
                          </span>
                        );
                      })}
                    </div>
                    <small style={{ display: "block", marginTop: 6, color: "var(--ink-faint)", fontSize: 11 }}>Marca "+ entrega" en los puntos donde el conductor deja parte de la carga antes del destino final.</small>
                  </>
                ) : null}
              </div>
              <DateField className="field span-4" label="Fecha y hora de salida" name="departureAt" required value={departure} withTime onChange={setDeparture} />
              <DateField className="field span-4" label="Llegada estimada" name="expectedArrivalAt" value={expected} withTime min={departure.slice(0, 10)} onChange={setExpected} />
              <label className="field span-4">
                <span>Frecuencia de reporte</span>
                <select value={interval} onChange={(e) => setInterval(Number(e.target.value))}>
                  {intervals.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
                </select>
              </label>
            </div>
          </fieldset>

          <fieldset className="field-section" disabled={busy}>
            <legend>Vehículo y conductor</legend>
            <div className="field-grid semantic">
              <VehicleField
                className="field span-6"
                label="Buscar vehículo en maestros"
                selected={vehicle}
                onSelect={(v) => {
                  setVehicle(v);
                  setPlate(v.plate);
                  const first = v.drivers?.[0];
                  if (first && !driverName) {
                    setDriver(first);
                    setDriverName(first.name ?? "");
                    setDriverDocument(first.document);
                    setDriverPhone(first.phone ?? "");
                  }
                }}
                onClear={() => setVehicle(null)}
              />
              <DriverField
                className="field span-6"
                label="Buscar conductor en maestros"
                selected={driver}
                onSelect={(d) => {
                  setDriver(d);
                  setDriverName(d.name ?? "");
                  setDriverDocument(d.document);
                  setDriverPhone(d.phone ?? "");
                }}
                onClear={() => setDriver(null)}
              />
              <label className="field span-3">
                <span>Placa</span>
                <input required className="mono" placeholder="ABC123" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} />
              </label>
              <label className="field span-3">
                <span>Remolque <small>opcional</small></span>
                <input className="mono" placeholder="R12345" value={trailerPlate} onChange={(e) => setTrailerPlate(e.target.value.toUpperCase())} />
              </label>
              <label className="field span-6">
                <span>Nombre del conductor</span>
                <input required value={driverName} onChange={(e) => setDriverName(e.target.value)} />
              </label>
              <label className="field span-4">
                <span>Documento <small>opcional</small></span>
                <input value={driverDocument} onChange={(e) => setDriverDocument(e.target.value)} />
              </label>
              <label className="field span-4">
                <span>Celular del conductor</span>
                <input required inputMode="tel" placeholder="300 000 0000" value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} />
              </label>
            </div>
          </fieldset>

          <fieldset className="field-section" disabled={busy}>
            <legend>Cliente y carga</legend>
            <div className="field-grid semantic">
              <label className="field span-6">
                <span>Cliente</span>
                <input required value={customer} onChange={(e) => setCustomer(e.target.value)} />
              </label>
              <label className="field span-6">
                <span>Mercancía</span>
                <input required placeholder="Ej. Cemento gris en sacos · 34.000 kg" value={cargo} onChange={(e) => setCargo(e.target.value)} />
              </label>
              <label className="field span-4">
                <span>Número de manifiesto <small>opcional</small></span>
                <input className="mono" value={manifest} onChange={(e) => setManifest(e.target.value)} />
              </label>
              <label className="field wide">
                <span>Observaciones generales <small>instrucciones del cliente, protecciones, restricciones</small></span>
                <textarea rows={3} value={observations} onChange={(e) => setObservations(e.target.value)} />
              </label>
            </div>
          </fieldset>
        </div>
        <aside className="bm-new-side">
          <div className="panel">
            <h3>Qué pasa al guardar</h3>
            <ul>
              <li>El viaje queda <strong>en ruta</strong> y aparece en el tablero de monitoreo.</li>
              <li>Se programa el primer reporte según la frecuencia elegida.</li>
              <li>Cada llamada al conductor se registra con fecha, hora, lugar y observación.</li>
              <li>La entrega cierra la bitácora con los documentos de soporte.</li>
            </ul>
          </div>
          <div className="panel">
            <label className="bm-checks" style={{ margin: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={registerDeparture} onChange={(e) => setRegisterDeparture(e.target.checked)} />
                Registrar la salida como primer reporte de la bitácora
              </span>
            </label>
          </div>
          {error ? <p className="bm-message error" role="alert">{error}</p> : null}
          <button className="primary-action" disabled={busy} type="submit">{busy ? "Creando viaje…" : "Abrir bitácora"}</button>
          <Link className="ghost-button" href="/control/bitacora" style={{ textAlign: "center", textDecoration: "none" }}>Cancelar</Link>
        </aside>
      </form>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { formatDocument } from "../../components/fields/lookup-fields";
import { SearchSelect } from "../../components/fields/search-select";
import { assignmentAfterVehiclePick, vehicleColorLabel } from "./vehicle-assignment-state";

export type DriverPick = {
  _id: Id<"drivers">;
  document: string;
  name?: string;
  phone?: string;
  licenseCategory?: string;
  licenseExpiresAt?: string;
};

export type VehiclePick = {
  _id: Id<"vehicles">;
  plate: string;
  make?: string;
  line?: string;
  modelYear?: string;
  color?: string;
  trailer?: string;
  configuration?: string;
  capacityTn?: string;
  status?: string;
  soatExpiresAt?: string;
  drivers: DriverPick[];
};

export type VehicleAssignmentValue = {
  vehicle: VehiclePick | null;
  driver: DriverPick | null;
};

function expired(date: string | undefined): boolean {
  return Boolean(date && date < new Date().toISOString().slice(0, 10));
}

export function VehicleAssignmentPicker({ currentDriverDocument, currentVehiclePlate, disabled = false, onChange, value }: { currentDriverDocument?: string; currentVehiclePlate?: string; disabled?: boolean; onChange: (value: VehicleAssignmentValue) => void; value: VehicleAssignmentValue }) {
  const [plateTerm, setPlateTerm] = useState("");
  const [driverTerm, setDriverTerm] = useState("");
  const vehicles = useQuery(api.lookups.vehiclesWithDriversSearch, plateTerm.trim() ? { term: plateTerm } : "skip");
  const initialVehicles = useQuery(api.lookups.vehiclesWithDriversSearch, currentVehiclePlate && !value.vehicle ? { term: currentVehiclePlate } : "skip");
  const drivers = useQuery(api.lookups.driversLookup, driverTerm.trim().length >= 2 ? { term: driverTerm } : "skip");
  const initialDrivers = useQuery(api.lookups.driversLookup, currentDriverDocument && !value.driver ? { term: currentDriverDocument } : "skip");

  useEffect(() => {
    if (value.vehicle || !initialVehicles) return;
    const match = initialVehicles.find((row) => row.plate === currentVehiclePlate);
    if (match) onChange(assignmentAfterVehiclePick(value.driver, match));
  }, [currentVehiclePlate, initialVehicles, onChange, value.driver, value.vehicle]);

  useEffect(() => {
    if (value.driver || !initialDrivers) return;
    const match = initialDrivers.find((row) => row.document === currentDriverDocument);
    if (match) onChange({ vehicle: value.vehicle, driver: match });
  }, [currentDriverDocument, initialDrivers, onChange, value.driver, value.vehicle]);

  const linkedDrivers = value.vehicle?.drivers ?? [];
  const driverIsLinked = value.driver ? linkedDrivers.some((row) => row._id === value.driver?._id) : false;

  return (
    <>
      <SearchSelect
        disabled={disabled}
        emptyText="No hay vehículos con esa placa"
        hint={value.vehicle ? `${value.vehicle.drivers.length} conductor${value.vehicle.drivers.length === 1 ? "" : "es"} vinculado${value.vehicle.drivers.length === 1 ? "" : "s"}` : undefined}
        label="Placa del vehículo"
        minLength={2}
        mono
        onClear={() => onChange({ vehicle: null, driver: null })}
        onSearch={setPlateTerm}
        onSelect={(key) => {
          const next = vehicles?.find((row) => row._id === key);
          if (next) onChange(assignmentAfterVehiclePick(value.driver, next));
        }}
        options={vehicles?.map((row) => ({ key: row._id, title: row.plate, badge: row.status, subtitle: [row.make, row.line, row.modelYear, row.configuration].filter(Boolean).join(" · ") }))}
        placeholder="ABC123"
        required
        selectedLabel={value.vehicle?.plate}
      />
      {value.vehicle ? (
        <div className="vehicle-pick-card">
          <div><small>Placa</small><strong>{value.vehicle.plate}</strong></div>
          <div><small>Marca</small><strong>{[value.vehicle.make, value.vehicle.line].filter(Boolean).join(" ") || "—"}</strong></div>
          <div><small>Modelo</small><strong>{value.vehicle.modelYear ?? "—"}</strong></div>
          <div><small>Tráiler</small><strong>{value.vehicle.trailer ?? "—"}</strong></div>
          <div><small>Color</small><strong>{vehicleColorLabel(value.vehicle.color)}</strong></div>
          <div><small>Configuración</small><strong>{value.vehicle.configuration ?? "—"}</strong></div>
          <div><small>Capacidad</small><strong>{value.vehicle.capacityTn ? `${value.vehicle.capacityTn} TN` : "—"}</strong></div>
          <div><small>SOAT</small><strong className={expired(value.vehicle.soatExpiresAt) ? "warn" : undefined}>{value.vehicle.soatExpiresAt ? `${expired(value.vehicle.soatExpiresAt) ? "Vencido " : "Vence "}${value.vehicle.soatExpiresAt}` : "—"}</strong></div>
        </div>
      ) : null}
      {value.vehicle && linkedDrivers.length > 1 ? (
        <div className="form-field span-2">
          <span>Conductores vinculados a {value.vehicle.plate}</span>
          <div className="driver-choice-list">
            {linkedDrivers.map((row) => (
              <button className={`driver-choice ${value.driver?._id === row._id ? "selected" : ""}`} disabled={disabled} key={row._id} onClick={() => onChange({ vehicle: value.vehicle, driver: row })} type="button">
                <span>{row.name ?? "Sin nombre"}<br /><small>CC {formatDocument(row.document)}{row.licenseCategory ? ` · Licencia ${row.licenseCategory}` : ""}{expired(row.licenseExpiresAt) ? " · Licencia vencida" : ""}</small></span>
                {value.driver?._id === row._id ? <b>✓ Asignado</b> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {value.driver ? (
        <div className="vehicle-pick-card">
          <div><small>Conductor</small><strong>{value.driver.name ?? "—"}</strong></div>
          <div><small>C.C.</small><strong>{formatDocument(value.driver.document)}</strong></div>
          <div><small>Teléfono</small><strong>{value.driver.phone ?? "—"}</strong></div>
          <div><small>Licencia</small><strong className={expired(value.driver.licenseExpiresAt) ? "warn" : undefined}>{[value.driver.licenseCategory, value.driver.licenseExpiresAt ? `${expired(value.driver.licenseExpiresAt) ? "Vencida" : "Vence"} ${value.driver.licenseExpiresAt}` : undefined].filter(Boolean).join(" · ") || "—"}</strong></div>
        </div>
      ) : null}
      <SearchSelect
        className={linkedDrivers.length > 0 ? undefined : "span-2"}
        disabled={disabled}
        emptyText="No hay conductores con ese nombre o documento"
        hint={value.driver && !driverIsLinked ? `CC ${formatDocument(value.driver.document)}${value.driver.licenseCategory ? ` · Licencia ${value.driver.licenseCategory}` : ""}${expired(value.driver.licenseExpiresAt) ? " · Licencia vencida" : ""}${value.vehicle ? " · No está vinculado a esta placa en el RNDC" : ""}` : linkedDrivers.length > 1 ? "Sólo si el conductor no está en la lista de arriba" : linkedDrivers.length === 1 ? "Puedes reemplazar el conductor propuesto" : undefined}
        label={linkedDrivers.length > 0 ? "Otro conductor" : "Conductor"}
        onClear={() => onChange({ vehicle: value.vehicle, driver: null })}
        onSearch={setDriverTerm}
        onSelect={(key) => {
          const next = drivers?.find((row) => row._id === key);
          if (next) onChange({ vehicle: value.vehicle, driver: next });
        }}
        options={drivers?.map((row) => ({ key: row._id, title: row.name ?? row.document, badge: `CC ${formatDocument(row.document)}`, subtitle: [row.phone, row.licenseCategory ? `Licencia ${row.licenseCategory}` : undefined].filter(Boolean).join(" · ") || undefined }))}
        placeholder="Nombre o cédula"
        required={linkedDrivers.length === 0}
        selectedLabel={value.driver && !driverIsLinked ? (value.driver.name ?? value.driver.document) : undefined}
      />
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { vehiclePatches, driverPatches } from "./form-autofill";

type ApplyHandler = (patches: [string, string][], summary: string) => void;

export function VehicleLookup({
  value,
  onApply,
  onRegisterNew
}: {
  value: string;
  onApply: ApplyHandler;
  onRegisterNew: (typed: string) => void;
}) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const prefix = text.trim().toUpperCase();
  const results = useQuery(api.fleet.vehiclesSearch, open && prefix !== "" ? { prefix } : "skip");
  const detail = useQuery(api.fleet.vehicleDetail, selected ? { plate: selected } : "skip");

  useEffect(() => {
    if (selected && detail && detail.plate === selected) {
      const summaryParts = [detail.make, detail.modelYear, detail.trailer ? `Remolque ${detail.trailer}` : ""]
        .filter(Boolean)
        .join(" · ");
      onApply(vehiclePatches(detail), summaryParts || detail.plate);
      setSelected(null);
      setOpen(false);
    }
  }, [detail, selected, onApply]);

  return (
    <label className="field span-4 lookup">
      <span title="NUMPLACA">Placa (buscar en maestros)</span>
      <input
        autoComplete="off"
        onChange={(event) => { setText(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="JVK276"
        value={text}
      />
      {open && prefix !== "" && results !== undefined ? (
        <div className="lookup-menu">
          {results.map((row) => (
            <button
              className="lookup-option"
              key={row._id}
              onClick={() => { setText(row.plate); setSelected(row.plate); }}
              type="button"
            >
              <strong>{row.plate}</strong>
              <small>{[row.make, row.modelYear].filter(Boolean).join(" ")}</small>
            </button>
          ))}
          {results.length === 0 ? (
            <div className="lookup-empty">
              <span>No esta en maestros</span>
              <button className="ghost-button" onClick={() => onRegisterNew(prefix)} type="button">
                Registrar vehiculo
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </label>
  );
}

export function DriverLookup({
  value,
  onApply,
  onRegisterNew
}: {
  value: string;
  onApply: ApplyHandler;
  onRegisterNew: (typed: string) => void;
}) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const prefix = text.trim();
  const results = useQuery(api.fleet.driversSearch, open && prefix !== "" ? { prefix } : "skip");
  const detail = useQuery(api.fleet.driverDetail, selected ? { document: selected } : "skip");

  useEffect(() => {
    if (selected && detail && detail.document === selected) {
      const summary = [detail.name, detail.cellphone ?? detail.phone1].filter(Boolean).join(" · ");
      onApply(driverPatches(detail), summary || detail.document);
      setSelected(null);
      setOpen(false);
    }
  }, [detail, selected, onApply]);

  return (
    <label className="field span-4 lookup">
      <span title="NUMIDCONDUCTOR">Documento conductor (buscar)</span>
      <input
        autoComplete="off"
        inputMode="numeric"
        onChange={(event) => { setText(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="80756632"
        value={text}
      />
      {open && prefix !== "" && results !== undefined ? (
        <div className="lookup-menu">
          {results.map((row) => (
            <button
              className="lookup-option"
              key={row._id}
              onClick={() => { setText(row.document); setSelected(row.document); }}
              type="button"
            >
              <strong>{row.document}</strong>
              <small>{row.name ?? ""}</small>
            </button>
          ))}
          {results.length === 0 ? (
            <div className="lookup-empty">
              <span>No esta en maestros</span>
              <button className="ghost-button" onClick={() => onRegisterNew(prefix)} type="button">
                Registrar conductor
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </label>
  );
}

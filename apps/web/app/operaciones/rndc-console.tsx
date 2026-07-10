"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  apiBase,
  initialForm,
  operations,
  type FieldSection,
  type FormResult,
  type FormState,
  type Operation
} from "./operations-config";
import { readPath, setPath } from "./form-state";
import { FieldControl, FieldSectionCard } from "./field-section";
import { ActionBar } from "./action-bar";
import { ResultPanel } from "./result-panel";
import { VehicleLookup, DriverLookup } from "./lookup";
import { applyPatches } from "./form-autofill";
import { counterFieldPath, countersForOperation, formatConsecutivo, parseConsecutivo, type CounterType } from "./consecutivos";

export function RndcConsole() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [active, setActive] = useState<Operation>("loading-order");
  const [result, setResult] = useState<FormResult | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [vehicleSummary, setVehicleSummary] = useState("");
  const [driverSummary, setDriverSummary] = useState("");
  const [prefilled, setPrefilled] = useState(false);
  const activeOperation = operations.find((operation) => operation.id === active) ?? operations[0];
  const counters = useQuery(api.counters.peekAll, {});
  const nextConsecutivo = useMutation(api.counters.next);
  const ensureAtLeast = useMutation(api.counters.ensureAtLeast);
  const suggestions: Partial<Record<CounterType, string>> = {};

  for (const row of counters ?? []) {
    const type = row.documentType as CounterType;
    if (type in counterFieldPath) {
      suggestions[type] = formatConsecutivo(type, row.lastValue + 1);
    }
  }

  useEffect(() => {
    if (prefilled || !counters) return;
    setForm((current) => {
      let nextForm = current;
      for (const [type, path] of Object.entries(counterFieldPath) as [CounterType, string][]) {
        const suggestion = suggestions[type];
        if (suggestion && readPath(nextForm, path) === readPath(initialForm, path)) {
          nextForm = setPath(nextForm, path, suggestion);
        }
      }
      return nextForm;
    });
    setPrefilled(true);
  }, [counters, prefilled]);

  const missing = activeOperation.sections
    .flatMap((section) => section.fields)
    .filter((field) => isRequiredField(activeOperation.id, form, field.path, Boolean(field.required)) && readPath(form, field.path).trim() === "")
    .map((field) => field.label);

  function handleChange(path: string, value: string) {
    setForm((current) => setPath(current, path, value));
  }

  function handleRegisterNew(kind: "vehicle" | "driver", typed: string) {
    setForm((current) => setPath(current, kind === "vehicle" ? "vehicle.plate" : "driver.id", typed));
    setActive("driver-vehicle");
  }

  async function submitForm() {
    if (pending) {
      return;
    }

    setPending(true);
    setError("");

    try {
      let payload = form;
      for (const type of countersForOperation(activeOperation.id)) {
        const path = counterFieldPath[type];
        const current = readPath(payload, path);
        if (suggestions[type] !== undefined && current === suggestions[type]) {
          try {
            const consumed = await nextConsecutivo({ documentType: type });
            payload = setPath(payload, path, formatConsecutivo(type, consumed));
          } catch {
            // Sin Convex (o contador sin sembrar) el envio no se bloquea:
            // va con el numero visible en el campo, sin reservar.
          }
        }
      }
      setForm(payload);

      const response = await fetch(`${apiBase}/forms/${activeOperation.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json() as FormResult | { error?: string; missingFields?: string[] };

      if (!("steps" in body)) {
        setResult(null);
        const missing = "missingFields" in body && body.missingFields?.length ? ` Campos faltantes: ${body.missingFields.join(", ")}` : "";
        setError((body.error ?? "No se pudo completar la operacion RNDC.") + missing);
        return;
      }

      setResult(body);

      if (body.ok) {
        for (const type of countersForOperation(activeOperation.id)) {
          const manual = parseConsecutivo(readPath(payload, counterFieldPath[type]));
          if (manual !== null) {
            void ensureAtLeast({ documentType: type, value: manual }).catch(() => undefined);
          }
        }
      }

      if (!body.ok) {
        setError(body.steps.find((step) => step.errorText)?.errorText ?? "RNDC rechazo la operacion.");
      }
    } catch {
      setResult(null);
      setError("No hay conexion con el servicio RNDC local.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="panel-head" style={{ border: "none", padding: 0 }}>
        <div className="ops-tabs" role="tablist" aria-label="Tipo de operacion">
          {operations.map((operation) => (
            <button
              aria-selected={active === operation.id}
              className={active === operation.id ? "ops-tab active" : "ops-tab"}
              key={operation.id}
              onClick={() => setActive(operation.id)}
              role="tab"
              type="button"
            >
              {operation.label}
            </button>
          ))}
        </div>
      </div>

      <TripContextStrip form={form} />

      <div className="ops-layout">
        <form className="form-panel" onSubmit={(event) => { event.preventDefault(); void submitForm(); }}>
          {activeOperation.sections.map((section) => section.lookup ? (
            <LookupSection
              driverSummary={driverSummary}
              form={form}
              key={section.title}
              onChange={handleChange}
              onDriverApply={(patches, summary) => {
                setForm((current) => applyPatches(current, patches));
                setDriverSummary(summary);
              }}
              onRegisterNew={handleRegisterNew}
              onVehicleApply={(patches, summary) => {
                setForm((current) => applyPatches(current, patches));
                setVehicleSummary(summary);
              }}
              section={section}
              setDriverSummary={setDriverSummary}
              setVehicleSummary={setVehicleSummary}
              vehicleSummary={vehicleSummary}
            />
          ) : (
            <FieldSectionCard form={form} key={section.title} onChange={handleChange} section={section} />
          ))}
          <ActionBar
            label={activeOperation.action}
            missing={missing}
            onSubmit={() => void submitForm()}
            pending={pending}
          />
        </form>

        <ResultPanel
          apiBase={apiBase}
          error={error}
          plate={form.vehicle.plate}
          processIds={activeOperation.processIds}
          result={result}
          route={`${form.sender.cityName} → ${form.recipient.cityName}`}
        />
      </div>
    </>
  );
}

function isRequiredField(operation: Operation, form: FormState, path: string, required: boolean): boolean {
  if (operation === "fulfill-remesa") {
    const suspended = readPath(form, "compliance.remesaType") === "S";
    const normalOnly = new Set([
      "compliance.deliveredQuantityKg",
      "compliance.unloadingArrivalDate",
      "compliance.unloadingArrivalTime",
      "compliance.unloadingEntryDate",
      "compliance.unloadingEntryTime",
      "compliance.unloadingExitDate",
      "compliance.unloadingExitTime"
    ]);

    if (suspended && normalOnly.has(path)) {
      return false;
    }

    if (suspended && path === "compliance.remesaSuspensionReason") {
      return true;
    }
  }

  if (operation === "fulfill-manifest") {
    if (readPath(form, "compliance.manifestType") === "S" && (path === "compliance.manifestSuspensionReason" || path === "compliance.suspensionConsequence")) {
      return true;
    }

    if (path === "compliance.additionalValueReason" && readNumberPath(form, "compliance.additionalFreightValue") > 0) {
      return true;
    }

    if (path === "compliance.discountReason" && readNumberPath(form, "compliance.freightDiscountValue") > 0) {
      return true;
    }
  }

  return required;
}

function readNumberPath(form: FormState, path: string): number {
  const parsed = Number(readPath(form, path).replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function TripContextStrip({ form }: { form: FormState }) {
  return (
    <div className="context-strip">
      <span>Vehiculo <strong>{form.vehicle.plate || "—"}</strong></span>
      <span>Conductor <strong>{form.driver.fullName || form.driver.id || "—"}</strong></span>
      <span>Ruta <strong>{form.sender.cityName || "—"} → {form.recipient.cityName || "—"}</strong></span>
      <span>Carga <strong>{form.cargo.productName || "—"} · {form.cargo.quantityKg || "—"} kg</strong></span>
    </div>
  );
}

function LookupSection({
  section,
  form,
  onChange,
  onVehicleApply,
  onDriverApply,
  onRegisterNew,
  vehicleSummary,
  driverSummary,
  setVehicleSummary,
  setDriverSummary
}: {
  section: FieldSection;
  form: FormState;
  onChange: (path: string, value: string) => void;
  onVehicleApply: (patches: [string, string][], summary: string) => void;
  onDriverApply: (patches: [string, string][], summary: string) => void;
  onRegisterNew: (kind: "vehicle" | "driver", typed: string) => void;
  vehicleSummary: string;
  driverSummary: string;
  setVehicleSummary: (summary: string) => void;
  setDriverSummary: (summary: string) => void;
}) {
  return (
    <fieldset className="field-section">
      <legend>{section.title}</legend>
      {section.description ? <p className="section-desc">{section.description}</p> : null}
      <div className="field-grid semantic">
        <VehicleLookup
          onApply={onVehicleApply}
          onRegisterNew={(typed) => onRegisterNew("vehicle", typed)}
          value={form.vehicle.plate}
        />
        <DriverLookup
          onApply={onDriverApply}
          onRegisterNew={(typed) => onRegisterNew("driver", typed)}
          value={form.driver.id}
        />
        {vehicleSummary ? (
          <div className="summary-card">
            <div className="summary-main">
              <strong>{form.vehicle.plate}</strong>
              <span>{vehicleSummary}</span>
            </div>
            <button className="ghost-button" onClick={() => setVehicleSummary("")} type="button">Editar</button>
          </div>
        ) : null}
        {driverSummary ? (
          <div className="summary-card">
            <div className="summary-main">
              <strong>{form.driver.fullName || form.driver.id}</strong>
              <span>{driverSummary}</span>
            </div>
            <button className="ghost-button" onClick={() => setDriverSummary("")} type="button">Editar</button>
          </div>
        ) : null}
        {vehicleSummary && driverSummary ? null : section.fields.map((field) => (
          <FieldControl
            field={field}
            key={field.path}
            onChange={(value) => onChange(field.path, value)}
            value={readPath(form, field.path)}
          />
        ))}
      </div>
    </fieldset>
  );
}

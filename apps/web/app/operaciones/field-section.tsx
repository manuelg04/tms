"use client";

import { useState } from "react";
import type { Field, FieldSection, FormState } from "./operations-config";
import { readPath } from "./form-state";

export function FieldControl({ field, value, onChange }: { field: Field; value: string; onChange: (value: string) => void }) {
  const spanClass = field.span && field.span !== 3 ? ` span-${field.span}` : "";
  const className =
    field.type === "textarea" ? "field wide" : `field${spanClass}${field.secondary ? " secondary" : ""}`;

  return (
    <label className={className}>
      <span title={field.code}>{field.label}</span>
      {field.type === "select" ? (
        <select onChange={(event) => onChange(event.target.value)} value={value}>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      ) : field.type === "textarea" ? (
        <textarea onChange={(event) => onChange(event.target.value)} rows={4} value={value} />
      ) : (
        <input
          inputMode={field.type === "number" ? "decimal" : "text"}
          onChange={(event) => onChange(event.target.value)}
          type="text"
          value={value}
        />
      )}
    </label>
  );
}

export function FieldSectionCard({
  section,
  form,
  onChange,
  forceOpen
}: {
  section: FieldSection;
  form: FormState;
  onChange: (path: string, value: string) => void;
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(!section.collapsible);
  const expanded = forceOpen || open;

  return (
    <fieldset className="field-section">
      <legend>{section.title}</legend>
      {section.description ? <p className="section-desc">{section.description}</p> : null}
      {expanded ? (
        <div className="field-grid semantic">
          {section.fields.map((field) => (
            <FieldControl
              field={field}
              key={field.path}
              onChange={(value) => onChange(field.path, value)}
              value={readPath(form, field.path)}
            />
          ))}
        </div>
      ) : (
        <div className="section-summary">
          <span className="summary-values">{sectionSummary(section, form)}</span>
          <button className="ghost-button" onClick={() => setOpen(true)} type="button">
            Editar
          </button>
        </div>
      )}
    </fieldset>
  );
}

function sectionSummary(section: FieldSection, form: FormState): string {
  const parts = section.fields
    .filter((field) => !field.secondary && field.type !== "textarea")
    .map((field) => readPath(form, field.path))
    .filter((value) => value !== "");

  return parts.slice(0, 5).join(" · ") || "Sin datos";
}

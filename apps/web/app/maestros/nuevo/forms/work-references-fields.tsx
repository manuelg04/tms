"use client";

import { useRef, useState } from "react";
import { TextField } from "../../components/master-form-ui";

type WorkReferenceInput = {
  company: string;
  contactName?: string;
  phone?: string;
  position?: string;
  trips?: string;
  tenure?: string;
  city?: string;
  merchandise?: string;
};

const FIELD_NAMES = ["company", "contactName", "phone", "position", "trips", "tenure", "city", "merchandise"] as const;

export function WorkReferencesFields() {
  const [ids, setIds] = useState([0]);
  const nextId = useRef(1);

  function add() {
    if (ids.length >= 5) return;
    const id = nextId.current;
    nextId.current += 1;
    setIds((current) => [...current, id]);
  }

  function remove(id: number) {
    setIds((current) => current.filter((candidate) => candidate !== id));
  }

  return (
    <>
      {ids.map((id, index) => (
        <fieldset aria-label={`Referencia laboral ${index + 1}`} className="master-reference-card span-2" key={id}>
          <div className="master-reference-heading">
            <strong>Referencia laboral {index + 1}</strong>
            {ids.length > 1 ? <button aria-label={`Quitar referencia ${index + 1}`} className="text-button" onClick={() => remove(id)} type="button">Quitar</button> : null}
          </div>
          <div className="master-reference-grid">
            <TextField label="Empresa" name={`workReferences.${id}.company`} />
            <TextField label="Contacto" name={`workReferences.${id}.contactName`} />
            <TextField inputMode="tel" label="Teléfono" name={`workReferences.${id}.phone`} />
            <TextField label="Cargo" name={`workReferences.${id}.position`} />
            <TextField inputMode="numeric" label="Viajes" name={`workReferences.${id}.trips`} />
            <TextField label="Antigüedad" name={`workReferences.${id}.tenure`} />
            <TextField label="Ciudad" name={`workReferences.${id}.city`} />
            <TextField label="Mercancía" name={`workReferences.${id}.merchandise`} />
          </div>
        </fieldset>
      ))}
      <div className="master-reference-actions span-2">
        <button className="ghost-button" disabled={ids.length >= 5} onClick={add} type="button">Agregar referencia</button>
        <small>{ids.length} de 5 referencias</small>
      </div>
    </>
  );
}

export function readWorkReferences(data: FormData): WorkReferenceInput[] | undefined {
  const rows = new Map<number, Partial<Record<(typeof FIELD_NAMES)[number], string>>>();
  for (const [key, value] of data.entries()) {
    const match = /^workReferences\.(\d+)\.(company|contactName|phone|position|trips|tenure|city|merchandise)$/.exec(key);
    if (!match || typeof value !== "string") continue;
    const id = Number(match[1]);
    const field = match[2] as (typeof FIELD_NAMES)[number];
    const row = rows.get(id) ?? {};
    row[field] = value.trim();
    rows.set(id, row);
  }
  const references: WorkReferenceInput[] = [];
  for (const [, row] of [...rows.entries()].sort(([left], [right]) => left - right)) {
    if (!FIELD_NAMES.some((field) => Boolean(row[field]))) continue;
    if (!row.company) throw new Error(`Completa la empresa de la referencia laboral ${references.length + 1}.`);
    references.push({
      company: row.company,
      contactName: row.contactName || undefined,
      phone: row.phone || undefined,
      position: row.position || undefined,
      trips: row.trips || undefined,
      tenure: row.tenure || undefined,
      city: row.city || undefined,
      merchandise: row.merchandise || undefined
    });
  }
  return references.length > 0 ? references : undefined;
}

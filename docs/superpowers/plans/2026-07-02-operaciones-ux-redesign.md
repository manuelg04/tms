# Operaciones UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar los formularios de `/operaciones` (orden de cargue, remesa, manifiesto, registro) con layout jerárquico, autollenado por placa/documento desde Convex, barra de acciones al pie y contador de consecutivos.

**Architecture:** El monolito `apps/web/app/rndc-console.tsx` (563 líneas) se separa en módulos bajo `apps/web/app/operaciones/`: config pura de operaciones/campos, helpers de estado puros (testeables con node --test), componentes de sección/lookup/barra de acciones/resultado, y un orquestador delgado. El payload enviado a `POST {apiBase}/rndc/forms/{operation}` es el objeto `FormState` completo serializado — protegido por un test de igualdad profunda contra el snapshot legacy. Convex suma una tabla `counters` con mutación atómica para consecutivos.

**Tech Stack:** Next.js 16 (App Router, client components), React 19, Convex 1.42 (`convex/react` `useQuery`/`useMutation`, ya hay `ConvexProvider` en `apps/web/app/providers.tsx`), CSS artesanal en `apps/web/app/globals.css` (sin Tailwind ni librerías), tests con `node --import tsx --test` (tsx ya está hoisted en el root, Node 22).

## Global Constraints

- **NO COMMITS automáticos** (regla global de Manuel). Al final de cada tarea: `git add` de los archivos tocados, correr verificaciones, y detenerse. Manuel commitea.
- **Invariante de payload**: la forma del objeto `FormState` (claves, anidamiento, tipos de `initialForm`) NO cambia. El fetch sigue siendo `JSON.stringify(form)` al mismo endpoint. No se toca `apps/rndc-api` ni `packages/rndc-core`.
- Sin dependencias nuevas en `apps/web/package.json` salvo el script `test`.
- Etiquetas visibles: solo la humana; el código RNDC (`NUMPLACA`, …) va en `title` del label.
- Textos de UI en español, sin tildes en código nuevo donde el codebase existente las omite (seguir el estilo actual: "operacion", "Vehiculo").
- Desviaciones aceptadas del spec: SOAT sigue manual (no existe en maestros Convex); códigos de municipio siguen editables (no hay catálogo de municipios), pero visualmente subordinados (`span-2`).
- Typecheck siempre con `npm run typecheck -w @tms/web`.

---

## File Structure

```
apps/web/app/operaciones/
  page.tsx                 (existe; solo cambia el import)
  rndc-console.tsx         (NUEVO: orquestador delgado, client component)
  operations-config.ts     (NUEVO: tipos, initialForm, campos, operaciones — datos puros)
  form-state.ts            (NUEVO: readPath/setPath/isRecord — puro)
  form-autofill.ts         (NUEVO: mapeo vehiculo/conductor Convex → patches — puro)
  consecutivos.ts          (NUEVO: formateo/parseo de consecutivos — puro)
  field-section.tsx        (NUEVO: card de sección, grid, FieldControl, sección colapsable)
  lookup.tsx               (NUEVO: comboboxes de placa y conductor)
  action-bar.tsx           (NUEVO: barra sticky con acción primaria + faltantes)
  result-panel.tsx         (NUEVO: estado del envío, pasos, PDFs)
  form-state.test.ts       (NUEVO)
  operations-config.test.ts(NUEVO: invariante de payload)
  form-autofill.test.ts    (NUEVO)
  consecutivos.test.ts     (NUEVO)
apps/web/app/rndc-console.tsx   (SE ELIMINA al final de la Tarea 2)
apps/web/convex/schema.ts       (MODIFICAR: tabla counters)
apps/web/convex/counters.ts     (NUEVO: peekAll/next/ensureAtLeast/seed)
apps/web/app/globals.css        (MODIFICAR: grid 12 col, action bar, lookup, summary, context strip)
apps/web/package.json           (MODIFICAR: script test)
```

---

### Task 1: Módulos puros — config de operaciones y estado del formulario, con test de invariante

**Files:**
- Create: `apps/web/app/operaciones/operations-config.ts`
- Create: `apps/web/app/operaciones/form-state.ts`
- Test: `apps/web/app/operaciones/form-state.test.ts`
- Test: `apps/web/app/operaciones/operations-config.test.ts`
- Modify: `apps/web/package.json` (script `test`)

**Interfaces:**
- Consumes: nada (archivos nuevos; el contenido se extrae de `apps/web/app/rndc-console.tsx` líneas 5–302 sin alterar valores).
- Produces:
  - `operations-config.ts`: `type Operation`, `type Field = { path; label; code?; type?; options?; span?: number; secondary?: boolean; required?: boolean }`, `type FieldSection = { title; description?; fields; collapsible?: boolean }`, `type OperationConfig`, `type FormState`, `const initialForm: FormState`, `const operations: OperationConfig[]`, `const apiBase: string`, `type FormResult`.
  - `form-state.ts`: `readPath(source: Record<string, unknown>, path: string): string`, `setPath(source: FormState, path: string, value: string): FormState`, `isRecord(value: unknown): value is Record<string, unknown>`.

- [ ] **Step 1: Crear `form-state.ts`**

Copiar las funciones `readPath`, `setPath`, `isRecord` EXACTAMENTE como están en `apps/web/app/rndc-console.tsx:528-563`, con este encabezado (sin `"use client"`, es módulo puro):

```ts
import type { FormState } from "./operations-config";

export function readPath(source: Record<string, unknown>, path: string): string {
  // ... (idéntico a rndc-console.tsx líneas 528-540)
}

export function setPath(source: FormState, path: string, value: string): FormState {
  // ... (idéntico a rndc-console.tsx líneas 542-559)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

("idéntico" = copiar el cuerpo literal del archivo original; no reescribirlo de memoria.)

- [ ] **Step 2: Crear `operations-config.ts`**

Mover desde `rndc-console.tsx` los tipos (`Operation`, `Field`, `FieldSection`, `OperationConfig`, `FormResult`), `idTypeOptions`, `apiBase`, `initialForm`, `FormState`, todos los arrays de campos y `operations`, exportándolos. `initialForm` se copia **byte a byte** (mismos valores, mismos números vs strings). Cambios permitidos y requeridos sobre lo copiado:

1. Extender `Field` y `FieldSection`:

```ts
export type Field = {
  path: string;
  label: string;
  code?: string;
  type?: "text" | "number" | "select" | "textarea";
  options?: { value: string; label: string }[];
  span?: number;        // columnas del grid de 12; default 3
  secondary?: boolean;  // campo subordinado (codigos de municipio)
  required?: boolean;   // para deshabilitar la accion primaria
};

export type FieldSection = {
  title: string;
  description?: string;
  fields: Field[];
  collapsible?: boolean; // en remesa/manifiesto: seccion repetida, arranca colapsada
};
```

2. Asignar `span`/`secondary`/`required` en los arrays de campos (el resto de props no cambia):
   - `numberFields`: todos `span: 3`, `required: true`.
   - `dateFields`: fechas `span: 3`, horas `span: 2`.
   - `routeFields`: `sender.name`/`recipient.name` `span: 6, required: true`; ids `span: 3`; `siteCode` `span: 2`; `cityName` `span: 3`; `cityCode` `span: 2, secondary: true`.
   - `cargoFields`: `productName` `span: 4, required: true`; `shortDescription` `span: 4`; códigos `span: 2`; `quantityKg` `span: 3, required: true`; `declaredValue` `span: 3`.
   - `vehicleFields`: `plate` `span: 3, required: true`; `trailerPlate` `span: 3`; `brand` `span: 3`; resto `span: 3`, códigos `span: 2`.
   - `driverFields`: `idType` `span: 2`; `id` `span: 3, required: true`; nombres `span: 4`; `fullName` `span: 6`; resto `span: 3`.
   - `ownerFields`/`holderFields`: `idType` `span: 2`; `id` `span: 3`; nombres `span: 4`; `fullName` `span: 6`; resto `span: 3`.
   - `moneyFields`: todos `span: 3`; `freightValue` y `advanceValue` `required: true` (solo aplican al manifiesto, que es la única operación que los incluye).
   - `observationsField`: sin span (usa `wide`).
3. En `operations`: el cuarto tab cambia `label: "Conductor"` → `label: "Registro"` (title/action/sections quedan igual). En `remesa`, la sección "Remitente y destinatario" gana `collapsible: true`; en `manifest`, la sección "Ruta y valores" NO es colapsable (tiene dinero propio) pero "Vehiculo y conductor" gana `collapsible: true`. Agregar `description` a cada sección (una frase corta, ej. Documento: "Numeros y fechas del documento", Carga: "Que se transporta", Ruta: "Origen, destino y partes", "Vehiculo y conductor": "Selecciona placa y conductor desde maestros", Observaciones: "Texto libre impreso en el documento").

4. La función `field(path)` y `allFields` se mantienen tal cual (privadas del módulo, `field` puede exportarse si hace falta).

- [ ] **Step 3: Escribir los tests (fallan aún si hay typo de import)**

`apps/web/app/operaciones/form-state.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readPath, setPath } from "./form-state";
import { initialForm } from "./operations-config";

test("readPath lee rutas anidadas", () => {
  assert.equal(readPath(initialForm, "vehicle.plate"), "JVK276");
  assert.equal(readPath(initialForm, "cargo.quantityKg"), "34000");
  assert.equal(readPath(initialForm, "noexiste.tampoco"), "");
});

test("setPath es inmutable y no altera hermanos", () => {
  const next = setPath(initialForm, "vehicle.plate", "ABC123");
  assert.equal(readPath(next, "vehicle.plate"), "ABC123");
  assert.equal(readPath(initialForm, "vehicle.plate"), "JVK276");
  assert.equal(readPath(next, "vehicle.trailerPlate"), "R41537");
});
```

`apps/web/app/operaciones/operations-config.test.ts` — **el test del invariante de payload**. Pegar el objeto legacy completo (copiar `initialForm` LITERAL desde `apps/web/app/rndc-console.tsx:69-179` como `legacyInitialForm` dentro del test) y comparar:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { initialForm, operations } from "./operations-config";

const legacyInitialForm = { /* pegar aqui el objeto de rndc-console.tsx:69-179, literal */ };

test("initialForm es identico al payload legacy", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(initialForm)), legacyInitialForm);
});

test("las 4 operaciones existen con sus ids legacy", () => {
  assert.deepEqual(
    operations.map((o) => o.id),
    ["loading-order", "remesa", "manifest", "driver-vehicle"]
  );
});

test("todo path de campo existe en initialForm", () => {
  for (const op of operations) {
    for (const section of op.sections) {
      for (const f of section.fields) {
        let cursor: unknown = initialForm;
        for (const part of f.path.split(".")) {
          assert.ok(typeof cursor === "object" && cursor !== null && part in (cursor as object), `path roto: ${f.path}`);
          cursor = (cursor as Record<string, unknown>)[part];
        }
      }
    }
  }
});
```

- [ ] **Step 4: Agregar script de test y correr**

En `apps/web/package.json`, dentro de `"scripts"`:

```json
"test": "node --import tsx --test app/operaciones/form-state.test.ts app/operaciones/operations-config.test.ts"
```

Run: `npm test -w @tms/web`
Expected: `# pass 5` / `# fail 0`. Si `deepEqual` falla, el copiado de `initialForm` divergió — corregir `operations-config.ts`, nunca el snapshot legacy.

- [ ] **Step 5: Typecheck y stage**

Run: `npm run typecheck -w @tms/web` → sin errores (rndc-console.tsx viejo sigue intacto y compilando).
Run: `git add apps/web/app/operaciones/operations-config.ts apps/web/app/operaciones/form-state.ts apps/web/app/operaciones/*.test.ts apps/web/package.json`
**NO commitear** (regla global).

---

### Task 2: UI nueva — secciones, grid semántico, barra de acciones, panel de resultado

**Files:**
- Create: `apps/web/app/operaciones/field-section.tsx`
- Create: `apps/web/app/operaciones/action-bar.tsx`
- Create: `apps/web/app/operaciones/result-panel.tsx`
- Create: `apps/web/app/operaciones/rndc-console.tsx`
- Modify: `apps/web/app/operaciones/page.tsx` (import `./rndc-console`)
- Modify: `apps/web/app/globals.css` (después del bloque `.field textarea`, ~línea 822)
- Delete: `apps/web/app/rndc-console.tsx`

**Interfaces:**
- Consumes: todo lo de Task 1 (`operations`, `initialForm`, `FormState`, `FormResult`, `Field`, `FieldSection`, `apiBase`, `readPath`, `setPath`).
- Produces:
  - `field-section.tsx`: `FieldSectionCard({ section, form, onChange, forceOpen }: { section: FieldSection; form: FormState; onChange: (path: string, value: string) => void; forceOpen?: boolean })` y `FieldControl({ field, value, onChange })`.
  - `action-bar.tsx`: `ActionBar({ label, pending, missing, onSubmit }: { label: string; pending: boolean; missing: string[]; onSubmit: () => void })`.
  - `result-panel.tsx`: `ResultPanel({ result, error, processIds, route, plate, apiBase }: { result: FormResult | null; error: string; processIds: string; route: string; plate: string; apiBase: string })`.

- [ ] **Step 1: CSS nuevo en `globals.css`**

Insertar tras la regla `.field textarea { resize: vertical; }`:

```css
/* --- rediseño operaciones: grid semantico de 12 columnas --- */
.field-grid.semantic {
  grid-template-columns: repeat(12, minmax(0, 1fr));
}

.field-grid.semantic .field { grid-column: span 3; }
.field-grid.semantic .field.span-2 { grid-column: span 2; }
.field-grid.semantic .field.span-4 { grid-column: span 4; }
.field-grid.semantic .field.span-6 { grid-column: span 6; }
.field-grid.semantic .field.wide { grid-column: 1 / -1; }

.field.secondary > span { color: var(--ink-faint); font-weight: 500; }
.field.secondary input { background: var(--surface-alt); font-size: 12px; }

.field-section > .section-desc {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--ink-soft);
}

.section-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12.5px;
  color: var(--ink-soft);
}

.section-summary .summary-values {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ghost-button {
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  background: none;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  padding: 5px 10px;
  cursor: pointer;
  white-space: nowrap;
}

.ghost-button:hover { background: var(--surface-alt); }

.action-bar {
  position: sticky;
  bottom: 12px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.action-bar .action-note {
  margin-right: auto;
  font-size: 12px;
  color: var(--ink-soft);
}

.action-bar .action-note.warn { color: #a15c07; }

@media (max-width: 900px) {
  .field-grid.semantic .field,
  .field-grid.semantic .field.span-2,
  .field-grid.semantic .field.span-4 { grid-column: span 6; }
  .field-grid.semantic .field.span-6 { grid-column: 1 / -1; }
}
```

- [ ] **Step 2: `field-section.tsx`**

```tsx
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
```

Nota: el `input` pasa a `type="text"` siempre (antes `type={field.type ?? "text"}` producía `type="number"` con spinners inconsistentes; `inputMode` se conserva para teclado móvil). Esto no cambia el estado (siempre fueron strings).

- [ ] **Step 3: `action-bar.tsx`**

```tsx
"use client";

export function ActionBar({
  label,
  pending,
  missing,
  onSubmit
}: {
  label: string;
  pending: boolean;
  missing: string[];
  onSubmit: () => void;
}) {
  const blocked = missing.length > 0;

  return (
    <div className="action-bar">
      {blocked ? (
        <span className="action-note warn">Faltan: {missing.join(", ")}</span>
      ) : (
        <span className="action-note">Listo para enviar al RNDC</span>
      )}
      <button className="primary-action" disabled={pending || blocked} onClick={onSubmit} type="button">
        {pending ? "Enviando…" : label}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: `result-panel.tsx`**

Extraer el `<aside className="result-panel">` COMPLETO de `rndc-console.tsx:442-500` a un componente presentacional. Firma exacta:

```tsx
"use client";

import type { FormResult } from "./operations-config";

export function ResultPanel({
  result,
  error,
  processIds,
  route,
  plate,
  apiBase
}: {
  result: FormResult | null;
  error: string;
  processIds: string;
  route: string;
  plate: string;
  apiBase: string;
}) {
  const documentLinks = result?.documents ?? [];
  // JSX identico al aside original, sustituyendo:
  //   activeOperation.processIds        -> processIds
  //   `${form.sender.cityName} → ${form.recipient.cityName}` -> route
  //   form.vehicle.plate                -> plate
  // El resto (status-card, step-list, documents-row, sync-note, evidence) se copia tal cual.
}
```

- [ ] **Step 5: Nuevo orquestador `apps/web/app/operaciones/rndc-console.tsx`**

```tsx
"use client";

import { useState } from "react";
import {
  apiBase,
  initialForm,
  operations,
  type FormResult,
  type FormState,
  type Operation
} from "./operations-config";
import { readPath, setPath } from "./form-state";
import { FieldSectionCard } from "./field-section";
import { ActionBar } from "./action-bar";
import { ResultPanel } from "./result-panel";

export function RndcConsole() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [active, setActive] = useState<Operation>("loading-order");
  const [result, setResult] = useState<FormResult | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const activeOperation = operations.find((operation) => operation.id === active) ?? operations[0];

  const missing = activeOperation.sections
    .flatMap((section) => section.fields)
    .filter((field) => field.required && readPath(form, field.path).trim() === "")
    .map((field) => field.label);

  function handleChange(path: string, value: string) {
    setForm((current) => setPath(current, path, value));
  }

  async function submitForm() {
    // identico al submitForm original (rndc-console.tsx:369-399):
    // POST `${apiBase}/rndc/forms/${activeOperation.id}` con JSON.stringify(form),
    // mismo manejo de missingFields / error / result.
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

      <div className="ops-layout">
        <form className="form-panel" onSubmit={(event) => { event.preventDefault(); void submitForm(); }}>
          {activeOperation.sections.map((section) => (
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
```

(El botón de la cabecera desaparece: la acción primaria vive solo en la ActionBar.)

- [ ] **Step 6: Repuntar la página y borrar el monolito**

`apps/web/app/operaciones/page.tsx`: cambiar `import { RndcConsole } from "../rndc-console"` → `from "./rndc-console"` (verificar el import real antes de editar).
Luego: `git rm apps/web/app/rndc-console.tsx` (queda staged; sin commit).

- [ ] **Step 7: Verificar**

Run: `npm test -w @tms/web` → pass (los tests de Task 1 protegen el payload).
Run: `npm run typecheck -w @tms/web` → sin errores.
Verificación visual: con `npm run dev:web` (y `npm run dev:rndc` si se quiere probar envío), abrir `http://localhost:3000/operaciones` y confirmar: una sola etiqueta por campo (código RNDC como tooltip), grid alineado sin huérfanos, secciones con descripción, "Remitente y destinatario" colapsada en Remesa con botón Editar, barra sticky al pie con la acción y la lista de faltantes al vaciar un campo requerido, tab "Registro".
Run: `git add -A apps/web/app apps/web/package.json` — **sin commit**.

---

### Task 3: Autollenado por placa y documento (lookups Convex)

**Files:**
- Create: `apps/web/app/operaciones/form-autofill.ts`
- Test: `apps/web/app/operaciones/form-autofill.test.ts`
- Create: `apps/web/app/operaciones/lookup.tsx`
- Modify: `apps/web/app/operaciones/operations-config.ts` (marcar secciones con lookup)
- Modify: `apps/web/app/operaciones/rndc-console.tsx` (montar lookups)
- Modify: `apps/web/app/globals.css` (combobox + summary card)
- Modify: `apps/web/package.json` (agregar test al script)

**Interfaces:**
- Consumes: `api.fleet.vehiclesSearch({ prefix })`, `api.fleet.driversSearch({ prefix })` (arrays de rows, máx 25), `api.fleet.vehicleDetail({ plate })`, `api.fleet.driverDetail({ document })` (detalle o `null`) — ya existen en `apps/web/convex/fleet.ts`; `setPath` de Task 1.
- Produces:
  - `form-autofill.ts`: `type VehicleAutofillSource` (subset estructural de `vehicleDetail`: `{ plate: string; make?: string; modelYear?: string; configuration?: string; trailer?: string; capacityTn?: string; emptyWeightTn?: string; ownerDocument?: string; ownerName?: string; ownerCellphone?: string; ownerPhone?: string; possessorDocument?: string; possessorName?: string; possessorCellphone?: string; possessorPhone?: string }`), `type DriverAutofillSource` (`{ document: string; documentType?: string; name?: string; address?: string; city?: string; phone1?: string; cellphone?: string; licenseNumber?: string; licenseCategory?: string; licenseExpiresAt?: string }`), `tonsToKg(value?: string): string`, `vehiclePatches(v: VehicleAutofillSource): [string, string][]`, `driverPatches(d: DriverAutofillSource): [string, string][]`, `applyPatches(form: FormState, patches: [string, string][]): FormState`.
  - `lookup.tsx`: `VehicleLookup({ value, onApply, onRegisterNew })` y `DriverLookup({ value, onApply, onRegisterNew })` con `onApply: (patches: [string, string][], summary: string) => void`, `onRegisterNew: (typed: string) => void`.

- [ ] **Step 1: Test primero — `form-autofill.test.ts`**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { tonsToKg, vehiclePatches, driverPatches, applyPatches } from "./form-autofill";
import { initialForm } from "./operations-config";
import { readPath } from "./form-state";

test("tonsToKg convierte toneladas a kg", () => {
  assert.equal(tonsToKg("34"), "34000");
  assert.equal(tonsToKg("7.5"), "7500");
  assert.equal(tonsToKg(undefined), "");
  assert.equal(tonsToKg("N/A"), "");
});

test("vehiclePatches mapea detalle Convex a paths del formulario", () => {
  const patches = vehiclePatches({
    plate: "XYZ789",
    make: "KENWORTH",
    modelYear: "2019",
    configuration: "2S3",
    trailer: "S12345",
    capacityTn: "35",
    emptyWeightTn: "8",
    ownerDocument: "123",
    ownerName: "PEPE PEREZ",
    ownerCellphone: "3001112233",
    possessorDocument: "456",
    possessorName: "ANA GOMEZ"
  });
  const map = Object.fromEntries(patches);
  assert.equal(map["vehicle.plate"], "XYZ789");
  assert.equal(map["vehicle.brand"], "KENWORTH");
  assert.equal(map["vehicle.trailerPlate"], "S12345");
  assert.equal(map["vehicle.configuration"], "2S3");
  assert.equal(map["vehicle.modelYear"], "2019");
  assert.equal(map["vehicle.capacityKg"], "35000");
  assert.equal(map["vehicle.emptyWeightKg"], "8000");
  assert.equal(map["vehicleOwner.id"], "123");
  assert.equal(map["vehicleOwner.fullName"], "PEPE PEREZ");
  assert.equal(map["vehicleOwner.phone"], "3001112233");
  assert.equal(map["vehicleHolder.id"], "456");
  assert.equal(map["vehicleHolder.fullName"], "ANA GOMEZ");
});

test("vehiclePatches omite campos vacios (no pisa lo digitado)", () => {
  const patches = vehiclePatches({ plate: "XYZ789" });
  const paths = patches.map(([path]) => path);
  assert.ok(!paths.includes("vehicle.brand"));
  assert.ok(!paths.includes("vehicleOwner.id"));
});

test("driverPatches mapea conductor", () => {
  const map = Object.fromEntries(
    driverPatches({
      document: "999888",
      name: "ROJAS PINTO CARLOS",
      cellphone: "3109998877",
      city: "PAIPA - Boyaca",
      address: "CL 1 2-3",
      licenseNumber: "999888",
      licenseCategory: "C2",
      licenseExpiresAt: "01/01/2030"
    })
  );
  assert.equal(map["driver.id"], "999888");
  assert.equal(map["driver.fullName"], "ROJAS PINTO CARLOS");
  assert.equal(map["driver.phone"], "3109998877");
  assert.equal(map["driver.cityName"], "PAIPA - Boyaca");
  assert.equal(map["driver.licenseNumber"], "999888");
  assert.equal(map["driver.licenseCategory"], "C2");
  assert.equal(map["driver.licenseExpirationDate"], "01/01/2030");
});

test("applyPatches aplica en orden sobre el form", () => {
  const next = applyPatches(initialForm, [["vehicle.plate", "XYZ789"], ["vehicle.brand", "KENWORTH"]]);
  assert.equal(readPath(next, "vehicle.plate"), "XYZ789");
  assert.equal(readPath(next, "vehicle.brand"), "KENWORTH");
  assert.equal(readPath(initialForm, "vehicle.plate"), "JVK276");
});
```

Run: `node --import tsx --test app/operaciones/form-autofill.test.ts` (desde `apps/web`)
Expected: FAIL — `Cannot find module './form-autofill'`.

- [ ] **Step 2: Implementar `form-autofill.ts`**

```ts
import type { FormState } from "./operations-config";
import { setPath } from "./form-state";

export type VehicleAutofillSource = {
  plate: string;
  make?: string;
  modelYear?: string;
  configuration?: string;
  trailer?: string;
  capacityTn?: string;
  emptyWeightTn?: string;
  ownerDocument?: string;
  ownerName?: string;
  ownerCellphone?: string;
  ownerPhone?: string;
  possessorDocument?: string;
  possessorName?: string;
  possessorCellphone?: string;
  possessorPhone?: string;
};

export type DriverAutofillSource = {
  document: string;
  documentType?: string;
  name?: string;
  address?: string;
  city?: string;
  phone1?: string;
  cellphone?: string;
  licenseNumber?: string;
  licenseCategory?: string;
  licenseExpiresAt?: string;
};

export function tonsToKg(value?: string): string {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? String(Math.round(parsed * 1000)) : "";
}

function push(patches: [string, string][], path: string, value?: string) {
  if (value !== undefined && value.trim() !== "") {
    patches.push([path, value.trim()]);
  }
}

export function vehiclePatches(vehicle: VehicleAutofillSource): [string, string][] {
  const patches: [string, string][] = [];
  push(patches, "vehicle.plate", vehicle.plate);
  push(patches, "vehicle.trailerPlate", vehicle.trailer);
  push(patches, "vehicle.brand", vehicle.make);
  push(patches, "vehicle.configuration", vehicle.configuration);
  push(patches, "vehicle.modelYear", vehicle.modelYear);
  push(patches, "vehicle.capacityKg", tonsToKg(vehicle.capacityTn));
  push(patches, "vehicle.emptyWeightKg", tonsToKg(vehicle.emptyWeightTn));
  push(patches, "vehicleOwner.id", vehicle.ownerDocument);
  push(patches, "vehicleOwner.fullName", vehicle.ownerName);
  push(patches, "vehicleOwner.phone", vehicle.ownerCellphone ?? vehicle.ownerPhone);
  push(patches, "vehicleHolder.id", vehicle.possessorDocument);
  push(patches, "vehicleHolder.fullName", vehicle.possessorName);
  push(patches, "vehicleHolder.phone", vehicle.possessorCellphone ?? vehicle.possessorPhone);
  return patches;
}

export function driverPatches(driver: DriverAutofillSource): [string, string][] {
  const patches: [string, string][] = [];
  push(patches, "driver.id", driver.document);
  push(patches, "driver.fullName", driver.name);
  push(patches, "driver.phone", driver.cellphone ?? driver.phone1);
  push(patches, "driver.address", driver.address);
  push(patches, "driver.cityName", driver.city);
  push(patches, "driver.licenseNumber", driver.licenseNumber);
  push(patches, "driver.licenseCategory", driver.licenseCategory);
  push(patches, "driver.licenseExpirationDate", driver.licenseExpiresAt);
  return patches;
}

export function applyPatches(form: FormState, patches: [string, string][]): FormState {
  return patches.reduce((current, [path, value]) => setPath(current, path, value), form);
}
```

Notas de alcance (NO mapear): `documentType` de Convex no está normalizado al catálogo `C/N/E/P` → `driver.idType` no se toca; SOAT no existe en Convex → `vehicle.soatNumber`/`soatExpirationDate`/`insurerNit` no se tocan; `driver.firstName`/apellidos no se derivan de `name` (partir nombres es lotería) — siguen editables en el tab Registro.

- [ ] **Step 3: Correr tests**

Run: `node --import tsx --test app/operaciones/form-autofill.test.ts` → PASS (5 tests).
Agregar `app/operaciones/form-autofill.test.ts` al script `test` de `apps/web/package.json`.

- [ ] **Step 4: CSS del combobox y summary card en `globals.css`**

Insertar tras el bloque `.action-bar` de Task 2:

```css
/* --- lookup de maestros --- */
.lookup { position: relative; }

.lookup-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 30;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow);
  max-height: 240px;
  overflow-y: auto;
}

.lookup-option {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  font: inherit;
  font-size: 12.5px;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
}

.lookup-option:hover { background: var(--surface-alt); }

.lookup-option small { color: var(--ink-soft); }

.lookup-empty {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--ink-soft);
}

.summary-card {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid var(--line);
  background: var(--surface-alt);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  font-size: 12.5px;
}

.summary-card .summary-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.summary-card .summary-main strong { font-size: 13px; }

.summary-card .summary-main span {
  color: var(--ink-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 5: `lookup.tsx`**

```tsx
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
```

- [ ] **Step 6: Montar en el orquestador**

En `operations-config.ts`, agregar a `FieldSection` el flag `lookup?: boolean` y ponerlo en `true` en las secciones "Vehiculo y conductor" de `loading-order` y de `manifest`. Las secciones marcadas renderizan los dos lookups (placa y conductor) arriba del grid. El tab `driver-vehicle` NO se marca: ahí se digita todo, porque su propósito es registrar maestros nuevos.

En `rndc-console.tsx`:

```tsx
import { VehicleLookup, DriverLookup } from "./lookup";
import { applyPatches } from "./form-autofill";

// dentro de RndcConsole:
const [vehicleSummary, setVehicleSummary] = useState("");
const [driverSummary, setDriverSummary] = useState("");

function handleRegisterNew(kind: "vehicle" | "driver", typed: string) {
  setForm((current) => setPath(current, kind === "vehicle" ? "vehicle.plate" : "driver.id", typed));
  setActive("driver-vehicle");
}

// al renderizar secciones, si section.lookup:
<fieldset className="field-section" key={section.title}>
  <legend>{section.title}</legend>
  {section.description ? <p className="section-desc">{section.description}</p> : null}
  <div className="field-grid semantic">
    <VehicleLookup
      onApply={(patches, summary) => { setForm((c) => applyPatches(c, patches)); setVehicleSummary(summary); }}
      onRegisterNew={(typed) => handleRegisterNew("vehicle", typed)}
      value={form.vehicle.plate}
    />
    <DriverLookup
      onApply={(patches, summary) => { setForm((c) => applyPatches(c, patches)); setDriverSummary(summary); }}
      onRegisterNew={(typed) => handleRegisterNew("driver", typed)}
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
      <FieldControl field={field} key={field.path} onChange={(v) => handleChange(field.path, v)} value={readPath(form, field.path)} />
    ))}
  </div>
</fieldset>
```

Regla de presentación: mientras haya summary de vehículo Y de conductor, los inputs individuales de la sección se ocultan (modo resumen); "Editar" en cualquiera de las cards limpia su summary y vuelve a mostrar el grid completo. Editar a mano un campo NO borra el summary (los patches ya están en `form`, que es la fuente de verdad — el summary es solo presentación).

Extraer esta rama a un componente local `LookupSection` en `rndc-console.tsx` si supera ~60 líneas.

- [ ] **Step 7: Verificar**

Run: `npm test -w @tms/web` → PASS todo.
Run: `npm run typecheck -w @tms/web` → sin errores.
Manual (requiere `npx convex dev` activo en `apps/web` y datos de flota ingresados): en Orden, tab "Vehiculo y conductor": digitar "JV" → dropdown con placas; seleccionar → summary cards con marca/modelo y conductor; "Editar" → inputs de vuelta con valores aplicados; digitar placa inexistente ("ZZZ") → "No esta en maestros → Registrar vehiculo" → salta al tab Registro con la placa puesta.
Run: `git add -A apps/web/app apps/web/package.json` — **sin commit**.

---

### Task 4: Franja de contexto del viaje

**Files:**
- Modify: `apps/web/app/operaciones/rndc-console.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: `FormState` (Task 1).
- Produces: componente local `TripContextStrip({ form }: { form: FormState })` en `rndc-console.tsx` (no se exporta).

- [ ] **Step 1: CSS**

Tras el bloque `.summary-card` agregar:

```css
.context-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  padding: 10px 14px;
  margin-bottom: 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-alt);
  font-size: 12.5px;
  color: var(--ink-soft);
}

.context-strip strong { color: var(--ink); font-weight: 600; }
```

- [ ] **Step 2: Componente y montaje**

En `rndc-console.tsx`, encima de `.ops-layout` (después de los tabs):

```tsx
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
```

Montar: `<TripContextStrip form={form} />` justo antes de `<div className="ops-layout">`. Esto hace visible qué datos comparte el tab activo con los demás (el estado ya era compartido).

- [ ] **Step 3: Verificar**

Run: `npm run typecheck -w @tms/web` → sin errores. Visual: la franja refleja en vivo cambios de placa/ruta/carga desde cualquier tab.
Run: `git add -A apps/web/app` — **sin commit**.

---

### Task 5: Consecutivos — contador atómico en Convex + sugerencia en formulario

**Files:**
- Modify: `apps/web/convex/schema.ts` (tabla `counters`)
- Create: `apps/web/convex/counters.ts`
- Create: `apps/web/app/operaciones/consecutivos.ts`
- Test: `apps/web/app/operaciones/consecutivos.test.ts`
- Modify: `apps/web/app/operaciones/rndc-console.tsx`
- Modify: `apps/web/package.json` (agregar test al script)

**Interfaces:**
- Consumes: `useQuery`/`useMutation` de `convex/react`; `readPath`/`setPath` de Task 1.
- Produces:
  - Convex `api.counters.peekAll({})` → `Array<{ documentType: string; lastValue: number }>`; `api.counters.next({ documentType: string })` → `number`; `api.counters.ensureAtLeast({ documentType: string; value: number })` → `null`; `api.counters.seed({ documentType: string; lastValue: number })` → `null`.
  - `consecutivos.ts`: `type CounterType = "orden_cargue" | "remesa" | "manifiesto"`, `const counterFieldPath: Record<CounterType, string>` (= `{ orden_cargue: "cargoNumber", remesa: "remesaNumber", manifiesto: "manifestNumber" }`), `formatConsecutivo(type: CounterType, n: number): string`, `parseConsecutivo(value: string): number | null`, `countersForOperation(operation: Operation): CounterType[]`.

- [ ] **Step 1: Test primero — `consecutivos.test.ts`**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { formatConsecutivo, parseConsecutivo, countersForOperation } from "./consecutivos";

test("formato con padding por tipo (segun legacy: 000044579 / 42196 / 0041464)", () => {
  assert.equal(formatConsecutivo("orden_cargue", 44580), "000044580");
  assert.equal(formatConsecutivo("remesa", 42197), "42197");
  assert.equal(formatConsecutivo("manifiesto", 41465), "0041465");
});

test("parse tolera padding y basura", () => {
  assert.equal(parseConsecutivo("000044580"), 44580);
  assert.equal(parseConsecutivo("42197"), 42197);
  assert.equal(parseConsecutivo(""), null);
  assert.equal(parseConsecutivo("IV42196"), null);
});

test("cada operacion consume sus contadores", () => {
  assert.deepEqual(countersForOperation("loading-order"), ["orden_cargue"]);
  assert.deepEqual(countersForOperation("remesa"), ["remesa"]);
  assert.deepEqual(countersForOperation("manifest"), ["manifiesto"]);
  assert.deepEqual(countersForOperation("driver-vehicle"), []);
});
```

Run: `node --import tsx --test app/operaciones/consecutivos.test.ts` → FAIL (módulo no existe).

- [ ] **Step 2: Implementar `consecutivos.ts`**

```ts
import type { Operation } from "./operations-config";

export type CounterType = "orden_cargue" | "remesa" | "manifiesto";

export const counterFieldPath: Record<CounterType, string> = {
  orden_cargue: "cargoNumber",
  remesa: "remesaNumber",
  manifiesto: "manifestNumber"
};

const padding: Record<CounterType, number> = {
  orden_cargue: 9,
  remesa: 0,
  manifiesto: 7
};

export function formatConsecutivo(type: CounterType, n: number): string {
  return String(n).padStart(padding[type], "0");
}

export function parseConsecutivo(value: string): number | null {
  return /^\d+$/.test(value.trim()) ? Number.parseInt(value.trim(), 10) : null;
}

export function countersForOperation(operation: Operation): CounterType[] {
  if (operation === "loading-order") return ["orden_cargue"];
  if (operation === "remesa") return ["remesa"];
  if (operation === "manifest") return ["manifiesto"];
  return [];
}
```

Run: test de Step 1 → PASS. Agregar el archivo al script `test`.

Nota: `tripNumber` (`IV42196`) NO usa contador propio — hoy es `"IV" + remesaNumber` por convención de datos; queda editable y fuera del sistema de contadores (documentado como decisión).

- [ ] **Step 3: Schema Convex**

En `apps/web/convex/schema.ts`, agregar al final del `defineSchema` (tras `notifications`):

```ts
  counters: defineTable({
    documentType: v.string(),
    lastValue: v.number(),
    updatedAt: v.number()
  }).index("by_document_type", ["documentType"])
```

- [ ] **Step 4: `apps/web/convex/counters.ts`**

```ts
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const peekAll = query({
  args: {},
  returns: v.array(v.object({ documentType: v.string(), lastValue: v.number() })),
  handler: async (ctx) => {
    const rows = await ctx.db.query("counters").collect();
    return rows.map((row) => ({ documentType: row.documentType, lastValue: row.lastValue }));
  }
});

export const next = mutation({
  args: { documentType: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("counters")
      .withIndex("by_document_type", (q) => q.eq("documentType", args.documentType))
      .unique();

    if (!row) {
      throw new ConvexError(`Contador sin sembrar: ${args.documentType}`);
    }

    const value = row.lastValue + 1;
    await ctx.db.patch(row._id, { lastValue: value, updatedAt: Date.now() });
    return value;
  }
});

export const ensureAtLeast = mutation({
  args: { documentType: v.string(), value: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("counters")
      .withIndex("by_document_type", (q) => q.eq("documentType", args.documentType))
      .unique();

    if (!row) {
      await ctx.db.insert("counters", { documentType: args.documentType, lastValue: args.value, updatedAt: Date.now() });
      return null;
    }

    if (args.value > row.lastValue) {
      await ctx.db.patch(row._id, { lastValue: args.value, updatedAt: Date.now() });
    }

    return null;
  }
});

export const seed = mutation({
  args: { documentType: v.string(), lastValue: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("counters")
      .withIndex("by_document_type", (q) => q.eq("documentType", args.documentType))
      .unique();

    if (row) {
      await ctx.db.patch(row._id, { lastValue: args.lastValue, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("counters", { documentType: args.documentType, lastValue: args.lastValue, updatedAt: Date.now() });
    }

    return null;
  }
});
```

(Las mutaciones Convex son transaccionales y serializadas — dos envíos concurrentes de `next` jamás devuelven el mismo número.)

- [ ] **Step 5: Push del schema y siembra**

Run (en `apps/web`, requiere deployment configurado): `npx convex dev --once`
Expected: schema aceptado, `_generated/api` actualizado con `counters`.

Sembrar con los últimos números reales radicados (los del despacho E2E del 2026-07-02; confirmar contra el panel de Documentos antes de sembrar):

```bash
npx convex run counters:seed '{"documentType": "orden_cargue", "lastValue": 44579}'
npx convex run counters:seed '{"documentType": "remesa", "lastValue": 42196}'
npx convex run counters:seed '{"documentType": "manifiesto", "lastValue": 41464}'
```

Verificar atomicidad y secuencia:

```bash
npx convex run counters:next '{"documentType": "manifiesto"}'   # → 41465
npx convex run counters:next '{"documentType": "manifiesto"}'   # → 41466
npx convex run counters:seed '{"documentType": "manifiesto", "lastValue": 41464}'  # restaurar tras la prueba
```

- [ ] **Step 6: Integración en el formulario**

En `rndc-console.tsx`:

```tsx
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { counterFieldPath, countersForOperation, formatConsecutivo, parseConsecutivo, type CounterType } from "./consecutivos";

// dentro de RndcConsole:
const counters = useQuery(api.counters.peekAll, {});
const nextConsecutivo = useMutation(api.counters.next);
const ensureAtLeast = useMutation(api.counters.ensureAtLeast);

// sugerencias: mapa type -> string sugerida (lastValue + 1)
const suggestions: Partial<Record<CounterType, string>> = {};
for (const row of counters ?? []) {
  const type = row.documentType as CounterType;
  if (type in counterFieldPath) {
    suggestions[type] = formatConsecutivo(type, row.lastValue + 1);
  }
}

// Prefill una sola vez cuando cargan los contadores: si el campo aun tiene el
// valor default de initialForm, sustituirlo por la sugerencia.
const [prefilled, setPrefilled] = useState(false);
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
```

Y en `submitForm`, ANTES del fetch:

```tsx
let payload = form;
for (const type of countersForOperation(activeOperation.id)) {
  const path = counterFieldPath[type];
  const current = readPath(payload, path);
  if (suggestions[type] !== undefined && current === suggestions[type]) {
    const consumed = await nextConsecutivo({ documentType: type });
    payload = setPath(payload, path, formatConsecutivo(type, consumed));
  }
}
setForm(payload);
// fetch con JSON.stringify(payload)
```

Y DESPUÉS de un envío con `body.ok === true`, avanzar el contador si hubo override manual:

```tsx
for (const type of countersForOperation(activeOperation.id)) {
  const manual = parseConsecutivo(readPath(payload, counterFieldPath[type]));
  if (manual !== null) {
    void ensureAtLeast({ documentType: type, value: manual });
  }
}
```

Reglas resultantes: el número mostrado es la sugerencia del contador (editable); si el usuario no lo tocó, el número real se reserva atómicamente justo antes de enviar (dos operadores simultáneos obtienen números distintos); un rechazo del RNDC NO devuelve el número (queda consumido — nunca se reutiliza); un override manual mayor adelanta el contador tras un envío exitoso. Si Convex no está disponible (`counters === undefined` persistente), el formulario funciona como hoy con los defaults — el envío no se bloquea.

- [ ] **Step 7: Verificar**

Run: `npm test -w @tms/web` → PASS (todos los suites).
Run: `npm run typecheck -w @tms/web` → sin errores.
Manual: abrir Operaciones → el campo Manifiesto muestra `0041465` (sugerido); enviar en modo prueba → tras enviar, `counters:peekAll` refleja el consumo; editar el número a mano a `0050000`, enviar OK → `peekAll` muestra `lastValue: 50000`. Restaurar contadores con `counters:seed` a los valores reales al terminar la prueba.
Run: `git add -A apps/web/app apps/web/convex apps/web/package.json` — **sin commit**.

---

### Task 6: Cierre — verificación integral y revisión independiente

**Files:** ninguno nuevo.

- [ ] **Step 1: Suite completa**

Run: `npm test -w @tms/web && npm run typecheck -w @tms/web && npm run typecheck -w @tms/rndc-api 2>/dev/null; npm test -w @tms/rndc-core`
Expected: todo PASS (rndc-core no fue tocado; su suite confirma que no hubo daño colateral).

- [ ] **Step 2: E2E manual en modo prueba**

Con `npm run dev:rndc` + `npm run dev:web` + `npx convex dev`:
1. Orden: seleccionar placa y conductor por lookup, revisar summary cards, enviar → Aceptado.
2. Remesa: verificar sección colapsada "Remitente y destinatario" con resumen correcto, consecutivo sugerido, enviar.
3. Manifiesto: verificar valores de dinero, consecutivo sugerido, enviar.
4. Confirmar PDFs descargables y sync a panel.

- [ ] **Step 3: git status + revisión Codex**

Run: `git status` (confirmar solo archivos esperados).
Dispatch del agente `codex-reviewer` sobre el diff actual (regla global de Manuel tras implementación no trivial). Resumir el review a Manuel SIN aplicar recomendaciones automáticamente.

- [ ] **Step 4: Entrega**

Presentar a Manuel: resumen de cambios, resultado del review, y dejar el commit en sus manos (o commitear solo si él lo pide explícitamente).

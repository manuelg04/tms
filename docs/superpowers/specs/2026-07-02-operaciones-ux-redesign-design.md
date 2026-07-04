# Rediseño UX del módulo Operaciones (orden de cargue, remesa, manifiesto, registro)

Fecha: 2026-07-02
Estado: aprobado (decisiones delegadas por Manuel a Fable 5)

## Problema

La página `/operaciones` (`apps/web/app/rndc-console.tsx`, 563 líneas) presenta los cuatro
formularios (Orden, Remesa, Manifiesto, Conductor) como rejillas planas de inputs:

- Doble etiqueta por campo (etiqueta humana + código RNDC en mayúsculas truncado).
- Todos los inputs con el mismo ancho, sin relación con el contenido; campos huérfanos
  al envolver la rejilla.
- Acción principal ("Registrar orden", "Expedir remesa") arriba a la derecha,
  desconectada del final del formulario.
- Datos de vehículo y conductor digitados a mano en cada documento, aunque ya existen
  en los maestros de Convex (`apps/web/convex/fleet.ts`).
- Consecutivos de documento quemados como valores por defecto, sin generador.

## Decisiones (delegadas y resueltas)

1. **Estructura**: tabs mejorados + contexto compartido (no wizard). Menor riesgo,
   respeta el flujo ya validado E2E contra RNDC en producción.
2. **Consecutivos**: se incluye contador atómico en Convex en este alcance.
3. **Autollenado**: los datos traídos por lookup se muestran como resumen de solo
   lectura con acción "Editar", no como inputs prellenados.

## Diseño

### Estructura general

- Se mantienen 4 tabs. El tab "Conductor" se renombra **"Registro"** y agrupa
  registrar conductor y registrar vehículo (operaciones de maestros, no del despacho).
- **Franja de contexto de viaje** bajo los tabs: "JVK276 · LANDAZURI → MINGUEO ·
  CARBON 34.000 kg". Hace visible el estado compartido que hoy ya existe entre tabs.
- Los grupos de campos repetidos entre documentos (ruta, carga, remitente/destinatario)
  se muestran **colapsados como resumen editable** en remesa/manifiesto cuando ya
  fueron diligenciados en la orden; se expanden solo para modificarlos.

### Layout de formulario (los 4 tabs)

- Una sola etiqueta por campo. El código RNDC (`CONSECUTIVOREMESA`, `NUMPLACA`, …)
  pasa a tooltip (atributo `title` o icono de ayuda), para depuración contra RNDC.
- Grid de 12 columnas con anchos semánticos: fechas/horas 2–3 col, números de
  documento 3–4 col, razones sociales 6 col. Máximo 4 campos por fila.
- Códigos de municipio: **desviación** — no existe catálogo de municipios en la
  app, así que no se pueden derivar del nombre todavía; siguen siendo inputs
  editables pero visualmente subordinados (más angostos, estilo secundario),
  ubicados junto a su municipio. Derivarlos queda para cuando exista catálogo.
- Secciones como cards con título + descripción corta, en orden:
  **Documento → Ruta → Carga → Vehículo y conductor → Observaciones**.
- **Barra de acciones sticky al pie**: botón primario del documento activo a la
  derecha, estado del envío resumido al lado. El botón se deshabilita con motivo
  visible cuando faltan campos obligatorios (validación según los requeridos del
  backend `apps/rndc-api/src/index.ts`, que es la fuente de verdad en modo live).
- El panel "Estado del envío" (pasos, PDFs, evidencia) se conserva pero se ancla a la
  barra de acciones / debajo del formulario, no como columna flotante a la derecha.

### Autollenado por placa y documento

Conecta consultas Convex ya existentes en `apps/web/convex/fleet.ts` (hoy sin uso
desde operaciones):

- **Placa** → combobox con búsqueda por prefijo (`vehiclesSearch`); al seleccionar,
  `vehicleDetail` llena remolque, marca, modelo, configuración, capacidad,
  propietario y tenedor. **Desviación**: los datos de SOAT no existen en los
  maestros de Convex (la tabla `vehicles` no tiene esos campos), así que SOAT y
  aseguradora siguen digitados a mano hasta que se ingesten.
- **Documento del conductor** → igual con `driverDetail`: nombre, teléfono,
  licencia (categoría, número, vencimiento), ciudad y dirección. El tipo de ID y
  los nombres separados no se autollenan (datos de Convex no normalizados).
- Presentación: card compacta de solo lectura ("FREIGHTLINER 2020 · Remolque R41537 ·
  SOAT vence 23/03/2027") con botón "Editar" que expone los inputs subyacentes.
  El estado del formulario sigue conteniendo los mismos paths; "Editar" solo cambia
  la presentación.
- Placa/documento inexistente en maestros → mensaje inline con acción "Registrar
  vehículo/conductor" que navega al tab Registro con el dato precargado.

### Consecutivos

- Nueva tabla Convex `counters`: `{ documentType, lastValue }` con mutación
  `nextConsecutivo(documentType)` que incrementa y devuelve en una sola transacción
  (Convex garantiza serialización, sin race conditions).
- Sembrado manual inicial con el último número radicado real por tipo de documento.
- El formulario muestra el siguiente número como sugerencia (lectura del contador,
  sin consumirlo) y el campo queda **editable** para override manual.
- El número se consume en el momento del envío: si el campo coincide con la
  sugerencia se llama `nextConsecutivo` justo antes de enviar; si el usuario lo
  editó, se envía el valor manual y el contador avanza hasta ese valor si es mayor.
  Un envío rechazado por RNDC no devuelve el número al contador (reutilizar causa
  rechazos por duplicado). Registro del resultado ya existe en
  `apps/web/convex/rndc.ts`.

### Refactor técnico

`rndc-console.tsx` se separa en módulos bajo `apps/web/app/operaciones/`:

- `operations-config.ts` — definición de operaciones, secciones y campos (datos puros).
- `form-state.ts` — estado del formulario, `setPath`, valores compartidos entre tabs.
- `field-section.tsx` — card de sección + grid + `FieldControl`.
- `lookup.tsx` — comboboxes de placa/conductor con las queries Convex.
- `action-bar.tsx` — barra sticky + estado de envío.
- `result-panel.tsx` — pasos, PDFs, evidencia.
- `rndc-console.tsx` queda como orquestador delgado.

Los primitivos de estilo (card de sección, grid, combobox, barra sticky) se agregan a
`globals.css` siguiendo el sistema artesanal existente; no se introduce Tailwind ni
librería de componentes.

**Invariante duro**: el payload enviado a `POST /rndc/forms/{operation}` de
`apps/rndc-api` no cambia. No se toca `packages/rndc-core` (generación XML, flujo RNDC).

## Fuera de alcance

- Wizard / flujo guiado de despacho (posible etapa futura).
- Cambios en `packages/rndc-core` y en el backend `apps/rndc-api`.
- Autenticación / PII de maestros (decisión pendiente registrada aparte).
- Sincronización de consecutivos con documentos históricos de Avansat.

## Pruebas

- Unit tests del mapeo formulario→payload por operación: fixture del estado del
  formulario → payload esperado idéntico al actual (protege el invariante del refactor).
- Unit test de `nextConsecutivo` (secuencia 500 → 501, concurrencia serializada).
- Verificación manual E2E en modo prueba: autollenado por placa/documento, envío de
  orden y remesa, estados de error.

## Criterios de éxito

- Digitar un despacho completo requiere seleccionar placa y conductor (2 lookups) en
  vez de digitar ~10 campos de vehículo/conductor a mano.
- Cada campo tiene una sola etiqueta visible; ningún código RNDC en la vista por defecto.
- La acción principal está al pie del formulario y comunica por qué está deshabilitada.
- El consecutivo propuesto se incrementa automáticamente y nunca se duplica.
- El payload al backend es byte-idéntico al actual para los mismos datos (tests).

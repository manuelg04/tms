# Prompt de implementación: Despachos modulares (emisión documental independiente)

> Redactado el 2026-07-13 por el arquitecto orquestador. Entregar este documento
> completo como prompt al agente implementador. El agente debe leerlo entero
> antes de tocar código.

---

## Rol y objetivo

Eres un ingeniero senior trabajando en `tms-demo`, un TMS colombiano que
reemplaza a Avansat y transmite documentos al RNDC (Registro Nacional de
Despachos de Carga). Tu tarea es **eliminar la linealidad forzada del flujo de
creación y emisión de despachos**, para que cada documento (orden de cargue,
remesas, manifiesto) pueda prepararse y emitirse de forma independiente y en
momentos distintos, por usuarios distintos, sin bloquear al resto de la
operación.

### El problema de negocio (contexto real del cliente)

La operación NO es lineal:

1. Un despachador le pide a seguridad "genérame una orden de cargue para tal
   vehículo/conductor" (le pasa un Excel con los datos).
2. Seguridad crea la orden de cargue **y la entrega ya** — el camión se va a cargar.
3. Pasan horas. Mientras tanto, despachadores de otras sedes crean otras
   órdenes de cargue en paralelo.
4. Cuando el conductor terminó de cargar, el despachador vuelve: "ahora sí,
   expídeme remesa y manifiesto".

Hoy el sistema obliga a diligenciar los 5 pasos (orden → remesas → flota →
manifiesto → revisión) en una sola sesión y a emitir toda la cadena RNDC de un
solo golpe. Eso bloquea la operación. Avansat (el sistema que reemplazamos)
tiene módulos independientes por documento; nosotros debemos ofrecer esa
flexibilidad **sin perder** la trazabilidad del expediente como carpeta que
agrupa toda la cadena documental de un viaje.

---

## Diagnóstico (verificado en el código, no re-derivar)

Lo que **ya es modular** y debes aprovechar sin reescribir:

- Mutaciones de borrador independientes por etapa en
  `apps/web/convex/dispatches.ts`: `saveLoadingOrderDraft`,
  `saveConsignmentsDraft`, `saveAssignmentDraft`, `saveManifestDraft`. Cada una
  valida edición con `assertStageEditable` por documento.
- `expedienteRemesas` son filas propias con ciclo de vida individual
  (`officialState`, `fulfillmentState`, …) en `apps/web/convex/schema.ts`.
- Cola durable `rndcOperations` con idempotencia (`requestKey`, `businessKey`),
  leases y conciliación. NO tocar esta maquinaria.
- Consecutivos por rango y agencia (`counterRanges`, `claimNextConsecutive` en
  `apps/web/convex/model/consecutiveRange.ts`).
- El detalle `/expedientes/[id]` ya tiene formularios por etapa
  (`apps/web/app/expedientes/components/draft-stage-forms.tsx`).
- El route de emisión ya es reanudable: los pasos `authorized` se saltan.

Los **4 puntos que fuerzan la linealidad** (esto es lo que se cambia):

1. **Wizard de creación** (`apps/web/app/expedientes/nuevo/page.tsx`): no
   persiste NADA hasta pulsar "Guardar despacho" en el paso 5. El enlace
   "Guardar después" navega a `/expedientes` descartando todo lo escrito.
   Seguridad no puede crear una orden de cargue y dejarla ahí.
2. **`prepareEmission`** (`apps/web/convex/dispatches.ts:638`): todo-o-nada.
   Rechaza si la etapa derivada aún está en
   `orden_cargue|remesas|vehiculo_conductor|manifiesto` (línea ~683), es decir
   exige orden + remesas + flota + manifiesto completos; luego quema TODOS los
   consecutivos (orden, remesas, viaje, manifiesto) y congela TODAS las
   fotografías en una sola transacción, pasando el expediente a `ready`.
3. **`buildEmissionPlan`** (`apps/web/convex/model/emissionPlan.ts:85`):
   devuelve `not_prepared` salvo que existan fotografía + número de la orden,
   de TODAS las remesas, del manifiesto, de la asignación y el consecutivo de
   viaje (líneas 112–141). Además hay un acoplamiento de payload:
   `buildCargoPayload` y `buildConsignmentPayload` usan `manifest.issueDate`
   como `expeditionDate` — la orden no puede emitirse sin datos del manifiesto.
4. **Route de emisión**
   (`apps/web/app/api/rndc/dispatches/[expedienteId]/emit/route.ts`): ejecuta
   la cadena completa (cargo → remesas → viaje → manifiesto) en una sola
   petición; no acepta emitir un subconjunto.

Además, `deriveDispatchStage`
(`apps/web/convex/model/dispatchWorkflow.ts:37`) colapsa el estado del
expediente en UNA etapa lineal, y el detalle usa esa etapa para autoseleccionar
qué formulario mostrar.

---

## Decisiones de arquitectura (tomadas; no re-litigar)

**D1 — El expediente sigue siendo la carpeta agregadora.** NO se separan
órdenes/remesas/manifiestos en módulos top-level desconectados estilo Avansat.
La modularidad se logra con **preparación y emisión por documento dentro del
expediente**, más vistas globales por documento que ya existen (`/documentos`).
Razón: la cadena RNDC exige que remesa referencie el consecutivo de la orden y
el manifiesto referencie remesas + viaje; el expediente es lo que garantiza esa
trazabilidad.

**D2 — Persistencia temprana en la creación.** El paso 1 del wizard (orden de
cargue) crea y guarda el expediente inmediatamente. Los pasos 2–5 pasan a ser
opcionales y con autoguardado. Salir en cualquier momento no pierde datos: el
expediente queda en la lista con su progreso visible.

**D3 — Emisión por alcance (scope).** Se introduce el concepto de scope de
emisión: `orden`, `remesas`, `manifiesto`, `todo`. Preparación (consecutivo +
fotografía) y emisión ocurren por documento, cuando ESE documento está
completo. Las dependencias se validan en el momento de emitir, no de editar:

- `orden`: emisible con orden completa + vehículo/conductor asignados
  (el payload de `emit_cargo` incluye conductor y vehículo).
- `remesas`: emisibles cuando la orden esté `authorized` (variante estándar;
  respetar `workflowVariant` para `remesa_without_order` y `empty_manifest`).
- `manifiesto`: emisible cuando todas las remesas estén `authorized`; el paso
  `register_trip` (información de viaje) se ejecuta dentro de este scope, antes
  del manifiesto, como hoy.

**D4 — Desacoplar la fecha de expedición.** La orden de cargue y las remesas
NO pueden depender de `manifest.issueDate`. Añadir `expeditionDate` al draft de
la orden de cargue (default: fecha actual America/Bogota al preparar) y usarla
en `buildCargoPayload`/`buildConsignmentPayload`. El manifiesto conserva su
propio `issueDate`. Documentar este cambio de payload en los tests (el
invariante de payload byte-idéntico del rediseño de 2026-07-02 se rompe aquí
conscientemente y solo aquí).

**D5 — La etapa derivada pasa a ser una sugerencia, no una compuerta.**
`deriveDispatchStage` se conserva para la tarjeta "siguiente acción" y para los
listados, pero deja de bloquear `prepareEmission` y deja de forzar la
navegación del detalle. La edición sigue protegida por documento con
`assertStageEditable` (un documento oficial autorizado nunca se edita; se
corrige o anula — eso no cambia).

**D6 — Semántica de estado del expediente.** `status` del expediente:
`draft` = nada emitido; `in_progress` = al menos un documento preparado o
emitido; `completed`/`cancelled` como hoy. El estado global `ready` deja de ser
la compuerta de emisión (mantener el literal en el schema por compatibilidad de
datos existentes, pero el código nuevo no debe depender de él).

**D7 — Los consecutivos se queman por documento al prepararlo**, no todos de
golpe. Un expediente puede tener número de orden asignado y remesas sin número
durante horas. Eso es correcto y esperado.

---

## Plan de implementación por fases

Trabaja en una rama nueva. Cada fase debe dejar `npm test` (workspaces) verde y
compilar. Commits separados por fase.

### Fase A — Backend: preparación y plan de emisión por documento

1. En `apps/web/convex/model/emissionPlan.ts`:
   - Añadir `scope: "orden" | "remesas" | "manifiesto" | "todo"` a
     `buildEmissionPlan` (parámetro nuevo; default `"todo"` para compatibilidad).
   - Por scope, exigir SOLO los insumos de ese scope (fotografías/números del
     scope + estados de sus dependencias). Ejemplo: scope `orden` no exige
     fotografía de manifiesto ni consecutivo de viaje.
   - Validar dependencias por estado: scope `remesas` exige
     `order.officialState` autorizado (según `workflowVariant`); scope
     `manifiesto` exige todas las remesas autorizadas e incluye el paso
     `register_trip` si aplica.
   - Aplicar D4 (expeditionDate propio de la orden).
2. En `apps/web/convex/dispatches.ts`:
   - Refactorizar `prepareEmission` en `prepareForEmission({ expedienteId, scope })`:
     valida SOLO los datos del scope (`loadingOrderMissingFields`,
     `consignmentMissingFields`, `manifestMissingFields` según corresponda),
     quema consecutivos SOLO del scope, escribe fotografías SOLO del scope
     (incluida `asignacion` cuando el scope la requiera), y pasa el expediente
     a `in_progress`. Mantener la reutilización idempotente: si el documento ya
     tiene número/fotografía, devolverlo sin quemar otro consecutivo (como hace
     hoy con `alreadyPrepared`).
   - `emissionInputs` no cambia de forma, pero ya no debe auto-invocar la
     preparación global (ver Fase B).
   - Ojo con `effectiveConsignment`: la herencia remesa←orden se materializa en
     la fotografía de la remesa al prepararla, como hoy.
3. Tests: extender `emissionPlan.test.ts` y `dispatchWorkflow.test.ts` con
   casos por scope (orden sola emisible; remesa bloqueada si orden no
   autorizada; manifiesto bloqueado con remesas pendientes; variantes
   `remesa_without_order` y `empty_manifest` intactas). Actualizar fixtures del
   cambio D4 explícitamente.

### Fase B — Backend/route: emitir por alcance

1. `apps/web/app/api/rndc/dispatches/[expedienteId]/emit/route.ts`:
   - Aceptar `{ scope?: "orden" | "remesas" | "manifiesto" | "todo" }` en el
     body (además de `simulateTimeoutAt`). Default `"todo"` (compatibilidad con
     el e2e existente).
   - Si el scope está en borrador, llamar `prepareForEmission` con ese scope;
     construir el plan con ese scope; ejecutar solo esos pasos. Las claves de
     idempotencia `emit-${expedienteId}-${step.key}` NO cambian de formato —
     así una emisión parcial previa se reconoce al emitir `todo` después.
   - Mantener intactos: manejo de `uncertain`/`in_flight`, 409 con blockers,
     `ensureOfficialDocuments` (créalos solo para el scope), y la regla de que
     el navegador no aporta campos RNDC.
2. Tests de gateway (`apps/web/app/api/rndc/gateway.test.ts` y vecinos):
   emisión scope `orden` sola → 200; scope `remesas` con orden no autorizada →
   409 con blocker claro; `todo` sigue funcionando end-to-end en dry-run.

### Fase C — UI: creación con persistencia temprana

En `apps/web/app/expedientes/nuevo/page.tsx`:

1. Al completar el paso 1 (Continuar), ejecutar la cadena
   `upsertCustomer → upsertLocation → upsertOrder → createDraft →
   saveLoadingOrderDraft` que hoy corre al final, y navegar el wizard ya con
   `expedienteId` real. Pasos 2–4 guardan con sus mutaciones al pulsar
   Continuar (autoguardado por paso).
2. "Guardar después" guarda el paso actual (si es válido) y navega a
   `/expedientes/[id]`; nunca descarta datos silenciosamente.
3. Los pasos 2–4 dejan de ser obligatorios: botón secundario "Guardar y salir"
   visible desde el paso 1 en adelante. El paso 5 (revisión) muestra qué está
   completo y qué falta, sin exigir completitud para salir.
4. Tras crear en paso 1, ofrecer la acción "Emitir orden de cargue" (usa el
   scope `orden`) directamente desde la revisión o desde el detalle.

### Fase D — UI: detalle como hub de documentos

En `apps/web/app/expedientes/[id]/page.tsx` y componentes:

1. Convertir la navegación de etapas en un **hub de tarjetas por documento**:
   Orden de cargue / Remesas / Vehículo y conductor / Manifiesto / Cumplidos.
   Cada tarjeta muestra: estado oficial (chip), número si existe, blockers
   propios, y acciones contextuales (Editar, Emitir a RNDC, PDF).
   "Emitir a RNDC" por tarjeta llama al route con el scope correspondiente y
   queda deshabilitado con el motivo visible cuando la dependencia no está
   (ej. "Requiere orden de cargue autorizada").
2. Conservar `NextActionCard` alimentada por `deriveDispatchStage` como
   sugerencia de siguiente paso, no como compuerta.
3. En la lista `/expedientes`, mostrar progreso documental compacto por fila
   (ej. chips O/R/M con estado) para que un despachador encuentre "órdenes
   emitidas sin manifiesto" de un vistazo. Si existe filtro por etapa,
   añadir filtro "pendiente de manifiesto".
4. Actualizar `apps/web/e2e/guided-dispatch.spec.ts`: añadir el recorrido
   asíncrono (crear orden → salir → reabrir → emitir orden → volver después →
   completar remesas+manifiesto → emitir resto) manteniendo el recorrido
   completo existente.

---

## Invariantes y guardrails (violarlos = rechazo del trabajo)

1. **Nunca degradar un documento autorizado.** Ningún camino nuevo puede mover
   `officialState` de `authorized`/`fulfilled` hacia atrás. (Hay un
   antecedente: un fulfill fallido degradaba un doc autorizado — no repetir.)
2. **Idempotencia intacta**: no cambiar el formato de `requestKey`/
   `businessKey` de operaciones existentes; no duplicar consecutivos (reusar
   número/fotografía existentes al re-preparar).
3. **Dry-run por defecto**: nada de este trabajo puede enviar tráfico RNDC
   real; respetar `safeRndcMode` y el modo `dry-run` en tests.
4. **El navegador nunca aporta campos RNDC**: el body del emit solo lleva
   identidad + scope + simulateTimeoutAt.
5. **Compatibilidad de datos**: expedientes existentes (incluido el radicado
   real SWM776 en producción) deben seguir renderizando y operando; no hay
   migración destructiva de schema (solo campos opcionales nuevos).
6. **Autorización**: todas las mutaciones nuevas usan `requireActor` con roles
   `admin|operator` y `requireSameOrganization`, como las existentes.
7. Los tests existentes se mantienen verdes; los que cambian por D4 se
   actualizan con comentario explícito del porqué en el test.

## Definición de terminado

- `npm test` verde en todos los workspaces; e2e de despacho guiado verde.
- Demostrable en dry-run: crear solo la orden en la mañana (persistida y
  emitida con scope `orden`), y horas después —en otra sesión— completar
  remesas + manifiesto y emitirlos, sin re-tocar la orden.
- Dos despachos de sedes distintas pueden avanzar intercalados sin
  interferirse (consecutivos por agencia correctos).
- El recorrido lineal completo de siempre (todo en una sesión, scope `todo`)
  sigue funcionando igual.

# Plan de implementación: Despachos guiados compatibles con Avansat Básico

Fecha: 2026-07-10
Diseño aprobado: `docs/plans/2026-07-10-despachos-guiados-avansat-design.md`
Base funcional auditada: `f2b544f`
Commit del diseño: `bc2e735`

## Resultado esperado

El operador podrá abrir `Despachos`, crear o retomar un expediente y completar en orden:

`Orden de cargue → Remesas → Vehículo y conductor → Manifiesto → Envío RNDC → Cargue y descargue → Cumplido inicial → Cumplido final`.

Cada etapa reutilizará los datos anteriores, mostrará solamente los campos necesarios, explicará los bloqueos y propondrá una única acción principal. `Documentos e historial` será una vista siempre disponible que acumula resultados, no una etapa final. La implementación conservará las rutas `/expedientes`, la identidad visual actual y la comunicación RNDC por medio del backend existente.

## Definición de terminado

El trabajo completo estará terminado cuando:

- Un operador pueda guardar, cerrar, reabrir y editar un despacho en borrador.
- Una orden de cargue pueda contener una o varias remesas.
- Un manifiesto pueda asociar una o varias remesas elegibles.
- La secuencia RNDC se ejecute desde el expediente, sea reanudable y no duplique documentos.
- Los tiempos reales de cargue, descargue y llegada se registren manualmente sin GPS.
- El cumplido inicial de cada remesa ocurra antes del cumplido final del manifiesto.
- Los documentos, resultados, rechazos y evidencias sean visibles desde el despacho.
- Los listados tengan búsqueda de servidor, paginación y exportación.
- Los recorridos de escritorio y móvil estén verificados.
- La autenticación, recuperación, alertas y prueba RNDC controlada cumplan la puerta de producción.

## Reglas transversales

- Todas las pruebas RNDC se ejecutarán con `RNDC_MODE=dry-run` hasta una autorización separada y explícita.
- No se ejecutará `npm run rndc:prod-flow` durante estas fases.
- El frontend nunca se comunicará directamente con el RNDC.
- Cada operación oficial registrará primero su intención, conservará evidencia permanente y sólo después actualizará su estado oficial.
- Un timeout o resultado incierto se conciliará; no provocará reenvío automático.
- Un doble clic, retry de red o reinicio del worker no podrá duplicar documentos.
- Los borradores se guardarán mediante mutaciones atómicas del servidor, no mediante cadenas de escrituras desde el navegador.
- Las rutas `/expedientes`, `/expedientes/nuevo` y `/expedientes/[id]` se conservarán en la primera versión.
- La navegación visible usará `Despachos`; `Expediente de viaje` permanecerá como nombre del registro detallado.
- No se agregarán monitoreo GPS, Control Tráfico ni integración con DIAN en el flujo normal ni en las acciones avanzadas.
- No se bloqueará la implementación por los catálogos de municipios o marcas aún no suministrados. Se crearán contratos de catálogo que permitan incorporarlos después.
- Cada comportamiento nuevo comenzará con una prueba fallida cuando sea posible.
- Mientras `apps/web/package.json` enumere pruebas una por una, todo archivo de prueba nuevo se agregará explícitamente al script `test`.
- No se agregarán comentarios al código.
- Ninguna fase se declarará terminada sólo porque compile: deberá verificarse el recorrido que modifica.

## Orden de trabajo

### Fase 0. Hacer confiable el resultado documental actual

#### Objetivo

Cerrar primero los riesgos que podrían mostrar un documento como autorizado sin datos completos, sin evidencia permanente o después de una conciliación que corresponde a otro registro.

#### Pruebas primero

Agregar casos que demuestren que:

- Un expediente persistido incompleto falla incluso en `dry-run`.
- Los datos faltantes nunca se completan con el escenario de referencia.
- Una respuesta aceptada sin evidencia durable no autoriza el documento.
- Una conciliación sólo resuelve la operación si coincide el tipo y número de documento esperado.
- Un estado incierto bloquea el reenvío y muestra la acción `Conciliar`.
- Un rechazo conserva código, mensaje, XML y momento del intento.
- Los totales del panel distinguen autorizado, rechazado, pendiente e incierto.

#### Archivos principales

- `apps/web/app/api/rndc/actions/[action]/route.ts`
- `apps/web/app/api/rndc/actions/[action]/route.test.ts`
- `apps/web/app/api/rndc/forms/[operation]/route.ts`
- `apps/web/app/api/rndc/forms/[operation]/route.test.ts`
- `apps/web/app/operaciones/page.tsx`
- `apps/web/app/operaciones/rndc-console.tsx`
- `apps/web/package.json`
- `apps/web/app/lib/rndc-action-runner.ts`
- `apps/web/app/lib/rndc-action-runner.test.ts`
- `apps/web/convex/officialDocuments.ts`
- `apps/web/convex/rndcOperations.ts`
- `apps/web/convex/dashboard.ts`
- `apps/web/convex/model/documentLifecycle.ts`
- `apps/web/convex/model/operationState.ts`
- `apps/web/convex/model/reconciliationOutcome.ts`
- `apps/web/convex/model/reconciliationOutcome.test.ts`
- `apps/rndc-api/src/index.ts`
- `apps/rndc-api/src/phaseOneRoutes.ts`
- `apps/rndc-api/src/durableEvidence.ts`
- `apps/rndc-api/src/tests/persistedPayloadValidation.test.ts`
- `packages/rndc-core/src/data/scenarioOverlay.ts`

#### Cambios

- Separar la construcción de solicitudes de demostración de la construcción basada en un expediente guardado.
- Exigir todos los campos del documento persistido antes de crear la intención de envío.
- Hacer que el resultado de almacenamiento de evidencia sea parte del resultado de la operación.
- Validar la identidad del documento conciliado antes de cambiar el estado.
- Normalizar los estados visibles de documento y de intento sin mezclarlos.
- Ajustar el panel para contar el estado oficial real y no el último mensaje recibido.
- Hacer que `/api/rndc/forms` use el mismo corredor durable o quede bloqueado fuera de desarrollo y administración.
- Detener la consola técnica cuando falle la reserva de consecutivo; nunca continuar con un número local no confirmado.

#### Criterio de salida

Los casos de datos incompletos, falta de evidencia, timeout y conciliación equivocada están cubiertos y ninguna ruta puede devolver éxito oficial en esos escenarios.

### Fase 1. Crear el modelo de despacho editable y atómico

#### Objetivo

Convertir el expediente existente en una raíz de agregado que pueda guardar todo el despacho como borrador coherente y producir fotografías inmutables al confirmar documentos.

#### Pruebas primero

Agregar casos que demuestren que:

- Crear un borrador asigna un número de expediente único y los documentos usan rangos independientes por organización, agencia y tipo documental.
- Guardar una etapa actualiza todos sus datos o ninguno.
- Reabrir un borrador devuelve exactamente el último estado guardado.
- Confirmar una orden o remesa crea una fotografía que no cambia si después se edita el maestro.
- Una remesa puede seleccionarse provisionalmente en un manifiesto borrador, pero sólo puede emitirse dentro del proceso 4 cuando está autorizada y no pertenece a otro manifiesto activo.
- La etapa siguiente se deriva de los documentos y bloqueos, no de una bandera manual del navegador.
- Las transiciones inválidas son rechazadas por el servidor.

#### Archivos principales

- `apps/web/convex/schema.ts`
- `apps/web/convex/counters.ts`
- `apps/web/convex/expedientes.ts`
- `apps/web/convex/masterData.ts`
- `apps/web/convex/fleet.ts`
- `apps/web/convex/audit.ts`
- `apps/web/convex/access.ts`
- `apps/web/convex/model/access.ts`
- `apps/web/convex/model/dispatchWorkflow.ts`
- `apps/web/convex/model/dispatchWorkflow.test.ts`
- `apps/web/convex/model/dispatchSnapshot.ts`
- `apps/web/convex/model/dispatchSnapshot.test.ts`
- `apps/web/convex/migrations.ts`
- `apps/web/convex/test/convexTestHarness.ts`
- `apps/web/package.json`
- `package-lock.json`

#### Cambios de datos

- Consolidar identidad, organización y estado de borrador del expediente. La siguiente etapa seguirá siendo una proyección derivada, no una verdad almacenada que pueda desincronizarse.
- Completar el contrato de orden de cargue con agencia, cliente, remitente, destinatarios, lugares, fechas, vehículo, flete, carga, empaque y observaciones.
- Mantener separados el estado local e impresión de la orden y el número, radicado y estado de la `Información de carga` RNDC del proceso 1 asociada.
- Completar el contrato de remesa con clase `Municipal` o `Terrestre de carga`, origen, destino, sitios y citas, valor declarado, póliza, remisiones, cantidades, peso, volumen, naturaleza de carga y observaciones.
- Completar el contrato de manifiesto con expedición, entrega estimada editable, alcance municipal o intermunicipal, tipo de manifiesto independiente, agencia, ruta, vehículo, remolque, conductor, segundo conductor, liquidación del viaje y responsables de pago.
- Guardar asignación de vehículo, remolque, conductor, propietario, tenedor y poseedor sin duplicar maestros.
- Agregar tiempos logísticos reales, datos de cumplimiento y referencias a evidencias.
- Conservar como campos distintos el número de orden, remesa, remisión, manifiesto interno y manifiesto electrónico, junto con radicados de remesa, cargue, descargue, emisión, anulación, cumplimiento y reversa, sus fechas y el estado de impresión.
- Guardar como texto consecutivos, números y radicados RNDC, códigos DANE, remesas, remisiones, códigos de cliente, pólizas, placas, remolques, identificaciones, teléfonos, licencias y SOAT; ninguna frontera de importación o exportación los convertirá a número.
- Separar valor declarado de carga o remesa de flete, anticipo, retenciones, ICA, FOPAT, ajustes y neto a pagar.
- Conservar un identificador EMF sólo como metadato regulatorio cuando el RNDC lo exija, sin credenciales ni funciones de seguimiento.
- Mantener la entrega estimada editable y no codificar el patrón de ocho días de la muestra hasta confirmar esa regla con MTM.
- Crear fotografías inmutables de orden, remesas, manifiesto y cumplimiento.
- Registrar historial append-only con actor, fecha, acción y motivo.
- Mantener adaptadores para los expedientes y documentos ya existentes.
- Migrar con una secuencia `expandir → rellenar → verificar → contraer`: primero campos opcionales, luego backfill idempotente con conteos, después validación y sólo al final restricciones obligatorias.
- Documentar reversa y comprobar que el conteo de registros antes y después coincida.

#### Mutaciones de servidor

- `createDraft`: crea el expediente y su número interno.
- `prepareEmission`: valida el expediente, asigna consecutivos documentales dentro de la misma transacción y crea las fotografías inmutables que consumirá el worker.
- `saveLoadingOrderDraft`: guarda la orden completa de forma atómica.
- `saveConsignmentsDraft`: guarda altas, cambios y eliminaciones permitidas de remesas.
- `saveAssignmentDraft`: guarda vehículo y conductores.
- `saveManifestDraft`: guarda el manifiesto y sus remesas elegibles.
- `recordLogisticsTimes`: guarda tiempos manuales y su auditoría.
- `recordFulfillmentDraft`: guarda cantidades y novedades reales antes del envío.

La ruta de emisión sólo recibirá la identidad del expediente y la acción. Cargará la fotografía confiable en el servidor y rechazará cualquier intento de sustituir campos RNDC desde el navegador.

El paquete web incorporará descubrimiento automático de pruebas, un comando `convex:once` para generación y validación de funciones, y una base de pruebas de integración para demostrar atomicidad y aislamiento por organización en mutaciones reales.

#### Criterio de salida

Un borrador completo se puede crear, editar y reanudar desde Convex sin estados parciales, y los documentos confirmados conservan su fotografía histórica. La migración expandida y el backfill se ejecutan dos veces sin duplicar cambios, los conteos coinciden y la generación Convex termina sin errores antes de aplicar restricciones.

### Fase 2. Completar la secuencia documental desde el servidor

#### Objetivo

Crear una sola acción protegida que emita el despacho en el orden correcto y pueda reanudarse después de una interrupción.

#### Pruebas primero

Agregar casos que demuestren que:

- La orden de cargue se emite antes que cualquier remesa.
- Cada remesa se emite una vez y conserva su resultado independiente.
- El viaje y manifiesto sólo se emiten cuando todas las remesas seleccionadas están autorizadas.
- Reanudar una secuencia parcial salta documentos ya autorizados.
- Si el proceso 2 se autoriza y el proceso 4 falla, la reanudación no vuelve a transmitir el proceso 2.
- Un rechazo detiene los pasos dependientes y conserva los pasos anteriores.
- Un timeout detiene la secuencia y exige conciliación.
- Dos solicitudes simultáneas producen una sola secuencia efectiva.
- El plan de emisión se construye únicamente con datos fotografiados del expediente.

#### Archivos principales

- `apps/web/app/api/rndc/dispatches/[expedienteId]/emit/route.ts`
- `apps/web/app/api/rndc/dispatches/[expedienteId]/emit/route.test.ts`
- `apps/web/app/lib/dispatch-readiness.ts`
- `apps/web/app/lib/dispatch-readiness.test.ts`
- `apps/web/app/lib/rndc-action-runner.ts`
- `apps/web/app/lib/rndc-action-config.ts`
- `apps/web/convex/model/emissionPlan.ts`
- `apps/web/convex/model/emissionPlan.test.ts`
- `apps/web/convex/officialDocuments.ts`
- `apps/web/convex/rndcOperations.ts`
- `apps/rndc-api/src/index.ts`
- `apps/rndc-api/src/operationWorker.ts`
- `apps/rndc-api/src/tests/operationWorker.test.ts`
- `apps/rndc-api/src/convexQueue.ts`
- `apps/rndc-api/src/convexSync.ts`
- `apps/rndc-api/package.json`
- `apps/rndc-api/src/phaseOneRoutes.ts`
- `apps/rndc-api/src/tests/phaseOneRoutes.test.ts`
- `packages/rndc-core/src/rndc/flow.ts`
- `packages/rndc-core/src/rndc/messages.ts`
- `packages/rndc-core/src/rndc/xml.ts`
- `packages/rndc-core/src/rndc/types.ts`

#### Cambios

- Calcular un reporte de preparación con errores agrupados por etapa y campo.
- Construir un plan inmutable: información de carga asociada a la orden, remesas pendientes, información de viaje y manifiesto.
- Adquirir una exclusión por expediente antes de ejecutar el plan.
- Registrar la intención de cada paso antes de contactar al worker.
- Separar la información de viaje del proceso 2 y el manifiesto del proceso 4 en operaciones durables con identidad, fotografía y conciliación propias.
- Ejecutar las operaciones mediante un consumidor persistente que reclame trabajo, renueve leases y recupere operaciones pendientes al iniciar.
- Probar reinicio entre pasos, lease vencido, worker duplicado y recuperación sin reenvío.
- Reutilizar los builders RNDC existentes y ampliar sólo los campos faltantes.
- Guardar solicitud, respuesta, resultado interpretado, estado, huella y tiempos por paso.
- Devolver un resumen comprensible para la interfaz: completado, detenido, rechazado, incierto o pendiente de conciliación.
- Hacer que la consola técnica use esta misma cola durable o restringirla a administración y desarrollo; no conservar un endpoint de envío directo como bypass.

#### Criterio de salida

Un expediente válido completa información de carga, remesas, información de viaje y manifiesto en `dry-run` desde una sola acción, y una interrupción o reinicio puede reanudarse sin repetir documentos autorizados.

### Fase 3. Construir la experiencia guiada de Despachos

#### Objetivo

Reemplazar el formulario largo y la navegación técnica por una cola de trabajo y un detalle que muestren la etapa actual, los bloqueos y la siguiente acción.

#### Pruebas primero

Agregar casos de lógica de presentación que demuestren que:

- Cada combinación de documentos produce una etapa y acción principal correctas.
- Los bloqueos se muestran en lenguaje operativo.
- Los campos heredados se autocompletan y no se solicitan otra vez.
- Una etapa oficial queda en sólo lectura y ofrece una acción explícita de corrección o anulación.
- El botón de envío se deshabilita mientras hay una operación en curso o incierta.
- La navegación por teclado conserva orden, foco y mensajes de error.

#### Archivos principales

- `apps/web/app/components/app-shell.tsx`
- `apps/web/app/globals.css`
- `apps/web/app/expedientes/page.tsx`
- `apps/web/app/expedientes/nuevo/page.tsx`
- `apps/web/app/expedientes/[id]/page.tsx`
- `apps/web/app/expedientes/status-badge.tsx`
- `apps/web/app/expedientes/components/dispatch-stage-nav.tsx`
- `apps/web/app/expedientes/components/next-action-card.tsx`
- `apps/web/app/expedientes/components/blocker-list.tsx`
- `apps/web/app/expedientes/components/loading-order-form.tsx`
- `apps/web/app/expedientes/components/consignments-form.tsx`
- `apps/web/app/expedientes/components/assignment-form.tsx`
- `apps/web/app/expedientes/components/manifest-form.tsx`
- `apps/web/app/expedientes/components/document-history.tsx`
- `apps/web/app/expedientes/components/advanced-actions.tsx`
- `apps/web/playwright.config.ts`
- `apps/web/e2e/guided-dispatch.spec.ts`
- `apps/web/package.json`
- `package-lock.json`

#### Cola de trabajo

- Cambiar la etiqueta principal de `Expedientes` a `Despachos` sin cambiar la URL.
- Mostrar número de expediente, agencia, números de orden, remesa y manifiesto, cliente, ruta, placa, conductor, fecha, etapa, estado RNDC y próxima acción.
- Agregar filtros por texto, cliente, placa, conductor, origen, destino, etapa, estado y rango de fechas.
- Ofrecer acciones rápidas `Continuar`, `Revisar rechazo`, `Conciliar`, `Imprimir` o `Cumplir` según el estado.
- Separar claramente borradores, pendientes, rechazados, autorizados, por cumplir, cumplidos y anulados.

#### Detalle del despacho

- Mostrar un encabezado compacto con identidad, ruta, asignación y estado general.
- Mostrar un indicador de las ocho etapas operativas aprobadas.
- Mantener una sola tarjeta `Siguiente acción` sobre el contenido.
- Abrir la etapa actual y contraer las demás sin ocultar el resumen.
- Guardar cada etapa como borrador y permitir salir sin perder el trabajo.
- Mostrar errores junto al campo y un resumen enfocable al enviar.
- Mantener `Documentos e historial` disponible en todo momento y separarlo de `Evidencia técnica`.
- Ocultar corrección, anulación, transbordo y manifiesto vacío dentro de acciones avanzadas protegidas.

#### Escritorio, móvil y accesibilidad

- Verificar anchos aproximados de 1440, 1024, 768, 390 y 360 píxeles.
- Evitar tablas completas en móvil; usar tarjetas o filas resumidas.
- Mantener la acción principal visible sin cubrir campos ni mensajes.
- Garantizar objetivos táctiles, contraste, foco visible y etiquetas asociadas.
- No depender sólo del color para expresar un estado.
- Evitar desbordamiento horizontal.
- Agregar Playwright y un comando `test:e2e` para verificar el recorrido, foco, teclado y viewports de forma repetible.

#### Criterio de salida

Un operador puede crear y completar el recorrido documental en escritorio y móvil sin abrir la consola RNDC ni buscar acciones en módulos separados.

### Fase 4. Registrar operación física y cumplidos

#### Objetivo

Completar el ciclo posterior a la emisión con tiempos manuales, cumplido inicial por remesa y cumplido final del manifiesto.

#### Pruebas primero

Agregar casos que demuestren que:

- Los cinco tiempos de origen y los cinco de destino —llegada, entrada, inicio, fin y salida— aceptan el orden permitido y rechazan incoherencias.
- La entrega o llegada final manual se distingue de las llegadas a los sitios de cargue y descargue.
- Una remesa puede registrar cantidades entregadas, faltantes, sobrantes, devoluciones y observación.
- Cada remesa se cumple una sola vez.
- El manifiesto no se cumple mientras exista una remesa pendiente.
- Una secuencia interrumpida cumple primero las remesas restantes y después el manifiesto.
- La llegada manual no depende de GPS ni de puntos de control.
- Los documentos de cumplimiento conservan evidencia y fotografía propia.

#### Archivos principales

- `apps/web/app/api/rndc/dispatches/[expedienteId]/fulfill/route.ts`
- `apps/web/app/api/rndc/dispatches/[expedienteId]/fulfill/route.test.ts`
- `apps/web/app/expedientes/components/logistics-times-form.tsx`
- `apps/web/app/expedientes/components/consignment-fulfillment-form.tsx`
- `apps/web/app/expedientes/components/manifest-fulfillment-form.tsx`
- `apps/web/convex/model/fulfillmentWorkflow.ts`
- `apps/web/convex/model/fulfillmentWorkflow.test.ts`
- `apps/web/convex/expedientes.ts`
- `apps/web/convex/officialDocuments.ts`
- `apps/rndc-api/src/phaseOneRoutes.ts`
- `packages/rndc-core/src/rndc/flow.ts`
- `packages/rndc-core/src/documents/pdf.ts`

#### Cambios

- Agregar una etapa manual con cinco eventos de cargue, cinco de descargue y una entrega o llegada final diferenciada, cada uno con fecha, hora, actor y observación.
- Capturar los datos reales de cada remesa antes del cumplido inicial.
- Construir una secuencia reanudable de cumplimientos de remesa.
- Habilitar el cumplido final sólo cuando el conjunto esté listo.
- Mostrar el progreso por remesa y el resultado final del manifiesto.
- Generar y guardar los documentos y evidencias de cumplimiento.
- Permitir adjuntar soportes operativos sin mezclarlos con la evidencia técnica RNDC.

#### Criterio de salida

Un despacho autorizado puede registrar su ejecución física y quedar cumplido por completo en `dry-run`, con todas las remesas cerradas antes del manifiesto.

### Fase 5. Incorporar excepciones operativas y acciones avanzadas

#### Objetivo

Cubrir los casos reales que Avansat permite sin convertirlos en el camino normal ni debilitar las reglas de seguridad.

#### Casos

- Remesa sin orden de cargue como flujo secundario y explícito.
- Manifiesto vacío sólo para los casos oficialmente admitidos.
- Varias remesas en un manifiesto.
- Remesa municipal o remesa terrestre de carga, separadas del alcance municipal o intermunicipal del viaje y del tipo de manifiesto.
- Transbordo con vehículo y conductor de reemplazo.
- Corrección de documentos con motivo y comparación antes/después.
- Anulación dirigida de orden, remesa o manifiesto según dependencias.
- Anulación del conjunto sólo cuando la operación lo requiera explícitamente.
- Reconciliación manual de resultados inciertos.

#### Pruebas primero

Agregar casos que demuestren que:

- Los casos avanzados no aparecen para un operador sin permiso.
- Toda corrección y anulación exige motivo, observación y confirmación.
- Una anulación respeta las dependencias documentales.
- Un transbordo conserva la asignación anterior y crea una nueva fotografía.
- Un transbordo exige un manifiesto anterior elegible y conserva el vínculo entre ambos manifiestos.
- Un manifiesto vacío no activa `Requiere seguimiento` ni campos de GPS.
- Los casos de remesa sin orden, manifiesto vacío, tipo de remesa y transbordo completan recorridos independientes de extremo a extremo.
- Ninguna acción avanzada muestra credenciales, ubicación, operador GPS ni Control Tráfico.
- La conciliación no autoriza un documento diferente al esperado.
- Una excepción queda en auditoría y no se presenta como recorrido normal.

#### Archivos principales

- `apps/web/app/expedientes/components/advanced-actions.tsx`
- `apps/web/app/api/rndc/dispatches/[expedienteId]/correct/route.ts`
- `apps/web/app/api/rndc/dispatches/[expedienteId]/annul/route.ts`
- `apps/web/app/api/rndc/dispatches/[expedienteId]/reconcile/route.ts`
- `apps/web/convex/access.ts`
- `apps/web/convex/audit.ts`
- `apps/web/convex/officialDocuments.ts`
- `apps/web/convex/model/documentLifecycle.ts`
- `apps/rndc-api/src/phaseOneRoutes.ts`
- `packages/rndc-core/src/rndc/queries.ts`
- `packages/rndc-core/src/rndc/flow.ts`

#### Criterio de salida

Los casos secundarios se pueden ejecutar con permisos, validación, evidencia y auditoría sin interferir con el recorrido principal.

### Fase 6. Preparar listados, exportaciones y volumen real

#### Objetivo

Hacer que `Despachos` y `Documentos` sigan siendo rápidos y útiles cuando contengan el historial equivalente al observado en Avansat.

#### Pruebas primero

Agregar casos que demuestren que:

- La búsqueda y filtros se ejecutan en el servidor.
- La paginación no descarga toda la tabla al navegador.
- Cambiar un filtro reinicia el cursor de forma segura.
- La exportación respeta exactamente los filtros y el orden visibles.
- Los consecutivos con ceros iniciales no se convierten en números al exportar.
- Fechas, placas, documentos y estados conservan su formato.
- Operador, administrador y auditor reciben sólo las columnas personales permitidas y el resto se enmascara o excluye.
- Una prueba representativa con al menos 50.000 registros cumple un umbral de respuesta definido antes de implementar la optimización.

#### Archivos principales

- `apps/web/convex/dispatchSearch.ts`
- `apps/web/convex/schema.ts`
- `apps/web/convex/dashboard.ts`
- `apps/web/app/expedientes/page.tsx`
- `apps/web/app/documentos/page.tsx`
- `apps/web/app/api/exports/dispatches/route.ts`
- `apps/web/app/api/exports/dispatches/route.test.ts`
- `apps/web/app/api/exports/orders/route.ts`
- `apps/web/app/api/exports/consignments/route.ts`
- `apps/web/app/api/exports/manifests/route.ts`
- `apps/web/app/lib/exportSchemas.ts`
- `apps/web/app/lib/exportSchemas.test.ts`
- `apps/web/app/components/document-table.tsx`
- `apps/web/convex/notifications.ts`
- `apps/web/scripts/seed-dispatch-volume.ts`
- `apps/web/scripts/cleanup-dispatch-volume.ts`
- `apps/web/package.json`
- `package-lock.json`
- `packages/rndc-core/src/documents/pdf.ts`

#### Cambios

- Agregar índices para organización, fecha, etapa, estado, placa, conductor, cliente, origen y destino, junto con una proyección normalizada e índice de búsqueda para texto compuesto.
- Implementar búsqueda paginada y filtros persistentes en la URL.
- Crear tres esquemas estables de exportación: órdenes, remesas y manifiestos, además del resumen opcional de despachos.
- La exportación de órdenes incluirá número, fecha, placa, agencia y ciudad, origen, destino, remitente, mercancía, estado local, impresión, creación y anulación.
- La exportación de remesas incluirá números de remesa, remisión y RNDC, orden, citas, cantidad, peso, valor declarado, seguro, estados local y de impresión, y radicados de cargue y descargue.
- La exportación de manifiestos incluirá números interno y electrónico RNDC, tipo, expedición, fecha límite, agencia, ruta y códigos DANE, vehículo, remolque, remesas, liquidación, estados, radicación, anulación y cumplimiento.
- Aplicar en el servidor el enmascaramiento o exclusión de identificaciones, teléfonos, licencias, SOAT y datos de propietario, poseedor y conductor según el rol.
- Elegir e instalar una dependencia de escritura Excel mantenida, fijarla en el lockfile y probar tipos de celda, fechas y ceros iniciales.
- Crear datos sintéticos reproducibles y su limpieza para la prueba de 50.000 registros.
- Mantener `Imprimir` separado del estado oficial `Autorizado`.
- Ajustar documentos PDF a la identidad de MTM y verificar su legibilidad.
- Generar notificaciones accionables para rechazos, conciliaciones, documentos por cumplir y errores de evidencia.

#### Criterio de salida

La cola, los documentos y la exportación funcionan con volumen representativo sin bloquear el navegador ni perder precisión documental.

### Fase 7. Endurecer autenticación, operación y despliegue

#### Objetivo

Retirar las condiciones de demostración que impedirían usar el sistema como reemplazo real.

#### Pruebas primero

Agregar casos que demuestren que:

- Cada organización sólo puede leer y modificar sus propios datos.
- `admin`, `operator` y `auditor` tienen permisos distintos y verificables.
- Una sesión demo nunca puede habilitar `RNDC_MODE=live`.
- Las rutas oficiales rechazan solicitudes sin identidad, permiso o token de servicio.
- La rotación o expiración de sesión no deja una operación oficial a medias sin estado recuperable.
- Un reinicio del backend recupera operaciones pendientes desde almacenamiento durable.

#### Archivos principales

- `docs/plans/2026-07-10-auth-provider-decision.md`
- `apps/web/proxy.ts`
- `apps/web/app/lib/auth.ts`
- `apps/web/app/lib/auth-server.ts`
- `apps/web/app/lib/auth-client.ts`
- `apps/web/app/api/auth/`
- `apps/web/convex/auth.config.ts`
- `apps/web/convex/access.ts`
- `apps/web/convex/model/access.ts`
- `apps/rndc-api/src/runtimeSecurity.ts`
- `apps/rndc-api/src/index.ts`
- `apps/rndc-api/src/tests/apiSecurity.test.ts`
- `apps/rndc-api/src/tests/operationWorker.test.ts`
- `docs/operations/rndc-deployment.md`
- `docs/operations/rndc-recovery.md`
- `apps/web/package.json`
- `apps/rndc-api/package.json`
- `package-lock.json`

#### Cambios

- Resolver primero una decisión corta y verificable del proveedor de identidad, considerando organizaciones, roles, Convex, Vercel, recuperación de cuenta y costo; no iniciar la sustitución con el proveedor abierto.
- Sustituir la autenticación demo sólo después de aprobar esa decisión.
- Aplicar autorización en consultas, mutaciones, rutas same-origin y descargas.
- Desplegar `apps/rndc-api` como servicio Node persistente con egress permitido al RNDC.
- Configurar secretos sólo en el entorno de despliegue.
- Verificar almacenamiento, respaldo, restauración y retención de evidencia.
- Configurar salud, disponibilidad, métricas, logs sin datos sensibles y alertas.
- Definir runbooks para timeout, conciliación, rechazo, caída del RNDC y recuperación.
- Mantener el frontend en Vercel y el backend fuera de funciones efímeras cuando la operación durable lo requiera.

#### Criterio de salida

El sistema puede reiniciarse y recuperarse, los permisos están verificados y ninguna dependencia de demostración queda en el camino de producción.

### Fase 8. Migración operativa y reemplazo gradual de Avansat

#### Objetivo

Cambiar de plataforma sin perder documentos, consecutivos, trazabilidad ni capacidad de reversa.

#### Archivos principales

- `apps/web/scripts/import-avansat-history.ts`
- `apps/web/scripts/lib/avansatTabular.ts`
- `apps/web/scripts/lib/avansatTabular.test.ts`
- `apps/web/convex/imports.ts`
- `apps/web/convex/schema.ts`
- `apps/web/convex/audit.ts`
- `apps/web/package.json`
- `package-lock.json`

#### Pruebas primero

Agregar casos con copias minimizadas y enmascaradas de los formatos suministrados que demuestren detección tabulada por contenido, fallback de encoding, desambiguación de encabezados, conservación de ceros iniciales, rechazo por fila, idempotencia y bloqueo de acciones oficiales en registros importados.

#### Preparación

- Definir el conjunto mínimo de maestros para el primer recorrido: clientes, lugares, vehículos, remolques, conductores, mercancías, empaques, agencias, aseguradoras y pólizas.
- Incorporar después los catálogos oficiales de municipios y marcas cuando sean suministrados; los códigos oficiales de municipio y demás códigos RNDC serán obligatorios antes de la puerta de tráfico real.
- Crear importadores idempotentes con detección por contenido, no por extensión. Deberán aceptar los `.xls.xls` suministrados como texto tabulado, intentar ASCII e ISO-8859-1, usar mapas explícitos de encabezados, desambiguar encabezados repetidos, ignorar columnas vacías controladas y conservar el valor original junto con el resultado normalizado.
- Reportar por fila registros aceptados, rechazados y duplicados, con una razón verificable.
- Mapear estados y consecutivos históricos de Avansat a los estados internos.
- Importar sólo el historial necesario para consulta y continuidad operativa.
- Marcar los registros importados con procedencia y `officialActionsBlocked` aplicado por el servidor para impedir que se envíen de nuevo al RNDC.

#### Prueba paralela

- Elegir usuarios y rutas representativas.
- Mantener Avansat como único emisor real durante la prueba paralela. El nuevo TMS permanecerá en `dry-run` y comparará los mismos casos sin emitir una segunda vez.
- Comparar orden, remesas, manifiesto, valores, PDF, cumplidos y resultado RNDC.
- Registrar diferencias como incidencias de aceptación.
- Medir tiempo de despacho, errores, pasos y necesidad de soporte.
- Capacitar con el lenguaje y flujo aprobado.

#### Puerta de tráfico real

La primera prueba real requiere una autorización separada. Antes de ella deberán estar verificados:

- Autenticación real y permisos.
- Backend desplegado y durable.
- Respaldos y restauración.
- Alertas y runbooks.
- Maestros del caso elegido.
- Idempotencia y conciliación.
- Evidencia y descarga de documentos.
- Plan de reversa.
- Responsable operativo presente.

#### Criterio de salida

Los usuarios completan los casos de aceptación, la primera transmisión controlada se concilia y existe una decisión formal de avance o reversa antes de ampliar el uso.

## Dependencias entre fases

```text
Fase 0: confiabilidad documental
  ↓
Fase 1: modelo editable y fotografías
  ↓
Fase 2: secuencia documental de servidor
  ↓
Fase 3: experiencia guiada
  ↓
Fase 4: operación física y cumplidos
  ↓
Fase 5: excepciones avanzadas
  ↓
Fase 6: volumen, búsqueda y exportación
  ↓
Fase 7: autenticación y operación durable
  ↓
Fase 8: migración, paralelo y tráfico controlado
```

Las fases 3 y 6 pueden preparar componentes en paralelo después de estabilizar la fase 1, pero no deberán declarar un recorrido completo hasta que la secuencia de la fase 2 esté verificada.

## Recorridos de aceptación

### Recorrido A. Un despacho normal con una remesa

1. Crear despacho.
2. Guardar orden de cargue.
3. Crear remesa heredando remitente, destinatario, ruta y carga.
4. Asignar vehículo y conductor.
5. Crear manifiesto.
6. Revisar y emitir en `dry-run`.
7. Descargar orden, remesa y manifiesto.
8. Registrar cargue, descargue y llegada manual.
9. Cumplir remesa.
10. Cumplir manifiesto.
11. Verificar cronología, documentos y evidencia.

### Recorrido B. Un despacho con varias remesas

1. Crear una orden con dos destinos o entregas.
2. Crear dos remesas.
3. Seleccionar ambas en el manifiesto.
4. Emitir y verificar resultado individual por remesa.
5. Cumplir la primera remesa y confirmar que el manifiesto sigue abierto.
6. Cumplir la segunda y habilitar el cumplido final.

### Recorrido C. Rechazo y corrección

1. Provocar un rechazo controlado en `dry-run`.
2. Ver el código y la explicación en la siguiente acción.
3. Corregir el dato permitido.
4. Crear una nueva fotografía auditada.
5. Reanudar sin duplicar pasos autorizados.

### Recorrido D. Timeout y conciliación

1. Simular un resultado incierto.
2. Confirmar que el reenvío queda bloqueado.
3. Conciliar el documento esperado.
4. Resolver como autorizado, rechazado o pendiente sin aceptar otro documento.

### Recorrido E. Anulación

1. Seleccionar un documento anulable.
2. Registrar motivo y observación.
3. Confirmar dependencias y alcance.
4. Ejecutar en `dry-run`.
5. Verificar estado, auditoría y evidencia.

### Recorrido F. Móvil y teclado

1. Crear y continuar un despacho a 390 y 360 píxeles.
2. Completar cada formulario sin desplazamiento horizontal.
3. Navegar, corregir errores y confirmar usando teclado.
4. Verificar que la acción fija no cubra controles ni mensajes.

### Recorrido G. Tipos y excepciones controladas

1. Crear y completar una `Remesa municipal` y una `Remesa terrestre de carga` sin confundirlas con el alcance del viaje o el tipo de manifiesto.
2. Crear una remesa sin orden desde la acción secundaria y verificar sus bloqueos propios.
3. Crear un manifiesto vacío elegible y confirmar que no solicite seguimiento, operador ni credenciales GPS.
4. Crear un transbordo a partir de un manifiesto anterior elegible, conservar el vínculo y las dos fotografías de asignación.
5. Confirmar que un operador sin permiso no pueda ejecutar estas acciones avanzadas.

### Recorrido H. Importación y exportación Avansat

1. Importar los dos archivos `.xls.xls` tabulados con sus encodings reales.
2. Verificar encabezados repetidos, columnas vacías, ceros iniciales y rechazos por fila.
3. Confirmar que los registros importados tengan `officialActionsBlocked` en el servidor.
4. Exportar por separado órdenes, remesas y manifiestos con los filtros activos.
5. Comparar números, radicados, fechas, estados, liquidación y auditoría con los archivos originales.
6. Verificar enmascaramiento distinto para operador, administrador y auditor.

## Verificación por fase

Durante el desarrollo:

```bash
npm run test -w @tms/web
npm run test -w @tms/rndc-api
npm run test -w @tms/rndc-core
```

Después de cambios estructurales o de TypeScript:

```bash
npm run typecheck
npm run build
```

Después de cambios al esquema o funciones Convex:

```bash
npm run convex:once -w @tms/web
```

Después de cambios al núcleo, XML, configuración, PDF o secuencia RNDC:

```bash
RNDC_MODE=dry-run npm run rndc:flow
RNDC_MODE=dry-run npm run rndc:loading-order
RNDC_MODE=dry-run npm run rndc:prepare-ops
```

El cumplimiento se ejecutará únicamente con evidencia generada en `dry-run`:

```bash
RNDC_MODE=dry-run npm run rndc:fulfill -- <ruta-evidencia-dry-run>
```

Antes de cerrar una fase:

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

Después de cambios al recorrido guiado:

```bash
npm run test:e2e -w @tms/web
```

Además:

- Iniciar web, Convex y backend disponibles para el recorrido afectado.
- Verificar el flujo en navegador de escritorio y móvil.
- Revisar consola del navegador y respuestas de red.
- Renderizar e inspeccionar visualmente cualquier PDF modificado.
- Reiniciar servicios cuando se modifique recuperación o cola durable.
- Confirmar que ningún secreto, dato sensible o artefacto temporal se agregó al diff.

## Acciones expresamente prohibidas durante este plan

- Ejecutar `npm run rndc:prod-flow`.
- Cambiar `RNDC_MODE` a `live` sin una autorización nueva y específica.
- Usar credenciales RNDC en pruebas, capturas, logs o commits.
- Reenviar automáticamente una operación incierta.
- Marcar un documento como autorizado antes de persistir evidencia.
- Permitir que el navegador encadene escrituras parciales para simular una transacción.
- Declarar que Avansat fue reemplazado antes de completar la prueba paralela y la puerta de producción.

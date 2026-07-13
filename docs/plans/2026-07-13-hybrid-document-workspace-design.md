# Diseño: Navegación híbrida por despacho y documento

Fecha: 2026-07-13
Estado: aprobado por el usuario
Base funcional: `cf12561`

## Objetivo

Permitir que el operador trabaje con la lógica documental que ya conoce de Avansat sin perder la relación integral del despacho. El producto conservará `Despachos` como vista completa del viaje y agregará entradas permanentes para órdenes de cargue, remesas, manifiestos, cumplidos y correcciones o anulaciones.

La experiencia debe reducir la sensación de un único registro largo. Los documentos seguirán compartiendo los datos del despacho y respetando sus dependencias RNDC, pero cada uno tendrá una cola de trabajo y un punto de entrada propios.

## Decisión aprobada

Se implementará un modelo híbrido:

- `Despachos` seguirá mostrando el recorrido completo, su etapa actual y la siguiente acción.
- `Documentos` se convertirá en un grupo de navegación con vistas estables para cada tipo documental.
- `Correcciones y anulaciones` será una sección principal y visible.
- Un despacho nuevo guardará primero los datos base y abrirá después el centro documental del despacho.
- Cada documento se editará, emitirá, consultará o completará desde su contexto, sin duplicar información ni crear una segunda fuente de verdad.

## Alternativas descartadas

### Conservar el asistente y mover las acciones avanzadas

Reduce el alcance del cambio, pero mantiene la sensación de proceso extenso y no aprovecha el hábito documental de los operadores.

### Separar completamente los módulos como Avansat

Resulta familiar, pero fragmenta la operación, favorece la digitación repetida y dificulta entender qué documentos pertenecen al mismo viaje.

## Navegación objetivo

- `Panel`
- `Despachos`
- `Documentos`
  - `Todos los documentos`
  - `Órdenes de cargue`
  - `Remesas`
  - `Manifiestos`
  - `Cumplidos`
- `Correcciones y anulaciones`
- `Maestros`

En escritorio, el grupo documental permanecerá visible y reconocible. En móvil, se conservará dentro del menú compacto con objetivos táctiles adecuados y sin desbordamiento horizontal.

## Creación de un despacho

`Nuevo despacho` dejará de presentar las cinco etapas como una obligación continua. La primera pantalla se enfocará exclusivamente en los datos base necesarios para crear la orden de cargue:

- Referencia comercial y agencia.
- Cliente, remitente y destinatario.
- Origen, destino y citas.
- Mercancía, cantidad, peso y empaque.
- Observaciones disponibles en esa etapa.

Al guardar, el sistema creará el despacho como borrador y abrirá su centro documental. Allí, las tarjetas de orden de cargue, remesas, vehículo y conductor, manifiesto y cumplidos mostrarán su estado, bloqueos y acción disponible.

El operador podrá salir después de la creación base y retomar desde `Despachos` o desde la cola del documento que necesita completar.

## Vistas por documento

Cada vista documental compartirá búsqueda, estado, paginación y lenguaje visual, pero tendrá un propósito propio:

- `Órdenes de cargue`: iniciar, completar, revisar, emitir y abrir el despacho relacionado.
- `Remesas`: continuar borradores, revisar remesas autorizadas, consultar PDF y abrir el despacho en la etapa de remesas.
- `Manifiestos`: completar asignación o liquidación, revisar emisión, consultar PDF y abrir el manifiesto relacionado.
- `Cumplidos`: ver documentos pendientes, parciales y completados, y abrir la etapa de cumplimiento correspondiente.

Las vistas serán accesos diferentes a los mismos registros. No almacenarán copias ni estados paralelos.

## Correcciones y anulaciones

La sección tendrá dos propósitos:

- Mostrar operaciones que necesitan conciliación o atención.
- Permitir localizar un documento autorizado y abrir su acción protegida de corrección o anulación.

Cada fila identificará el documento, despacho, ruta, estado actual y acción disponible. La acción abrirá el detalle del despacho con la sección visible. Los formularios existentes conservarán motivo, observación, confirmación, permisos y auditoría.

Las acciones destructivas no se ejecutarán directamente desde una tabla. El usuario siempre revisará primero el documento y sus dependencias.

## Detalle del despacho

El centro documental será el punto principal después de crear o abrir un despacho. La navegación por etapas seguirá disponible, pero funcionará como acceso directo a un documento, no como un asistente obligatorio.

`Correcciones y anulaciones` aparecerá cerca de los documentos oficiales y también podrá abrirse mediante un enlace directo. `Evidencia técnica` e `Historial` permanecerán separados de las acciones operativas.

## Seguridad y RNDC

- El frontend no enviará operaciones directamente al RNDC.
- Se conservarán el gateway, las intenciones durables, la idempotencia y la evidencia existente.
- No se ejecutará ninguna operación RNDC real durante implementación o validación.
- Las dependencias entre orden, remesas, manifiesto y cumplidos seguirán bloqueando acciones inválidas.
- Correcciones, anulaciones y conciliaciones conservarán permisos, confirmación y trazabilidad.

## Estados vacíos y errores

Cada cola explicará qué significa no tener registros y ofrecerá una siguiente acción coherente. Los errores conservarán el documento y el despacho como contexto, y nunca sugerirán reenviar una operación incierta.

## Accesibilidad y adaptación

- Los grupos de navegación usarán enlaces reales y estado activo visible.
- Los controles conservarán etiquetas accesibles y foco visible.
- El tipo y estado de cada documento se expresarán con texto además de color.
- Las tablas cambiarán a filas resumidas o tarjetas en móvil.
- La navegación documental no dependerá de submenús activados sólo con el puntero.
- Las acciones peligrosas conservarán texto explícito y confirmación.

## Verificación

La implementación se considerará terminada cuando:

- Las rutas documentales funcionen con búsqueda, filtros, paginación y estados vacíos.
- Los enlaces abran el despacho en la etapa documental correcta.
- `Nuevo despacho` guarde los datos base y abra el centro documental sin exigir completar las cinco etapas.
- `Correcciones y anulaciones` sea visible desde la navegación y conduzca a las acciones protegidas correctas.
- Los recorridos existentes de despacho, emisión, operación y cumplimiento sigan funcionando.
- La experiencia haya sido inspeccionada en escritorio y móvil.
- Pasen pruebas, typecheck, build y el flujo RNDC en modo `dry-run`.

# Plan de implementación: Navegación híbrida por despacho y documento

Fecha: 2026-07-13
Diseño aprobado: `docs/plans/2026-07-13-hybrid-document-workspace-design.md`
Commit del diseño: `6fe5933`

## Resultado esperado

El operador podrá entrar por `Despachos` para ver el viaje completo o por una cola documental para trabajar órdenes de cargue, remesas, manifiestos y cumplidos. `Correcciones y anulaciones` será una sección visible que conducirá a las acciones protegidas del documento seleccionado. Un despacho nuevo guardará los datos base y abrirá inmediatamente su centro documental.

## Definición de terminado

- La navegación documental funciona en escritorio y móvil.
- Cada tipo documental tiene una ruta estable, filtros, búsqueda, paginación y enlaces al despacho relacionado.
- Las filas documentales abren directamente la etapa correcta del despacho.
- `Nuevo despacho` deja de exigir el recorrido de cinco pasos y termina en el centro documental.
- Las correcciones, anulaciones y conciliaciones se pueden localizar desde la navegación principal.
- Las acciones oficiales siguen requiriendo revisión, permisos, motivo, observación y confirmación.
- Las pruebas automatizadas, typecheck, build, recorridos de navegador y flujo RNDC `dry-run` pasan.

## Fase 1. Contratos de navegación y enlaces

### Pruebas primero

Agregar pruebas que demuestren:

- Cada sección documental resuelve su tipo, título, descripción y etapa de despacho.
- Una sección desconocida se rechaza.
- Cada documento construye un enlace al despacho y a la etapa correcta.
- Cumplidos abre la etapa de cumplimiento correspondiente.
- Correcciones y anulaciones construyen enlaces que muestran las acciones protegidas.

### Implementación

- Crear un contrato compartido para secciones documentales.
- Reutilizarlo en navegación, encabezados, filtros y enlaces.
- Agregar metadatos de página para todas las rutas nuevas.

## Fase 2. Colas documentales

### Pruebas primero

Agregar pruebas sobre presentación y enlaces de filas documentales antes de cambiar la tabla.

### Implementación

- Extraer el listado actual a un espacio de trabajo reutilizable.
- Agregar rutas para órdenes, remesas, manifiestos y cumplidos.
- Mantener `/documentos` como historial completo.
- Fijar el tipo documental en cada ruta específica y conservar filtros de estado y búsqueda.
- Agregar acciones claras para abrir el documento dentro de su despacho.
- Mantener estados vacíos y carga incremental.

## Fase 3. Correcciones y anulaciones

### Pruebas primero

Agregar pruebas que demuestren:

- Los documentos autorizados muestran la acción de revisión protegida.
- Los resultados inciertos conducen a conciliación.
- Ninguna acción destructiva se ejecuta desde la tabla.
- Los enlaces incluyen el panel y la acción solicitada.

### Implementación

- Crear la ruta principal `Correcciones y anulaciones`.
- Mostrar accesos a documentos corregibles y a despachos que requieren atención.
- Reutilizar los documentos y operaciones existentes; no crear estados paralelos.
- Abrir el detalle del despacho con la sección visible y, cuando sea seguro, con la acción preseleccionada.

## Fase 4. Creación base y centro documental

### Pruebas primero

Actualizar el recorrido de navegador para demostrar que:

- El formulario inicial muestra sólo la creación base.
- Guardar crea el borrador y navega al centro documental.
- La orden queda seleccionada después de crear.
- El operador puede continuar remesas o salir sin completar las demás etapas.

### Implementación

- Retirar el indicador obligatorio de cinco pasos de `Nuevo despacho`.
- Conservar los campos base necesarios para crear la orden de cargue.
- Guardar cliente, lugares, orden de servicio, despacho y borrador de orden.
- Navegar al detalle con la etapa de orden seleccionada y el centro documental disponible.
- Conservar la capacidad de guardar y salir.

## Fase 5. Detalle y acciones visibles

### Pruebas primero

Agregar pruebas para resolver los parámetros de etapa, panel y acción protegida.

### Implementación

- Leer la etapa solicitada desde la URL.
- Hacer visible `Correcciones y anulaciones` junto al centro documental.
- Conservar evidencia e historial como secciones separadas.
- Permitir enlaces directos desde las colas documentales y la cola de correcciones.

## Fase 6. Adaptación y verificación

- Ajustar la navegación expandida, las tablas, tarjetas y acciones para escritorio y móvil.
- Verificar teclado, foco visible, objetivos táctiles, contraste y ausencia de desbordamiento horizontal.
- Ejecutar pruebas específicas después de cada ciclo rojo-verde.
- Ejecutar `npm run typecheck`.
- Ejecutar `npm test`.
- Ejecutar `npm run build`.
- Ejecutar `npm run rndc:flow` con `RNDC_MODE=dry-run`.
- Ejecutar los recorridos de navegador y revisar visualmente escritorio y móvil.

## Límites

- No se enviará tráfico RNDC real.
- No se cambiará el modelo oficial de dependencias documentales.
- No se agregará GPS, facturación ni integración DIAN.
- No se duplicarán documentos o despachos para alimentar las nuevas vistas.

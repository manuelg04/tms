# Plan de implementación: operación integral y clara del TMS RNDC

Fecha: 2026-07-12
Diseño: `2026-07-12-operacion-integral-rndc-design.md`

## Definición de terminado

El alcance termina cuando las capacidades solicitadas pueden demostrarse desde la interfaz con datos persistidos, evidencia protegida, PDF y XML preparado en modo de prueba, y cuando todas las verificaciones exigidas por el proyecto pasan.

## Orden de trabajo

### 1. Consolidar la línea base

- Preservar los cambios locales existentes de excepciones, búsquedas y exportaciones.
- Ejecutar las pruebas actuales y registrar los faltantes reales.
- Confirmar que el backend muestra `dry-run` antes de cualquier recorrido.

### 2. Habilitar maestros operativos

- Agregar pruebas de validación, aislamiento por organización y reutilización de terceros por rol.
- Crear mutaciones autenticadas para personas, conductores y vehículos.
- Incorporar formularios claros en `Maestros` para conductor, vehículo, propietario, poseedor y tercero.
- Preparar la transmisión RNDC de procesos 11 y 12 desde el servidor y mostrar el estado de la simulación.

### 3. Cerrar corrección, edición y anulación

- Mantener la edición directa sólo para borradores.
- Separar permisos de anulación y corrección de las excepciones estructurales.
- Permitir al operador anular un manifiesto elegible con motivo, observación y confirmación.
- Mantener transbordos, manifiestos vacíos y cadenas completas bajo administración.

### 4. Hacer visibles los PDF

- Agregar pruebas que exijan PDF para orden, remesa y manifiesto.
- Asociar los PDF generados a los documentos oficiales y a la evidencia protegida.
- Mostrar la descarga en el expediente y en `Documentos`.
- Renderizar e inspeccionar al menos una página de cada tipo.

### 5. Pulir el recorrido completo

- Eliminar enlaces y mensajes que envían al operador a la consola técnica.
- Corregir estados heredados que muestren una siguiente acción contradictoria.
- Verificar que cada etapa tenga una acción principal y un bloqueo comprensible.

### 6. Verificación final

- Ejecutar las pruebas específicas en rojo y verde durante cada cambio.
- Ejecutar `npm test`.
- Ejecutar `npm run typecheck`.
- Ejecutar `npm run build`.
- Ejecutar `npm run rndc:flow` con `RNDC_MODE=dry-run`.
- Ejecutar las pruebas de navegador existentes.
- Recorrer escritorio y móvil: crear maestro, crear/editar despacho, emisión, tiempos, cumplidos, anulación y descarga PDF.
- Revisar la consola del navegador y confirmar que no hay errores relevantes.

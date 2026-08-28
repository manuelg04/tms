# Plan de implementación: Ingesta segura de catálogos de referencia RNDC

Fecha: 2026-08-27
Diseño aprobado: `docs/plans/2026-08-27-rndc-reference-catalog-ingestion-design.md`

## Resultado esperado

Los cuatro catálogos RNDC quedarán disponibles como referencias globales, tipadas e indexadas. La carga podrá repetirse sin duplicar ni tocar registros sin cambios, y cada ejecución dejará evidencia resumida verificable.

## Definición de terminado

- Los cuatro archivos se validan completamente antes de escribir.
- Los duplicados históricos se resuelven por fecha y los conflictos ambiguos se detienen.
- Las relaciones marca-línea conservan la clave compuesta.
- No se modifican vehículos, terceros, documentos, formularios ni flujos RNDC.
- El modo seguro informa los conteos esperados.
- Pruebas, typecheck y build pasan.
- La validación de Convex se ejecuta únicamente en desarrollo.
- La carga real en desarrollo se verifica por lectura y por una segunda ejecución idempotente.

## Fase 1. Contrato puro del parser

### Pruebas primero

Agregar pruebas que demuestren:

- Decodificación correcta de caracteres Windows-1252 y reparación del mojibake confirmado.
- Validación estricta de cabeceras y número de columnas.
- Conservación de códigos como texto.
- Clave compuesta para líneas.
- Selección de la fila más reciente para claves repetidas.
- Rechazo de conflictos con igual fecha.
- Tratamiento de valores desconocidos y validación de pesos.
- Estadísticas exactas sobre los cuatro archivos reales.

### Implementación

Crear un módulo puro que lea bytes, normalice texto y produzca colecciones tipadas sin conocer Convex.

## Fase 2. Esquema y funciones Convex

### Pruebas primero

Agregar pruebas unitarias para la decisión de inserción, actualización, registro sin cambios, fuente antigua y conflicto.

### Implementación

- Agregar las cuatro tablas globales y la tabla resumida de importaciones.
- Agregar índices exactos para cada clave natural.
- Crear una mutación protegida para lotes con validadores completos.
- Crear funciones protegidas para iniciar, finalizar y verificar una importación.
- Mantener la lógica de decisión en funciones TypeScript puras y probadas.

## Fase 3. Comando de ingesta

### Pruebas primero

Probar el análisis de argumentos y la exigencia de los cuatro archivos antes de agregar comunicación remota.

### Implementación

- Agregar un comando único `ingest:rndc-catalogs`.
- Exigir rutas explícitas para los cuatro archivos.
- Usar simulación local por defecto y exigir `--apply` para cualquier escritura.
- Calcular SHA-256 y generar un reporte JSON local.
- Enviar lotes sólo después de que los cuatro parsers terminen correctamente.
- Reutilizar un identificador determinista para recuperar corridas interrumpidas y evitar repetir una corrida ya certificada.
- Mostrar insertados, actualizados, sin cambios y deduplicados por catálogo.

## Fase 4. Verificación local

- Ejecutar cada prueba nueva en rojo antes de implementar su comportamiento.
- Ejecutar las pruebas enfocadas hasta dejarlas en verde.
- Agregar las pruebas nuevas al comando web explícito.
- Ejecutar `npm run test -w @tms/web`.
- Ejecutar `npm run typecheck -w @tms/web`.
- Ejecutar `npm run build`.
- Ejecutar el comando sobre los cuatro archivos con `--dry-run` y comprobar los conteos.

## Fase 5. Validación y carga en desarrollo

- Identificar el tipo de despliegue configurado sin imprimir secretos.
- Detenerse si el destino es producción.
- Exigir además la habilitación de ingesta configurada únicamente en el servidor de desarrollo.
- Validar esquema y funciones con `npm run convex:once -w @tms/web` únicamente en desarrollo.
- Ejecutar la carga.
- Leer de vuelta todos los conteos y relaciones mediante funciones protegidas y paginadas.
- Certificar la huella del catálogo normalizado contra los recibos de lote mantenidos por el servidor.
- Ejecutar nuevamente la misma carga y comprobar cero inserciones y cero actualizaciones.
- Comparar las relaciones de líneas, aseguradoras y carrocerías con los códigos existentes sin modificar vehículos.

## Límites

- No ejecutar `convex deploy`.
- No enviar operaciones RNDC.
- No agregar selectores ni cambios visuales.
- No borrar referencias por ausencia en un archivo posterior.
- No incluir archivos fuente reales ni reportes de ingesta en Git.

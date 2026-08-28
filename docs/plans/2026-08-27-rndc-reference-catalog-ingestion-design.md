# Diseño: Ingesta segura de catálogos de referencia RNDC

Fecha: 2026-08-27
Estado: aprobado por el usuario

## Objetivo

Incorporar los catálogos oficiales de líneas de vehículos, empresas aseguradoras, empaques y tipos de carrocería extraídos del RNDC sin modificar los maestros operativos existentes, los formularios ni los flujos XML/SOAP.

La carga debe ser repetible, auditable y resistente a archivos parciales, duplicados históricos y relaciones ambiguas.

## Decisión aprobada

Se crearán cuatro catálogos globales y tipados en Convex:

- Líneas de vehículos, identificadas por la relación compuesta entre código de marca y código de línea.
- Empresas aseguradoras, identificadas por NIT.
- Empaques, identificados por código RNDC.
- Tipos de carrocería, identificados por código RNDC.

También se registrará un resumen por archivo importado con su huella SHA-256, la huella del catálogo normalizado, cantidades procesadas y resultado final.

Los catálogos no tendrán organización porque los archivos no contienen una empresa transportadora y representan referencias globales del RNDC.

## Alternativas descartadas

### Una tabla genérica para todos los catálogos

Reduce el número de tablas, pero debilita la validación de campos y facilita mezclar claves que tienen reglas diferentes.

### Copiar referencias dentro de vehículos y operaciones

Evita nuevas tablas, pero duplicaría información, alteraría datos operativos existentes y dificultaría actualizar un catálogo sin tocar miles de registros.

## Datos de origen

Los cuatro archivos con extensión `.xls` son tablas de texto delimitadas por tabulaciones. Se leerán como Windows-1252, se eliminará únicamente la columna final vacía causada por la tabulación terminal y se normalizarán espacios regulares y no separables.

Los identificadores se conservarán como texto. Los pesos de empaque se validarán como números no negativos y los valores desconocidos no se convertirán en cero o falso.

## Identidad y relaciones

- Una línea pertenece a una marca. Su identidad es `codigoMarca + codigoLinea`; el código de línea aislado no es único.
- Una aseguradora se identifica por NIT.
- Un empaque se identifica por su código, que puede ser numérico o alfanumérico.
- Una carrocería se identifica por su código.
- Los vehículos existentes conservarán sus códigos actuales. La importación comprobará qué relaciones pueden resolverse, pero no escribirá identificadores nuevos dentro de esos vehículos.

## Duplicados y precedencia

Todos los archivos se validarán antes de iniciar la primera escritura remota.

Cuando un archivo contenga varias filas para una misma clave:

- Gana la fila con `FECHAINGRESO` más reciente.
- Una fila antigua se cuenta como versión histórica deduplicada.
- Dos filas diferentes con la misma clave y la misma fecha se rechazan como conflicto y detienen la carga completa.
- Una fila sin clave válida se rechaza y detiene la carga completa.

La fuente actual contiene dos NIT repetidos de aseguradoras y un código repetido de carrocería; la regla anterior elige de manera determinista las descripciones más recientes.

## Persistencia e idempotencia

La escritura se hará en lotes pequeños mediante una función protegida con `RNDC_INGEST_KEY` y una habilitación adicional que sólo existe en el despliegue de desarrollo.

Para cada registro:

- Si no existe, se inserta.
- Si existe y la fuente entrante es más reciente, se actualiza.
- Si existe con la misma fecha y el mismo contenido normalizado, queda sin cambios.
- Si la fuente entrante es más antigua, queda sin cambios.
- Si existe con la misma fecha y contenido diferente, el lote falla sin sobrescribirlo.

No se eliminarán registros ausentes de una exportación posterior. Una segunda ejecución sobre los mismos archivos debe producir cero inserciones y cero actualizaciones.

## Flujo de ingesta

1. Confirmar que existen exactamente los cuatro archivos esperados.
2. Calcular la huella SHA-256 de cada archivo.
3. Decodificar, validar cabeceras y normalizar todas las filas.
4. Resolver duplicados históricos y generar estadísticas.
5. Sin `--apply`, producir únicamente el reporte local.
6. Validar el esquema y las funciones contra un entorno Convex de desarrollo.
7. Crear el registro resumido de importación y enviar los lotes.
8. Leer nuevamente conteos y relaciones para comprobar el resultado.
9. Certificar en el servidor la secuencia completa de lotes y marcar la importación como completada o fallida.
10. Repetir la carga y confirmar idempotencia real.

## Errores y recuperación

Una falla de lectura o validación ocurre antes de cualquier escritura. Una falla de red durante los lotes puede dejar una importación parcial, pero el identificador determinista de la corrida, los recibos de lote y las claves naturales permiten reanudar exactamente la misma carga ejecutando nuevamente el comando.

Los reportes locales mostrarán filas leídas, registros normalizados, versiones históricas descartadas, inserciones, actualizaciones, registros sin cambios, conflictos y relaciones no resueltas. No incluirán secretos.

## Seguridad

- No se ejecutará ningún mensaje XML/SOAP ni acción oficial del RNDC.
- No se modificará el frontend.
- No se ejecutará un despliegue Convex de producción.
- Las funciones de escritura y verificación administrativa exigirán la clave de ingesta y la habilitación exclusiva del servidor de desarrollo.
- El servidor volverá a calcular las huellas de filas, lotes y catálogo completo antes de certificar la corrida.
- Las consultas de lectura futuras usarán índices y límites explícitos.

## Verificación

La implementación se considerará terminada cuando:

- Los parsers fallen ante cabeceras inválidas, claves vacías, fechas inválidas y conflictos de igual fecha.
- Las pruebas cubran Windows-1252, caracteres acentuados, códigos alfanuméricos, relaciones compuestas y duplicados históricos.
- El `dry-run` procese 18.632 líneas, 108 aseguradoras vigentes, 31 empaques y 94 carrocerías vigentes.
- Pasen las pruebas web, typecheck y build completos.
- El esquema se valide en desarrollo.
- La lectura posterior coincida con los conteos esperados.
- La segunda ejecución no cree duplicados ni actualizaciones innecesarias.

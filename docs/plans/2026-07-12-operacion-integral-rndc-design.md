# Diseño: operación integral y clara del TMS RNDC

Fecha: 2026-07-12
Estado: aprobado por delegación explícita del usuario
Base: `2026-07-10-despachos-guiados-avansat-design.md`

## Objetivo

Cerrar el recorrido diario de un operador desde una sola plataforma: preparar y editar borradores, expedir orden de cargue, remesas y manifiesto, registrar la operación física, cumplir remesas y manifiesto, corregir o anular documentos elegibles, administrar los maestros necesarios y obtener representaciones PDF claras.

La validación se hará completamente en `dry-run`. El mismo modelo y los mismos constructores XML quedarán preparados para producción, pero ninguna prueba de este alcance podrá contactar al RNDC real.

## Alternativas consideradas

### Despacho guiado como centro de la operación

Es la alternativa seleccionada. Mantiene una sola historia del viaje, reutiliza los datos entre documentos y presenta una única siguiente acción.

### Módulos independientes por documento

Haría más visibles las órdenes, remesas y manifiestos, pero duplicaría información y volvería a fragmentar el trabajo del operador.

### Consola técnica como superficie principal

Reutilizaría formularios existentes, pero expondría procesos RNDC, permitiría inconsistencias y no resolvería la claridad solicitada.

## Experiencia del operador

`Despachos` seguirá reuniendo orden de cargue, remesas, flota, manifiesto, revisión RNDC, tiempos y cumplidos. Los borradores serán editables. Después de una autorización oficial, la interfaz no simulará una edición directa: ofrecerá la corrección o anulación permitida, con motivo, comparación, confirmación y evidencia.

La anulación de un manifiesto elegible estará disponible al operador desde el expediente. Las excepciones estructurales, como transbordo, manifiesto vacío o anulación encadenada de varios documentos, seguirán reservadas a administración.

## Maestros

`Maestros` dejará de ser una consulta de sólo lectura. Permitirá crear y actualizar:

- Conductores.
- Vehículos.
- Propietarios.
- Poseedores o tenedores.
- Terceros reutilizables en más de un rol.

Las personas se almacenarán una sola vez y podrán asumir varios roles. El vehículo referenciará al propietario y al poseedor. El conductor conservará los datos de identificación, contacto y licencia necesarios para RNDC.

Guardar un maestro persistirá primero la información local. La preparación RNDC se ejecutará desde el servidor y en `dry-run`, usando procesos 11 y 12 y conservando evidencia. Una falla simulada no borrará el maestro local; mostrará claramente que quedó pendiente de transmisión.

## Documentos PDF

Cada orden de cargue, remesa y manifiesto tendrá una representación PDF generada con los datos fotografiados del documento. El enlace estará disponible tanto en el expediente como en `Documentos`.

El PDF no dependerá de una ruta pública del backend. Se guardará como evidencia protegida y se descargará por la ruta autenticada existente. Los documentos en borrador podrán mostrar una representación marcada como borrador o modo de prueba; los autorizados incluirán su radicado simulado y el modo de ejecución.

## Frontera RNDC

El navegador no enviará XML ni credenciales. Las acciones pasarán por rutas autenticadas, cargarán datos persistidos, crearán una fotografía inmutable y usarán los constructores XML/SOAP compartidos.

Todas las pruebas de este alcance exigirán `RNDC_MODE=dry-run`. El paso a producción requerirá credenciales reales, almacenamiento durable, autenticación no demo y una prueba controlada con un caso oficial válido. Cambiar una variable local no bastará para habilitar tráfico real.

## Reglas de seguridad y estado

- Un documento autorizado no se reenviará.
- Un resultado incierto exigirá conciliación antes de cualquier reintento.
- El manifiesto sólo se cumplirá cuando todas sus remesas estén cumplidas.
- La anulación respetará las dependencias documentales.
- Una doble pulsación producirá una sola operación efectiva.
- Solicitud, respuesta, resultado interpretado, estado y tiempos quedarán preservados.
- El operador podrá corregir o anular documentos elegibles, pero no ejecutar excepciones estructurales.

## Criterios de aceptación

- El operador puede crear, guardar, cerrar, reabrir y editar un despacho en borrador.
- La emisión simulada prepara y procesa orden, remesas y manifiesto en el orden correcto.
- El operador puede registrar tiempos, cumplir cada remesa y después cumplir el manifiesto.
- El operador puede anular un manifiesto elegible con motivo, observación y confirmación.
- El operador puede crear y actualizar conductor, vehículo, propietario, poseedor y tercero desde `Maestros`.
- Cada orden, remesa y manifiesto ofrece un PDF protegido y legible.
- La cola y el detalle muestran una sola siguiente acción y bloqueos en lenguaje operativo.
- Las pruebas automáticas, compilación, validación de tipos, flujo RNDC completo en `dry-run` y recorridos de escritorio y móvil pasan sin errores relevantes.
- Ninguna llamada llega al RNDC real.

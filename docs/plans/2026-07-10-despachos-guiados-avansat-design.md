# Diseño: Despachos guiados compatibles con Avansat Básico

Fecha: 2026-07-10
Estado: aprobado por el usuario
Diseño anterior: `docs/plans/2026-07-09-phases-1-3-tms-rndc-design.md`

## Objetivo

Convertir el expediente actual en el flujo principal para despachar y documentar viajes de Transportes MTM, conservando la experiencia visual existente y trasladando la terminología y el orden operativo que los usuarios conocen de Avansat Básico.

El producto no será una copia de Avansat. Será una experiencia guiada que permita completar, desde un solo despacho, la orden de cargue, las remesas, el manifiesto, los tiempos logísticos y los cumplidos, reutilizando la información ya registrada y ocultando la complejidad técnica del RNDC.

## Decisión de producto

La interfaz principal usará `Despachos` como nombre de la cola de trabajo. `Expediente de viaje` seguirá siendo el contenedor interno y el título del detalle completo. `Viaje` representará el movimiento operativo y `Manifiesto` seguirá siendo el documento oficial asociado.

Se conservarán las rutas actuales `/expedientes`, `/expedientes/nuevo` y `/expedientes/[id]` durante la transición. El cambio será primero de experiencia y lenguaje visible, no una migración de URLs.

La navegación principal será:

- `Panel`
- `Despachos`
- `Documentos`
- `Maestros`

Las acciones técnicas de compatibilidad RNDC no serán una sección principal para operadores. Permanecerán disponibles solamente para administración, soporte o desarrollo mientras se completa la migración a un único flujo protegido.

## Alternativas consideradas

### 1. Un despacho guiado dentro de un expediente

Esta es la alternativa seleccionada. Mantiene una sola fuente de verdad, reduce la digitación repetida y permite mostrar al operador solamente el siguiente paso necesario.

### 2. Renombrar las pantallas actuales sin cambiar el proceso

Sería más rápido, pero conservaría el formulario extenso, la falta de edición real de borradores, el salto de la orden de cargue y la separación entre el expediente y la consola técnica.

### 3. Recrear módulos independientes como Avansat

Sería familiar, pero conservaría la navegación fragmentada y la repetición de datos entre orden, remesa, manifiesto y cumplidos.

## Límites del alcance

- El alcance corresponde al plan Básico de Avansat para despachos y documentación.
- No se implementará monitoreo GPS.
- No se implementarán planes de ruta, puestos de control, mapas, Faro ni Control Tráfico.
- No se integrará con la DIAN.
- Los campos económicos del viaje, como flete, anticipo, retención, ICA, FOPAT y neto a pagar, no implican integración tributaria con DIAN.
- Las coordenadas de un lugar podrán conservarse si el RNDC las exige, pero serán datos del sitio, no seguimiento del vehículo.
- No se realizará ninguna llamada real al RNDC hasta completar autenticación, despliegue, validación y prueba controlada.
- La apariencia visual actual se mantendrá como base. Este diseño cambia el proceso, la jerarquía y las acciones, no la identidad visual.

## Lenguaje del dominio

| Término | Significado canónico |
|---|---|
| Orden de servicio | Solicitud comercial o referencia del cliente. No es un documento RNDC. |
| Despacho | Flujo de trabajo visible que reúne la preparación, documentación y cierre de un servicio. |
| Expediente de viaje | Registro persistente que contiene toda la información, documentos, evidencia e historial del despacho. |
| Orden de cargue | Documento y proceso oficial inicial que prepara la carga y puede originar una o varias remesas. |
| Remesa | Documento de la carga, remitente, destinatario, sitios, citas, mercancía y condiciones de entrega. |
| Viaje | Ejecución operativa asociada al vehículo, conductor, remesas y manifiesto. |
| Manifiesto | Documento oficial que formaliza el viaje y vincula una o varias remesas. |
| Cargue y descargue | Tiempos y hechos logísticos reales de origen y destino. |
| Cumplido inicial | Cierre o transmisión de cada remesa con sus datos reales de entrega. |
| Cumplido final | Cierre del manifiesto después de cumplir todas las remesas o registrar una excepción autorizada. |
| Anulación | Reversión oficial controlada que exige motivo, observación, actor y fecha. |
| Conciliación | Consulta oficial para resolver un resultado incierto sin reenviar automáticamente. |

`Información de carga` podrá aparecer como ayuda técnica o nombre RNDC secundario. El nombre principal visible será `Orden de cargue`.

## Flujo objetivo

### 1. Orden de cargue

El operador inicia un `Nuevo despacho` y registra o selecciona:

- Cliente y referencia comercial.
- Agencia responsable.
- Remitente y destinatario.
- Lugar y cita de cargue.
- Lugar y cita de descargue.
- Mercancía, cantidad, peso, volumen, empaque y observaciones.
- Fechas mínima y máxima de cargue cuando apliquen.
- Vehículo y conductor iniciales, si ya están disponibles.

El consecutivo será automático. El operador podrá guardar el despacho como borrador y salir sin perder información.

La orden no podrá anularse directamente cuando ya tenga remesas oficiales asociadas. La interfaz explicará qué documentos deben reversarse primero.

### 2. Remesas

El expediente permitirá una o varias remesas. Cada remesa heredará los datos conocidos de la orden y pedirá solamente las diferencias:

- Destinatario o sitio diferente.
- Línea de mercancía o remisión.
- Cantidad, empaque, peso y volumen propios.
- Valor declarado, póliza y condiciones particulares.
- Observaciones que pasan al manifiesto.

El flujo normal partirá de una orden de cargue. `Crear remesa sin orden` será una excepción secundaria y controlada, no la acción principal.

### 3. Vehículo y conductor

El operador seleccionará conductor, vehículo, remolque, propietario, poseedor y segundo conductor cuando aplique. La interfaz mostrará vigencias y datos faltantes de los maestros antes de permitir un envío oficial.

Los datos disponibles en maestros se autocompletarán. Los campos técnicos RNDC sólo aparecerán cuando requieran una decisión del operador.

### 4. Manifiesto

La pantalla mostrará solamente remesas elegibles según origen, destino, tipo de operación y estado oficial. El operador podrá vincular una o varias remesas.

El manifiesto incluirá:

- Fecha de expedición y entrega estimada.
- Tipo municipal o intermunicipal.
- Vehículo, remolque, propietario, poseedor y conductores.
- Flete, anticipo, retenciones, ICA, FOPAT, ajustes y neto a pagar.
- Responsables del cargue y descargue.
- Agencia y fecha de pago.
- Observaciones.

`Crear manifiesto vacío` y `Transbordo` serán acciones avanzadas separadas del flujo normal.

### 5. Revisión y envío RNDC

Antes del envío, el sistema mostrará un resumen legible con:

- Orden de cargue.
- Remesas incluidas.
- Vehículo y conductor.
- Manifiesto y valores.
- Datos faltantes o advertencias.
- Modo de ejecución claramente visible.

Una acción explícita iniciará la secuencia oficial. Para un expediente persistido no se completarán campos faltantes con datos de referencia.

La secuencia normal será:

1. Registrar la orden de cargue.
2. Expedir cada remesa pendiente.
3. Registrar la información de viaje y expedir el manifiesto.
4. Guardar toda la evidencia antes de confirmar el cambio de estado.

El operador podrá continuar desde el último documento autorizado cuando una secuencia quede parcial. Ningún documento ya autorizado se reenviará.

### 6. Documentos

El expediente mostrará las representaciones PDF, XML enmascarado, respuesta, radicado, estado oficial, fecha y actor de cada operación.

`Impreso` será una propiedad separada de `Autorizado`, `Rechazado`, `Cumplido` o `Anulado`.

### 7. Cargue y descargue

El operador registrará manualmente:

- Llegada.
- Entrada.
- Inicio.
- Fin.
- Salida.
- Observaciones y novedades.

Estos datos pertenecerán al expediente y podrán alimentar los cumplidos. No dependerán de GPS, puntos de control ni Control Tráfico.

### 8. Cumplido inicial

Cada remesa se cumplirá de forma individual. El operador revisará cantidades entregadas, tiempos, novedades, suspensión y motivos cuando apliquen.

El sistema destacará el plazo operativo aplicable y conservará la evidencia del proceso.

### 9. Cumplido final

El manifiesto podrá cumplirse cuando todas sus remesas estén cumplidas o exista una excepción autorizada y auditada.

El cierre mostrará vehículo, conductor, ruta, remesas, valores, tiempos reales, entrega y novedades. El resultado dejará el expediente en `Cumplido`.

## Cola de trabajo

La página `Despachos` será una cola orientada a la siguiente acción. Permitirá buscar y filtrar por:

- Número de despacho o expediente.
- Orden de cargue.
- Remesa.
- Manifiesto.
- Cliente.
- Placa.
- Conductor.
- Origen y destino.
- Agencia.
- Rango de fechas.
- Estado general y estado RNDC.

Los grupos principales serán:

- `En preparación`
- `Orden de cargue pendiente`
- `Remesas pendientes`
- `Manifiesto pendiente`
- `Listo para enviar`
- `En operación`
- `Por cumplir`
- `Cumplido`
- `Anulado`
- `Requiere atención`

La búsqueda y paginación se ejecutarán en el servidor. La lista no tendrá un límite silencioso de registros. Se ofrecerá exportación a Excel con los filtros aplicados.

## Detalle del despacho

El detalle conservará el resumen visual actual, pero agregará:

- Indicador de etapas con estado completo, actual y bloqueado.
- Tarjeta de `Siguiente acción` con una sola acción primaria.
- Resumen de bloqueos antes de cada envío.
- Edición de borradores por etapa.
- Historial de cambios separado de la evidencia técnica.
- Acciones de soporte y RNDC avanzado en una sección secundaria según rol.

El operador no navegará a una consola técnica para completar el flujo normal.

## Experiencia móvil y accesibilidad

- La navegación móvil se convertirá en un menú compacto y no en una fila horizontal desbordada.
- La barra de acción fija reservará espacio y nunca cubrirá campos.
- Cada etapa tendrá un título, instrucciones, errores y resumen propios.
- Los estados usarán texto e icono además de color.
- Los formularios conservarán etiquetas asociadas y orden de lectura lógico.
- Los errores indicarán el campo, la causa y la forma de corregirlo.
- El foco regresará al encabezado de la etapa después de guardar o avanzar.
- Se verificará navegación completa con teclado, zoom, contraste y lector de pantalla en los recorridos principales.

## Modelo de datos

El expediente seguirá siendo el agregado principal. No se creará una segunda fuente de verdad paralela.

### Datos editables

Mientras el despacho esté en borrador, el operador podrá editar cliente, lugares, carga, programación, tarifa, flota y remesas.

La creación y actualización inicial se ejecutarán mediante una mutación atómica del servidor. No se encadenarán múltiples escrituras independientes desde el navegador.

### Fotografías históricas

Al confirmar una etapa o solicitar una operación RNDC se guardará una fotografía inmutable de:

- Cliente y partes.
- Lugares, direcciones y códigos de municipio.
- Carga y líneas de remisión.
- Tarifa y valores.
- Vehículo, remolque, propietario, poseedor y conductores.
- Documentos y vigencias usados.

Los maestros podrán cambiar sin alterar despachos históricos.

### Documentos oficiales

`documents` seguirá representando orden de cargue, remesa y manifiesto. Cada documento mantendrá separados:

- Estado local.
- Estado de emisión oficial.
- Estado de impresión.
- Cumplimiento.
- Corrección.
- Anulación.
- Aceptación.
- Conciliación.

La etapa general del despacho será una proyección derivada de estos estados y de los datos operativos. No se duplicará manualmente una verdad incompatible.

## Frontera RNDC

Existirá una sola ruta protegida para cualquier acción oficial:

`Interfaz → gateway Next.js → intención durable → worker RNDC → evidencia permanente → transición oficial`

La consola de compatibilidad usará el mismo gateway o quedará restringida a desarrollo y soporte.

Para expedientes persistidos:

- La validación de campos completos se ejecutará también en `dry-run`.
- No se usarán personas, lugares, vehículos ni valores del escenario de referencia.
- La evidencia permanente será parte de la condición de éxito.
- Un doble clic o retry HTTP convergerá en una sola operación durable.
- Un timeout quedará como `Resultado incierto` y exigirá conciliación.
- La conciliación sólo confirmará éxito cuando la respuesta contenga el documento esperado y un estado oficial compatible.

## Manejo de errores

### Fallo antes de contactar al RNDC

La operación quedará fallida sin cambiar el estado oficial. El operador podrá corregir y volver a solicitarla explícitamente.

### Timeout o conexión incierta

La operación quedará bloqueada como incierta. No habrá reenvío automático. La siguiente acción será `Consultar y conciliar`.

### Respuesta aceptada sin evidencia permanente

El sistema mostrará `Respuesta RNDC recibida; evidencia pendiente`. No declarará el documento como completamente confirmado ni permitirá reenviarlo. Se ejecutará recuperación de evidencia y conciliación.

### Secuencia parcial

Los documentos autorizados conservarán su estado. Al reanudar, el sistema continuará con el siguiente documento pendiente.

### Rechazo oficial

El documento conservará su estado oficial anterior cuando el rechazo corresponda a una corrección, cumplido o anulación. El error se mostrará en lenguaje operativo con el detalle técnico disponible para soporte.

### Anulación

No se usará `Eliminar` para documentos oficiales. La interfaz ofrecerá `Anular`, `Reversar cumplido` o `Corregir` según el estado, siempre con motivo y observación.

## Seguridad y permisos

Roles objetivo:

- `operator`: prepara despachos y solicita operaciones permitidas.
- `admin`: gestiona excepciones, anulaciones y soporte avanzado.
- `auditor`: consulta historial y evidencia sin modificar datos.

La autenticación demo se reemplazará antes de producción. El modo real seguirá bloqueado mientras `AUTH_MODE=demo`.

Los documentos personales y teléfonos estarán enmascarados en listados y exportaciones para usuarios sin permiso suficiente.

## Compatibilidad y migración

- Las rutas `/expedientes` se conservarán inicialmente.
- Los registros existentes seguirán visibles.
- Los borradores anteriores podrán abrirse con un adaptador que marque campos faltantes.
- `trips` continuará como proyección compatible mientras existan consumidores antiguos.
- La consola `/operaciones` no será la ruta normal de despacho.
- Los datos demostrativos se identificarán como prueba y no se mezclarán con datos oficiales.

## Estrategia de pruebas

Cada comportamiento se implementará con prueba fallida primero.

La cobertura mínima incluirá:

- Derivación de etapa del despacho.
- Creación atómica y reanudación de borradores.
- Fotografías históricas inmutables.
- Orden de cargue antes de remesas y manifiesto.
- Una y varias remesas.
- Validación estricta sin datos de referencia.
- Secuencia parcial y reanudación segura.
- Idempotencia y doble clic.
- Conciliación con coincidencia y sin coincidencia.
- Fallo de evidencia permanente.
- Cargue, descargue y llegada manual.
- Cumplido inicial antes del final.
- Anulación según estado.
- Búsqueda paginada y exportación.
- Permisos por rol.
- Recorridos de escritorio y móvil.
- Teclado, foco, contraste y estados accesibles.

## Criterios de aceptación

- Un operador completa `Orden de cargue → Remesas → Manifiesto → Cumplidos` desde un solo despacho.
- Los nombres visibles son `Orden de cargue`, `Remesa`, `Viaje`, `Manifiesto`, `Cumplido inicial` y `Cumplido`.
- `Despachos` es la cola principal y `Expediente de viaje` es el registro detallado.
- El consecutivo de orden, remesa y manifiesto es automático y seguro.
- Una orden admite varias remesas y un manifiesto admite varias remesas.
- Los datos conocidos se autocompletan y sólo se piden las diferencias.
- Un borrador se puede guardar, cerrar, reabrir, editar y completar.
- La orden de cargue se autoriza antes de emitir remesas y manifiesto.
- Un envío desde un expediente incompleto falla incluso en `dry-run`.
- Ningún dato faltante se sustituye silenciosamente por el escenario de referencia.
- Toda operación oficial se registra antes del envío y guarda evidencia antes de confirmar éxito.
- Un doble clic o retry no crea documentos duplicados.
- Un resultado incierto exige conciliación y no permite reenvío automático.
- La conciliación verifica el documento esperado antes de confirmar éxito.
- Los tiempos de cargue, descargue y llegada se pueden registrar sin GPS.
- El cumplido inicial y el final permanecen como etapas diferentes.
- Anular exige motivo, observación, usuario y fecha.
- Los listados tienen búsqueda de servidor, paginación y exportación a Excel.
- La experiencia móvil no tiene desbordamiento horizontal ni controles cubiertos.
- No aparecen campos de operador GPS, credenciales GPS, puntos de control ni DIAN en el flujo normal.

## Condición de producción

Este diseño no autoriza tráfico real. El reemplazo de Avansat sólo podrá declararse listo cuando:

- La autenticación real esté activa.
- El backend esté desplegado con almacenamiento durable.
- Los respaldos, restauración y alertas estén verificados.
- Los maestros necesarios estén completos.
- Los recorridos operativos hayan pasado pruebas de aceptación con usuarios MTM.
- Se haya ejecutado una prueba RNDC real controlada y conciliada.
- Exista un plan de transición, soporte y reversa.

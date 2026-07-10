# Fases 1 a 3: cierre RNDC, seguridad y expediente de viaje

Fecha: 2026-07-09
Estado: aprobado por delegacion de criterio

## Objetivo

Convertir la consola RNDC actual en un TMS operativo verificable en modo `dry-run`, con una ruta concreta y bloqueada de forma segura para futuras pruebas reales.

El resultado debe permitir que un operador autenticado cree un expediente, asigne la flota, prepare varias remesas bajo un manifiesto, ejecute acciones RNDC sin duplicados, concilie resultados inciertos, consulte evidencia protegida y complete correcciones, cumplidos y anulaciones permitidas.

## Limites del alcance

- No se enviaran registros reales al RNDC.
- No se desplegara el backend en esta fase.
- Se conservara `RNDC_MODE=dry-run` durante toda la verificacion.
- Las credenciales RNDC no se almacenaran en el repositorio ni se mostraran en respuestas, registros o capturas.
- El modo real quedara bloqueado mientras la aplicacion use autenticacion dummy.
- Los diccionarios oficiales suministrados se conservaran y normalizaran sin modificar los originales.
- Se documentara el procedimiento exacto para activar autenticacion definitiva, desplegar el backend y realizar una prueba real controlada.

## Decision de arquitectura

Se construira un nucleo unico alrededor del `Expediente de viaje`.

Se descartaron dos alternativas:

1. Parchear primero la consola RNDC y agregar el expediente despues. Daria resultados visibles antes, pero obligaria a migrar estados, evidencias y permisos dos veces.
2. Construir una version paralela. Reduciria el impacto sobre la demostracion actual, pero duplicaria pantallas, datos y reglas oficiales.

El nucleo unico permite que las tres fases compartan la misma identidad de usuario, el mismo expediente, la misma cola de operaciones y la misma historia auditable. La consola existente se mantendra mediante adaptadores durante la migracion.

## Modelo operativo

### Organizacion y usuarios

La primera organizacion sera `Transportes MTM`.

Los roles provisionales seran:

- `admin`: configura, corrige estados y autoriza excepciones con motivo obligatorio.
- `operator`: crea y actualiza expedientes y solicita operaciones permitidas.
- `auditor`: consulta expedientes, operaciones, evidencia e historial sin modificar datos.

La autenticacion local usara usuarios dummy con contrasenas definidas por variables privadas. Las contrasenas se almacenaran como hashes y las sesiones se entregaran mediante cookies firmadas, `HttpOnly` y `SameSite`.

El modo `live` rechazara el arranque si la autenticacion sigue en modo dummy.

### Expediente de viaje

El expediente sera la fuente de verdad anterior a cualquier operacion RNDC. Contendra:

- Cliente y orden de servicio.
- Lugares de cargue y descargue con una copia historica de sus datos.
- Carga, cantidad, empaque, naturaleza y tarifa acordada.
- Conductor, vehiculo y remolque asignados.
- Revisiones de vigencias y alertas de cumplimiento.
- Una o varias remesas.
- Un manifiesto y sus estados oficiales.
- Novedades y cronologia operativa.
- Evidencia de entrega.
- Correcciones, cumplidos y anulaciones.

Los datos usados para una accion oficial se guardaran como una fotografia inmutable. Una edicion posterior del expediente no cambiara la evidencia de una operacion anterior.

### Compatibilidad

La tabla `trips` y las rutas actuales se conservaran durante la transicion. Los nuevos registros se enlazaran al expediente y las lecturas antiguas recibiran una proyeccion compatible.

La forma singular de remesa se mantendra como adaptador temporal, pero el modelo canonico usara una coleccion de remesas.

## Estados separados

No se volvera a usar un unico estado para representar documento e intento.

Cada documento tendra estados independientes para:

- Emision oficial.
- Cumplimiento.
- Correccion.
- Anulacion.
- Aceptacion electronica.
- Ultima conciliacion.

Cada llamada RNDC tendra su propio intento y resultado. Un intento rechazado de cumplido no podra convertir un manifiesto autorizado en rechazado.

## Cola durable y proteccion contra duplicados

Cada accion se registrara antes de contactar al RNDC.

La operacion durable guardara:

- Clave de solicitud para reintentos HTTP.
- Clave de negocio para impedir repetir una misma accion oficial.
- Huella del contenido.
- Expediente, documento, proceso, actor y rol.
- Estado, lease, cantidad de intentos y tiempos.
- Fotografia del contenido enviado.

Estados de la cola:

- `queued`
- `claimed`
- `sending`
- `uncertain`
- `accepted`
- `rejected`
- `reconciling`
- `reconciled`
- `cancelled`

Un timeout producira `uncertain`. Nunca se reenviara automaticamente. Primero se ejecutara una consulta oficial de conciliacion.

El navegador no consumira consecutivos ni podra continuar si no se pudo registrar la intencion durable.

## Frontera segura con RNDC

El navegador llamara solamente rutas del mismo origen en Next.js.

El servidor web verificara sesion y permisos, creara la operacion durable y llamara al worker RNDC mediante un secreto de servicio que nunca llegara al navegador.

El backend Express:

- Exigira siempre autenticacion de servicio para rutas operativas.
- Aceptara acciones tipadas, no XML arbitrario.
- Deshabilitara el endpoint generico en cualquier modo distinto de desarrollo seguro.
- Expondra salud sin datos sensibles.
- Rechazara el modo real si falta cualquier dependencia de seguridad.

## Evidencia permanente

Los XML enmascarados, respuestas, JSON normalizados y PDF se almacenaran en Convex File Storage.

Cada artefacto tendra:

- Tipo y version.
- Identificador de almacenamiento.
- SHA-256.
- Tamano.
- Operacion y expediente relacionados.
- Actor y fecha.
- Politica de retencion.

Las descargas comprobaran sesion y permiso. Las URLs directas no se mostraran como enlaces publicos permanentes.

## Fase 1: cierre RNDC

### Diccionarios 2026

Se conservaran los archivos originales del diccionario de datos y errores, junto con una version normalizada y una suma de comprobacion.

Las pruebas verificaran que los builders usan variables reconocidas por la fotografia oficial para los procesos cubiertos.

### FOPAT

La retencion se calculara de forma centralizada como el 0.1 por ciento del valor a pagar aplicable, redondeado al peso.

El calculo representara explicitamente las excepciones oficiales conocidas:

- Flota propia.
- Vehiculos con PBV menor o igual a 10.500 kg.
- Configuraciones no sujetas.
- Viajes municipales.

Si faltan datos para decidir la aplicabilidad, el modo real fallara de forma cerrada y pedira revision. El modo `dry-run` mostrara la advertencia y conservara la evidencia.

### Corregir remesa, proceso 38

Se implementara un builder tipado limitado a las variables oficiales del diccionario.

La accion exigira:

- Remesa existente.
- Codigo y motivo de cambio.
- Vista previa de campos anteriores y nuevos.
- Motivo operativo para auditoria.
- Consulta previa y conciliacion posterior.

### Anulaciones dirigidas

Cada proceso de anulacion sera una accion independiente. Seleccionar manifiesto enviara solamente el proceso 32.

Las acciones validaran el estado conocido, consultaran RNDC cuando sea necesario y pediran confirmacion y motivo. La cadena completa dejara de ser el comportamiento predeterminado.

### Conciliacion

Se agregaran consultas tipadas para emision, cumplidos, correccion, anulacion y aceptacion.

La conciliacion guardara su propia solicitud, respuesta y resultado normalizado. Nunca sobrescribira evidencia previa.

### Aceptacion electronica, proceso 73

Se podra consultar una aceptacion por manifiesto y por rango de fechas.

Se almacenaran fecha, tipo, actor, observacion y estado. El PDF del manifiesto incluira la evidencia de aceptacion cuando exista.

### Varias remesas

El manifiesto recibira una lista de remesas y generara la estructura `REMESASMAN` con todos sus elementos.

Cada remesa tendra su propio PDF y cumplido. El manifiesto no podra cumplirse hasta que todas sus remesas esten cumplidas o exista una excepcion autorizada y auditada.

## Fase 2: seguridad de produccion

La implementacion local entregara:

- Login y roles dummy.
- Sesion protegida.
- Autorizacion central para consultas y cambios.
- Gateway del mismo origen.
- Secreto obligatorio entre servicios.
- Cola durable e idempotente.
- Evidencia protegida.
- Historial append-only con actor, hora y motivo.
- Salud y preparacion sin datos sensibles.
- Configuracion reproducible del backend.
- Guia concreta de despliegue, alertas, respaldo, restauracion y prueba real.

No se afirmara que el entorno esta listo para produccion hasta reemplazar la autenticacion dummy, desplegar el worker y probar conectividad, respaldos y alertas.

## Fase 3: flujo del TMS

La interfaz principal agregara:

- `/expedientes`: listado y cola de trabajo.
- `/expedientes/nuevo`: creacion de orden y expediente.
- `/expedientes/[id]`: detalle operativo.

El detalle mostrara:

- Resumen de orden y ruta.
- Asignacion y cumplimiento documental.
- Remesas y manifiesto.
- Acciones RNDC permitidas.
- Cronologia y novedades.
- Evidencia de entrega.
- Intentos y evidencia tecnica segun el rol.

Las acciones RNDC se generaran desde datos ya guardados. El operador no volvera a digitar la misma informacion en formularios independientes.

## Auditoria

El historial sera append-only y registrara:

- Actor, correo y rol al momento de la accion.
- Organizacion.
- Entidad y accion.
- Estado anterior y nuevo.
- Motivo cuando aplique.
- Operacion y correlacion.
- Fecha generada por el servidor.

Se auditaran creacion, edicion, asignacion, envio, conciliacion, retry autorizado, correccion, cumplido, anulacion, carga y descarga de evidencia.

## Manejo de errores

Los errores oficiales se normalizaran usando el diccionario suministrado.

La aplicacion diferenciara:

- Rechazo oficial.
- Registro duplicado con autorizacion existente.
- Timeout incierto.
- Respuesta mal formada.
- Consulta sin resultados.
- Fallo local antes del envio.
- Aceptacion RNDC seguida de fallo de sincronizacion.

Los errores inciertos nunca autorizaran un reenvio automatico.

## Estrategia de pruebas

Todo comportamiento nuevo se implementara con prueba fallida primero.

La cobertura minima incluira:

- XML de varias remesas.
- Calculo y excepciones FOPAT.
- Proceso 38 y campos permitidos.
- Anulacion individual.
- Consultas y normalizacion de conciliacion.
- Errores oficiales capturados y respuestas anormales.
- Separacion entre estado oficial e intento.
- Permisos por rol.
- Idempotencia concurrente.
- Recuperacion despues de reinicio.
- Timeout incierto sin reenvio.
- Acceso protegido a evidencia.
- Persistencia completa del expediente.
- Recorrido visual en escritorio y movil.
- Render de PDF de manifiesto con dos remesas y aceptacion.

## Criterio de finalizacion

El trabajo estara terminado cuando, en modo `dry-run`, un operador autenticado pueda:

1. Crear y guardar una orden y su expediente.
2. Asignar conductor, vehiculo y remolque elegibles.
3. Crear dos remesas bajo un manifiesto.
4. Emitir registros sin riesgo de duplicados.
5. Recuperarse de un timeout simulado mediante conciliacion.
6. Consultar el estado normalizado.
7. Cumplir remesas y manifiesto respetando dependencias.
8. Corregir una remesa.
9. Anular solamente el documento permitido y seleccionado.
10. Consultar evidencia protegida despues de reiniciar servicios.

Ademas deben pasar tests, typecheck, build, flujo RNDC dry-run, inspeccion visual en escritorio y movil y render de los PDF relevantes.

## Activacion futura de pruebas reales

Se entregara una guia separada con una lista cerrada de pasos:

1. Sustituir autenticacion dummy por un proveedor definitivo.
2. Configurar usuarios y roles reales.
3. Crear secretos independientes para web, worker y Convex.
4. Desplegar el worker con salida de red permitida por RNDC.
5. Configurar almacenamiento, respaldo y restauracion.
6. Activar logs y alertas sin datos sensibles.
7. Ejecutar consultas de solo lectura.
8. Validar FOPAT y diccionarios contra el portal vigente.
9. Habilitar `live` mediante un control explicito.
10. Ejecutar una unica operacion controlada y conciliarla antes de ampliar el uso.


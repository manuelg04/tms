# Plan de implementacion: fases 1 a 3

Fecha: 2026-07-09
Diseno relacionado: `docs/plans/2026-07-09-phases-1-3-tms-rndc-design.md`

## Orden de trabajo

### 1. Preservar los diccionarios oficiales

- Copiar sin alterar los dos archivos suministrados a `docs/rndc/dictionaries/2026-07-09/`.
- Crear una representacion UTF-8 normalizada para datos y errores.
- Guardar SHA-256 y metadatos de origen.
- Agregar un lector probado que permita consultar variables y errores por proceso.
- Verificar procesos 1 a 12, 28, 29, 32, 38 y 73, dejando explicitas las ausencias del archivo.

### 2. Separar estados y crear el nucleo de expediente

- Extender el esquema Convex con organizacion, usuarios, expedientes, clientes, lugares, ordenes, remolques, remesas, eventos, novedades, evidencia, operaciones RNDC y auditoria.
- Mantener `trips` y campos historicos para compatibilidad.
- Separar emision, cumplimiento, correccion, anulacion, aceptacion y conciliacion.
- Agregar funciones de dominio puras y pruebas de transiciones antes de funciones Convex.
- Evitar que un intento fallido cambie el estado oficial autorizado.

### 3. Completar el nucleo RNDC

- Agregar pruebas fallidas para FOPAT, proceso 38, anulaciones dirigidas, consultas, errores capturados y varias remesas.
- Implementar calculo FOPAT y sus excepciones conocidas.
- Implementar builder tipado del proceso 38 con las 13 variables oficiales.
- Exponer builders de anulacion individual y mantener la cadena completa solo como compatibilidad explicita.
- Agregar consultas de conciliacion y aceptacion 73.
- Normalizar respuestas de consulta y clasificar timeout, rechazo, duplicado y respuesta mal formada.
- Migrar el modelo de escenario a varias remesas con adaptador singular.
- Actualizar PDF de manifiesto y remesas.

### 4. Crear cola durable, evidencia y auditoria

- Probar idempotencia, claves de negocio, leases, timeout incierto y recuperacion.
- Registrar la intencion y la fotografia antes del envio.
- Agregar claim y finalizacion atomicos.
- Agregar conciliacion sin retry automatico.
- Implementar carga de XML, respuesta, JSON y PDF a Convex File Storage.
- Guardar huellas SHA-256 y metadatos.
- Crear historial append-only.

### 5. Agregar autenticacion y permisos locales

- Agregar pruebas para hashes, sesiones, expiracion y permisos.
- Implementar usuarios dummy configurados por entorno.
- Crear login y logout con cookie firmada `HttpOnly`.
- Aplicar roles `admin`, `operator` y `auditor`.
- Proteger paginas y rutas de servidor.
- Rechazar `RNDC_MODE=live` cuando `AUTH_MODE=demo`.
- Eliminar datos personales de ejemplo del bundle publico.

### 6. Mover RNDC detras del gateway

- Agregar rutas same-origin tipadas.
- Registrar la operacion durable antes de llamar al worker.
- Exigir secreto de servicio en Express.
- Deshabilitar el endpoint generico fuera de desarrollo `dry-run`.
- Reemplazar PDF publico por descargas autorizadas.
- Reducir `/healthz` y agregar `/readyz` sin datos sensibles.
- Conservar compatibilidad local controlada con la consola anterior.

### 7. Construir el flujo de expediente

- Crear `/expedientes`, `/expedientes/nuevo` y `/expedientes/[id]`.
- Reutilizar busquedas actuales de flota.
- Guardar cliente, orden, lugares, carga, tarifa y asignacion.
- Permitir varias remesas y un manifiesto.
- Mostrar revisiones, alertas y bloqueos.
- Exponer acciones permitidas de emision, conciliacion, correccion, cumplido y anulacion.
- Mostrar cronologia, novedades y evidencia segun rol.
- Generar documentos desde el expediente guardado.

### 8. Preparar operacion futura

- Agregar Dockerfile y configuracion de ejemplo para un servicio Node persistente.
- Documentar variables y secretos sin valores reales.
- Documentar egress RNDC, salud, logs, alertas, respaldo y restauracion.
- Crear una lista de comprobacion para sustituir autenticacion dummy.
- Crear el procedimiento de prueba real controlada y reversa.

### 9. Verificacion integral

- Ejecutar tests focalizados durante cada ciclo rojo-verde.
- Ejecutar `npm test`.
- Ejecutar `npm run typecheck`.
- Ejecutar `npm run build`.
- Ejecutar `RNDC_MODE=dry-run npm run rndc:flow`.
- Ejecutar preparacion, correccion, conciliacion y anulacion en `dry-run`.
- Iniciar web, backend y Convex disponibles.
- Verificar login, roles y expediente en navegador.
- Verificar escritorio y movil.
- Renderizar PDF con dos remesas y aceptacion.
- Reiniciar servicios y comprobar recuperacion y evidencia.

## Reglas durante la implementacion

- Ninguna llamada RNDC real.
- Prueba fallida antes de cada comportamiento nuevo.
- Ningun secreto ni credencial en Git.
- Ningun comentario dentro del codigo.
- Los cambios incompatibles tendran adaptador o migracion.
- No se informara una fase como completa si depende de una simulacion no ejecutada.


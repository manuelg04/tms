# Primera prueba real RNDC y entrega a produccion

Fecha de referencia: 9 de julio de 2026.

Esta guia separa tres hitos que no deben confundirse:

1. Ensayo local y desplegado en `dry-run`, sin crear registros oficiales.
2. Una prueba real controlada, con autorizacion escrita y un solo expediente.
3. Habilitacion operativa continua para produccion.

Completar el segundo hito no habilita automaticamente el tercero. Todo registro aceptado en RNDC es oficial.

## Reglas no negociables

- `RNDC_MODE=dry-run` es el valor normal y el valor incorporado en la imagen.
- Nadie cambia a `live` sin una autorizacion escrita que identifique expediente, ventana, responsable y plan de cierre.
- No se prueba solo el proceso 1. La unidad minima de emision es un ciclo valido que no deje una informacion de carga sin tratamiento: 1, 2, 3 y 4, o la secuencia equivalente validada por el gateway.
- Ante timeout, respuesta vacia o estado incierto, no se reenvia. Primero se consulta y reconcilia el numero exacto.
- Se reversan solamente registros confirmados como aceptados, en orden inverso y con el motivo aprobado.
- El comando historico `rndc:annul` no se usa para la primera prueba real porque intenta una cadena completa. La recuperacion usa anulaciones dirigidas.
- Nunca se guardan credenciales, tokens, archivos de escenario reales ni evidencia con datos personales en Git.
- Solicitudes, respuestas, PDF y resultado deben quedar fuera del disco efimero antes de cerrar la ventana.

## Estado de salida esperado

Hay tres decisiones posibles:

- `NO-GO`: falta al menos un prerrequisito. Todo permanece en `dry-run`.
- `GO CONTROLADO`: se autoriza una unica prueba real y luego se vuelve a `dry-run`.
- `GO PRODUCCION`: se habilita operacion continua despues de cumplir tambien los controles de despliegue, monitoreo, respaldo y soporte.

El sistema debe considerarse `NO-GO` para trafico continuo mientras ocurra cualquiera de estas condiciones:

- La autenticacion web sigue siendo solamente de demostracion.
- El gateway registra una operacion real como `dry-run`.
- XML, respuestas o PDF solo existen en el sistema de archivos efimero.
- Una operacion queda `uncertain` o `reconciling`.
- FOPAT queda como `review-required`.
- `/readyz` responde `503`.
- No hay salida estable desde la infraestructura hacia los cuatro destinos RNDC requeridos.
- Los diccionarios activos del portal no coinciden con la copia revisada.

## Artefactos de despliegue

La imagen se construye desde la raiz del monorepo:

```bash
docker build --pull -t tms-rndc-api:2026-07-09 .
```

No se debe configurar `apps/rndc-api` como contexto de construccion porque el backend depende de `packages/rndc-core`.

La imagen:

- usa Node.js 22;
- ejecuta un usuario sin privilegios;
- inicia `apps/rndc-api/dist/index.js`;
- expone el puerto `3017` como valor por defecto;
- incluye un chequeo contra `/healthz`;
- mantiene `RNDC_MODE=dry-run` si el proveedor no define otro valor;
- escribe datos bajo `/app/data`.

Para Railway, Render u otro proveedor, configurar:

- contexto de construccion: raiz del repositorio;
- Dockerfile: `Dockerfile`;
- health check: `/healthz`;
- readiness operativo: `/readyz`;
- volumen persistente: `/app/data`;
- una sola replica durante la primera prueba;
- TLS obligatorio en la URL publica;
- salida de red estable y, si RNDC lo exige, IP autorizada.

El volumen montado debe ser escribible por el usuario `node` de la imagen. Un montaje reemplaza los permisos creados durante el build, por lo que debe comprobarse despues del despliegue.

## Variables exactas del backend

### Perfil desplegado seguro

```dotenv
NODE_ENV=production
PORT=3017
AUTH_MODE=service
RNDC_SERVICE_TOKEN=<secreto-aleatorio-de-al-menos-32-caracteres>
RNDC_MODE=dry-run
RNDC_ENV=test
RNDC_TRANSPORT=soap
WEB_ORIGIN=https://<dominio-web>
RNDC_API_KEY=
RNDC_ENABLE_LEGACY_API_KEY=false
RNDC_ENABLE_LEGACY_MESSAGE=false
RNDC_TIMEOUT_MS=30000
RNDC_OUTPUT_DIR=/app/data/runs
RNDC_PDF_DIR=/app/data/pdf
RNDC_LOCAL_DATA_DIR=/app/data/local/rndc-masters
CONVEX_URL=https://<deployment>.convex.cloud
RNDC_INGEST_KEY=<secreto-compartido-con-convex-y-el-gateway>
```

### Variables adicionales para una ventana real

Estas variables se guardan en el gestor de secretos del proveedor, nunca en un archivo versionado:

```dotenv
RNDC_MODE=live
RNDC_ENV=primary
RNDC_USERNAME=<usuario-oficial>
RNDC_PASSWORD=<clave-oficial>
RNDC_COMPANY_NIT=<nit-sin-dv>
RNDC_COMPANY_DV=<digito-verificacion>
RNDC_COMPANY_RNDC_NIT=<identificador-exacto-esperado-por-rndc>
```

Con `RNDC_ENV=primary`, el cliente conserva el enrutamiento implementado:

- procesos 1, 2, 5, 6, 7, 8, 9, 11, 12, 28, 29, 32 y 38 al destino primario;
- procesos 3 y 4 al destino secundario;
- consultas al destino PLC.

No definir `RNDC_ENDPOINT_URL` ni reemplazar URLs individuales salvo que el Ministerio confirme un cambio. Un override unico puede enviar procesos al destino equivocado.

### Variables del gateway web

```dotenv
NEXT_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud
RNDC_API_URL=https://<backend-rndc>
RNDC_SERVICE_TOKEN=<mismo-secreto-del-backend>
RNDC_INGEST_KEY=<mismo-secreto-de-convex>
RNDC_MODE=dry-run
AUTH_MODE=<modo-autenticacion-aprobado>
AUTH_SESSION_SECRET=<secreto-de-sesion>
AUTH_JWT_PRIVATE_KEY_BASE64=<clave-privada-base64>
AUTH_JWT_PUBLIC_KEY_BASE64=<clave-publica-base64>
AUTH_JWT_ISSUER=https://<dominio-web>
AUTH_JWT_AUDIENCE=tms-demo
AUTH_JWT_KEY_ID=<identificador-de-clave>
CONVEX_AUTH_JWKS=<jwks-configurado>
```

La autenticacion de demostracion esta pensada para validar roles y pantallas. No debe desbloquear trafico RNDC continuo. Antes de produccion debe existir un modo de autenticacion soportado para usuarios reales, con revocacion y trazabilidad.

### Interruptor de escrituras oficiales en Convex

Las emisiones, cumplidos, correcciones y anulaciones permanecen bloqueadas en modo `live` aunque el backend cambie accidentalmente. Solamente durante una ventana real aprobada se habilita el segundo interruptor en el despliegue Convex de produccion:

```bash
npx convex env set RNDC_LIVE_WRITES_ENABLED true --prod
```

El gateway y el backend tambien deben usar `RNDC_MODE=live`. Al cerrar la ventana o ante cualquier condicion de parada, volver a bloquear primero Convex y luego devolver gateway y backend a `dry-run`:

```bash
npx convex env set RNDC_LIVE_WRITES_ENABLED false --prod
```

No definir este valor en desarrollo. Su ausencia equivale a `false`.

## Manejo de secretos

Generar valores independientes:

```bash
openssl rand -base64 48
openssl rand -base64 48
openssl rand -base64 48
```

Usar uno para `RNDC_SERVICE_TOKEN`, otro para `RNDC_INGEST_KEY` y otro para la sesion. No reutilizar la clave RNDC.

- `RNDC_SERVICE_TOKEN` debe coincidir en backend y web.
- `RNDC_INGEST_KEY` debe coincidir en backend, web y entorno Convex.
- Las credenciales RNDC existen solo en el backend.
- La clave JWT privada existe solo en el servidor web.
- Rotar un secreto primero en el consumidor que pueda aceptar ambos valores, luego en el emisor, y finalmente retirar el anterior.
- Revocar y rotar inmediatamente cualquier valor que aparezca en logs, una captura, un ticket o Git.

## Verificacion de diccionarios

La copia disponible esta en `docs/rndc/dictionaries/2026-07-09`. Los originales no se editan.

En macOS:

```bash
cd docs/rndc/dictionaries/2026-07-09
shasum -a 256 -c SHA256SUMS
```

En Linux:

```bash
cd docs/rndc/dictionaries/2026-07-09
sha256sum -c SHA256SUMS
```

Antes de un `GO CONTROLADO`:

1. Descargar nuevamente desde el portal oficial los diccionarios de datos y errores.
2. Registrar fecha, hora, operador y fuente.
3. Comparar como minimo procesos 1, 2, 3, 4, 7, 8, 9, 28, 29, 32, 38 y 73.
4. Si cambiaron, crear una carpeta con fecha nueva y nuevas huellas. No reemplazar la copia anterior.
5. Confirmar campos requeridos, longitudes, catalogos de motivos y errores activos.
6. Detener la prueba si un codigo usado por XML, FOPAT, correccion o anulacion no puede justificarse con la copia activa.

El PDF de 2026 orienta el protocolo. El portal y sus diccionarios activos son la referencia operativa para variables y errores.

## Ensayo completo en dry-run

### 1. Verificaciones del repositorio

```bash
npm ci
npm run typecheck
npm test
npm run build
RNDC_MODE=dry-run npm run rndc:flow
```

Todas deben terminar correctamente. Si otra rama o despliegue produjo la imagen, registrar el commit y el digest exacto de esa imagen.

### 2. Preparar un escenario completo

Guardar el archivo real fuera del repositorio, por ejemplo:

```bash
install -m 700 -d "$HOME/.local/share/tms-rndc/scenarios"
export RNDC_SCENARIO_FILE="$HOME/.local/share/tms-rndc/scenarios/primera-prueba.json"
chmod 600 "$RNDC_SCENARIO_FILE"
```

El archivo debe ser una instantanea completa del expediente. En modo `live` se prohibe un overlay parcial porque cualquier campo omitido puede conservar un valor de referencia.

La revision a cuatro ojos debe cubrir:

- `seed`, `cargoNumber`, `tripNumber`, `remesaNumber` y `manifestNumber`;
- fechas de expedicion, cargue, descargue y pago;
- remitente y destinatario, incluyendo tipo, identificacion, sede y municipio;
- conductor, propietario, tenedor, vehiculo y remolque;
- SOAT, aseguradora, licencia y vencimientos;
- mercancia, empaque, naturaleza, cantidad y valor declarado;
- flete, anticipo, ICA y FOPAT;
- una sola remesa para esta primera prueba;
- ausencia de datos ficticios, vencidos o ya utilizados.

### 3. Generar y revisar sin enviar

```bash
RNDC_MODE=dry-run RNDC_SCENARIO_FILE="$RNDC_SCENARIO_FILE" npm run rndc:prepare-ops
RNDC_MODE=dry-run RNDC_SCENARIO_FILE="$RNDC_SCENARIO_FILE" npm run rndc:prod-flow
```

Revisar los XML en el directorio informado por el comando. Deben aparecer las emisiones en orden 1, 2, 3 y 4, con credenciales enmascaradas. Confirmar que el manifiesto contiene exactamente la remesa prevista.

No continuar si:

- una cifra monetaria difiere del expediente;
- FOPAT no tiene una decision determinista;
- una fecha esta en formato o zona horaria incorrectos;
- un consecutivo coincide con una ejecucion anterior;
- el XML hereda cualquier dato del escenario de referencia;
- la evidencia no puede copiarse al almacenamiento protegido.

### 4. Ensayar la recuperacion

En `dry-run`, practicar antes de la ventana:

- consulta de carga, viaje, remesa y manifiesto;
- timeout simulado y reconciliacion sin reenvio;
- anulacion dirigida del manifiesto, remesa, viaje y carga;
- copia, checksum y recuperacion de evidencia;
- retorno del servicio a `RNDC_MODE=dry-run`.

## Verificacion del contenedor sin envio real

Crear un archivo de entorno fuera del repositorio a partir de `apps/rndc-api/.env.example`, completar un token de servicio y mantener `RNDC_MODE=dry-run`.

```bash
export RNDC_ENV_FILE="$HOME/.config/tms/rndc-api.env"
export RNDC_DATA_DIR="$HOME/.local/share/tms-rndc/runtime"
install -m 700 -d "$(dirname "$RNDC_ENV_FILE")" "$RNDC_DATA_DIR"
chmod 600 "$RNDC_ENV_FILE"
docker run --rm -d \
  --name tms-rndc-api-dry \
  --env-file "$RNDC_ENV_FILE" \
  -p 3017:3017 \
  -v "$RNDC_DATA_DIR:/app/data" \
  tms-rndc-api:2026-07-09
```

Comprobar:

```bash
curl -fsS http://127.0.0.1:3017/healthz
curl -fsS http://127.0.0.1:3017/readyz
docker exec tms-rndc-api-dry sh -lc 'touch /app/data/.write-test && rm /app/data/.write-test'
docker inspect --format '{{json .State.Health}}' tms-rndc-api-dry
```

La respuesta de readiness debe ser `ready` y modo `dry-run`. Al terminar:

```bash
docker stop tms-rndc-api-dry
```

## Consultas de solo lectura contra RNDC

Las consultas usan HTTP `POST` por la forma del servicio SOAP, pero no crean documentos oficiales. Se ejecutan primero con numeros ya conocidos y autorizados por el negocio.

No escribir el token en el historial:

```bash
export RNDC_API_BASE=https://<backend-rndc>
read -r -s RNDC_SERVICE_TOKEN
export RNDC_SERVICE_TOKEN
```

Disponibilidad:

```bash
curl -fsS "$RNDC_API_BASE/healthz"
curl -fsS "$RNDC_API_BASE/readyz"
```

Consultar un registro existente:

```bash
curl -fsS -X POST "$RNDC_API_BASE/rndc/reconciliation" \
  -H "Authorization: Bearer $RNDC_SERVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'X-Request-Id: preflight-cargo-001' \
  -d '{"documentType":"cargo","documentNumber":"<numero-existente>"}'
```

Repetir de forma controlada con `trip`, `remesa` y `manifest`. Consultar aceptacion electronica de un manifiesto existente:

```bash
curl -fsS -X POST "$RNDC_API_BASE/rndc/acceptances/query" \
  -H "Authorization: Bearer $RNDC_SERVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'X-Request-Id: preflight-acceptance-001' \
  -d '{"manifestRadicado":"<radicado-existente>"}'
```

Guardar respuesta, `X-Request-Id`, `X-Correlation-Id`, hora y operador. Si una consulta falla por red, probar una sola vez despues de confirmar conectividad. No convertir un fallo de consulta en un envio.

## Prerrequisitos del GO CONTROLADO

Todos deben estar marcados:

- [ ] Autorizacion escrita con numero de cambio o ticket.
- [ ] Expediente real aprobado por operaciones y por quien responde ante RNDC.
- [ ] Se decidio si el expediente seguira como viaje real o sera una prueba con anulacion preaprobada.
- [ ] Una sola remesa y un solo manifiesto.
- [ ] Consecutivos de carga, viaje, remesa y manifiesto reservados y nunca usados.
- [ ] Conductor, vehiculo, remolque, propietario, tenedor, remitente y destinatario verificados.
- [ ] Documentos y vencimientos vigentes.
- [ ] FOPAT resuelto; no aparece `review-required`.
- [ ] Diccionarios actualizados y motivos de anulacion aprobados.
- [ ] Consultas PLC exitosas desde el mismo runtime que enviara.
- [ ] `/healthz` y `/readyz` correctos.
- [ ] Volumen `/app/data` persistente, respaldado y probado.
- [ ] Una ruta adicional de copia protegida para XML, respuestas y PDF.
- [ ] Logs visibles en tiempo real y alertas habilitadas.
- [ ] Un solo operador ejecutor y un segundo revisor presentes.
- [ ] Nadie mas puede enviar durante la ventana.
- [ ] Procedimiento de anulacion dirigida ensayado en `dry-run`.
- [ ] Contacto de escalamiento RNDC disponible.

## Primera prueba real controlada

### Opcion preferida: gateway operativo completo

Usar esta opcion solamente cuando la autenticacion real, el modo `live`, la cola durable y la evidencia protegida hayan sido verificados juntos.

Para un expediente de una remesa, la secuencia visible es:

1. Emitir informacion de carga, proceso 1.
2. Consultar y confirmar la carga.
3. Emitir la remesa, proceso 3.
4. Consultar y confirmar la remesa.
5. Emitir manifiesto. Esta accion registra informacion de viaje, proceso 2, y luego manifiesto, proceso 4.
6. Consultar y confirmar viaje y manifiesto por separado.
7. Consultar aceptacion electronica cuando corresponda.

Cada accion debe tener una clave de negocio unica y una clave de solicitud unica. No avanzar si la operacion no termina `succeeded`, la evidencia no queda almacenada o el documento oficial no conserva su estado correcto.

### Opcion excepcional: prueba protocolaria de una sola ejecucion

Mientras el gateway web no soporte autenticacion real en `live`, una prueba protocolaria puede ejecutarse desde la imagen aprobada, siempre que el ticket lo autorice expresamente. El servicio principal permanece en `dry-run`; solo el proceso CLI recibe el override `live`.

Montar la instantanea completa en `/app/data/scenarios/primera-prueba.json` y ejecutar una vez:

```bash
docker exec \
  -e RNDC_MODE=live \
  -e RNDC_ENV=primary \
  -e RNDC_SCENARIO_FILE=/app/data/scenarios/primera-prueba.json \
  tms-rndc-api-dry \
  node apps/rndc-api/dist/cli.js mtm-prod-flow
```

Este comando usa la secuencia conocida 1, 2, 3 y 4, detiene el flujo en el primer rechazo y guarda evidencia en `/app/data/runs`. No ofrece por si solo cola durable ni sincronizacion completa con Convex. Por eso sirve para una prueba protocolaria controlada, no para operacion continua.

No cumplir remesa ni manifiesto durante la prueba. Los procesos 5 y 6 se ejecutan solamente cuando el viaje real haya terminado y los datos de entrega sean verdaderos.

## Condiciones de parada

Detener inmediatamente y no reenviar si ocurre cualquiera:

- timeout, HTTP 408, 502, 503 o 504;
- respuesta vacia o sin conclusion aceptada/rechazada;
- error de duplicado inesperado;
- rechazo despues de que un paso anterior fue aceptado;
- radicado ausente en un paso que debe producirlo;
- FOPAT distinto al aprobado;
- numero, placa, persona, ruta, remesa o valor inesperado;
- operacion `uncertain` o lease vencido;
- evidencia local incompleta;
- fallo al guardar evidencia protegida;
- `/readyz` cambia a `503`;
- el segundo revisor pierde visibilidad del proceso.

Ante incertidumbre:

1. Registrar la hora y el ultimo `X-Correlation-Id`.
2. Copiar la evidencia local sin modificarla.
3. Consultar el numero exacto del ultimo paso.
4. Consultar tambien todos los pasos anteriores.
5. Marcar como aceptado solamente lo confirmado por RNDC.
6. No usar otro consecutivo para ocultar el estado incierto.
7. Decidir continuacion o anulacion con el responsable del negocio.

## Reversion oficial dirigida

La reversion de software y la anulacion RNDC son cosas distintas. Volver a una imagen anterior no elimina registros oficiales.

Si el expediente no seguira como viaje real y existe autorizacion de anulacion, confirmar primero que paso fue aceptado. Revertir solo los confirmados, en este orden:

1. Manifiesto, proceso 32.
2. Remesa, proceso 9.
3. Informacion de viaje, proceso 8.
4. Informacion de carga, proceso 7.

Si ya existieran cumplidos, primero se evaluan 29 y 28. Esa situacion queda fuera de la primera prueba y requiere un plan nuevo.

Ejemplo para anular un manifiesto confirmado:

```bash
curl -fsS -X POST "$RNDC_API_BASE/rndc/annulments/targeted" \
  -H "Authorization: Bearer $RNDC_SERVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'X-Request-Id: rollback-manifest-001' \
  -d '{"target":"manifest","manifestNumber":"<numero>","reasonCode":"<codigo-validado>","observations":"<motivo-aprobado>"}'
```

Luego usar, uno por uno y solo cuando aplique:

```json
{"target":"remesa","remesaNumber":"<numero>","reasonCode":"<codigo-validado>","reverseReasonCode":"<codigo-validado>","observations":"<motivo-aprobado>"}
{"target":"trip-information","tripNumber":"<numero>","reasonCode":"<codigo-validado>"}
{"target":"cargo-information","cargoNumber":"<numero>","reasonCode":"<codigo-validado>"}
```

Despues de cada anulacion, consultar el registro antes de continuar. Si RNDC rechaza un paso superior, no forzar los siguientes; preservar evidencia y escalar.

## Evidencia y cierre de la ventana

El paquete minimo contiene:

- commit e imagen exactos;
- ticket y aprobaciones;
- instantanea del expediente usada;
- XML de cada solicitud con credenciales enmascaradas;
- XML de cada respuesta;
- `evidence.json` o `result.json`;
- PDF generados;
- radicados y estados consultados;
- operaciones Convex, intentos y auditoria;
- logs por `requestId` y `correlationId`;
- decisiones de continuar, detener o anular;
- resultado de las consultas posteriores.

Crear un paquete inmutable sin imprimir su contenido:

```bash
export RUN_DIR=/ruta/al/run
tar -C "$(dirname "$RUN_DIR")" -czf first-live-evidence.tgz "$(basename "$RUN_DIR")"
shasum -a 256 first-live-evidence.tgz > first-live-evidence.tgz.sha256
```

Subirlo al almacenamiento protegido, validar descarga y checksum, y restringirlo a operadores y auditores autorizados. El enmascaramiento elimina credenciales, pero no elimina datos personales ni comerciales.

Al cerrar:

1. Confirmar estado oficial por consulta.
2. Confirmar evidencia protegida y checksum.
3. Devolver backend y gateway a `RNDC_MODE=dry-run` si solo habia `GO CONTROLADO`.
4. Confirmar `/readyz` en `dry-run`.
5. Cerrar o escalar cada operacion `uncertain`, `reconciling` o `failed`.
6. Documentar errores RNDC nuevos en pruebas automatizadas antes de otra ventana.

## Monitoreo minimo

Alertar por:

- `/healthz` caido;
- `/readyz` en `503`;
- cualquier 5xx;
- rechazos 422 por encima de cero durante la ventana;
- operaciones `uncertain` o `reconciling` durante mas de cinco minutos;
- leases vencidos;
- operaciones que alcanzan el maximo de intentos;
- fallo de sincronizacion o evidencia no almacenada;
- falta de espacio o error de escritura en `/app/data`;
- crecimiento anormal de latencia RNDC;
- reinicio del contenedor durante una operacion.

Los logs JSON deben centralizarse con retencion, busqueda por `requestId` y `correlationId`, y redaccion de payloads. No registrar credenciales ni cuerpos XML completos en el agregador general.

## Rollback de software

Si el problema es de aplicacion y no hay estado RNDC incierto:

1. Bloquear nuevas acciones oficiales.
2. Fijar `RNDC_MODE=dry-run`.
3. Esperar o cancelar solamente trabajos que aun estan `queued`; no cancelar a ciegas uno `claimed`.
4. Preservar volumen y logs.
5. Volver al digest anterior de la imagen.
6. Verificar `/healthz`, `/readyz` y una consulta de solo lectura.
7. Mantener `dry-run` hasta una nueva autorizacion.

Nunca restaurar una base de datos para intentar borrar un documento RNDC. La fuente oficial se corrige mediante consulta, reconciliacion, correccion o anulacion admitida por RNDC.

## Criterios de GO PRODUCCION

- [ ] La primera prueba real termino con los cuatro procesos confirmados o con una reversion confirmada.
- [ ] No quedan operaciones inciertas.
- [ ] La UI usa autenticacion apta para usuarios reales.
- [ ] El backend solo acepta el token del gateway y las rutas genericas permanecen deshabilitadas.
- [ ] La cola registra el modo real y evita duplicados despues de reinicio.
- [ ] Un timeout se reconcilia antes de habilitar reintento.
- [ ] XML, respuestas y PDF sobreviven redeploy y restauracion.
- [ ] Existe respaldo probado del volumen y del almacenamiento de evidencia.
- [ ] Se probaron rotacion de secretos y revocacion de usuario.
- [ ] Se probaron alertas y guardia de soporte.
- [ ] Los diccionarios tienen propietario y calendario de actualizacion.
- [ ] Existe una ventana separada para cumplidos 5 y 6 con FOPAT validado.
- [ ] Operaciones, tecnologia y auditoria firmaron el handoff.

Hasta completar esta lista, mantener `RNDC_MODE=dry-run` como configuracion permanente.

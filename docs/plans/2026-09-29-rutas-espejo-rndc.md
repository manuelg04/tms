# Rutas, puestos de control y espejo RNDC

## Alcance

Migrar los catálogos operativos y el plan de cada despacho siguiendo los campos observados en Avansat. Reutilizar Seguimiento para reportes, novedades e historial. Consultar manifiestos, remesas, cumplidos y anulaciones mediante el protocolo XML/SOAP existente y conservar sus identidades oficiales.

## Decisiones

- Puestos operativos independientes de los maestros RNDC. Código de origen como identidad; nombres repetidos permitidos. Campos observados: nombre, ciudad, encargado, dirección, teléfono, coordenadas, temperatura, altitud y virtual.
- Ruta: origen, destino, vía, estado y secuencia de puestos con minutos y kilómetros acumulados desde el origen. Lugar Entrega es el terminal especial 9999. La ruta 803 muestra 18 posiciones; el terminal no debe confundirse con el puesto virtual 10013.
- Asignación con instantánea de la revisión de ruta, fecha de salida y horarios planeados. Las modificaciones del catálogo no cambian los planes ya asignados. Reportes y estados oficiales no se deducen de los nombres de novedades.
- Espejo separado de documentos emitidos por el TMS. Importación idempotente por empresa, proceso y radicado. Actualizar consultas no elimina documentos anteriores ni convierte ausencia en anulación.
- Lecturas oficiales tipo 3 expresamente habilitadas en el backend, independientes del modo de emisión. Frontend autenticado, consultas por fechas acotadas, evidencia en backend y almacenamiento Convex protegido por clave de servicio.
- RNDC y Avansat usan fechas distintas. Conservar fecha del documento, ingreso RNDC y última consulta; no inferir discrepancia por fecha local de cumplido.
- Autorización por organización y rol, control de revisiones y auditoría. La primera validación fue local; la ampliación descrita al final incluye importación a la organización configurada y publicación del backend, Convex y una vista previa web. La emisión oficial sigue en dry-run.

## Verificación

- Base inicial: 455 pruebas pasaron.
- Probar catálogos, importación repetida, copia de ruta, horarios, preservación de historial, concurrencia, aislamiento y permisos.
- Probar SOAP de sólo lectura contra servidor aislado, límites de fecha, errores y evidencia sin credenciales.
- Recorrer las pantallas en escritorio y móvil con funciones Convex reales en una base aislada; comprobar persistencia y registros.
- Ejecutar typecheck, pruebas, build y flujo RNDC dry-run.

## Uso y preparación de publicación

- `/rutas` permite importar un catálogo JSON versión 1, revisar puestos, copiar rutas y guardar cambios. Cada puesto conserva su código original. La importación repetida omite registros idénticos y controla revisiones; si un lote queda parcial, informa lo guardado para permitir reintentar sin duplicar.
- El catálogo contiene `points` y `routes`. Las rutas usan `stops` con `key`, `pointCode`, `minutes`, `kilometers` opcional y estados `active`/`assigned`. Las rutas nuevas TMS requieren tiempos y distancias acumulados válidos y terminal `9999`. Las rutas Avansat conservan su secuencia original, incluso las antiguas sin ese terminal. La pantalla permite importar archivos de hasta 25 MB, exportar el catálogo, buscar sobre todos los registros y paginar los resultados en grupos de 100.
- En Seguimiento, seleccionar una ruta activa y la fecha/hora de salida de Bogotá crea el plan y sus horarios. El origen y destino deben coincidir con el despacho. No se reemplazan planes con controles completados o reportes vinculados a sus puestos; los reportes históricos independientes se conservan.
- `/documentos/espejo` consulta por fecha de ingreso RNDC, de 1 a 31 días por lote, con máximo 2000 documentos por proceso. Consultas mayores requieren reducir el período. La actualización es manual; mostrar un documento guardado no garantiza que el estado oficial siga vigente. La pantalla conserva la fecha de consulta y los radicados.
- Procesos incluidos: remesas, manifiestos, sus cumplidos, anulaciones y anulaciones de cumplidos. La relación usa números originales normalizados para sus ceros iniciales; la evidencia mantiene los valores originales. Las órdenes de cargue, rutas y puestos operativos se obtienen de Avansat.
- Para publicar, instalar los módulos/schema Convex, backend y frontend en los destinos acordados. El backend debe tener `RNDC_MIRROR_ENABLED=true` y `RNDC_MIRROR_ORGANIZATION_ID` con la organización autorizada. Mantener `RNDC_MODE=dry-run` para emisión mientras se validan las consultas. Se reutilizan la autenticación de servicio, credenciales RNDC, URL Convex y `RNDC_INGEST_KEY` existentes; ninguna clave pasa al navegador.
- Cada consulta SOAP conserva evidencia en el backend. Una actualización exitosa también guarda evidencia protegida en Convex. Los registros nuevos se preparan por lotes y se publican atómicamente al finalizar; un fallo conserva el espejo anterior. No borrar documentos ausentes de una consulta ni inferir que fueron anulados.
- Los datos inválidos originales de coordenadas de Avansat se conservan como texto, sin convertirlos en posiciones GPS. Los puestos nuevos de fuente TMS requieren valores numéricos válidos. Campos aún no verificados del catálogo Avansat se dejan vacíos.

## Evidencia de validación local

- Suite completa: 572 pruebas, cero fallos (55 core, 53 backend, 464 web). Typecheck completo y build completo aprobados. Flujo RNDC dry-run aprobado.
- Pruebas de navegador: cuatro casos nuevos aprobados en escritorio y móvil, con Express, SOAP aislado y funciones reales de Convex sobre una base de prueba. Los cuatro casos anteriores de Seguimiento también aprobaron; se corrigió la tilde faltante en un selector de la prueba móvil.
- Reimportación, copia de ruta, persistencia tras recarga, asignación de horarios que cruzan el mes, conservación de reportes, vínculos manifiesto/remesa/cumplidos, evidencia descargable, roles y consulta fallida conservando datos verificados.
- Ruta real 803 validada en una base aislada: 17 puestos de control y 18 posiciones del plan, incluido Lugar Entrega. Se conservaron dos reportes existentes y los valores inválidos originales del puesto 74.
- GET real del backend al RNDC para el 29 de septiembre: 37 manifiestos; 34 presentes en la captura anterior coinciden sin diferencias de campos. Los tres restantes no pertenecían a esa captura anterior; no se clasifican como inconsistencias.
- Capturas de interfaz revisadas en escritorio y móvil. Los archivos de origen y las consultas reales permanecen en `local/rndc-avansat/2026-09-29`, excluidos de Git. La validación no publica cambios ni escribe en una base compartida y no transmite documentos oficiales.
- La primera muestra de ruta 803 no equivalía a la migración completa. La ampliación siguiente completa la importación del catálogo y la validación del backend publicado.

## Catálogo completo y validación compartida

- Origen Avansat: 1.404 puestos, 3.703 rutas y 58.470 posiciones. Se extrajeron todas las fichas y formularios de consulta; sus códigos y cantidades de puestos coinciden con los listados completos. Los valores originales, incluidos nombres con espacios, campos vacíos, coordenadas en texto y estados de cada posición, se conservan.
- El archivo preparado mide 11.334.563 bytes. Una validación con las funciones reales de Convex en una base aislada comparó los 5.107 registros campo por campo, sin diferencias. La respuesta del catálogo completo mide 7.181.968 bytes en esa validación.
- Importación aplicada a la organización Transportes MTM del destino ya configurado `dev:tremendous-dragon-726`: 1.404 puestos y 3.703 rutas. La lectura posterior de todos los registros coincide. La repetición produjo cero inserciones y cero modificaciones y volvió a verificar los 5.107 registros.
- Comando reproducible: `npm run ingest:avansat-routes -- <archivo.json>` prepara la carga sin escribir; `--apply` aplica y verifica. Reutiliza el administrador y las claves existentes, comprueba el destino de desarrollo y la organización, rechaza conflictos con registros TMS, conserva revisiones y emite recibos privados con el hash del archivo.
- Las 353 rutas antiguas sin terminal `9999` permanecen sin paradas añadidas. Una ruta está inactiva en origen. Las 33 rutas con distancias no acumuladas se importan fielmente; requieren revisar esas distancias antes de asignar un plan. La revisión está en `catalogo-completo/schedule-validation.json` dentro de la evidencia privada.
- Convex publicado, backend Railway publicado y ocho consultas reales SOAP tipo 3 realizadas desde ese backend para el período inclusivo 2026-08-31 a 2026-09-29. Cada proceso se almacenó con su evidencia y se verificó mediante lectura paginada de todos sus campos.
- Resultados por proceso: 3 remesas 787; 4 manifiestos 768; 5 cumplidos de remesa 688; 6 cumplidos de manifiesto 685; 9 anulaciones de remesa 0; 32 anulaciones de manifiesto 0; 28 anulaciones de cumplido de remesa 5; 29 anulaciones de cumplido de manifiesto 0. Son consultas independientes; las cantidades incluyen documentos de otros períodos que tuvieron operaciones en esta ventana.
- Contra la captura Avansat de septiembre: 752 manifiestos comunes coinciden en ocho campos y dos relaciones; 571 cumplidos de remesa de esa cohorte coinciden en la relación remesa/manifiesto. Los 25 manifiestos Avansat ausentes del resultado RNDC están anulados y carecen de radicado en la captura. Los 16 documentos RNDC fuera de esa captura pertenecen al período ampliado o a registros posteriores; no se califican como inconsistencias.
- Se corrigió el arranque del backend, que reutilizaba una URL calculada para pruebas como una dirección fija. Una prueba del proceso independiente confirma que el espejo usa el endpoint de consultas mientras la emisión permanece dry-run. La suite backend pasó 54 pruebas; las suites core y web habían pasado 55 y 466. Typecheck y build completos pasaron después de los cambios.
- Vista previa Vercel disponible en `https://web-b3qvj3ci0-manuelg9704-gmailcoms-projects.vercel.app`, con la autenticación existente. Desde esa web publicada se consultó el período completo y se guardaron 768 manifiestos; la pantalla confirmó el resultado y la nueva fecha de consulta. Se revisó su presentación en escritorio y móvil. La sustitución de la dirección habitual de producción está pendiente de la elección del usuario.
- Una lectura real agotó el límite anterior de 30 segundos y conservó el espejo existente. Las consultas ahora disponen de 120 segundos en el backend y 180 en la función web, sin modificar el límite de emisión. El backend corregido quedó publicado y la consulta posterior desde la vista previa terminó correctamente. La prueba backend con una respuesta lenta confirma que el presupuesto de consulta es independiente del de emisión.
- Recibos, consultas, cruce, capturas y registros se conservan en `local/rndc-avansat/2026-09-29`, excluidos de Git. `migration-validation.json` concentra la evidencia. La actualización del espejo sigue siendo manual.
- Se verificó un detalle real desde la web publicada con remesa, manifiesto, cumplido de remesa y cumplido de manifiesto relacionados por sus identidades oficiales. La captura y la auditoría de cierre están en la evidencia privada. El backend volvió a responder listo en dry-run; la vista previa permanece Ready y la dirección habitual conserva su versión anterior.

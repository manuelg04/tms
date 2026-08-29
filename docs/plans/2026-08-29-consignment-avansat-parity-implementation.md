# Plan de implementación: paridad de remesas con Avansat

Fecha: 2026-08-29

## Criterio de finalización

La etapa de remesas muestra el contrato de campos de Avansat, asigna un consecutivo estable de cinco dígitos al abrir, conserva la herencia desde la orden, guarda los datos operativos adicionales y completa el flujo documental en dry-run sin regresiones.

## 1. Fijar el contrato con pruebas

- Agregar una prueba de navegador que abra una remesa de un despacho y compruebe los campos, tipos, valores heredados, consecutivo y ausencia de desbordamiento.
- Agregar pruebas unitarias para el formato y la resolución idempotente del número de remesa.
- Agregar pruebas unitarias para convertir valores efectivos del formulario en modificaciones compactas frente a la orden.
- Ejecutar las pruebas y confirmar que fallen por las capacidades ausentes.

## 2. Preparar el modelo de datos

- Ampliar el borrador de remesa con tipo de operación, tipo consolidado, operador GPS, contado, contraentrega, tomador del seguro, grupo de embalaje y orden de servicio del transportador.
- Mantener esos campos separados de la fotografía XML cuando no exista un mapeo RNDC respaldado.
- Exponer el tipo o grupo del catálogo de empaques para derivar el grupo de embalaje sin inventarlo.

## 3. Asignar el número al abrir

- Crear una operación autenticada e idempotente que garantice la remesa de una secuencia dentro del despacho.
- Si la remesa no existe, crear su borrador inicial y reclamar el siguiente consecutivo de cinco dígitos.
- Si existe sin número, reclamarlo una sola vez.
- Si ya tiene número, devolverlo sin modificarlo.
- Registrar la creación o asignación en auditoría.

## 4. Construir el formulario completo

- Sustituir la presentación de diferencias por secciones equivalentes a Avansat.
- Mostrar cliente, orden, origen, destino y manifiesto como contexto del despacho.
- Precargar remitente, destinatario, sitios, citas, carga y clasificación desde la orden.
- Mantener búsqueda en los catálogos existentes para terceros, identificaciones, municipios, aseguradora y empaques.
- Conservar filas dinámicas para remisiones.
- Añadir estados claros mientras se prepara el borrador o si la preparación falla.

## 5. Guardar sin romper la herencia

- Construir el valor efectivo desde el formulario.
- Compararlo con la orden y persistir sólo las diferencias heredables.
- Persistir completos los campos propios de la remesa.
- Validar los campos obligatorios según el valor efectivo.
- Conservar el bloqueo de edición de documentos oficiales.

## 6. Proteger la emisión RNDC

- Confirmar con pruebas que los mismos datos producen el mismo payload de emisión.
- No incorporar campos operativos al XML sin una equivalencia existente.
- Confirmar que el número reservado se use en la fotografía y en el documento emitido.

## 7. Verificar

- Ejecutar pruebas unitarias y de navegador dirigidas durante cada ciclo rojo, verde y refactorización.
- Actualizar funciones y esquema únicamente en Convex de desarrollo.
- Ejecutar todas las pruebas, validación de tipos y compilación.
- Revisar el formulario en escritorio y móvil.
- Ejecutar el flujo de orden, remesa y manifiesto con el backend en `RNDC_MODE=dry-run`.
- Revisar el estado final de Git y dejar intactos los archivos ajenos al alcance.

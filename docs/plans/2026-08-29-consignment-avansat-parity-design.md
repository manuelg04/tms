# Diseño: paridad de creación de remesas con Avansat

Fecha: 2026-08-29
Estado: aprobado por Manuel

## Objetivo

Ajustar la etapa de creación de remesas del despacho para que muestre y guarde los mismos datos operativos visibles en Avansat, sin duplicar el flujo documental ni inventar catálogos o equivalencias RNDC.

## Enfoque elegido

La remesa seguirá siendo una etapa del despacho y estará vinculada a su orden de cargue. El formulario mostrará los datos completos, precargados desde la orden, pero conservará internamente la herencia: sólo las diferencias se guardarán como modificaciones propias de la remesa.

La remesa sin orden seguirá siendo una excepción administrativa independiente. El formulario ordinario mostrará que proviene de una orden, junto con el cliente y el consecutivo de esa orden, sin permitir que el operador cambie accidentalmente la modalidad del despacho.

## Alternativas descartadas

### Cambio exclusivamente visual

No resuelve el consecutivo tardío, los campos operativos ausentes ni la dificultad para revisar los valores heredados.

### Módulo independiente que replique Avansat

Duplicaría remitente, destinatario, ruta, carga y estado documental, y debilitaría el recorrido orden, remesa y manifiesto que ya usa el TMS.

## Experiencia del operador

Al abrir la etapa de remesas, el sistema garantizará que exista el borrador inicial y le asignará un consecutivo real de cinco dígitos. La operación será idempotente: recargar la página o repetir la solicitud devolverá la misma remesa y el mismo número. Los números reservados no se reutilizarán.

Los datos heredados se mostrarán como valores reales, no como placeholders. El operador podrá corregirlos antes de la emisión. Al guardar, los valores idénticos a la orden seguirán heredándose y sólo las diferencias quedarán persistidas como modificaciones de la remesa.

Los documentos autorizados permanecerán en sólo lectura. Las correcciones y anulaciones conservarán el flujo protegido existente.

## Campos visibles

### Tipo e información de la orden

- Remesa municipal o terrestre de carga.
- Indicador de creación desde orden de cargue.
- Cliente.
- Número de orden de cargue.

### Datos básicos

- Fecha.
- Agencia.
- Origen.
- Destino.
- Tipo de operación de la remesa.
- Tipo consolidado.
- Número de remesa.
- Operador GPS RNDC.

El tipo de operación será General mientras sea la única modalidad respaldada por el contrato RNDC actual. No se mostrarán opciones sin soporte real.

### Sitios de cargue y descargue

Para remitente y destinatario se mostrarán nombre, tipo y número de identificación, dirección, teléfono, celular, latitud, longitud, cita y horas pactadas. Los datos conocidos se tomarán de la orden y de los maestros existentes.

### Datos del despacho

- Remesa de contado.
- Remesa contraentrega.
- Valor declarado de la mercancía.
- Valor de la remesa.
- Número de manifiesto, sólo lectura cuando exista.
- Porcentaje de seguro.

### Póliza

- Tomador del seguro.
- Aseguradora.
- Número de póliza.
- Vigencia final.

El tomador se mantendrá como Empresa de transporte porque el XML actual emite esa propiedad. No se ofrecerán alternativas que todavía no pueda transmitir el sistema.

### Remisiones

Cada fila tendrá número de remisión, cantidad, clase de bultos, descripción, peso en toneladas y volumen. Será posible agregar y retirar filas antes de la autorización.

### Resumen para el manifiesto

- Unidad de medida.
- Mercancía.
- Código de empaque.
- Naturaleza de la carga.
- Grupo de embalaje o envase.
- Orden de servicio del transportador.
- Observaciones del transportador.
- Observaciones generales.

El grupo de embalaje se derivará del catálogo de empaques cuando exista esa relación. Los valores desconocidos permanecerán vacíos; no se fabricarán relaciones.

## Datos y compatibilidad

Los campos operativos de Avansat que no participan actualmente en el XML se guardarán en el borrador de la remesa para trazabilidad. El payload RNDC conservará sus campos y reglas vigentes. No se modificará el protocolo XML/SOAP ni se enviarán datos sin una equivalencia ya respaldada.

La validación de campos obligatorios se calculará sobre la combinación efectiva entre orden y remesa. Una remesa puede heredar un valor requerido, pero nunca se considerará completa si el valor efectivo falta.

## Errores y concurrencia

- Abrir simultáneamente la misma etapa devolverá la misma remesa por expediente y secuencia.
- Cada consecutivo se reclamará de manera atómica.
- Si falla la preparación del formulario, se mostrará una acción clara para reintentar.
- Guardar dos veces actualizará el mismo borrador y no creará otra remesa.
- Un documento oficial no podrá volver a editarse desde este formulario.

## Verificación

- Pruebas unitarias de reserva idempotente, formato del consecutivo, herencia y extracción de modificaciones.
- Prueba del contrato visible de campos frente a Avansat.
- Pruebas de guardado, recarga y lectura posterior.
- Protección del payload RNDC existente.
- Revisión visual en escritorio y móvil.
- Flujo completo con RNDC en modo dry-run.

Ninguna verificación de este alcance contactará el RNDC real ni desplegará la aplicación pública.

# Diseño: alineación de correcciones y anulaciones

Fecha: 2026-07-13
Estado: aprobado por el usuario
Base funcional: `eb2980e`

## Objetivo

Pulir el listado de correcciones y anulaciones para que todas las filas compartan una estructura visual estable. El documento, la ruta, el estado y cada acción deben comenzar siempre en la misma posición, incluso cuando una fila no permita corrección.

## Decisión aprobada

Se conservará la presentación compacta de una fila por documento en escritorio. El listado seguirá usando tarjetas ligeras, pero funcionará con una cuadrícula compartida y encabezados visibles para documento, despacho y ruta, estado y acciones.

Las acciones tendrán tres posiciones reservadas:

- Revisar acciones.
- Preparar corrección.
- Preparar anulación.

Cuando una acción no esté disponible, su espacio se conservará en escritorio para que las otras acciones no se desplacen.

## Alternativas descartadas

### Convertir el listado en una tabla HTML completa

Ofrece semántica tabular directa, pero añade complejidad innecesaria para adaptar los controles a móvil y cambia más de lo necesario la superficie recién creada.

### Ajustar únicamente el ancho del grupo de acciones

Es el cambio más pequeño, pero seguiría dependiendo del contenido de cada fila y volvería a desalinearse al agregar o traducir acciones.

## Comportamiento adaptable

En escritorio amplio, cada documento permanecerá en una sola línea con columnas estables. En pantallas intermedias, las acciones pasarán a una segunda línea sin perder su orden. En móvil, la identidad, la ruta, el estado y las acciones se apilarán con objetivos táctiles de altura suficiente y sin desplazamiento horizontal.

## Acabado visual

- Los encabezados usarán el mismo tono y espaciado que el resto del producto.
- El estado quedará alineado con su encabezado y con los estados de las demás filas.
- La ruta tendrá mayor claridad tipográfica sin competir con el número del documento.
- Las tres acciones tendrán alturas, áreas de interacción y estados de foco consistentes.
- El hover de la fila conservará el lenguaje visual existente y no moverá el contenido.

## Accesibilidad

- Los enlaces conservarán nombres explícitos.
- El foco seguirá siendo visible.
- El estado continuará expresado con texto además de color.
- Los encabezados visuales se ocultarán cuando la distribución deje de ser tabular.

## Criterios de finalización

- Las acciones equivalentes quedan alineadas entre manifiestos, remesas y órdenes de cargue.
- El listado no presenta desbordamiento horizontal en escritorio, tableta o móvil.
- La búsqueda, revisión, corrección y anulación conservan su comportamiento.
- La página se inspecciona visualmente en escritorio y móvil.
- Pasan el typecheck, el build y las pruebas relevantes.

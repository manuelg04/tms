export const rndcFieldHelp: Readonly<Record<string, string>> = {
  expeditionDate: "Fecha real en que se expide el documento. Es la fecha con la que queda registrado ante el RNDC.",
  agencyCode: "Agencia de la empresa que responde por el despacho. Es un dato interno para reportes y consecutivos; no cambia lo que se envía al RNDC.",
  generatesConsignment: "Déjalo marcado cuando esta orden debe convertirse en remesa. Los datos de remitente, destinatario y mercancía pasan a la remesa como borrador.",
  clientName: "Empresa que contrata el servicio. Es un dato interno: ante el RNDC el propietario de la carga se reporta con la identificación y la sede del remitente.",
  senderName: "Busca el remitente por nombre o NIT en el maestro de terceros del RNDC. Si no aparece, primero créalo en Maestros; un tercero sin registrar hace rechazar la remesa.",
  recipientName: "Busca el destinatario por nombre o documento en el maestro de terceros del RNDC. Si no aparece, créalo en Maestros antes de emitir.",
  senderIdType: "Tipo de documento con el que el remitente está registrado en el RNDC: NIT para empresas, cédula para personas. Si no coincide con ese registro, el RNDC rechaza la remesa.",
  recipientIdType: "Tipo de documento con el que el destinatario está registrado en el RNDC: NIT para empresas, cédula para personas. Si no coincide, el RNDC rechaza la remesa.",
  senderId: "Solo números, sin puntos ni guion. Si es NIT, incluye el dígito de verificación al final (900.226.684-3 → 9002266843), máximo 10 caracteres.",
  recipientId: "Solo números, sin puntos ni guion. Si es NIT, incluye el dígito de verificación al final, máximo 10 caracteres. Debe existir como tercero en el RNDC.",
  senderSiteCode: "Código de la sede del remitente tal como aparece en el registro de terceros del RNDC. Si el remitente es persona con cédula, la sede es 0.",
  recipientSiteCode: "Código de la sede del destinatario tal como aparece en el registro de terceros del RNDC. Si es persona con cédula, la sede es 0.",
  senderMunicipality: "Municipio donde se carga. Debe ser el de la sede del remitente y distinto al de descargue. Es el origen del manifiesto.",
  recipientMunicipality: "Municipio donde se descarga. Debe ser el de la sede del destinatario y distinto al de cargue. Es el destino del manifiesto.",
  loadingMunicipality: "Municipio del sitio de cargue. Debe coincidir con el de la sede del remitente y ser distinto al de descargue. De aquí sale el origen del manifiesto.",
  unloadingMunicipality: "Municipio del sitio de descargue. Debe coincidir con el de la sede del destinatario y ser distinto al de cargue. Es el destino del manifiesto.",
  loadingAppointment: "Fecha y hora pactadas para presentarse a cargar, en formato de 24 horas. La cita de descargue no puede ser anterior ni más de 5 días después (30 si es maquinaria).",
  unloadingAppointment: "Fecha y hora pactadas para descargar: igual o posterior a la cita de cargue y máximo 5 días después. SOAT y revisión técnico-mecánica deben estar vigentes hasta esta cita.",
  minLoadingDate: "Se reporta al RNDC como cita de cargue a las 00:00. Si la cita tiene otra hora, ajústala en el borrador de la orden antes de emitir.",
  maxLoadingDate: "Se reporta al RNDC como cita de descargue a las 23:59. Debe ser igual o posterior a la fecha mínima y máximo 5 días después.",
  vehicleId: "Placa registrada en el RNDC. El SOAT y la revisión técnico-mecánica deben estar vigentes hasta la cita de descargue, o el manifiesto será rechazado.",
  cargoDescription: "Nombre corto y claro del producto, máximo 60 caracteres (ej. CARBÓN MINERAL). El RNDC rechaza textos vacíos o poco explicativos.",
  merchandiseCode: "El sistema pone el código RNDC a partir del producto que elijas. Solo cámbialo de producto si la descripción que aparece debajo no corresponde a lo que se transporta.",
  natureOfCargo: "Clasificación oficial del RNDC. Debe cuadrar con el código de mercancía: un producto peligroso reportado como carga normal se rechaza.",
  packagingCode: "Tipo de empaque según la tabla del RNDC (caja, estiba, granel…). El granel líquido no se puede reportar en kilogramos; la carga en contenedor usa un código de contenedor.",
  weightTons: "Peso de la mercancía en toneladas; se reporta en kilogramos (34 → 34.000 kg). Sin el contenedor vacío y sin superar la capacidad del vehículo.",
  cargoQuantity: "Número de bultos o unidades (cajas, estibas). No es el peso: 34 toneladas no son 34 unidades.",
  driverFreight: "Valor acordado con el conductor, en pesos. Es una referencia interna: al RNDC se reporta el Valor flete del manifiesto.",
  orderObservations: "Se envía al RNDC como observaciones de la información de carga. Máximo 200 caracteres.",
  observations: "Se envía al RNDC como observaciones de la información de carga. Máximo 200 caracteres.",
  sealNumbers: "Números de sellos o precintos instalados en el vehículo o contenedor. Quedan en la orden impresa como soporte ante reclamos.",
  policyNumber: "Número de la póliza que asegura la mercancía. Se reporta como póliza tomada por la empresa de transporte; si la carga está asegurada, el RNDC exige este número.",
  policyExpiresOn: "Fecha de vencimiento de la póliza de la carga. El RNDC rechaza la remesa si la póliza ya está vencida.",
  insurerNit: "NIT de la aseguradora que expide la póliza, con dígito de verificación y sin guion (ej. 8110191907). Debe estar en la tabla de aseguradoras del RNDC.",
  declaredValue: "Valor comercial de la mercancía en pesos, sin decimales. Debe ser el valor real de la carga que se transporta.",
  issueDate: "Fecha de expedición del manifiesto. El RNDC solo acepta fechas desde hace un año hasta un mes adelante. Los cumplidos no pueden tener fechas anteriores a esta.",
  estimatedDeliveryDate: "Fecha estimada de entrega de la carga. Si dejas vacía la fecha de pago, esta fecha se reporta al RNDC como fecha de pago del saldo.",
  manifestType: "General: origen y destino distintos. Multiparada: dos o más remesas. Viaje vacío: sin remesas. Varios viajes en el día: recorridos de menos de 150 km.",
  operationScope: "Intermunicipal cuando origen y destino son municipios distintos. Los viajes municipales no pagan FOPAT.",
  freightTotal: "Valor total del viaje en pesos, solo números. Debe cubrir los costos eficientes del SiceTac de la ruta; con carga normal no puede superar $15.000.000.",
  withholdingSource: "Retención en la fuente en pesos: 1 % del valor del viaje por servicio de transporte de carga, cuando ese valor supera 4 UVT. No incluye el ICA.",
  withholdingIca: "Tarifa de ReteICA por cada $1.000 del flete, no el valor en pesos (3 por mil → escribe 3). Máximo 20, con hasta dos decimales, según el municipio de cargue.",
  advance: "Anticipo entregado al conductor, en pesos. No puede superar el valor del viaje menos las retenciones. Si el viaje es de flota propia no se permite anticipo.",
  fopatContribution: "Retención FOPAT: 0,1 % del valor a pagar, redondeada al peso. No aplica a viajes municipales ni a vehículos de 10.500 kg o menos de peso bruto. Se calcula al enviar.",
  adjustments: "Valores que suman al saldo del titular (por ejemplo, reconocimientos pactados). Escríbelos en pesos.",
  netPayable: "Saldo por pagar al titular del manifiesto: flete menos anticipo, retenciones y FOPAT, más ajustes.",
  paymentDate: "Fecha de pago del saldo al titular. El RNDC la acepta desde un mes antes hasta dos meses después de hoy. Si la dejas vacía se usa la fecha estimada de entrega.",
  paymentAgencyCode: "Agencia donde se paga el saldo, para uso interno. Ante el RNDC el lugar de pago del saldo es el municipio de destino del viaje.",
  loadingResponsible: "Quién paga el cargue. El RNDC solo acepta remitente o destinatario; el manifiesto reporta al remitente.",
  unloadingResponsible: "Quién paga el descargue. El RNDC solo acepta remitente o destinatario; el manifiesto reporta al destinatario.",
  requiresTracking: "Márcalo si el viaje debe entrar al control de tráfico (puestos de control y reportes en ruta).",
  documentsDeliveryDate: "Día en que el conductor entregó todos los documentos para cerrar el manifiesto. No puede ser futura ni anterior a la fecha de expedición del manifiesto.",
  observation: "Se envía al RNDC como observaciones del cumplido. Máximo 200 caracteres.",
  "remesa.class": "Terrestre de carga para viajes entre municipios; municipal cuando cargue y descargue quedan en el mismo municipio.",
  "remesa.loadingHours": "Tiempo total pactado para el cargue, incluidas la espera y la documentación, en horas (1,5 = 1 h 30 min). Debe ser menor a 24 horas.",
  "remesa.unloadingHours": "Tiempo total pactado para el descargue, incluidas la espera y la documentación, en horas (2,5 = 2 h 30 min). Debe ser menor a 24 horas.",
  "remesa.loadingLatitude": "Latitud del punto de cargue en grados decimales con punto, entre -5 y 14 en Colombia. Debe caer dentro del municipio de cargue.",
  "remesa.loadingLongitude": "Longitud del punto de cargue en grados decimales; en Colombia es negativa, entre -79 y -66 (ej. -73.1198).",
  "remesa.unloadingLatitude": "Latitud del punto de descargue en grados decimales con punto, entre -5 y 14 en Colombia. Debe caer dentro del municipio de descargue.",
  "remesa.unloadingLongitude": "Longitud del punto de descargue en grados decimales; en Colombia es negativa, entre -79 y -66 (ej. -73.3983).",
  "remesa.unitOfMeasure": "El RNDC solo admite kilogramos o galones para la cantidad cargada. El TMS reporta la remesa en kilogramos; consulta antes de emitir granel líquido.",
  "remesa.gpsOperator": "Empresa de monitoreo de flota que reportará los tiempos del viaje. Debe estar registrada en el RNDC como empresa de monitoreo.",
  "remesa.observations": "Se envía al RNDC como observaciones de la remesa. Máximo 200 caracteres.",
  "remesa.delivered": "Kilogramos entregados al destinatario, no bultos. El RNDC no acepta menos del 50 % de lo cargado ni más del doble de lo planeado.",
  "remesa.missing": "Kilogramos que faltaron al entregar. Regístralos para que el cumplido refleje la novedad.",
  "remesa.surplus": "Kilogramos entregados de más frente a lo cargado.",
  "remesa.returned": "Kilogramos que el destinatario devolvió.",
  "remesa.loadingArrivalAt": "Llegada del vehículo a la zona de espera del cargue. No puede ser futura ni estar a más de 60 días de la expedición del manifiesto.",
  "remesa.loadingEntryAt": "Inicio del cargue. Debe ser igual o posterior a la llegada al cargue y no puede ser futura.",
  "remesa.loadingExitAt": "Fin del cargue. Debe ser posterior a la entrada (el tiempo de cargue no puede ser 0), no futura y máximo 8 días después de la llegada.",
  "remesa.unloadingArrivalAt": "Llegada al descargue: al menos 15 minutos después de la salida del cargue, no futura y sin implicar más de 90 km/h promedio.",
  "remesa.unloadingEntryAt": "Inicio del descargue. Debe ser igual o posterior a la llegada al descargue y no puede ser futura.",
  "remesa.unloadingExitAt": "Fin del descargue: posterior a la entrada, no futura y máximo 8 días después de la llegada. Remesas sin cumplir 72 h después de la cita bloquean nuevos manifiestos.",
  "remission.weightTons": "Peso de esta remisión en toneladas (34 → 34.000 kg), sin el contenedor vacío. La remesa reporta la suma de todas las remisiones.",
  "remission.description": "Nombre corto y explicativo del producto, máximo 60 caracteres. La descripción de la primera remisión es la que se reporta al RNDC.",
  "remission.quantity": "Número de bultos o unidades de esta remisión (cajas, estibas). No es el peso."
};

export const manifestFieldHelp: Readonly<Record<string, string>> = {
  observations: "Recomendaciones para el conductor que se imprimen en el manifiesto. Máximo 200 caracteres; no incluyas textos ajenos a la operación."
};

export const loadingOrderDraftFieldHelp: Readonly<Record<string, string>> = {
  minLoadingDate: "Primer día en que el cliente puede cargar. Es una ventana interna: al RNDC se reporta la Cita de cargue.",
  maxLoadingDate: "Último día en que el cliente puede cargar. Es una ventana interna: al RNDC se reporta la Cita de descargue."
};

export function lookupFieldHelp(help: Readonly<Record<string, string>>, name: string): string | undefined {
  if (help[name]) return help[name];
  const remission = name.match(/^[A-Za-z0-9]+_rem\d+_(\w+)$/);
  if (remission) return help[`remission.${remission[1]}`];
  const perRemesa = name.match(/^[A-Za-z0-9]+_(\w+)$/);
  return perRemesa ? help[`remesa.${perRemesa[1]}`] ?? help[perRemesa[1]] : undefined;
}

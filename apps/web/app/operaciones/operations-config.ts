export type Operation = "loading-order" | "remesa" | "manifest" | "driver-vehicle";

export type Field = {
  path: string;
  label: string;
  code?: string;
  type?: "text" | "number" | "select" | "textarea";
  options?: { value: string; label: string }[];
  span?: number;
  secondary?: boolean;
  required?: boolean;
};

export type FieldSection = {
  title: string;
  description?: string;
  fields: Field[];
  collapsible?: boolean;
  lookup?: boolean;
};

export type OperationConfig = {
  id: Operation;
  label: string;
  title: string;
  action: string;
  processIds: string;
  sections: FieldSection[];
};

export type FormResult = {
  ok: boolean;
  operation: Operation;
  mode: string;
  runDirectory: string;
  evidencePath: string;
  numbers: {
    loadingOrder: string;
    trip: string;
    remesa: string;
    manifest: string;
    plate: string;
    driverId: string;
    ownerId: string;
    holderId: string;
  };
  documents: { kind: string; number: string; urlPath: string; path: string }[];
  steps: {
    name: string;
    title: string;
    procesoId: number;
    accepted: boolean;
    status: number;
    radicado?: string;
    errorText?: string;
    requestPath: string;
    responsePath: string;
  }[];
  convexSync?: { synced: boolean; reason?: string };
};

export const idTypeOptions = [
  { value: "C", label: "Cedula" },
  { value: "N", label: "NIT" },
  { value: "E", label: "Extranjeria" },
  { value: "P", label: "Pasaporte" }
];

export const apiBase = process.env.NEXT_PUBLIC_RNDC_API_URL ?? "http://localhost:3017";

export const initialForm = {
  seed: "421960041464",
  cargoNumber: "000044579",
  tripNumber: "IV42196",
  remesaNumber: "42196",
  manifestNumber: "0041464",
  expeditionDate: "22/06/2026",
  loadingAppointmentDate: "22/06/2026",
  loadingAppointmentTime: "11:02",
  unloadingAppointmentDate: "25/06/2026",
  unloadingAppointmentTime: "12:06",
  balancePaymentDate: "30/06/2026",
  observations: "CARGAMENTO ENTREGADO EN BUEN ESTADO Y COMPLETO",
  driver: {
    idType: "C",
    id: "80756632",
    firstName: "LUIS GERMAN",
    firstLastName: "FONSECA",
    secondLastName: "GUTIERREZ",
    fullName: "FONSECA GUTIERREZ LUIS GERMAN",
    phone: "3118980752",
    address: "CALLE 19 22 - 26",
    cityName: "PAIPA - Boyaca",
    cityCode: "15516000",
    licenseCategory: "C3",
    licenseNumber: "80756632",
    licenseExpirationDate: "23/06/2028"
  },
  vehicleOwner: {
    idType: "C",
    id: "74322799",
    firstName: "GONZALO",
    firstLastName: "FONSECA",
    secondLastName: "",
    fullName: "FONSECA GONZALO",
    phone: "7852586",
    address: "CL 19 22 - 26",
    cityName: "PAIPA - Boyaca",
    cityCode: "15516000"
  },
  vehicleHolder: {
    idType: "C",
    id: "74322799",
    firstName: "GONZALO",
    firstLastName: "FONSECA",
    secondLastName: "",
    fullName: "FONSECA GONZALO",
    phone: "7852586",
    address: "CL 19 22 - 26",
    cityName: "PAIPA - Boyaca",
    cityCode: "15516000"
  },
  sender: {
    idType: "N",
    id: "9002266843",
    siteCode: "0",
    siteName: "LANDAZURI",
    name: "C.I BULKTRADIN - LANDAZURI",
    address: "LANDAZURI",
    cityName: "LANDAZURI",
    cityCode: "68385000",
    latitude: "6.316071",
    longitude: "-73.949992"
  },
  recipient: {
    idType: "N",
    id: "9002266843",
    siteCode: "1",
    siteName: "MINGUEO",
    name: "C.I BULKTRADIN-MINGUEO",
    address: "MINGUEO",
    cityName: "MINGUEO",
    cityCode: "44090003",
    latitude: "11.2171951",
    longitude: "-73.3983323"
  },
  vehicle: {
    plate: "JVK276",
    trailerPlate: "R41537",
    brand: "FREIGHTLINER",
    configuration: "3S2",
    rndcConfigurationCode: "55",
    lineCode: "373",
    colorCode: "1",
    modelYear: "2020",
    emptyWeightKg: 7000,
    capacityKg: 34000,
    soatNumber: "4356454300",
    soatExpirationDate: "23/03/2027",
    insurerNit: "8110191907"
  },
  cargo: {
    productName: "CARBON",
    shortDescription: "CARBON",
    merchandiseCode: "002803",
    packageName: "Granel Solido",
    packageCode: "10",
    nature: "Carga Normal",
    natureCode: "1",
    quantityKg: 34000,
    declaredValue: 40000000
  },
  money: {
    freightValue: 4760000,
    advanceValue: 3808000,
    sourceRetention: 0,
    icaRetention: 0,
    icaRetentionPerMille: 3,
    fopatRetention: 4760
  }
};

export type FormState = typeof initialForm;

export const numberFields: Field[] = [
  { path: "cargoNumber", label: "Orden de cargue", code: "CONSECUTIVOINFORMACIONCARGA", span: 3, required: true },
  { path: "remesaNumber", label: "Remesa", code: "CONSECUTIVOREMESA", span: 3, required: true },
  { path: "tripNumber", label: "Viaje", code: "CONSECUTIVOINFORMACIONVIAJE", span: 3, required: true },
  { path: "manifestNumber", label: "Manifiesto", code: "NUMMANIFIESTOCARGA", span: 3, required: true }
];

export const dateFields: Field[] = [
  { path: "expeditionDate", label: "Fecha expedicion", code: "FECHAEXPEDICIONMANIFIESTO", span: 3 },
  { path: "loadingAppointmentDate", label: "Fecha cita cargue", code: "FECHACITAPACTADACARGUE", span: 3 },
  { path: "loadingAppointmentTime", label: "Hora cita cargue", code: "HORACITAPACTADACARGUE", span: 2 },
  { path: "unloadingAppointmentDate", label: "Fecha cita descargue", code: "FECHACITAPACTADADESCARGUE", span: 3 },
  { path: "unloadingAppointmentTime", label: "Hora cita descargue", code: "HORACITAPACTADADESCARGUEREMESA", span: 2 }
];

export const routeFields: Field[] = [
  { path: "sender.name", label: "Remitente", code: "NUMIDREMITENTE", span: 6, required: true },
  { path: "sender.id", label: "Identificacion remitente", span: 3 },
  { path: "sender.siteCode", label: "Sede remitente", code: "CODSEDEREMITENTE", span: 2 },
  { path: "sender.cityName", label: "Municipio cargue", span: 3 },
  { path: "sender.cityCode", label: "Codigo municipio cargue", code: "CODMUNICIPIOORIGENINFOVIAJE", span: 2, secondary: true },
  { path: "recipient.name", label: "Destinatario", code: "NUMIDDESTINATARIO", span: 6, required: true },
  { path: "recipient.id", label: "Identificacion destinatario", span: 3 },
  { path: "recipient.siteCode", label: "Sede destinatario", code: "CODSEDEDESTINATARIO", span: 2 },
  { path: "recipient.cityName", label: "Municipio descargue", span: 3 },
  { path: "recipient.cityCode", label: "Codigo municipio descargue", code: "CODMUNICIPIODESTINOINFOVIAJE", span: 2, secondary: true }
];

export const cargoFields: Field[] = [
  { path: "cargo.productName", label: "Producto", span: 4, required: true },
  { path: "cargo.shortDescription", label: "Descripcion corta", code: "DESCRIPCIONCORTAPRODUCTO", span: 4 },
  { path: "cargo.merchandiseCode", label: "Codigo mercancia", code: "MERCANCIAINFORMACIONCARGA", span: 2 },
  { path: "cargo.packageName", label: "Empaque" },
  { path: "cargo.packageCode", label: "Codigo empaque", code: "CODTIPOEMPAQUE", span: 2 },
  { path: "cargo.natureCode", label: "Codigo naturaleza", code: "CODNATURALEZACARGA", span: 2 },
  { path: "cargo.quantityKg", label: "Cantidad kg", code: "CANTIDADINFORMACIONCARGA", type: "number", span: 3, required: true },
  { path: "cargo.declaredValue", label: "Valor declarado", type: "number", span: 3 }
];

export const vehicleFields: Field[] = [
  { path: "vehicle.plate", label: "Placa", code: "NUMPLACA", span: 3, required: true },
  { path: "vehicle.trailerPlate", label: "Remolque", code: "NUMPLACAREMOLQUE", span: 3 },
  { path: "vehicle.brand", label: "Marca", span: 3 },
  { path: "vehicle.configuration", label: "Configuracion", span: 3 },
  { path: "vehicle.rndcConfigurationCode", label: "Codigo configuracion", code: "CODCONFIGURACIONUNIDADCARGA", span: 2 },
  { path: "vehicle.modelYear", label: "Modelo", span: 3 },
  { path: "vehicle.capacityKg", label: "Capacidad kg", code: "CAPACIDADUNIDADCARGA", type: "number", span: 3 },
  { path: "vehicle.emptyWeightKg", label: "Peso vacio kg", code: "PESOVEHICULOVACIO", type: "number", span: 3 },
  { path: "vehicle.soatNumber", label: "SOAT", code: "NUMSEGUROSOAT", span: 3 },
  { path: "vehicle.soatExpirationDate", label: "Vence SOAT", code: "FECHAVENCIMIENTOSOAT", span: 3 },
  { path: "vehicle.insurerNit", label: "NIT aseguradora", code: "NUMNITASEGURADORASOAT", span: 3 }
];

export const driverFields: Field[] = [
  { path: "driver.idType", label: "Tipo ID conductor", code: "CODIDCONDUCTOR", type: "select", options: idTypeOptions, span: 2 },
  { path: "driver.id", label: "ID conductor", code: "NUMIDCONDUCTOR", span: 3, required: true },
  { path: "driver.firstName", label: "Nombres", code: "NOMIDTERCERO", span: 4 },
  { path: "driver.firstLastName", label: "Primer apellido", code: "PRIMERAPELLIDOIDTERCERO", span: 4 },
  { path: "driver.secondLastName", label: "Segundo apellido", span: 3 },
  { path: "driver.fullName", label: "Nombre impreso", span: 6 },
  { path: "driver.phone", label: "Telefono", span: 3 },
  { path: "driver.cityCode", label: "Codigo municipio", span: 3 },
  { path: "driver.licenseCategory", label: "Categoria licencia", code: "CODCATEGORIALICENCIACONDUCCION", span: 3 },
  { path: "driver.licenseNumber", label: "Numero licencia", code: "NUMLICENCIACONDUCCION", span: 3 },
  { path: "driver.licenseExpirationDate", label: "Vence licencia", code: "FECHAVENCIMIENTOLICENCIA", span: 3 }
];

export const ownerFields: Field[] = [
  { path: "vehicleOwner.idType", label: "Tipo ID propietario", code: "CODTIPOIDPROPIETARIO", type: "select", options: idTypeOptions, span: 2 },
  { path: "vehicleOwner.id", label: "ID propietario", code: "NUMIDPROPIETARIO", span: 3 },
  { path: "vehicleOwner.firstName", label: "Nombres", span: 4 },
  { path: "vehicleOwner.firstLastName", label: "Primer apellido", span: 3 },
  { path: "vehicleOwner.fullName", label: "Nombre impreso", span: 6 },
  { path: "vehicleOwner.phone", label: "Telefono", span: 3 },
  { path: "vehicleOwner.cityCode", label: "Codigo municipio", span: 3 }
];

export const holderFields: Field[] = [
  { path: "vehicleHolder.idType", label: "Tipo ID tenedor", code: "CODTIPOIDTENEDOR", type: "select", options: idTypeOptions, span: 2 },
  { path: "vehicleHolder.id", label: "ID tenedor", code: "NUMIDTENEDOR", span: 3 },
  { path: "vehicleHolder.firstName", label: "Nombres", span: 4 },
  { path: "vehicleHolder.firstLastName", label: "Primer apellido", span: 3 },
  { path: "vehicleHolder.fullName", label: "Titular manifiesto", code: "NUMIDTITULARMANIFIESTO", span: 6 },
  { path: "vehicleHolder.phone", label: "Telefono", span: 3 },
  { path: "vehicleHolder.cityCode", label: "Codigo municipio", span: 3 }
];

export const moneyFields: Field[] = [
  { path: "money.freightValue", label: "Flete pactado", code: "VALORFLETEPACTADOVIAJE", type: "number", span: 3, required: true },
  { path: "money.advanceValue", label: "Anticipo", code: "VALORANTICIPOMANIFIESTO", type: "number", span: 3, required: true },
  { path: "money.sourceRetention", label: "Retencion fuente ($)", type: "number", span: 3 },
  { path: "money.icaRetention", label: "Retencion ICA ($)", type: "number", span: 3 },
  { path: "money.icaRetentionPerMille", label: "Retencion ICA (por mil)", code: "RETENCIONICAMANIFIESTOCARGA", type: "number", span: 3 },
  { path: "money.fopatRetention", label: "Retencion FOPAT", code: "RETENCIONFOPAT", type: "number", span: 3 },
  { path: "balancePaymentDate", label: "Fecha pago saldo", code: "FECHAPAGOSALDOMANIFIESTO", span: 3 }
];

const allFields: Field[] = [
  ...numberFields,
  ...dateFields,
  ...routeFields,
  ...cargoFields,
  ...vehicleFields,
  ...driverFields,
  ...ownerFields,
  ...holderFields,
  ...moneyFields
];

export function field(path: string): Field {
  const found = allFields.find((item) => item.path === path);

  if (!found) {
    throw new Error(`Unknown form field: ${path}`);
  }

  return found;
}

export const observationsField: Field = { path: "observations", label: "Observaciones", code: "OBSERVACIONES", type: "textarea" };

export const operations: OperationConfig[] = [
  {
    id: "loading-order",
    label: "Orden",
    title: "Orden de cargue",
    action: "Registrar orden",
    processIds: "Proceso 1",
    sections: [
      { title: "Documento", description: "Numeros y fechas del documento", fields: [field("cargoNumber"), ...dateFields] },
      { title: "Carga", description: "Que se transporta", fields: cargoFields },
      { title: "Ruta", description: "Origen, destino y partes", fields: routeFields },
      { title: "Vehiculo y conductor", description: "Selecciona placa y conductor desde maestros", fields: [field("vehicle.plate"), field("vehicle.trailerPlate"), field("vehicle.brand"), field("vehicle.modelYear"), field("driver.id"), field("driver.fullName"), field("driver.phone")], lookup: true },
      { title: "Observaciones", description: "Texto libre impreso en el documento", fields: [observationsField] }
    ]
  },
  {
    id: "remesa",
    label: "Remesa",
    title: "Remesa terrestre de carga",
    action: "Expedir remesa",
    processIds: "Proceso 3",
    sections: [
      { title: "Documento", description: "Numeros y fechas del documento", fields: [field("remesaNumber"), field("cargoNumber"), field("loadingAppointmentDate"), field("loadingAppointmentTime"), field("unloadingAppointmentDate"), field("unloadingAppointmentTime")] },
      { title: "Carga y seguro", description: "Que se transporta y como se asegura", fields: [...cargoFields, field("vehicle.soatNumber"), field("vehicle.soatExpirationDate"), field("vehicle.insurerNit")] },
      { title: "Remitente y destinatario", description: "Origen, destino y partes", fields: routeFields, collapsible: true },
      { title: "Observaciones", description: "Texto libre impreso en el documento", fields: [observationsField] }
    ]
  },
  {
    id: "manifest",
    label: "Manifiesto",
    title: "Manifiesto de carga",
    action: "Expedir manifiesto",
    processIds: "Procesos 2 y 4",
    sections: [
      { title: "Documento", description: "Numeros y fechas del documento", fields: [field("manifestNumber"), field("tripNumber"), field("remesaNumber"), field("cargoNumber"), field("expeditionDate"), field("balancePaymentDate")] },
      { title: "Vehiculo y conductor", description: "Selecciona placa y conductor desde maestros", fields: [field("vehicle.plate"), field("vehicle.trailerPlate"), field("vehicle.brand"), field("vehicle.configuration"), field("vehicle.rndcConfigurationCode"), field("driver.idType"), field("driver.id"), field("driver.fullName"), field("vehicleHolder.idType"), field("vehicleHolder.id"), field("vehicleHolder.fullName")], lookup: true },
      { title: "Ruta y valores", description: "Origen, destino y valores del manifiesto", fields: [field("sender.cityName"), field("sender.cityCode"), field("recipient.cityName"), field("recipient.cityCode"), field("money.freightValue"), field("money.advanceValue"), field("money.sourceRetention"), field("money.icaRetention"), field("money.icaRetentionPerMille"), field("money.fopatRetention")] },
      { title: "Observaciones", description: "Texto libre impreso en el documento", fields: [observationsField] }
    ]
  },
  {
    id: "driver-vehicle",
    label: "Registro",
    title: "Conductor y vehiculo",
    action: "Registrar conductor y vehiculo",
    processIds: "Procesos 11 y 12",
    sections: [
      { title: "Conductor", description: "Datos del conductor y su licencia", fields: driverFields },
      { title: "Propietario", description: "Datos del propietario del vehiculo", fields: ownerFields },
      { title: "Tenedor", description: "Datos del tenedor o titular del manifiesto", fields: holderFields },
      { title: "Vehiculo", description: "Datos tecnicos y seguros del vehiculo", fields: vehicleFields }
    ]
  }
];

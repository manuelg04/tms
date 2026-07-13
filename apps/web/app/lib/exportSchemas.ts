export type ExportKind = "dispatches" | "orders" | "consignments" | "manifests";
export type ExportRole = "admin" | "operator" | "auditor";
export type ExportCell = string | number | boolean | Date | null | undefined;
export type ExportRow = Record<string, ExportCell>;

export type DispatchExportRecord = {
  dispatchCode: string;
  updatedAt: number;
  customerName: string;
  originCity: string;
  destinationCity: string;
  agencyCode?: string;
  order?: {
    number?: string;
    issuedAt?: string;
    vehiclePlate?: string;
    agencyCity?: string;
    senderName?: string;
    cargoDescription?: string;
    localStatus?: string;
    printStatus?: string;
    createdAt?: string;
    annulledAt?: string;
  };
  consignments: Array<{
    number?: string;
    reference?: string;
    rndcNumber?: string;
    orderNumber?: string;
    pickupAppointment?: string;
    deliveryAppointment?: string;
    quantity?: string;
    weightKg?: string;
    declaredValue?: string;
    insurancePolicy?: string;
    localStatus?: string;
    printStatus?: string;
    loadingRadicado?: string;
    unloadingRadicado?: string;
    driverDocument?: string;
    driverPhone?: string;
  }>;
  manifest?: {
    internalNumber?: string;
    rndcNumber?: string;
    type?: string;
    issuedAt?: string;
    dueAt?: string;
    route?: string;
    originCode?: string;
    destinationCode?: string;
    vehiclePlate?: string;
    trailerPlate?: string;
    consignmentNumbers: string[];
    freight?: string;
    advance?: string;
    netPay?: string;
    localStatus?: string;
    printStatus?: string;
    filingNumber?: string;
    annulmentNumber?: string;
    fulfillmentNumber?: string;
    driverDocument?: string;
    driverPhone?: string;
    driverLicense?: string;
    vehicleSoat?: string;
  };
};

export function buildExportRows(kind: ExportKind, records: readonly DispatchExportRecord[], role: ExportRole): ExportRow[] {
  const ordered = [...records];

  if (kind === "orders") {
    return ordered.flatMap((record) => record.order ? [{
      "Expediente": record.dispatchCode,
      "Número orden": record.order.number ?? "",
      "Fecha orden": record.order.issuedAt ?? "",
      "Placa": record.order.vehiclePlate ?? "",
      "Agencia": record.agencyCode ?? "",
      "Ciudad agencia": record.order.agencyCity ?? "",
      "Origen": record.originCity,
      "Destino": record.destinationCity,
      "Remitente": record.order.senderName ?? "",
      "Mercancía": record.order.cargoDescription ?? "",
      "Estado local": record.order.localStatus ?? "",
      "Impresión": record.order.printStatus ?? "",
      "Creación": record.order.createdAt ?? "",
      "Anulación": record.order.annulledAt ?? ""
    }] : []);
  }

  if (kind === "consignments") {
    return ordered.flatMap((record) => record.consignments.map((consignment) => ({
      "Expediente": record.dispatchCode,
      "Número remesa": consignment.number ?? "",
      "Remisión": consignment.reference ?? "",
      "Número RNDC": consignment.rndcNumber ?? "",
      "Orden": consignment.orderNumber ?? "",
      "Cita cargue": consignment.pickupAppointment ?? "",
      "Cita descargue": consignment.deliveryAppointment ?? "",
      "Cantidad": consignment.quantity ?? "",
      "Peso kg": consignment.weightKg ?? "",
      "Valor declarado": consignment.declaredValue ?? "",
      "Póliza": consignment.insurancePolicy ?? "",
      "Estado local": consignment.localStatus ?? "",
      "Impresión": consignment.printStatus ?? "",
      "Radicado cargue": consignment.loadingRadicado ?? "",
      "Radicado descargue": consignment.unloadingRadicado ?? "",
      ...personalCells(role, {
        "Documento conductor": consignment.driverDocument,
        "Teléfono conductor": consignment.driverPhone
      })
    })));
  }

  if (kind === "manifests") {
    return ordered.flatMap((record) => record.manifest ? [{
      "Expediente": record.dispatchCode,
      "Número interno": record.manifest.internalNumber ?? "",
      "Número RNDC": record.manifest.rndcNumber ?? "",
      "Tipo": record.manifest.type ?? "",
      "Expedición": record.manifest.issuedAt ?? "",
      "Fecha límite": record.manifest.dueAt ?? "",
      "Agencia": record.agencyCode ?? "",
      "Ruta": record.manifest.route ?? "",
      "DANE origen": record.manifest.originCode ?? "",
      "DANE destino": record.manifest.destinationCode ?? "",
      "Placa": record.manifest.vehiclePlate ?? "",
      "Remolque": record.manifest.trailerPlate ?? "",
      "Remesas": record.manifest.consignmentNumbers.join(", "),
      "Flete": record.manifest.freight ?? "",
      "Anticipo": record.manifest.advance ?? "",
      "Neto a pagar": record.manifest.netPay ?? "",
      "Estado local": record.manifest.localStatus ?? "",
      "Impresión": record.manifest.printStatus ?? "",
      "Radicación": record.manifest.filingNumber ?? "",
      "Anulación": record.manifest.annulmentNumber ?? "",
      "Cumplimiento": record.manifest.fulfillmentNumber ?? "",
      ...personalCells(role, {
        "Documento conductor": record.manifest.driverDocument,
        "Teléfono conductor": record.manifest.driverPhone,
        "Licencia conductor": record.manifest.driverLicense,
        "SOAT vehículo": record.manifest.vehicleSoat
      })
    }] : []);
  }

  return ordered.map((record) => ({
    "Expediente": record.dispatchCode,
    "Actualizado": new Date(record.updatedAt),
    "Cliente": record.customerName,
    "Origen": record.originCity,
    "Destino": record.destinationCity,
    "Agencia": record.agencyCode ?? "",
    "Orden": record.order?.number ?? "",
    "Remesas": record.consignments.map((item) => item.number).filter(Boolean).join(", "),
    "Manifiesto": record.manifest?.internalNumber ?? "",
    "Placa": record.manifest?.vehiclePlate ?? record.order?.vehiclePlate ?? "",
    "Estado": record.manifest?.localStatus ?? record.order?.localStatus ?? ""
  }));
}

export function maskIdentifier(value: string): string {
  if (!value) {
    return "";
  }

  if (value.length <= 4) {
    return "*".repeat(value.length);
  }

  return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
}

function personalCells(role: ExportRole, cells: Record<string, string | undefined>): ExportRow {
  if (role === "operator") {
    return {};
  }

  return Object.fromEntries(Object.entries(cells).map(([key, value]) => [
    key,
    role === "auditor" ? maskIdentifier(value ?? "") : value ?? ""
  ]));
}

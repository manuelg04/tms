export type LogisticsMoment = { date: string; time: string };

export type InitialComplianceRecord = {
  id: string;
  registeredAt?: string;
  loadingArrival?: LogisticsMoment;
  loadingExit?: LogisticsMoment;
  unloadingArrival?: LogisticsMoment;
  unloadingExit?: LogisticsMoment;
};

export type RemesaMonitoring = {
  remesaId: string;
  number?: string;
  status: "found" | "empty" | "unavailable" | "not_issued";
  record?: InitialComplianceRecord;
};

export function readInitialCompliance(body: unknown): InitialComplianceRecord | undefined {
  if (!isRecord(body) || !Array.isArray(body.records)) {
    return undefined;
  }

  const first = body.records.find(isRecord);

  if (!first || typeof first.id !== "string") {
    return undefined;
  }

  return {
    id: first.id,
    registeredAt: typeof first.registeredAt === "string" ? first.registeredAt : undefined,
    loadingArrival: moment(first.loadingArrival),
    loadingExit: moment(first.loadingExit),
    unloadingArrival: moment(first.unloadingArrival),
    unloadingExit: moment(first.unloadingExit)
  };
}

export function monitoringSummary(monitoring: RemesaMonitoring | undefined, mode: string | undefined): string {
  if (!monitoring) {
    return "Consultando el monitoreo en el RNDC…";
  }

  if (monitoring.status === "unavailable") {
    return "No fue posible consultar el RNDC. Puedes continuar; el RNDC validará el monitoreo al recibir el cumplido.";
  }

  if (monitoring.status === "not_issued") {
    return "La remesa aún no tiene número oficial.";
  }

  if (monitoring.status === "empty") {
    return mode === "dry-run"
      ? "Modo de prueba: no se consulta el monitoreo real."
      : "El RNDC aún no tiene cumplido inicial para esta remesa. Sin monitoreo reportado puede rechazar el cumplido.";
  }

  const record = monitoring.record;

  if (record && (!record.unloadingArrival || !record.unloadingExit)) {
    return "La empresa de monitoreo aún no ha reportado el descargue. Sin ese registro el RNDC puede rechazar el cumplido.";
  }

  return "Tiempos reportados por la empresa de monitoreo. No se digitan aquí.";
}

function moment(value: unknown): LogisticsMoment | undefined {
  return isRecord(value) && typeof value.date === "string" && typeof value.time === "string"
    ? { date: value.date, time: value.time }
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

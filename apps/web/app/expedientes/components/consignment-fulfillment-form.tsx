import { useEffect, useState } from "react";
import { FormField, ValidatedForm } from "../../components/fields/form-validation";
import { bogotaLocalInput } from "../../../convex/model/monitoring";
import { monitoringSummary, type LogisticsMoment, type RemesaMonitoring } from "../../lib/remesa-monitoring";

type Remesa = {
  _id: string;
  sequence: number;
  number?: string;
  cargoDescription: string;
  cargoWeightKg?: number;
  fulfillmentState: string;
  fulfillmentDraft?: {
    deliveredQuantity?: string;
    missingQuantity?: string;
    surplusQuantity?: string;
    returnedQuantity?: string;
    unit?: string;
    observation?: string;
    loadingEntryAt?: number;
    unloadingEntryAt?: number;
  };
};

type MonitoringState = { mode?: string; byRemesa: Record<string, RemesaMonitoring>; loaded: boolean };

export function ConsignmentFulfillmentForm({ expedienteId, onSubmit, remesas }: { expedienteId: string; onSubmit: (data: FormData) => void | Promise<void>; remesas: Remesa[] }) {
  const monitoring = useRemesaMonitoring(expedienteId);
  const latest = bogotaLocalInput(Date.now());
  return (
    <ValidatedForm id="stage-primary-form" onSubmit={(event) => { return onSubmit(new FormData(event.currentTarget)); }}>
      <div className="stage-form-heading"><span>06</span><div><h3 id="active-stage-title" tabIndex={-1}>Cumplido inicial</h3><p>Registra la cantidad entregada y la hora real de entrada al cargue y al descargue. Las llegadas y salidas las reporta la empresa de monitoreo. El manifiesto permanecerá abierto.</p></div></div>
      <div className="fulfillment-remesas">
        {remesas.map((remesa) => (
          <fieldset className={remesa.fulfillmentState === "fulfilled" ? "fulfillment-card complete" : "fulfillment-card"} disabled={remesa.fulfillmentState === "fulfilled"} key={remesa._id}>
            <legend>Remesa {remesa.number ?? remesa.sequence}</legend>
            <p>{remesa.cargoDescription} · {remesa.cargoWeightKg ? `${remesa.cargoWeightKg.toLocaleString("es-CO")} kg cargados` : "Peso por confirmar"}</p>
            <input name="remesaId" type="hidden" value={remesa._id} />
            <div className="fulfillment-quantities">
              <Quantity label="Entregada (kg)" name={`${remesa._id}_delivered`} required value={remesa.fulfillmentDraft?.deliveredQuantity ?? String(remesa.cargoWeightKg ?? "")} />
              <Quantity label="Faltante" name={`${remesa._id}_missing`} value={remesa.fulfillmentDraft?.missingQuantity ?? "0"} />
              <Quantity label="Sobrante" name={`${remesa._id}_surplus`} value={remesa.fulfillmentDraft?.surplusQuantity ?? "0"} />
              <Quantity label="Devuelta" name={`${remesa._id}_returned`} value={remesa.fulfillmentDraft?.returnedQuantity ?? "0"} />
            </div>
            <div className="field-group-note"><strong>Entradas</strong><small>Hora real, la reporta la empresa de transporte</small></div>
            <Moment label="Entrada al cargue" max={latest} name={`${remesa._id}_loadingEntryAt`} value={remesa.fulfillmentDraft?.loadingEntryAt} />
            <Moment label="Entrada al descargue" max={latest} name={`${remesa._id}_unloadingEntryAt`} value={remesa.fulfillmentDraft?.unloadingEntryAt} />
            <MonitoringPanel loaded={monitoring.loaded} mode={monitoring.mode} monitoring={monitoring.byRemesa[remesa._id]} />
            <FormField><span>Observaciones de entrega</span><textarea defaultValue={remesa.fulfillmentDraft?.observation} name={`${remesa._id}_observation`} rows={2} /></FormField>
            {remesa.fulfillmentState === "fulfilled" ? <span className="fulfilled-lock">✓ Cumplida · Sólo lectura</span> : null}
          </fieldset>
        ))}
      </div>
    </ValidatedForm>
  );
}

export function ManifestFulfillmentForm({ defaultDate, defaultObservation, onSubmit }: { defaultDate?: string; defaultObservation?: string; onSubmit: (data: FormData) => void | Promise<void> }) {
  return (
    <ValidatedForm id="stage-primary-form" onSubmit={(event) => { return onSubmit(new FormData(event.currentTarget)); }}>
      <div className="stage-form-heading"><span>07</span><div><h3 id="active-stage-title" tabIndex={-1}>Cumplido final</h3><p>Todas las remesas están cumplidas. Revisa la entrega de documentos y cierra el manifiesto.</p></div></div>
      <div className="manifest-fulfillment-card">
        <FormField><span>Fecha de entrega de documentos</span><input defaultValue={defaultDate} name="documentsDeliveryDate" required type="date" /></FormField>
        <FormField><span>Observaciones del cierre</span><textarea defaultValue={defaultObservation} name="observation" rows={4} /></FormField>
      </div>
    </ValidatedForm>
  );
}

function Moment({ label, max, name, value }: { label: string; max: string; name: string; value?: number }) {
  return <FormField><span>{label}</span><input defaultValue={value === undefined ? "" : bogotaLocalInput(value)} max={max} name={name} required type="datetime-local" /></FormField>;
}

function MonitoringPanel({ loaded, mode, monitoring }: { loaded: boolean; mode?: string; monitoring?: RemesaMonitoring }) {
  const record = monitoring?.record;
  const summary = loaded && !monitoring ? "No fue posible consultar el RNDC. Puedes continuar; el RNDC validará el monitoreo al recibir el cumplido." : monitoringSummary(monitoring, mode);
  return (
    <div className="monitoring-panel" role="status">
      <div className="field-group-note"><strong>Monitoreo en el RNDC</strong><small>Solo lectura</small></div>
      {record ? (
        <dl className="monitoring-times">
          <MonitoringTime label="Llegada al cargue" value={record.loadingArrival} />
          <MonitoringTime label="Salida del cargue" value={record.loadingExit} />
          <MonitoringTime label="Llegada al descargue" value={record.unloadingArrival} />
          <MonitoringTime label="Salida del descargue" value={record.unloadingExit} />
        </dl>
      ) : null}
      <p>{summary}{record ? ` Cumplido inicial ${record.id}.` : ""}</p>
    </div>
  );
}

function MonitoringTime({ label, value }: { label: string; value?: LogisticsMoment }) {
  return <div><dt>{label}</dt><dd className={value ? undefined : "pending"}>{value ? `${value.date} ${value.time}` : "Sin reportar"}</dd></div>;
}

function useRemesaMonitoring(expedienteId: string): MonitoringState {
  const [state, setState] = useState<MonitoringState>({ byRemesa: {}, loaded: false });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/rndc/dispatches/${expedienteId}/monitoring`, { signal: controller.signal })
      .then(async (response) => (response.ok ? ((await response.json()) as { mode?: string; remesas?: RemesaMonitoring[] }) : null))
      .then((body) => {
        setState({
          mode: body?.mode,
          byRemesa: Object.fromEntries((body?.remesas ?? []).map((item) => [item.remesaId, item])),
          loaded: true
        });
      })
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setState({ byRemesa: {}, loaded: true });
      });
    return () => controller.abort();
  }, [expedienteId]);

  return state;
}

function Quantity({ label, name, required = false, value }: { label: string; name: string; required?: boolean; value: string }) {
  return <FormField><span>{label}</span><input defaultValue={value} min="0" name={name} required={required} step="0.01" type="number" /></FormField>;
}

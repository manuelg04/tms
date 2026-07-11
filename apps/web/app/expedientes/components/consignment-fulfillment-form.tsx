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
  };
};

export function ConsignmentFulfillmentForm({ onSubmit, remesas }: { onSubmit: (data: FormData) => void; remesas: Remesa[] }) {
  return (
    <form id="stage-primary-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
      <div className="stage-form-heading"><span>07</span><div><h3 id="active-stage-title" tabIndex={-1}>Cumplido inicial</h3><p>Confirma las cantidades reales de cada remesa. El manifiesto permanecerá abierto.</p></div></div>
      <div className="fulfillment-remesas">
        {remesas.map((remesa) => (
          <fieldset className={remesa.fulfillmentState === "fulfilled" ? "fulfillment-card complete" : "fulfillment-card"} disabled={remesa.fulfillmentState === "fulfilled"} key={remesa._id}>
            <legend>Remesa {remesa.number ?? remesa.sequence}</legend>
            <p>{remesa.cargoDescription} · {remesa.cargoWeightKg ? `${remesa.cargoWeightKg} kg` : "Peso por confirmar"}</p>
            <input name="remesaId" type="hidden" value={remesa._id} />
            <div className="fulfillment-quantities">
              <Quantity label="Entregada" name={`${remesa._id}_delivered`} required value={remesa.fulfillmentDraft?.deliveredQuantity ?? String(remesa.cargoWeightKg ?? "")} />
              <Quantity label="Faltante" name={`${remesa._id}_missing`} value={remesa.fulfillmentDraft?.missingQuantity ?? "0"} />
              <Quantity label="Sobrante" name={`${remesa._id}_surplus`} value={remesa.fulfillmentDraft?.surplusQuantity ?? "0"} />
              <Quantity label="Devuelta" name={`${remesa._id}_returned`} value={remesa.fulfillmentDraft?.returnedQuantity ?? "0"} />
            </div>
            <label className="form-field"><span>Observaciones de entrega</span><textarea defaultValue={remesa.fulfillmentDraft?.observation} name={`${remesa._id}_observation`} rows={2} /></label>
            {remesa.fulfillmentState === "fulfilled" ? <span className="fulfilled-lock">✓ Cumplida · Sólo lectura</span> : null}
          </fieldset>
        ))}
      </div>
    </form>
  );
}

export function ManifestFulfillmentForm({ defaultDate, defaultObservation, onSubmit }: { defaultDate?: string; defaultObservation?: string; onSubmit: (data: FormData) => void }) {
  return (
    <form id="stage-primary-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
      <div className="stage-form-heading"><span>08</span><div><h3 id="active-stage-title" tabIndex={-1}>Cumplido final</h3><p>Todas las remesas están cumplidas. Revisa la entrega de documentos y cierra el manifiesto.</p></div></div>
      <div className="manifest-fulfillment-card">
        <label className="form-field"><span>Fecha de entrega de documentos</span><input defaultValue={defaultDate} name="documentsDeliveryDate" required type="date" /></label>
        <label className="form-field"><span>Observaciones del cierre</span><textarea defaultValue={defaultObservation} name="observation" rows={4} /></label>
      </div>
    </form>
  );
}

function Quantity({ label, name, required = false, value }: { label: string; name: string; required?: boolean; value: string }) {
  return <label className="form-field"><span>{label}</span><input defaultValue={value} min="0" name={name} required={required} step="0.01" type="number" /></label>;
}

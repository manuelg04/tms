type SavedEvent = { occurredAt: number; observation?: string } | undefined;
type SavedSite = { arrival?: SavedEvent; entry?: SavedEvent; start?: SavedEvent; end?: SavedEvent; exit?: SavedEvent } | undefined;

const events = [
  { key: "arrival", label: "Llegada" },
  { key: "entry", label: "Entrada" },
  { key: "start", label: "Inicio" },
  { key: "end", label: "Fin" },
  { key: "exit", label: "Salida" }
] as const;

export function LogisticsTimesForm({ destination, finalDelivery, origin, onSubmit }: { destination: SavedSite; finalDelivery: SavedEvent; origin: SavedSite; onSubmit: (data: FormData) => void }) {
  return (
    <form id="stage-primary-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
      <StageIntro number="06" title="Cargue y descargue" text="Registra los hechos reales. Estos tiempos son manuales y no dependen de GPS." />
      <div className="logistics-sites">
        <SiteTimes prefix="origin" title="Origen · Cargue" values={origin} />
        <SiteTimes prefix="destination" title="Destino · Descargue" values={destination} />
      </div>
      <div className="final-delivery-row">
        <label className="form-field"><span>Entrega o llegada final</span><input defaultValue={toInputValue(finalDelivery?.occurredAt)} name="finalDelivery" required type="datetime-local" /></label>
        <label className="form-field"><span>Observación final</span><input defaultValue={finalDelivery?.observation} name="finalDeliveryObservation" /></label>
      </div>
    </form>
  );
}

function SiteTimes({ prefix, title, values }: { prefix: string; title: string; values: SavedSite }) {
  return (
    <fieldset className="logistics-site-card">
      <legend>{title}</legend>
      {events.map((event) => (
        <div className="logistics-event" key={event.key}>
          <label className="form-field"><span>{event.label}</span><input defaultValue={toInputValue(values?.[event.key]?.occurredAt)} name={`${prefix}_${event.key}`} required type="datetime-local" /></label>
          <label className="form-field observation"><span>Observación</span><input defaultValue={values?.[event.key]?.observation} name={`${prefix}_${event.key}_observation`} /></label>
        </div>
      ))}
    </fieldset>
  );
}

function StageIntro({ number, text, title }: { number: string; text: string; title: string }) {
  return <div className="stage-form-heading"><span>{number}</span><div><h3 id="active-stage-title" tabIndex={-1}>{title}</h3><p>{text}</p></div></div>;
}

function toInputValue(value: number | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

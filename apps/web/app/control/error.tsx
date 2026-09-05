"use client";

export default function TrackingError({ reset }: { reset: () => void }) {
  return (
    <section className="panel tracking-error" role="alert">
      <h2>No se pudo cargar el seguimiento</h2>
      <p>Comprueba tu conexión y vuelve a intentarlo.</p>
      <button className="primary-action" type="button" onClick={reset}>
        Volver a intentar
      </button>
    </section>
  );
}

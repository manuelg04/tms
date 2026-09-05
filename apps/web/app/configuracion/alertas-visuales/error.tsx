"use client";

export default function AlarmError({ reset }: { reset: () => void }) {
  return (
    <section className="panel tracking-error" role="alert">
      <h2>No se pudieron cargar las alertas visuales</h2>
      <p>Comprueba la conexión e inténtalo de nuevo.</p>
      <button className="primary-action" type="button" onClick={reset}>
        Reintentar
      </button>
    </section>
  );
}

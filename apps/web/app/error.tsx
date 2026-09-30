"use client";

import Link from "next/link";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const sessionExpired = /UNAUTHORIZED|UNAUTHENTICATED|sesi[oó]n/i.test(error.message);
  return (
    <section className="panel app-error" role="alert">
      <h2>{sessionExpired ? "Tu sesión expiró" : "No se pudo cargar esta pantalla"}</h2>
      <p>{sessionExpired ? "Vuelve a ingresar para continuar. Lo que ya guardaste no se pierde." : "Revisa tu conexión y vuelve a intentarlo. Si el problema sigue, avisa al administrador."}</p>
      <div className="app-error-actions">
        {sessionExpired ? <Link className="primary-action action-link" href="/login">Ingresar de nuevo</Link> : <button className="primary-action" onClick={reset} type="button">Volver a intentar</button>}
        <Link className="ghost-button action-link" href="/expedientes">Ir a Despachos</Link>
      </div>
    </section>
  );
}

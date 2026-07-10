"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  return (
    <Suspense fallback={<section className="login-card"><div className="skeleton">Preparando acceso…</div></section>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("operador@mtm.local");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const body = await response.json() as { error?: string };

      if (!response.ok) {
        setError(body.error ?? "No fue posible iniciar sesion");
        return;
      }

      const next = searchParams.get("next");
      window.location.assign(next?.startsWith("/") && !next.startsWith("//") ? next : "/expedientes");
    } catch {
      setError("No fue posible conectar con el servicio de autenticacion");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="login-card" aria-labelledby="login-title">
      <div className="login-brand">
        <span className="brand-plate">MTM</span>
        <div>
          <strong>TMS RNDC</strong>
          <span>Operacion de transporte</span>
        </div>
      </div>
      <div className="login-copy">
        <span className="eyebrow">Acceso protegido</span>
        <h1 id="login-title">Bienvenido de nuevo</h1>
        <p>Ingresa con uno de los usuarios locales configurados para esta etapa.</p>
      </div>
      <form className="login-form" onSubmit={submit}>
        <label>
          <span>Correo</span>
          <input
            autoComplete="username"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>
        <label>
          <span>Contrasena</span>
          <input
            autoComplete="current-password"
            autoFocus
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        {error ? <div className="login-error" role="alert">{error}</div> : null}
        <button className="primary-action login-submit" disabled={submitting} type="submit">
          {submitting ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
      <p className="login-note">Este acceso es local y el envio real al RNDC permanece bloqueado.</p>
    </section>
  );
}

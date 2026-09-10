"use client";

import { useState, type FormEvent } from "react";
import "../../control/tracking.css";

export default function OwnPasswordPage() {
  const [values, setValues] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (values.newPassword !== values.confirm) {
      setError("La confirmación no coincide con la nueva contraseña");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: values.currentPassword, newPassword: values.newPassword })
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "No fue posible cambiar la contraseña");
        return;
      }
      setValues({ currentPassword: "", newPassword: "", confirm: "" });
      setMessage("Contraseña actualizada. Úsala en tu próximo ingreso.");
    } catch {
      setError("No fue posible conectar con el servidor");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tracking-workspace">
      <div className="tracking-heading">
        <div>
          <span className="eyebrow">Configuración</span>
          <h2>Mi contraseña</h2>
          <p>Cambia la contraseña con la que ingresas al sistema</p>
        </div>
      </div>
      {message ? <p className="tracking-message success" role="status">{message}</p> : null}
      <section className="panel alarm-form">
        <form onSubmit={(event) => void submit(event)}>
          <fieldset disabled={busy}>
            <legend className="sr-only">Cambio de contraseña</legend>
            <div className="tracking-form-grid">
              <label>
                <span>Contraseña actual</span>
                <input required type="password" autoComplete="current-password" value={values.currentPassword} onChange={(e) => setValues({ ...values, currentPassword: e.target.value })} />
              </label>
              <label>
                <span>Nueva contraseña</span>
                <input required type="password" autoComplete="new-password" minLength={10} value={values.newPassword} onChange={(e) => setValues({ ...values, newPassword: e.target.value })} />
              </label>
              <label>
                <span>Confirmar nueva contraseña</span>
                <input required type="password" autoComplete="new-password" minLength={10} value={values.confirm} onChange={(e) => setValues({ ...values, confirm: e.target.value })} />
              </label>
            </div>
            <p className="login-note">Mínimo 10 caracteres combinando letras y números.</p>
            {error ? <p role="alert" className="tracking-message error">{error}</p> : null}
            <div className="tracking-form-actions">
              <button type="submit" className="primary-action">{busy ? "Guardando…" : "Cambiar contraseña"}</button>
            </div>
          </fieldset>
        </form>
      </section>
    </div>
  );
}

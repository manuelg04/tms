"use client";

import { useState, type FormEvent } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { jobTitleLabels, jobTitles, type JobTitle } from "../../../convex/model/userAccounts";
import { convexErrorMessage } from "../../lib/convex-error";
import "../../control/tracking.css";

type Account = {
  _id: Id<"users">;
  name: string;
  email: string;
  jobTitle?: JobTitle;
  roles: string[];
  status: "active" | "disabled";
  hasPassword: boolean;
  passwordUpdatedAt?: number;
};

export default function UsersPage() {
  const { isAuthenticated } = useConvexAuth();
  const data = useQuery(api.userAccounts.list, isAuthenticated ? {} : "skip");
  const update = useMutation(api.userAccounts.update);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<Account | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  if (!data) {
    return <div className="skeleton" role="status">Cargando usuarios…</div>;
  }

  if (!data.canView) {
    return (
      <div className="tracking-workspace">
        <div className="tracking-heading">
          <div>
            <span className="eyebrow">Configuración</span>
            <h2>Usuarios</h2>
            <p>Solo el administrador de la empresa gestiona las cuentas de acceso.</p>
          </div>
        </div>
      </div>
    );
  }

  async function toggleStatus(account: Account) {
    setError("");
    setMessage("");
    try {
      await update({ userId: account._id, status: account.status === "active" ? "disabled" : "active" });
      setMessage(account.status === "active" ? `Acceso de ${account.name} desactivado.` : `Acceso de ${account.name} reactivado.`);
    } catch (reason) {
      setError(convexErrorMessage(reason, "No fue posible actualizar el usuario"));
    }
  }

  async function changeJobTitle(account: Account, jobTitle: JobTitle) {
    setError("");
    setMessage("");
    try {
      await update({ userId: account._id, jobTitle });
      setMessage(`${account.name} ahora es ${jobTitleLabels[jobTitle].toLowerCase()}.`);
    } catch (reason) {
      setError(convexErrorMessage(reason, "No fue posible cambiar el cargo"));
    }
  }

  return (
    <div className="tracking-workspace">
      <div className="tracking-heading">
        <div>
          <span className="eyebrow">Configuración</span>
          <h2>Usuarios</h2>
          <p>Quién puede entrar al sistema y con qué cargo</p>
        </div>
        {data.canManage ? (
          <button type="button" className="primary-action" onClick={() => { setCreating(true); setMessage(""); setError(""); }}>
            Crear usuario
          </button>
        ) : null}
      </div>
      {message ? <p className="tracking-message success" role="status">{message}</p> : null}
      {error ? <p className="tracking-message error" role="alert">{error}</p> : null}
      <section className="panel">
        <div className="tracking-section-title">
          <h3>Cuentas</h3>
          <span>{data.accounts.length} registros</span>
        </div>
        <div className="tracking-table-scroll">
          <table className="tracking-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Cargo</th>
                <th>Estado</th>
                <th>Contraseña</th>
                {data.canManage ? <th>Acciones</th> : null}
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((account) => {
                const isSelf = account._id === data.selfId;
                return (
                  <tr key={account._id}>
                    <td>{account.name}{isSelf ? " (tú)" : ""}</td>
                    <td>{account.email}</td>
                    <td>
                      {data.canManage && !isSelf ? (
                        <select
                          aria-label={`Cargo de ${account.name}`}
                          value={account.jobTitle ?? ""}
                          onChange={(event) => void changeJobTitle(account, event.target.value as JobTitle)}
                        >
                          {!account.jobTitle ? <option value="">{legacyRole(account.roles)}</option> : null}
                          {jobTitles.map((title) => <option key={title} value={title}>{jobTitleLabels[title]}</option>)}
                        </select>
                      ) : account.jobTitle ? jobTitleLabels[account.jobTitle] : legacyRole(account.roles)}
                    </td>
                    <td>{account.status === "active" ? "Activo" : "Desactivado"}</td>
                    <td>{account.hasPassword ? (account.passwordUpdatedAt ? `Actualizada ${formatDate(account.passwordUpdatedAt)}` : "Definida") : "Sin definir"}</td>
                    {data.canManage ? (
                      <td>
                        <div className="alarm-actions">
                          <button type="button" className="text-button" onClick={() => { setResetting(account); setMessage(""); setError(""); }}>
                            Restablecer contraseña
                          </button>
                          {!isSelf ? (
                            <button type="button" className={account.status === "active" ? "text-button alarm-delete" : "text-button"} onClick={() => void toggleStatus(account)}>
                              {account.status === "active" ? "Desactivar" : "Reactivar"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {!data.accounts.length ? (
                <tr><td className="tracking-empty" colSpan={data.canManage ? 6 : 5}>No hay usuarios registrados.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      {creating && data.canManage ? (
        <CreateUserForm
          onCancel={() => setCreating(false)}
          onCreated={(name) => { setCreating(false); setMessage(`Usuario ${name} creado.`); }}
        />
      ) : null}
      {resetting && data.canManage ? (
        <ResetPasswordForm
          account={resetting}
          onCancel={() => setResetting(null)}
          onDone={() => { setResetting(null); setMessage(`Contraseña de ${resetting.name} restablecida.`); }}
        />
      ) : null}
    </div>
  );
}

function CreateUserForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (name: string) => void }) {
  const [values, setValues] = useState({ name: "", email: "", jobTitle: "auxiliar_seguridad" as JobTitle, password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values)
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "No fue posible crear el usuario");
        return;
      }
      onCreated(values.name.trim());
    } catch {
      setError("No fue posible conectar con el servidor");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel alarm-form">
      <div className="tracking-section-title"><h3>Crear usuario</h3></div>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy}>
          <legend className="sr-only">Datos del usuario</legend>
          <div className="tracking-form-grid">
            <label>
              <span>Nombre completo</span>
              <input required minLength={3} maxLength={120} value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} />
            </label>
            <label>
              <span>Correo</span>
              <input required type="email" autoComplete="off" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} />
            </label>
            <label>
              <span>Cargo</span>
              <select value={values.jobTitle} onChange={(e) => setValues({ ...values, jobTitle: e.target.value as JobTitle })}>
                {jobTitles.map((title) => <option key={title} value={title}>{jobTitleLabels[title]}</option>)}
              </select>
            </label>
            <label>
              <span>Contraseña inicial</span>
              <input required type="password" autoComplete="new-password" minLength={10} value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} />
            </label>
          </div>
          <p className="login-note">Mínimo 10 caracteres combinando letras y números. El usuario puede cambiarla después desde Mi contraseña.</p>
          {error ? <p role="alert" className="tracking-message error">{error}</p> : null}
          <div className="tracking-form-actions">
            <button type="button" className="ghost-button" onClick={onCancel}>Cancelar</button>
            <button type="submit" className="primary-action">{busy ? "Creando…" : "Crear usuario"}</button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}

function ResetPasswordForm({ account, onCancel, onDone }: { account: Account; onCancel: () => void; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/auth/users/${account._id}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "No fue posible restablecer la contraseña");
        return;
      }
      onDone();
    } catch {
      setError("No fue posible conectar con el servidor");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel alarm-form">
      <div className="tracking-section-title"><h3>Restablecer contraseña de {account.name}</h3></div>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy}>
          <legend className="sr-only">Nueva contraseña</legend>
          <div className="tracking-form-grid">
            <label>
              <span>Nueva contraseña</span>
              <input required type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          </div>
          {error ? <p role="alert" className="tracking-message error">{error}</p> : null}
          <div className="tracking-form-actions">
            <button type="button" className="ghost-button" onClick={onCancel}>Cancelar</button>
            <button type="submit" className="primary-action">{busy ? "Guardando…" : "Guardar contraseña"}</button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}

function legacyRole(roles: string[]): string {
  if (roles.includes("admin")) return "Administrador";
  if (roles.includes("operator")) return "Operador";
  if (roles.includes("auditor")) return "Auditor";
  return roles.join(", ") || "Sin cargo";
}

function formatDate(value: number): string {
  return new Date(value).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

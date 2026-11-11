"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useConvexAuth, useMutation, useQuery } from "../../../lib/convex-hooks";
import { api } from "../../../../convex/_generated/api";
import { CustomerField, type CustomerPick } from "../../../components/fields/customer-field";
import { DriverField, type DriverPick } from "../../../components/fields/lookup-fields";
import { convexErrorMessage } from "../../../lib/convex-error";
import "../../../control/bitacora/bitacora.css";
import "../estudios.css";

export default function NewSecurityStudy() {
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const createStudy = useMutation(api.securityStudies.createStudy);
  const [document, setDocument] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseCategory, setLicenseCategory] = useState("");
  const [licenseExpiresAt, setLicenseExpiresAt] = useState("");
  const [customer, setCustomer] = useState<CustomerPick | null>(null);
  const [plate, setPlate] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [master, setMaster] = useState<DriverPick | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lookupTerm = document.trim().length >= 3 ? document.trim() : name.trim().length >= 3 ? name.trim() : "";
  const existing = useQuery(api.securityStudies.dossierLookup, isAuthenticated && lookupTerm ? { term: lookupTerm } : "skip");
  const status = useQuery(api.securityStudies.driverStatus, isAuthenticated && document.replace(/\D/g, "").length >= 5 ? { document, customerId: customer?._id } : "skip");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    try {
      if (!customer) throw new Error("Selecciona la empresa que solicita el estudio.");
      setBusy(true);
      const id = await createStudy({
        document,
        name,
        phone: phone || undefined,
        email: email || undefined,
        city: city || undefined,
        birthDate: birthDate || undefined,
        licenseNumber: licenseNumber || undefined,
        licenseCategory: licenseCategory || undefined,
        licenseExpiresAt: licenseExpiresAt || undefined,
        notes: notes || undefined,
        customer: customer.name,
        customerId: customer._id,
        plate: plate || undefined,
        requestedBy: requestedBy || undefined,
      });
      router.push(`/seguridad/estudios/${id}`);
    } catch (reason) {
      setError(reason instanceof Error && !("data" in reason) ? reason.message : convexErrorMessage(reason, "No se pudo abrir el estudio."));
      setBusy(false);
    }
  }

  return (
    <div className="bm-workspace">
      <Link className="bm-back" href="/seguridad/estudios">← Estudios de seguridad</Link>
      <div className="bm-heading">
        <div>
          <span className="eyebrow">Nuevo estudio</span>
          <h2>Abrir estudio de seguridad</h2>
          <p>Registra al conductor y la empresa que lo solicita. Después adjuntas la documentación, registras las consultas y decides.</p>
        </div>
      </div>
      <form className="es-new-layout" onSubmit={(e) => void submit(e)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <fieldset className="field-section" disabled={busy}>
            <legend>Conductor</legend>
            <div className="field-grid semantic">
              <DriverField
                className="field span-6"
                label="Buscar en maestros (opcional)"
                selected={master}
                onSelect={(d) => {
                  setMaster(d);
                  setDocument(d.document);
                  setName(d.name ?? "");
                  setPhone(d.phone ?? "");
                  setLicenseCategory(d.licenseCategory ?? "");
                  setLicenseExpiresAt(d.licenseExpiresAt ?? "");
                }}
                onClear={() => setMaster(null)}
              />
              <div className="field span-6 es-lookup">
                <span>Expedientes existentes <small>se reutiliza el expediente si el conductor ya fue estudiado</small></span>
                {existing?.length ? (
                  <ul className="es-lookup-results">
                    {existing.map((row) => (
                      <li key={row._id}>
                        <button type="button" onClick={() => { setDocument(row.document); setName(row.name); setPhone(row.phone ?? ""); }}>
                          <span>{row.name} <small>· CC {row.document}</small></span>
                          <small>{row.studies} estudio{row.studies === 1 ? "" : "s"} · {row.documentCount} doc.</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <small style={{ color: "var(--ink-faint)", fontSize: 11.5 }}>{lookupTerm ? "Ningún expediente coincide; se creará uno nuevo." : "Escribe el documento o el nombre para buscar."}</small>
                )}
              </div>
              <label className="field span-4">
                <span>Documento de identidad</span>
                <input required className="mono" placeholder="91276540" value={document} onChange={(e) => setDocument(e.target.value)} />
              </label>
              <label className="field span-8">
                <span>Nombre completo</span>
                <input required value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="field span-4">
                <span>Celular</span>
                <input inputMode="tel" placeholder="300 000 0000" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </label>
              <label className="field span-4">
                <span>Correo <small>opcional</small></span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="field span-4">
                <span>Ciudad de residencia <small>opcional</small></span>
                <input value={city} onChange={(e) => setCity(e.target.value)} />
              </label>
              <label className="field span-3">
                <span>Fecha de nacimiento <small>opcional</small></span>
                <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
              </label>
              <label className="field span-3">
                <span>Licencia N.º <small>opcional</small></span>
                <input className="mono" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
              </label>
              <label className="field span-3">
                <span>Categoría</span>
                <select value={licenseCategory} onChange={(e) => setLicenseCategory(e.target.value)}>
                  <option value="">—</option>
                  {["A1", "A2", "B1", "B2", "B3", "C1", "C2", "C3"].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="field span-3">
                <span>Vence licencia</span>
                <input type="date" value={licenseExpiresAt} onChange={(e) => setLicenseExpiresAt(e.target.value)} />
              </label>
            </div>
          </fieldset>

          <fieldset className="field-section" disabled={busy}>
            <legend>Solicitud</legend>
            <div className="field-grid semantic">
              <CustomerField className="field span-6" label="Empresa que solicita el estudio" required selected={customer} onSelect={setCustomer} onClear={() => setCustomer(null)} hint="La decisión se toma con los criterios de esta empresa" />
              <label className="field span-3">
                <span>Placa <small>opcional</small></span>
                <input className="mono" placeholder="ABC123" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} />
              </label>
              <label className="field span-3">
                <span>Solicitado por <small>opcional</small></span>
                <input placeholder="Nombre en la empresa" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} />
              </label>
              <label className="field wide">
                <span>Observaciones iniciales <small>opcional</small></span>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
            </div>
          </fieldset>
        </div>
        <aside className="es-new-side">
          <div className="panel">
            <h3>Cómo funciona</h3>
            <ul>
              <li>El <strong>expediente</strong> es uno por conductor: documentos, licencia y contacto.</li>
              <li>El <strong>estudio</strong> es por empresa: cada una tiene criterios distintos.</li>
              <li>Registra cada consulta (Policía, Procuraduría, SIMIT, RUNT…) con su resultado.</li>
              <li>Aprueba o rechaza. El rechazo exige motivo y lo ve la empresa.</li>
            </ul>
          </div>
          {status ? (
            <div className="panel" style={{ padding: 14 }}>
              <span className="eyebrow">Historial del conductor</span>
              <p style={{ margin: "6px 0 0", fontSize: 13 }}>
                <strong>{status.driverName}</strong>
                {status.approvedFor.length ? <><br />Aprobado para {status.approvedFor.join(", ")}</> : null}
                {status.rejectedFor.length ? <><br /><span style={{ color: "var(--bad)" }}>Rechazado para {status.rejectedFor.join(", ")}</span></> : null}
                {status.openCount ? <><br />{status.openCount} estudio{status.openCount === 1 ? "" : "s"} en curso</> : null}
                {status.forCustomer ? <><br />Para {status.forCustomer.customer}: <Link href={`/seguridad/estudios/${status.forCustomer._id}`}>{status.forCustomer.code}</Link></> : null}
              </p>
            </div>
          ) : null}
          {error ? <p className="bm-message error" role="alert">{error}</p> : null}
          <button className="primary-action" disabled={busy} type="submit">{busy ? "Abriendo estudio…" : "Abrir estudio"}</button>
          <Link className="ghost-button" href="/seguridad/estudios" style={{ textAlign: "center", textDecoration: "none" }}>Cancelar</Link>
        </aside>
      </form>
    </div>
  );
}

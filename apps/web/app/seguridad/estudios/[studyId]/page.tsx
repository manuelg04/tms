"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useRef, useState, type FormEvent } from "react";
import { useConvexAuth, useMutation, useQuery } from "../../../lib/convex-hooks";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  CHECK_RESULT_LABELS,
  DOSSIER_DOCUMENT_KINDS,
  SECURITY_CHECK_KINDS,
  STUDY_STATUS_LABELS,
  missingRequiredDocuments,
  studyProgress,
  type CheckResult,
} from "../../../../convex/model/securityStudies";
import { convexErrorMessage } from "../../../lib/convex-error";
import { formatDate, formatDateTime, relativePast, useNow } from "../../../control/bitacora/components/format";
import "../../../control/bitacora/bitacora.css";
import "../estudios.css";
import { Skeleton } from "../../../components/skeleton";

type Detail = NonNullable<ReturnType<typeof useQuery<typeof api.securityStudies.detail>>>;

export default function SecurityStudyDetail({ params }: { params: Promise<{ studyId: string }> }) {
  const { studyId } = use(params);
  const { isAuthenticated } = useConvexAuth();
  const data = useQuery(api.securityStudies.detail, isAuthenticated ? { studyId: studyId as Id<"securityStudies"> } : "skip");
  const router = useRouter();
  const now = useNow();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const deleteStudy = useMutation(api.securityStudies.deleteStudy);
  const reopen = useMutation(api.securityStudies.reopen);

  if (data === undefined) return <Skeleton label="Cargando estudio" />;
  if (data === null)
    return (
      <div className="bm-workspace">
        <Link className="bm-back" href="/seguridad/estudios">← Estudios de seguridad</Link>
        <section className="panel bm-empty"><strong>Este estudio no está disponible</strong>Puede haber sido eliminado o pertenece a otra empresa.</section>
      </div>
    );
  const { study, dossier, documents } = data;
  const client = data.viewer === "client";
  const decided = study.status === "aprobado" || study.status === "rechazado";
  const editable = data.canManage && !decided;
  const progress = studyProgress(study);
  const missing = missingRequiredDocuments(documents);

  async function run(action: () => Promise<unknown>, success: string) {
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
    } catch (reason) {
      setError(convexErrorMessage(reason, "No fue posible completar la acción."));
    }
  }

  async function removeStudy() {
    if (!window.confirm(`¿Eliminar el estudio ${study.code}? El expediente del conductor se conserva.`)) return;
    try {
      await deleteStudy({ studyId: study._id });
      router.push("/seguridad/estudios");
    } catch (cause) {
      window.alert(convexErrorMessage(cause, "No fue posible eliminar el estudio."));
    }
  }

  async function reopenStudy() {
    const reason = window.prompt("¿Por qué se reabre el estudio? Queda registrado en las notas.");
    if (!reason) return;
    await run(() => reopen({ studyId: study._id, reason }), "Estudio reabierto. Puedes ajustar consultas y volver a decidir.");
  }

  return (
    <div className="bm-workspace bm-trip">
      <Link className="bm-back" href="/seguridad/estudios">← Estudios de seguridad</Link>
      <div className="bm-heading">
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span className="bm-code">{study.code}</span>
            <span className={`es-status ${study.status}`}>{STUDY_STATUS_LABELS[study.status]}</span>
            {study.plate ? <span className="plate-chip">{study.plate}</span> : null}
          </div>
          <div className="bm-route-title"><span>{dossier.name}</span></div>
          <p className="bm-trip-facts">
            <span>CC <b>{dossier.document}</b></span>
            <span>Estudio para <b>{study.customer}</b></span>
            <span>Abierto {formatDateTime(study.createdAt)} por {study.createdByName}</span>
          </p>
        </div>
        <div className="bm-heading-actions">
          {data.isAdmin && decided ? <button className="ghost-button" type="button" onClick={() => void reopenStudy()}>Reabrir estudio</button> : null}
          {data.isAdmin ? <button className="ghost-button bm-danger" type="button" onClick={() => void removeStudy()}>Eliminar</button> : null}
        </div>
      </div>
      {notice ? <p className="bm-message success" role="status">{notice}</p> : null}
      {error ? <p className="bm-message error" role="alert">{error}</p> : null}

      <div className="es-layout">
        <div className="es-main">
          <div className="es-driver-strip">
            <div><span className="eyebrow">Celular</span><strong>{dossier.phone ?? "—"}</strong></div>
            <div><span className="eyebrow">Licencia</span><strong>{dossier.licenseCategory ? `${dossier.licenseCategory}${dossier.licenseExpiresAt ? ` · vence ${dossier.licenseExpiresAt}` : ""}` : "—"}</strong></div>
            <div><span className="eyebrow">Ciudad</span><strong>{dossier.city ?? "—"}</strong></div>
            <div><span className="eyebrow">Correo</span><strong>{dossier.email ?? "—"}</strong></div>
          </div>

          <section className="panel" aria-label="Expediente documental">
            <div className="bm-card-toolbar">
              <div>
                <h3>Expediente del conductor <span className="count">{documents.length} documento{documents.length === 1 ? "" : "s"}</span></h3>
                <span>{client ? "Los archivos se conservan en el sistema de la empresa de seguridad." : "Documentación enviada por el conductor. El expediente es único por documento de identidad."}</span>
              </div>
            </div>
            <ul className="es-docs">
              {documents.map((doc) => (
                <li className="es-doc" key={doc.id}>
                  <span className="icon">{doc.url && doc.contentType.startsWith("image/") ? <img src={doc.url} alt="" /> : doc.contentType.includes("pdf") ? "PDF" : "DOC"}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="kind">{doc.kind}</span>
                    <span className="meta">{doc.fileName} · subido {relativePast(doc.uploadedAt, now)} por {doc.uploadedByName}{doc.note ? ` · ${doc.note}` : ""}</span>
                  </span>
                  <span className="actions">
                    {doc.url ? <a href={doc.url} target="_blank" rel="noreferrer">Abrir</a> : null}
                    {data.canManage && (!decided || data.isAdmin) ? <RemoveDocument studyId={study._id} documentId={doc.id} onError={setError} /> : null}
                  </span>
                </li>
              ))}
              {!documents.length ? <li className="es-doc" style={{ gridTemplateColumns: "1fr", color: "var(--ink-soft)" }}>Aún no hay documentos en el expediente.</li> : null}
            </ul>
            {missing.length && !client ? (
              <div className="es-missing">Falta{missing.length === 1 ? "" : "n"} por adjuntar: {missing.map((kind) => <span key={kind}>{kind}</span>)}</div>
            ) : null}
            {data.canManage && (!decided || data.isAdmin) ? <UploadForm studyId={study._id} onError={setError} onDone={() => setNotice("Documento agregado al expediente.")} /> : null}
          </section>

          <section className="panel" aria-label="Consultas de antecedentes">
            <div className="bm-card-toolbar">
              <div>
                <h3>Consultas de antecedentes <span className="count">{progress.done} de {progress.total} registradas{progress.findings ? ` · ${progress.findings} con hallazgo` : ""}</span></h3>
                <span>Las consultas se hacen en las plataformas oficiales; aquí se registra el resultado y la evidencia relevante.</span>
              </div>
            </div>
            {client ? (
              <table className="es-checks">
                <thead><tr><th>Consulta</th><th>Resultado</th></tr></thead>
                <tbody>
                  {study.checks.map((check) => (
                    <tr key={check.kind} className={check.result === "con_hallazgo" ? "hallazgo" : ""}>
                      <td><span className="kind">{check.kind}</span></td>
                      <td>
                        <span className={`es-status ${check.result === "sin_novedad" ? "aprobado" : check.result === "con_hallazgo" ? "rechazado" : "pendiente"}`}>{CHECK_RESULT_LABELS[check.result]}</span>
                        {check.detail ? <span className="who">{check.detail}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <ChecksTable study={study} editable={editable} onError={setError} />
            )}
          </section>

          {!client ? <NotesPanel studyId={study._id} initial={study.analystNotes ?? ""} editable={data.canManage} onError={setError} onSaved={() => setNotice("Notas guardadas.")} /> : null}
        </div>

        <aside className="es-side">
          {decided ? (
            <section className={`panel es-verdict ${study.status}`} aria-label="Decisión">
              <span className="eyebrow">Decisión del estudio</span>
              <h3>{study.status === "aprobado" ? "Conductor aprobado" : "Conductor rechazado"}</h3>
              <p>{study.decisionReason ?? (study.status === "aprobado" ? "Sin observaciones adicionales." : "")}</p>
              <small>
                {study.decidedAt ? formatDateTime(study.decidedAt) : ""}{study.decidedByName ? ` · ${study.decidedByName}` : ""}
                {study.validUntil ? <><br />Vigente hasta {formatDate(study.validUntil)}</> : null}
                <br />Para {study.customer}
              </small>
            </section>
          ) : client ? (
            <section className="panel bm-closed">
              <strong>Estudio en curso</strong>
              El equipo de seguridad está realizando las consultas. Verá aquí la decisión y su motivo cuando se cierre.
            </section>
          ) : data.canManage ? (
            <DecisionPanel study={study} progress={progress} missing={missing} onError={setError} onDone={(outcome) => setNotice(outcome === "aprobado" ? "Estudio aprobado." : "Estudio rechazado con motivo registrado.")} />
          ) : null}

          {data.history.length ? (
            <section className="panel" aria-label="Otros estudios del conductor">
              <div className="bm-card-toolbar"><div><h3>Otros estudios de este conductor</h3></div></div>
              <ul className="es-history">
                {data.history.map((row) => (
                  <li key={row._id}>
                    <span><Link href={`/seguridad/estudios/${row._id}`}>{row.code}</Link> · {row.customer}</span>
                    <span className={`es-status ${row.status}`}>{STUDY_STATUS_LABELS[row.status]}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <details className="panel bm-details">
            <summary>Datos de la solicitud</summary>
            <dl>
              <div><dt>Empresa</dt><dd>{study.customer}</dd></div>
              <div><dt>Solicitado por</dt><dd className={study.requestedBy ? "" : "muted"}>{study.requestedBy ?? "—"}</dd></div>
              <div><dt>Placa</dt><dd className={study.plate ? "" : "muted"}>{study.plate ?? "—"}</dd></div>
              <div><dt>Nacimiento</dt><dd className={dossier.birthDate ? "" : "muted"}>{dossier.birthDate ?? "—"}</dd></div>
              <div className="wide"><dt>Notas del expediente</dt><dd className="muted">{dossier.notes ?? "—"}</dd></div>
              <div className="wide"><dt>Última actualización</dt><dd className="muted">{formatDateTime(study.updatedAt)}</dd></div>
            </dl>
          </details>
        </aside>
      </div>
    </div>
  );
}

function RemoveDocument({ studyId, documentId, onError }: { studyId: Id<"securityStudies">; documentId: string; onError: (m: string) => void }) {
  const remove = useMutation(api.securityStudies.removeDocument);
  return (
    <button
      type="button"
      className="text-button"
      style={{ color: "var(--bad)" }}
      onClick={async () => {
        if (!window.confirm("¿Quitar este documento del expediente?")) return;
        try {
          await remove({ studyId, documentId });
        } catch (reason) {
          onError(convexErrorMessage(reason, "No se pudo quitar el documento."));
        }
      }}
    >
      Quitar
    </button>
  );
}

function UploadForm({ studyId, onError, onDone }: { studyId: Id<"securityStudies">; onError: (m: string) => void; onDone: () => void }) {
  const generateUploadUrl = useMutation(api.securityStudies.generateUploadUrl);
  const addDocument = useMutation(api.securityStudies.addDocument);
  const [kind, setKind] = useState<string>(DOSSIER_DOCUMENT_KINDS[0]);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || busy) return;
    if (file.size > 15 * 1024 * 1024) {
      onError("El archivo no puede superar 15 MB.");
      return;
    }
    setBusy(true);
    onError("");
    try {
      const url = await generateUploadUrl({});
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (!response.ok) throw new Error(`No se pudo subir ${file.name}.`);
      const result = (await response.json()) as { storageId?: Id<"_storage"> };
      if (!result.storageId) throw new Error("La carga no devolvió un archivo válido.");
      await addDocument({ studyId, kind, storageId: result.storageId, fileName: file.name, contentType: file.type || "application/octet-stream", note: note || undefined });
      setFile(null);
      setNote("");
      if (input.current) input.current.value = "";
      onDone();
    } catch (reason) {
      onError(reason instanceof Error && !("data" in reason) ? reason.message : convexErrorMessage(reason, "No se pudo adjuntar el documento."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="es-upload" onSubmit={(e) => void submit(e)}>
      <label className="field">
        <span>Tipo de documento</span>
        <select value={kind} onChange={(e) => setKind(e.target.value)} disabled={busy}>
          {DOSSIER_DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Archivo <small>PDF o imagen, máx. 15 MB</small></span>
        <input ref={input} type="file" accept="application/pdf,image/*" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <label className="field wide">
        <span>Nota <small>opcional</small></span>
        <input value={note} maxLength={160} placeholder="Ej. Enviado por WhatsApp el 18/09" disabled={busy} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="wide bm-form-actions">
        <button className="primary-action" type="submit" disabled={!file || busy}>{busy ? "Subiendo…" : "Adjuntar al expediente"}</button>
      </div>
    </form>
  );
}

function ChecksTable({ study, editable, onError }: { study: Detail["study"]; editable: boolean; onError: (m: string) => void }) {
  const record = useMutation(api.securityStudies.recordCheck);
  const hints = new Map<string, string>(SECURITY_CHECK_KINDS.map((k) => [k.kind, k.hint]));
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  async function save(kind: string, result: CheckResult, detail: string | undefined) {
    try {
      await record({ studyId: study._id, kind, result, detail });
    } catch (reason) {
      onError(convexErrorMessage(reason, "No se pudo registrar la consulta."));
    }
  }

  return (
    <table className="es-checks">
      <thead>
        <tr>
          <th style={{ width: "34%" }}>Consulta</th>
          <th>Resultado</th>
          <th style={{ width: "36%" }}>Detalle del hallazgo / evidencia</th>
        </tr>
      </thead>
      <tbody>
        {study.checks.map((check) => {
          const draft = drafts[check.kind] ?? check.detail ?? "";
          return (
            <tr key={check.kind} className={check.result === "con_hallazgo" ? "hallazgo" : ""}>
              <td>
                <span className="kind">{check.kind}</span>
                {hints.get(check.kind) ? <span className="hint">{hints.get(check.kind)}</span> : null}
                {check.checkedAt ? <span className="who">{formatDateTime(check.checkedAt)} · {check.checkedByName}</span> : null}
              </td>
              <td>
                <div className="bm-segment" role="group" aria-label={`Resultado de ${check.kind}`}>
                  {(["sin_consultar", "sin_novedad", "con_hallazgo"] as const).map((value) => (
                    <button key={value} type="button" className={value === "sin_novedad" ? "good" : value === "con_hallazgo" ? "warn" : ""} aria-pressed={check.result === value} disabled={!editable} onClick={() => void save(check.kind, value, draft || undefined)}>
                      {CHECK_RESULT_LABELS[value]}
                    </button>
                  ))}
                </div>
              </td>
              <td>
                <textarea
                  value={draft}
                  disabled={!editable}
                  placeholder={check.result === "con_hallazgo" ? "Describe el hallazgo: tipo, fecha, vigencia." : "Opcional: número de certificado, fecha de consulta."}
                  onChange={(e) => setDrafts({ ...drafts, [check.kind]: e.target.value })}
                  onBlur={() => { if (draft !== (check.detail ?? "")) void save(check.kind, check.result, draft || undefined); }}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function NotesPanel({ studyId, initial, editable, onError, onSaved }: { studyId: Id<"securityStudies">; initial: string; editable: boolean; onError: (m: string) => void; onSaved: () => void }) {
  const saveNotes = useMutation(api.securityStudies.saveNotes);
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel es-notes" aria-label="Notas del analista">
      <div className="bm-card-toolbar"><div><h3>Notas del analista</h3><span>Criterios de la empresa, llamadas de referencias, contexto de la decisión.</span></div></div>
      <div className="bm-form">
        <textarea value={value} disabled={!editable || busy} maxLength={2000} onChange={(e) => setValue(e.target.value)} placeholder="Ej. La empresa acepta comparendos menores pagados; no acepta antecedentes contra el patrimonio." />
        {editable ? (
          <div className="bm-form-actions">
            <button className="ghost-button" type="button" disabled={busy || value === initial} onClick={async () => { setBusy(true); try { await saveNotes({ studyId, analystNotes: value }); onSaved(); } catch (reason) { onError(convexErrorMessage(reason, "No se pudieron guardar las notas.")); } finally { setBusy(false); } }}>
              {busy ? "Guardando…" : "Guardar notas"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DecisionPanel({ study, progress, missing, onError, onDone }: { study: Detail["study"]; progress: ReturnType<typeof studyProgress>; missing: string[]; onError: (m: string) => void; onDone: (outcome: "aprobado" | "rechazado") => void }) {
  const decide = useMutation(api.securityStudies.decide);
  const [outcome, setOutcome] = useState<"aprobado" | "rechazado" | null>(null);
  const [reason, setReason] = useState("");
  const [months, setMonths] = useState(12);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!outcome || busy) return;
    if (outcome === "rechazado" && reason.trim().length < 10) {
      onError("Explica el motivo del rechazo (mínimo 10 caracteres). Es lo que verá la empresa.");
      return;
    }
    if (!window.confirm(outcome === "aprobado" ? `¿Aprobar a ${study.driverName} para ${study.customer}?` : `¿Rechazar a ${study.driverName} para ${study.customer}? El motivo quedará visible para la empresa.`)) return;
    setBusy(true);
    onError("");
    try {
      await decide({ studyId: study._id, outcome, reason, validMonths: outcome === "aprobado" ? months : undefined });
      onDone(outcome);
    } catch (reason) {
      onError(convexErrorMessage(reason, "No se pudo registrar la decisión."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-label="Decisión del estudio">
      <form className="es-decision" onSubmit={(e) => void submit(e)}>
        <div>
          <span className="eyebrow">Decisión para {study.customer}</span>
        </div>
        <dl className="summary" style={{ margin: 0 }}>
          <div><dt>Consultas</dt><dd>{progress.done}/{progress.total}<small>{progress.total - progress.done ? `${progress.total - progress.done} pendiente${progress.total - progress.done === 1 ? "" : "s"}` : "todas registradas"}</small></dd></div>
          <div><dt>Hallazgos</dt><dd className={progress.findings ? "bad" : ""}>{progress.findings}<small>{missing.length ? `${missing.length} documento${missing.length === 1 ? "" : "s"} obligatorio${missing.length === 1 ? "" : "s"} faltante${missing.length === 1 ? "" : "s"}` : "expediente completo"}</small></dd></div>
        </dl>
        <div className="es-decision-actions" role="group" aria-label="Resultado">
          <button type="button" className="approve" aria-pressed={outcome === "aprobado"} disabled={busy} onClick={() => setOutcome("aprobado")}>Aprobar</button>
          <button type="button" className="reject" aria-pressed={outcome === "rechazado"} disabled={busy} onClick={() => setOutcome("rechazado")}>Rechazar</button>
        </div>
        {outcome === "aprobado" ? (
          <label className="field">
            <span>Vigencia de la aprobación</span>
            <select value={months} onChange={(e) => setMonths(Number(e.target.value))} disabled={busy}>
              {[3, 6, 12, 24].map((m) => <option key={m} value={m}>{m} meses</option>)}
              <option value={0}>Sin vencimiento</option>
            </select>
          </label>
        ) : null}
        {outcome ? (
          <label className="field">
            <span>{outcome === "aprobado" ? "Observaciones" : "Motivo del rechazo"} <small>{outcome === "aprobado" ? "opcional" : "obligatorio, lo verá la empresa"}</small></span>
            <textarea required={outcome === "rechazado"} maxLength={1000} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} placeholder={outcome === "aprobado" ? "Ej. Sin antecedentes; referencias confirmadas." : "Ej. Antecedente judicial vigente por hurto; la empresa no admite antecedentes contra el patrimonio."} />
          </label>
        ) : null}
        {outcome ? (
          <div className="bm-form-actions">
            <button className="primary-action" type="submit" disabled={busy}>{busy ? "Guardando…" : outcome === "aprobado" ? "Confirmar aprobación" : "Confirmar rechazo"}</button>
            <button className="ghost-button" type="button" disabled={busy} onClick={() => { setOutcome(null); setReason(""); }}>Cancelar</button>
          </div>
        ) : (
          <p className="bm-form-intro">Registra todas las consultas antes de aprobar. Para rechazar basta un hallazgo que la empresa considere excluyente.</p>
        )}
      </form>
    </section>
  );
}

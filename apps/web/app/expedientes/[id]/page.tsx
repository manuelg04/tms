"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useDemoUser } from "../../providers";
import { StatusBadge } from "../status-badge";

type Detail = NonNullable<FunctionReturnType<typeof api.expedientes.detail>>;
type DocumentRow = Detail["documents"][number];
type RemesaRow = Detail["remesas"][number];
type Modal = "novelty" | "remesa" | "correct" | "annul" | "reconcile" | "acceptance" | null;

export default function ExpedienteDetailPage() {
  const params = useParams<{ id: string }>();
  const expedienteId = params.id as Id<"expedientes">;
  const detailResult = useQuery(api.expedientes.detail, { expedienteId });
  const operations = useQuery(api.rndcOperations.listForExpediente, { expedienteId, limit: 30 });
  const evidence = useQuery(api.evidence.listForExpediente, { expedienteId, limit: 50 });
  const { user } = useDemoUser();
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "bad" | "wait"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const createDraft = useMutation(api.officialDocuments.createDraft);
  const addRemesa = useMutation(api.expedientes.upsertRemesa);
  const openNovelty = useMutation(api.expedientes.openNovelty);
  const generateUploadUrl = useMutation(api.evidence.generateUploadUrl);
  const finalizeUpload = useMutation(api.evidence.finalizeUpload);
  const attachEvidence = useMutation(api.expedientes.attachDeliveryEvidence);
  const canEdit = user?.role === "admin" || user?.role === "operator";

  if (detailResult === undefined) {
    return <div className="full-page-state">Cargando expediente…</div>;
  }

  if (detailResult === null) {
    return (
      <section className="panel expediente-empty">
        <strong>El expediente no existe o ya no esta disponible.</strong>
        <Link className="ghost-button action-link" href="/expedientes">Volver al listado</Link>
      </section>
    );
  }

  const detail: Detail = detailResult;
  const manifest = detail.documents.find((document) => document.kind === "manifiesto") ?? null;
  const remesaDocuments = detail.documents.filter((document) => document.kind === "remesa");
  const manifestAnnulled = manifest?.officialState === "annulled" || manifest?.annulmentState === "annulled";
  const remesasAuthorized = remesaDocuments.length === detail.remesas.length
    && remesaDocuments.every((document) => isIssuedState(document.officialState) && document.annulmentState !== "annulled");
  const emissionComplete = Boolean(isIssuedState(manifest?.officialState) && remesasAuthorized);
  const fulfillmentComplete = Boolean(
    manifest?.fulfillmentState === "fulfilled"
    && remesaDocuments.length === detail.remesas.length
    && remesaDocuments.every((document) => document.fulfillmentState === "fulfilled")
  );
  const canRunFulfillment = emissionComplete && !fulfillmentComplete && !manifestAnnulled;
  const canAddRemesa = !manifest || manifest.officialState === "draft" || manifest.officialState === "pending";
  const canCorrect = remesaDocuments.some((document) => isIssuedState(document.officialState) && document.annulmentState !== "annulled");
  const canAnnul = detail.documents.some((document) => isIssuedState(document.officialState) && document.annulmentState !== "annulled");
  const completedChecks = detail.complianceChecks.filter((check) => check.status === "passed").length;
  const openNovelties = detail.novelties.filter((novelty) => novelty.status === "open");

  async function runEmission() {
    if (emissionComplete) {
      setNotice({ tone: "ok", text: "Las remesas y el manifiesto ya estan autorizados." });
      return;
    }

    if (manifestAnnulled) {
      setNotice({ tone: "bad", text: "El manifiesto fue anulado y no puede volver a emitirse con el mismo numero." });
      return;
    }

    if (!detail.expediente.manifestNumber || detail.remesas.length === 0 || detail.remesas.some((remesa) => !remesa.number)) {
      setNotice({ tone: "bad", text: "Completa el numero de manifiesto y el numero de cada remesa antes de emitir." });
      return;
    }

    setBusy("emit");
    setNotice({ tone: "wait", text: "Registrando intenciones durables y ejecutando el flujo en modo de prueba…" });

    try {
      for (const remesa of detail.remesas) {
        const existingDocument = detail.documents.find((document) => document._id === remesa.documentId);
        if (existingDocument?.officialState === "authorized") {
          continue;
        }
        const documentId = await createDraft({
          expedienteId,
          expedienteRemesaId: remesa._id,
          kind: "remesa",
          number: remesa.number,
          mode: "dry-run"
        });
        await submitRndcAction("emit_remesa", {
          detail,
          documentId,
          remesa,
          businessKey: `emit-remesa:${remesa._id}:${remesa.number}`,
          payload: buildRndcPayload(detail, remesa)
        });
      }

      const manifestDocumentId = await createDraft({
        expedienteId,
        kind: "manifiesto",
        number: detail.expediente.manifestNumber,
        mode: "dry-run"
      });
      await submitRndcAction("emit_manifest", {
        detail,
        documentId: manifestDocumentId,
        businessKey: `emit-manifest:${expedienteId}:${detail.expediente.manifestNumber}`,
        payload: buildRndcPayload(detail)
      });
      setNotice({ tone: "ok", text: "Las remesas y el manifiesto terminaron su ejecucion de prueba y conservaron evidencia protegida." });
    } catch (cause) {
      setNotice({ tone: "bad", text: readActionError(cause) });
    } finally {
      setBusy("");
    }
  }

  async function runFulfillment() {
    if (!manifest || manifest.officialState !== "authorized" || remesaDocuments.some((document) => document.officialState !== "authorized")) {
      setNotice({ tone: "bad", text: "El manifiesto y todas las remesas deben estar autorizados antes del cumplido." });
      return;
    }

    setBusy("fulfill");
    setNotice({ tone: "wait", text: "Cumpliendo cada remesa antes de cerrar el manifiesto…" });

    try {
      for (const document of remesaDocuments) {
        if (document.fulfillmentState === "fulfilled") {
          continue;
        }
        const remesa = detail.remesas.find((item) => item.documentId === document._id);
        await submitRndcAction("fulfill_remesa", {
          detail,
          documentId: document._id,
          remesa,
          businessKey: `fulfill-remesa:${document._id}`,
          payload: {
            ...buildRndcPayload(detail, remesa),
            compliance: { remesaType: "C", loadedQuantityKg: remesa?.cargoWeightKg ?? detail.serviceOrder.cargoWeightKg ?? 0 }
          }
        });
      }
      await submitRndcAction("fulfill_manifest", {
        detail,
        documentId: manifest._id,
        businessKey: `fulfill-manifest:${manifest._id}`,
        payload: {
          ...buildRndcPayload(detail),
          compliance: { manifestType: "C", documentsDeliveryDate: formatRndcDate(Date.now()) }
        }
      });
      setNotice({ tone: "ok", text: "El cumplido de remesas y manifiesto termino en modo de prueba." });
    } catch (cause) {
      setNotice({ tone: "bad", text: readActionError(cause) });
    } finally {
      setBusy("");
    }
  }

  async function runTimeoutProbe() {
    if (!manifest) {
      return;
    }

    setBusy("timeout");
    try {
      await submitRndcAction("query_acceptance", {
        detail,
        documentId: manifest._id,
        businessKey: `timeout-probe:${manifest._id}:${Date.now()}`,
        payload: { from: toYearFirstDate(todayIso()), to: toYearFirstDate(todayIso()) },
        simulateTimeout: true
      });
    } catch {
      setNotice({ tone: "wait", text: "El timeout simulado quedo en estado incierto. Usa Consultar y conciliar para recuperarlo sin reenvio." });
    } finally {
      setBusy("");
    }
  }

  async function saveNovelty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await openNovelty({
      expedienteId,
      category: String(data.get("category") ?? "operativa"),
      severity: String(data.get("severity")) as "info" | "warning" | "critical",
      description: String(data.get("description") ?? "")
    });
    setModal(null);
    setNotice({ tone: "ok", text: "La novedad quedo registrada en la cronologia." });
  }

  async function saveRemesa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await addRemesa({
      expedienteId,
      sequence: detail.remesas.length + 1,
      number: optionalValue(data, "number"),
      cargoDescription: String(data.get("description") ?? ""),
      cargoWeightKg: numberValue(data, "weightKg"),
      cargoUnit: "kg",
      consigneeName: optionalValue(data, "consigneeName"),
      consigneeDocument: optionalValue(data, "consigneeDocument")
    });
    setModal(null);
    setNotice({ tone: "ok", text: "La nueva remesa quedo vinculada al manifiesto." });
  }

  async function submitSpecialAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const documentId = String(data.get("documentId") ?? "") as Id<"documents">;
    const document = detail.documents.find((item) => item._id === documentId);
    if (!document) {
      setNotice({ tone: "bad", text: "Selecciona un documento valido." });
      return;
    }

    setBusy(modal ?? "action");
    try {
      if (modal === "correct") {
        const remesa = detail.remesas.find((item) => item.documentId === document._id);
        await submitRndcAction("correct_remesa", {
          detail,
          documentId,
          remesa,
          businessKey: `correct-remesa:${documentId}:${String(data.get("reasonCode"))}:${String(data.get("appointmentDate"))}:${String(data.get("appointmentTime"))}`,
          payload: {
            remesaNumber: document.number,
            reasonCode: Number(data.get("reasonCode")),
            change: {
              code: 1,
              appointmentDate: toSlashDate(String(data.get("appointmentDate") ?? "")),
              appointmentTime: String(data.get("appointmentTime") ?? "")
            }
          }
        });
        setNotice({ tone: "ok", text: "La correccion de remesa termino en modo de prueba." });
      }

      if (modal === "reconcile") {
        await submitRndcAction("reconcile", {
          detail,
          documentId,
          businessKey: `reconcile:${documentId}:${Date.now()}`,
          payload: { documentType: documentTypeForQuery(document), documentNumber: document.number }
        });
        setNotice({ tone: "ok", text: "La consulta de conciliacion quedo guardada sin borrar evidencia anterior." });
      }

      if (modal === "acceptance") {
        const from = toYearFirstDate(String(data.get("from") ?? ""));
        const to = toYearFirstDate(String(data.get("to") ?? ""));
        await submitRndcAction("query_acceptance", {
          detail,
          documentId,
          businessKey: `acceptance:${documentId}:${from}:${to}:${Date.now()}`,
          payload: { from, to }
        });
        setNotice({ tone: "ok", text: "La consulta de aceptacion electronica quedo guardada como evidencia protegida." });
      }

      if (modal === "annul") {
        const action = document.kind === "manifiesto" ? "annul_manifest" : "annul_remesa";
        const payload = document.kind === "manifiesto"
          ? { target: "manifest", manifestNumber: document.number, reasonCode: String(data.get("reasonCode") ?? "A"), observations: String(data.get("observations") ?? "") }
          : { target: "remesa", remesaNumber: document.number, reasonCode: String(data.get("reasonCode") ?? "A"), observations: String(data.get("observations") ?? "") };
        await submitRndcAction(action, {
          detail,
          documentId,
          businessKey: `${action}:${documentId}`,
          payload
        });
        setNotice({ tone: "ok", text: `Se proceso unicamente ${document.kind === "manifiesto" ? "el manifiesto" : "la remesa"} seleccionado.` });
      }

      setModal(null);
    } catch (cause) {
      setNotice({ tone: "bad", text: readActionError(cause) });
    } finally {
      setBusy("");
    }
  }

  async function uploadFile(file: File) {
    setBusy("evidence");
    try {
      const uploadUrl = await generateUploadUrl({});
      const uploadResponse = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (!uploadResponse.ok) {
        throw new Error("No fue posible cargar el archivo");
      }
      const uploaded = await uploadResponse.json() as { storageId: Id<"_storage"> };
      const artifactId = await finalizeUpload({
        organizationId: detail.expediente.organizationId,
        expedienteId,
        storageId: uploaded.storageId,
        kind: file.type.startsWith("image/") ? "photo" : "pod",
        fileName: file.name
      });
      await attachEvidence({ expedienteId, evidenceArtifactId: artifactId, kind: file.type.startsWith("image/") ? "photo" : "pod", notes: "Evidencia cargada desde el detalle del expediente" });
      setNotice({ tone: "ok", text: "La evidencia quedo protegida y vinculada al expediente." });
    } catch (cause) {
      setNotice({ tone: "bad", text: readActionError(cause) });
    } finally {
      setBusy("");
      if (fileRef.current) {
        fileRef.current.value = "";
      }
    }
  }

  return (
    <>
      <div className="detail-breadcrumb"><Link href="/expedientes">Expedientes</Link><Chevron /> <span>{detail.expediente.code}</span></div>
      <section className="expediente-hero">
        <div>
          <div className="hero-title-line"><h2>{detail.expediente.code}</h2><StatusBadge status={detail.expediente.status} /></div>
          <p>Orden {detail.serviceOrder.code} · Creado {formatDate(detail.expediente.createdAt)}</p>
        </div>
        <div className="hero-actions">
          {canEdit ? <button className="ghost-button" onClick={() => setModal("novelty")} type="button">Registrar novedad</button> : null}
          {canEdit ? <Link className="ghost-button action-link" href="/expedientes/nuevo">Crear otro expediente</Link> : null}
        </div>
      </section>

      {notice ? <div className={`operation-notice ${notice.tone}`} role="status"><span />{notice.text}<button aria-label="Cerrar aviso" onClick={() => setNotice(null)} type="button">×</button></div> : null}

      <section className="expediente-summary" aria-label="Resumen del expediente">
        <SummaryItem label="Cliente" value={detail.customer.name} meta={detail.serviceOrder.customerReference ?? detail.customer.code} />
        <SummaryItem label="Informacion de carga" value={detail.serviceOrder.cargoDescription} meta={formatWeight(detail.serviceOrder.cargoWeightKg)} />
        <SummaryItem label="Ruta" value={`${detail.loadingLocation.city} → ${detail.unloadingLocation.city}`} meta={`${detail.loadingLocation.name} a ${detail.unloadingLocation.name}`} />
        <SummaryItem label="Programacion" value={formatDate(detail.serviceOrder.scheduledLoadingAt)} meta={detail.serviceOrder.scheduledUnloadingAt ? `Descargue ${formatDate(detail.serviceOrder.scheduledUnloadingAt)}` : "Descargue por confirmar"} />
      </section>

      <div className="expediente-detail-grid">
        <div className="detail-main-column">
          <section className="detail-card assignment-card">
            <div className="detail-card-head"><div><span className="eyebrow">Preparacion</span><h3>Asignacion y cumplimiento</h3></div><span className="completion-count">{completedChecks}/{Math.max(detail.complianceChecks.length, 3)} revisiones</span></div>
            <div className="assignment-grid">
              <AssignmentItem label="Conductor" primary={detail.driver?.name ?? "Sin asignar"} secondary={detail.driver?.document ?? "Completa la asignacion"} ready={Boolean(detail.driver)} />
              <AssignmentItem label="Vehiculo" primary={detail.vehicle?.plate ?? "Sin asignar"} secondary={[detail.vehicle?.make, detail.vehicle?.line].filter(Boolean).join(" ") || "Completa la asignacion"} ready={Boolean(detail.vehicle)} />
              <AssignmentItem label="Remolque" primary={detail.trailer?.plate ?? "Sin asignar"} secondary={detail.trailer?.trailerType ?? "Opcional segun configuracion"} ready={Boolean(detail.trailer)} />
            </div>
            {detail.complianceChecks.length > 0 ? <div className="compliance-strip">{detail.complianceChecks.slice(0, 4).map((check) => <span key={check._id} className={check.status === "passed" ? "ok" : check.status}>{check.checkType.replaceAll("_", " ")}</span>)}</div> : null}
          </section>

          <section className="detail-card">
            <div className="detail-card-head"><div><span className="eyebrow">Documentos oficiales</span><h3>Remesas y manifiesto</h3></div>{canEdit && canAddRemesa ? <button className="text-button" onClick={() => setModal("remesa")} type="button">Agregar remesa</button> : null}</div>
            <div className="document-stack">
              {detail.remesas.map((remesa) => {
                const document = detail.documents.find((item) => item._id === remesa.documentId);
                return <DocumentLine key={remesa._id} kind={`Remesa ${remesa.sequence}`} number={remesa.number} state={document?.officialState ?? remesa.officialState} meta={`${remesa.cargoDescription} · ${formatWeight(remesa.cargoWeightKg)}`} />;
              })}
              {detail.remesas.length === 0 ? <div className="inline-empty">No hay remesas preparadas.</div> : null}
              <DocumentLine kind="Manifiesto" number={manifest?.number ?? detail.expediente.manifestNumber} state={manifest?.officialState ?? "draft"} meta={`${detail.remesas.length} remesas vinculadas`} highlighted />
            </div>
          </section>

          <section className="detail-card">
            <div className="detail-card-head"><div><span className="eyebrow">Seguimiento</span><h3>Cronologia y novedades</h3></div>{openNovelties.length > 0 ? <span className="attention-chip">{openNovelties.length} abiertas</span> : null}</div>
            <div className="timeline">
              {[...detail.novelties.map((item) => ({ id: item._id, title: item.description, details: `Novedad ${item.severity}`, date: item.openedAt, tone: item.status === "open" ? "warn" : "ok" })), ...detail.events.map((item) => ({ id: item._id, title: item.title, details: item.details, date: item.occurredAt, tone: "neutral" }))]
                .sort((a, b) => b.date - a.date)
                .slice(0, 8)
                .map((item) => <div className="timeline-item" key={item.id}><span className={`timeline-dot ${item.tone}`} /><div><strong>{item.title}</strong>{item.details ? <p>{item.details}</p> : null}<time>{formatTimestamp(item.date)}</time></div></div>)}
              {detail.events.length === 0 && detail.novelties.length === 0 ? <div className="inline-empty">La actividad del expediente aparecera aqui.</div> : null}
            </div>
          </section>

          <section className="detail-card">
            <div className="detail-card-head"><div><span className="eyebrow">Custodia</span><h3>Evidencia</h3></div>{canEdit ? <button className="text-button" disabled={busy === "evidence"} onClick={() => fileRef.current?.click()} type="button">Agregar evidencia</button> : null}</div>
            <input className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file); }} ref={fileRef} type="file" />
            <div className="evidence-grid">
              {(evidence ?? []).map((artifact) => <a className="evidence-tile" download href={`/api/evidence/${artifact._id}`} key={artifact._id}><FileIcon /><span><strong>{artifact.fileName}</strong><small>{artifact.kind} · {formatBytes(artifact.size)}</small></span></a>)}
              {evidence?.length === 0 ? <div className="inline-empty">Carga POD, fotos o firmas; las descargas requieren sesion.</div> : null}
            </div>
          </section>
        </div>

        <aside className="rndc-action-rail" aria-label="Acciones RNDC">
          <div className="action-rail-head"><span className="rail-icon"><SignalIcon /></span><div><span className="eyebrow">Canal oficial</span><h3>Acciones RNDC</h3></div></div>
          <p>Las acciones se registran antes del envio y nunca se repiten automaticamente.</p>
          <button className="rail-action primary" disabled={!canEdit || Boolean(busy) || manifestAnnulled || emissionComplete} onClick={() => void runEmission()} type="button"><SendIcon /><span><strong>{busy === "emit" ? "Emitiendo…" : "Emitir documentos"}</strong><small>{manifestAnnulled ? "Manifiesto anulado" : emissionComplete ? "Documentos autorizados" : "Remesas y manifiesto"}</small></span></button>
          <button className="rail-action" disabled={!canEdit || Boolean(busy) || detail.documents.length === 0} onClick={() => setModal("reconcile")} type="button"><SearchIcon /><span><strong>Consultar y conciliar</strong><small>Confirmar estado oficial</small></span></button>
          <button className="rail-action" disabled={!canEdit || Boolean(busy) || !manifest} onClick={() => setModal("acceptance")} type="button"><SignatureIcon /><span><strong>Consultar aceptacion</strong><small>Proceso 73 por fechas</small></span></button>
          <button className="rail-action" disabled={!canEdit || Boolean(busy) || !canCorrect} onClick={() => setModal("correct")} type="button"><EditIcon /><span><strong>Corregir remesa</strong><small>Proceso 38 controlado</small></span></button>
          <button className="rail-action" disabled={!canEdit || Boolean(busy) || !canRunFulfillment} onClick={() => void runFulfillment()} type="button"><CheckIcon /><span><strong>{busy === "fulfill" ? "Cumpliendo…" : "Cumplir documentos"}</strong><small>{manifestAnnulled ? "Manifiesto anulado" : fulfillmentComplete ? "Cumplidos completos" : !emissionComplete ? "Autoriza primero" : "Remesas antes del manifiesto"}</small></span></button>
          <button className="rail-action danger" disabled={!canEdit || Boolean(busy) || !canAnnul} onClick={() => setModal("annul")} type="button"><CancelIcon /><span><strong>Anular documento</strong><small>Solo el seleccionado</small></span></button>
          {process.env.NEXT_PUBLIC_ENABLE_TIMEOUT_SIMULATION === "true" ? <button className="rail-action diagnostic" disabled={!canEdit || Boolean(busy) || !manifest} onClick={() => void runTimeoutProbe()} type="button"><ClockIcon /><span><strong>{busy === "timeout" ? "Simulando…" : "Probar recuperacion"}</strong><small>Timeout local sin reenvio</small></span></button> : null}
          <div className="rail-divider" />
          <div className="queue-summary"><span>Operaciones registradas</span><strong>{operations?.length ?? "—"}</strong></div>
          {(operations ?? []).slice(0, 4).map((operation) => <div className="queue-row" key={operation._id}><span>{operation.operationType.replaceAll("_", " ")}</span><StatusBadge status={operation.status} /></div>)}
          <div className="dry-run-assurance"><span />Modo prueba activo. Ninguna accion de esta pantalla puede usar credenciales reales.</div>
        </aside>
      </div>

      {modal ? <ModalPanel modal={modal} detail={detail} busy={Boolean(busy)} onClose={() => setModal(null)} onNovelty={saveNovelty} onRemesa={saveRemesa} onSpecial={submitSpecialAction} /> : null}
    </>
  );
}

async function submitRndcAction(
  action: string,
  input: {
    detail: Detail;
    documentId?: Id<"documents">;
    remesa?: RemesaRow;
    businessKey: string;
    payload: Record<string, unknown>;
    simulateTimeout?: boolean;
  }
) {
  const requestKey = crypto.randomUUID();
  const response = await fetch(`/api/rndc/actions/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      organizationId: input.detail.expediente.organizationId,
      expedienteId: input.detail.expediente._id,
      documentId: input.documentId,
      expedienteRemesaId: input.remesa?._id,
      requestKey,
      businessKey: input.businessKey,
      payload: input.payload,
      simulateTimeout: input.simulateTimeout
    })
  });
  const body = await response.json() as { error?: string | { message?: string }; evidenceStored?: boolean; result?: unknown };

  if (!response.ok) {
    const message = typeof body.error === "string" ? body.error : body.error?.message;
    throw new Error(message ?? findNestedError(body.result) ?? "La accion RNDC no termino correctamente");
  }

  if (body.evidenceStored !== true) {
    throw new Error("La operacion termino, pero su evidencia permanente no quedo guardada. No la reenvies; concilia el estado y revisa el almacenamiento.");
  }

  return body;
}

function buildRndcPayload(detail: Detail, selectedRemesa?: RemesaRow): Record<string, unknown> {
  const loadingDate = detail.serviceOrder.scheduledLoadingAt ?? Date.now();
  const unloadingDate = detail.serviceOrder.scheduledUnloadingAt ?? loadingDate;
  const remesa = selectedRemesa ?? detail.remesas[0];
  return {
    seed: detail.expediente.code,
    cargoNumber: detail.expediente.cargoNumber,
    tripNumber: detail.expediente.tripNumber,
    remesaNumber: remesa?.number,
    manifestNumber: detail.expediente.manifestNumber,
    expeditionDate: formatRndcDate(Date.now()),
    loadingAppointmentDate: formatRndcDate(loadingDate),
    loadingAppointmentTime: formatTime(loadingDate),
    unloadingAppointmentDate: formatRndcDate(unloadingDate),
    unloadingAppointmentTime: formatTime(unloadingDate),
    balancePaymentDate: formatRndcDate(Date.now()),
    driver: { id: detail.driver?.document, fullName: detail.driver?.name },
    vehicle: { plate: detail.vehicle?.plate, trailerPlate: detail.trailer?.plate, brand: detail.vehicle?.make },
    sender: { name: detail.customer.name, cityName: detail.loadingLocation.city, address: detail.loadingLocation.address },
    recipient: { name: remesa?.consigneeName ?? detail.customer.name, cityName: detail.unloadingLocation.city, address: detail.unloadingLocation.address },
    cargo: {
      productName: remesa?.cargoDescription ?? detail.serviceOrder.cargoDescription,
      shortDescription: remesa?.cargoDescription ?? detail.serviceOrder.cargoDescription,
      quantityKg: remesa?.cargoWeightKg ?? detail.serviceOrder.cargoWeightKg
    },
    money: { freightValue: detail.serviceOrder.agreedRate, advanceValue: 0 },
    ...(selectedRemesa ? {} : {
      manifestRemesas: detail.remesas.map((item) => ({
        number: item.number,
        quantityKg: item.cargoWeightKg,
        productName: item.cargoDescription,
        recipientName: item.consigneeName
      }))
    }),
    fopat: { operationType: detail.loadingLocation.city === detail.unloadingLocation.city ? "municipal" : "intermunicipal" }
  };
}

function ModalPanel({ modal, detail, busy, onClose, onNovelty, onRemesa, onSpecial }: { modal: Exclude<Modal, null>; detail: Detail; busy: boolean; onClose: () => void; onNovelty: (event: FormEvent<HTMLFormElement>) => void; onRemesa: (event: FormEvent<HTMLFormElement>) => void; onSpecial: (event: FormEvent<HTMLFormElement>) => void }) {
  const title = modal === "novelty" ? "Registrar novedad" : modal === "remesa" ? "Agregar remesa" : modal === "correct" ? "Corregir remesa" : modal === "annul" ? "Anular documento" : modal === "acceptance" ? "Consultar aceptacion" : "Consultar y conciliar";
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-head"><div><span className="eyebrow">Expediente {detail.expediente.code}</span><h2 id="modal-title">{title}</h2></div><button aria-label="Cerrar" onClick={onClose} type="button">×</button></div>
        {modal === "novelty" ? <form className="modal-form" onSubmit={onNovelty}><label><span>Categoria</span><select name="category"><option value="operativa">Operativa</option><option value="documental">Documental</option><option value="ruta">Ruta</option></select></label><label><span>Severidad</span><select name="severity"><option value="info">Informativa</option><option value="warning">Atencion</option><option value="critical">Critica</option></select></label><label className="wide"><span>Descripcion</span><textarea name="description" required rows={4} /></label><ModalActions busy={busy} onClose={onClose} /></form> : null}
        {modal === "remesa" ? <form className="modal-form" onSubmit={onRemesa}><label><span>Numero de remesa</span><input name="number" /></label><label><span>Peso kg</span><input min="0" name="weightKg" type="number" /></label><label className="wide"><span>Descripcion de la carga</span><input name="description" required /></label><label><span>Destinatario</span><input name="consigneeName" /></label><label><span>Identificacion</span><input name="consigneeDocument" /></label><ModalActions busy={busy} onClose={onClose} /></form> : null}
        {modal === "correct" ? <form className="modal-form" onSubmit={onSpecial}><DocumentSelect action="correct" detail={detail} kind="remesa" /><label><span>Motivo RNDC</span><select name="reasonCode"><option value="1">Error de digitacion</option><option value="2">Cambio operativo</option><option value="3">Solicitud del titular</option></select></label><label><span>Nueva fecha de cita</span><input name="appointmentDate" required type="date" /></label><label><span>Nueva hora</span><input name="appointmentTime" required type="time" /></label><div className="modal-warning wide">Se enviara exclusivamente el proceso 38 y quedara una fotografia de la solicitud.</div><ModalActions busy={busy} onClose={onClose} /></form> : null}
        {modal === "reconcile" ? <form className="modal-form" onSubmit={onSpecial}><DocumentSelect detail={detail} /><div className="modal-info wide">La consulta crea evidencia nueva y no reenvia el documento, incluso si el ultimo intento quedo incierto.</div><ModalActions busy={busy} onClose={onClose} /></form> : null}
        {modal === "acceptance" ? <form className="modal-form" onSubmit={onSpecial}><DocumentSelect action="acceptance" detail={detail} kind="manifiesto" /><label><span>Desde</span><input defaultValue={todayIso()} name="from" required type="date" /></label><label><span>Hasta</span><input defaultValue={todayIso()} name="to" required type="date" /></label><div className="modal-info wide">La consulta usa el proceso 73 y conserva tipo, actor, fecha y observacion cuando RNDC devuelve registros.</div><ModalActions busy={busy} onClose={onClose} /></form> : null}
        {modal === "annul" ? <form className="modal-form" onSubmit={onSpecial}><DocumentSelect action="annul" detail={detail} /><label><span>Codigo de motivo</span><input defaultValue="A" maxLength={1} name="reasonCode" required /></label><label className="wide"><span>Justificacion operativa</span><textarea maxLength={200} name="observations" required rows={4} /></label><div className="modal-warning wide">Solo se anulara el documento seleccionado. No se ejecutara una cadena automatica.</div><ModalActions busy={busy} danger onClose={onClose} /></form> : null}
      </section>
    </div>
  );
}

function DocumentSelect({ action, detail, kind }: { action?: "acceptance" | "annul" | "correct"; detail: Detail; kind?: "remesa" | "manifiesto" }) {
  const rows = detail.documents.filter((document) => {
    if (kind && document.kind !== kind) return false;
    if (!kind && document.kind !== "remesa" && document.kind !== "manifiesto") return false;
    if (action === "correct") return isIssuedState(document.officialState) && document.annulmentState !== "annulled";
    if (action === "annul") return isIssuedState(document.officialState) && document.annulmentState !== "annulled";
    if (action === "acceptance") return isIssuedState(document.officialState);
    return true;
  });
  return <label className="wide"><span>Documento</span><select name="documentId" required><option value="">Selecciona</option>{rows.map((document) => <option key={document._id} value={document._id}>{document.kind} {document.number ?? "sin numero"} · {document.officialState ?? document.status}</option>)}</select></label>;
}

function ModalActions({ busy, danger = false, onClose }: { busy: boolean; danger?: boolean; onClose: () => void }) {
  return <div className="modal-actions wide"><button className="ghost-button" onClick={onClose} type="button">Cancelar</button><button className={danger ? "danger-action" : "primary-action"} disabled={busy} type="submit">{busy ? "Procesando…" : "Confirmar"}</button></div>;
}

function SummaryItem({ label, value, meta }: { label: string; value: string; meta: string }) {
  return <div className="summary-item"><span>{label}</span><strong>{value}</strong><small>{meta}</small></div>;
}

function AssignmentItem({ label, primary, secondary, ready }: { label: string; primary: string; secondary: string; ready: boolean }) {
  return <div className="assignment-item"><span className={ready ? "assignment-icon ok" : "assignment-icon"}>{ready ? <CheckIcon /> : <CancelIcon />}</span><div><small>{label}</small><strong>{primary}</strong><span>{secondary}</span></div></div>;
}

function DocumentLine({ highlighted = false, kind, meta, number, state }: { highlighted?: boolean; kind: string; meta: string; number?: string; state: string }) {
  return <div className={highlighted ? "document-line highlighted" : "document-line"}><span className="document-icon"><FileIcon /></span><div><small>{kind}</small><strong>{number ?? "Numero pendiente"}</strong><span>{meta}</span></div><StatusBadge status={state} /></div>;
}

function formatDate(value?: number): string {
  if (!value) return "Por confirmar";
  return new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short", year: "numeric" }).format(value);
}

function formatTimestamp(value: number): string {
  return new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(value);
}

function formatWeight(value?: number): string {
  return value === undefined ? "Peso por confirmar" : `${new Intl.NumberFormat("es-CO").format(value)} kg`;
}

function formatBytes(value: number): string {
  return value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${Math.round(value / 1024)} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRndcDate(value: number): string {
  const date = new Date(value);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function formatTime(value: number): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function toSlashDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function toYearFirstDate(value: string): string {
  return value.replaceAll("-", "/");
}

function todayIso(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function optionalValue(data: FormData, key: string): string | undefined {
  const value = String(data.get(key) ?? "").trim();
  return value || undefined;
}

function numberValue(data: FormData, key: string): number | undefined {
  const value = optionalValue(data, key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function documentTypeForQuery(document: DocumentRow): string {
  return document.kind === "manifiesto" ? "manifest" : document.kind === "remesa" ? "remesa" : "cargo";
}

function readActionError(cause: unknown): string {
  return cause instanceof Error ? cause.message : "La accion no pudo completarse";
}

function isIssuedState(state: string | undefined): boolean {
  return state === "authorized" || state === "fulfilled";
}

function findNestedError(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  if (typeof record.error === "string") return record.error;
  if (record.response && typeof record.response === "object" && typeof (record.response as Record<string, unknown>).errorText === "string") return (record.response as Record<string, unknown>).errorText as string;
  return null;
}

function Chevron() { return <svg className="breadcrumb-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" aria-hidden><path d="m4 2 4 4-4 4" /></svg>; }
function SignalIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden><path d="M5 18a10 10 0 0 1 14 0M8 14a6 6 0 0 1 8 0M11 10a2 2 0 0 1 2 0" strokeLinecap="round" /><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none" /></svg>; }
function SendIcon() { return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden><path d="m17 3-7.5 8M17 3l-4.2 14-3.3-6L3 7.5 17 3Z" strokeLinejoin="round" /></svg>; }
function SearchIcon() { return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden><circle cx="8.5" cy="8.5" r="5" /><path d="m12.2 12.2 4 4" strokeLinecap="round" /></svg>; }
function SignatureIcon() { return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden><path d="M3 14c3.5-5 5.5-7 7-7 2 0 0 5 1.5 5 1 0 1.5-2 2.5-2s.8 2.2 3 2" strokeLinecap="round" strokeLinejoin="round" /><path d="M3 16h14" strokeLinecap="round" /></svg>; }
function EditIcon() { return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden><path d="M4 13.5V16h2.5L16 6.5 13.5 4 4 13.5Z" strokeLinejoin="round" /><path d="m11.8 5.7 2.5 2.5" /></svg>; }
function CheckIcon() { return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden><path d="m4 10 4 4 8-9" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function CancelIcon() { return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden><path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" /></svg>; }
function ClockIcon() { return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden><circle cx="10" cy="10" r="7" /><path d="M10 6v4l3 2" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function FileIcon() { return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden><path d="M5 2.5h6l4 4v11H5v-15Z" strokeLinejoin="round" /><path d="M11 2.5v4h4M7.5 10h5M7.5 13h5" /></svg>; }

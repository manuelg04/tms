"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { dispatchPrimaryAction } from "../../../convex/model/dispatchPresentation";
import type { DispatchStage } from "../../../convex/model/dispatchWorkflow";
import { useDemoUser } from "../../providers";
import { StatusBadge } from "../status-badge";
import { AdvancedActions } from "../components/advanced-actions";
import { BlockerList } from "../components/blocker-list";
import { ConsignmentFulfillmentForm, ManifestFulfillmentForm } from "../components/consignment-fulfillment-form";
import { DispatchStageNav } from "../components/dispatch-stage-nav";
import { DocumentHistory } from "../components/document-history";
import {
  AssignmentForm,
  ConsignmentsForm,
  LoadingOrderForm,
  ManifestForm,
  ReviewStage
} from "../components/draft-stage-forms";
import { LogisticsTimesForm } from "../components/logistics-times-form";
import { NextActionCard } from "../components/next-action-card";

type Detail = NonNullable<FunctionReturnType<typeof api.expedientes.detail>>;
type AdvancedModal = "correct" | "annul" | "reconcile" | null;

export default function DespachoDetailPage() {
  const params = useParams<{ id: string }>();
  const expedienteId = params.id as Id<"expedientes">;
  const detailResult = useQuery(api.expedientes.detail, { expedienteId });
  const stageResult = useQuery(api.dispatches.stage, { expedienteId });
  const operations = useQuery(api.rndcOperations.listForExpediente, { expedienteId, limit: 60 });
  const uncertainOperations = useQuery(api.rndcOperations.listUncertainForExpediente, { expedienteId });
  const evidence = useQuery(api.evidence.listForExpediente, { expedienteId, limit: 80 });
  const { user } = useDemoUser();
  const [selectedStage, setSelectedStage] = useState<DispatchStage>("orden_cargue");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad" | "wait"; text: string } | null>(null);
  const [advancedModal, setAdvancedModal] = useState<AdvancedModal>(null);
  const saveLoadingOrder = useMutation(api.dispatches.saveLoadingOrderDraft);
  const saveConsignments = useMutation(api.dispatches.saveConsignmentsDraft);
  const saveAssignment = useMutation(api.dispatches.saveAssignmentDraft);
  const saveManifest = useMutation(api.dispatches.saveManifestDraft);
  const recordLogistics = useMutation(api.dispatches.recordLogisticsTimes);
  const recordFulfillment = useMutation(api.dispatches.recordFulfillmentDraft);
  const recordManifestFulfillment = useMutation(api.dispatches.recordManifestFulfillmentDraft);

  useEffect(() => {
    if (stageResult?.stage && stageResult.stage !== "cumplido" && stageResult.stage !== "anulado") {
      setSelectedStage(stageResult.stage);
    }
  }, [stageResult?.stage]);

  if (detailResult === undefined || stageResult === undefined) {
    return <div className="full-page-state">Preparando el despacho…</div>;
  }

  if (detailResult === null || stageResult === null) {
    return <section className="panel expediente-empty"><strong>El despacho no existe o no está disponible.</strong><Link className="ghost-button action-link" href="/expedientes">Volver a Despachos</Link></section>;
  }

  const detail = detailResult;
  const manifestDocument = detail.documents.find((document) => document.kind === "manifiesto");
  const orderDocument = detail.documents.find((document) => document.kind === "orden_cargue");
  const hasUncertainOperation = (operations ?? []).some((operation) => operation.status === "uncertain" || operation.status === "reconciling");
  const hasRejectedOperation = (operations ?? []).some((operation) => operation.status === "failed");
  const hasOperationInFlight = (operations ?? []).some((operation) => operation.status === "queued" || operation.status === "claimed");
  const primaryAction = dispatchPrimaryAction({
    stage: stageResult.stage,
    blockers: stageResult.blockers,
    hasRejectedOperation,
    hasUncertainOperation,
    hasOperationInFlight,
    printed: Boolean(detail.expediente.loadingOrderDraft?.printedAt && detail.expediente.manifestDraft?.printedAt)
  });
  const canEdit = user?.role === "operator" || user?.role === "admin";
  const isDraft = detail.expediente.status === "draft";
  const formId = canEdit && ["orden_cargue", "remesas", "vehiculo_conductor", "manifiesto", "cargue_descargue", "cumplido_inicial", "cumplido_final"].includes(stageResult.stage)
    && !["reconcile", "review_rejection", "wait"].includes(primaryAction.kind)
    ? "stage-primary-form"
    : undefined;

  function moveTo(stage: DispatchStage, message: string) {
    setSelectedStage(stage);
    setNotice({ tone: "ok", text: message });
    requestAnimationFrame(() => document.getElementById("active-stage-title")?.focus());
  }

  async function saveOrder(data: FormData) {
    if (!isDraft) return;
    await run(async () => {
      const previous = detail.expediente.loadingOrderDraft;
      await saveLoadingOrder({
        expedienteId,
        draft: {
          ...previous,
          agencyCode: value(data, "agencyCode"),
          customerReference: value(data, "customerReference"),
          sender: { ...previous?.sender, name: required(data, "senderName"), identificationNumber: required(data, "senderId") },
          recipient: { ...previous?.recipient, name: required(data, "recipientName"), identificationNumber: required(data, "recipientId") },
          loading: { ...previous?.loading, siteName: required(data, "loadingName"), cityName: required(data, "loadingCity"), address: required(data, "loadingAddress"), municipalityCode: value(data, "loadingMunicipality"), appointmentAt: timestamp(data, "loadingAppointment") },
          unloading: { ...previous?.unloading, siteName: required(data, "unloadingName"), cityName: required(data, "unloadingCity"), address: required(data, "unloadingAddress"), municipalityCode: value(data, "unloadingMunicipality"), appointmentAt: timestamp(data, "unloadingAppointment") },
          cargoDescription: required(data, "cargoDescription"),
          cargoQuantity: value(data, "cargoQuantity"),
          cargoUnit: value(data, "cargoUnit"),
          weightTons: required(data, "weightTons"),
          volumeM3: value(data, "volumeM3"),
          packagingCode: required(data, "packagingCode"),
          merchandiseCode: value(data, "merchandiseCode"),
          observations: value(data, "observations"),
          generatesConsignment: true
        }
      });
      moveTo("remesas", "La orden de cargue quedó guardada. Los datos conocidos ya están disponibles para las remesas.");
    });
  }

  async function saveRemesas(data: FormData) {
    if (!isDraft) return;
    await run(async () => {
      const editableRows = detail.remesas.length > 0 ? detail.remesas.filter((remesa) => remesa.officialState === "draft") : [null];
      await saveConsignments({
        expedienteId,
        upserts: editableRows.map((remesa, index) => {
          const key = remesa?._id ?? "new";
          return {
            remesaId: remesa?._id,
            sequence: remesa?.sequence ?? index + 1,
            draft: {
              ...remesa?.draft,
              consignmentClass: (value(data, `${key}_class`) ?? "terrestre_carga") as "municipal" | "terrestre_carga",
              declaredValue: required(data, `${key}_declaredValue`),
              recipient: value(data, `${key}_recipientName`) ? { name: value(data, `${key}_recipientName`), identificationNumber: value(data, `${key}_recipientId`) } : undefined,
              remissions: [{ description: value(data, `${key}_description`), weightTons: value(data, `${key}_weightTons`) }],
              generalObservations: value(data, `${key}_observations`)
            }
          };
        })
      });
      moveTo("vehiculo_conductor", "Las remesas quedaron guardadas y siguen heredando la información de la orden.");
    });
  }

  async function saveFleet(values: { driverId?: string; vehicleId?: string }) {
    if (!isDraft) return;
    await run(async () => {
      if (!values.driverId || !values.vehicleId) throw new Error("Selecciona un conductor y un vehículo existentes en maestros.");
      await saveAssignment({ expedienteId, driverId: values.driverId as Id<"drivers">, vehicleId: values.vehicleId as Id<"vehicles"> });
      moveTo("manifiesto", "El vehículo y el conductor quedaron asignados al despacho.");
    });
  }

  async function saveManifestStage(data: FormData) {
    if (!isDraft) return;
    await run(async () => {
      await saveManifest({
        expedienteId,
        draft: {
          ...detail.expediente.manifestDraft,
          issueDate: required(data, "issueDate"),
          estimatedDeliveryDate: required(data, "estimatedDeliveryDate"),
          operationScope: required(data, "operationScope") as "municipal" | "intermunicipal",
          manifestType: required(data, "manifestType"),
          agencyCode: detail.expediente.agencyCode,
          originCityName: detail.loadingLocation.city,
          destinationCityName: detail.unloadingLocation.city,
          freightTotal: required(data, "freightTotal"),
          advance: value(data, "advance"),
          withholdingSource: value(data, "withholdingSource"),
          withholdingIca: value(data, "withholdingIca"),
          fopatContribution: value(data, "fopatContribution"),
          adjustments: value(data, "adjustments"),
          netPayable: required(data, "netPayable"),
          paymentResponsible: required(data, "paymentResponsible"),
          loadingResponsible: value(data, "loadingResponsible"),
          unloadingResponsible: value(data, "unloadingResponsible"),
          paymentDate: value(data, "paymentDate"),
          observations: value(data, "observations")
        }
      });
      moveTo("envio_rndc", "El manifiesto quedó guardado. Revisa el resumen y los bloqueos antes de enviar.");
    });
  }

  async function saveLogistics(data: FormData) {
    await run(async () => {
      await recordLogistics({
        expedienteId,
        origin: logisticsSite(data, "origin"),
        destination: logisticsSite(data, "destination"),
        finalDelivery: { occurredAt: timestamp(data, "finalDelivery"), observation: value(data, "finalDeliveryObservation") }
      });
      moveTo("cumplido_inicial", "Los tiempos reales quedaron registrados. Ya puedes revisar el cumplido de cada remesa.");
    });
  }

  async function fulfillRemesas(data: FormData) {
    await run(async () => {
      for (const remesa of detail.remesas.filter((row) => row.fulfillmentState !== "fulfilled")) {
        await recordFulfillment({
          expedienteId,
          remesaId: remesa._id,
          draft: {
            deliveredQuantity: required(data, `${remesa._id}_delivered`),
            missingQuantity: value(data, `${remesa._id}_missing`),
            surplusQuantity: value(data, `${remesa._id}_surplus`),
            returnedQuantity: value(data, `${remesa._id}_returned`),
            unit: remesa.cargoUnit ?? "kg",
            observation: value(data, `${remesa._id}_observation`)
          }
        });
      }
      await callDispatchRoute("fulfill", { scope: "remesas" });
      moveTo("cumplido_final", "Todas las remesas disponibles quedaron cumplidas. El manifiesto sigue abierto hasta el cierre final.");
    });
  }

  async function fulfillManifest(data: FormData) {
    await run(async () => {
      await recordManifestFulfillment({ expedienteId, draft: { documentsDeliveryDate: required(data, "documentsDeliveryDate"), observation: value(data, "observation") } });
      await callDispatchRoute("fulfill", { scope: "manifiesto" });
      setNotice({ tone: "ok", text: "El manifiesto quedó cumplido y el despacho está cerrado." });
    });
  }

  async function runPrimaryAction() {
    if (primaryAction.kind === "emit") {
      await run(async () => {
        await callDispatchRoute("emit", {});
        setNotice({ tone: "ok", text: "La secuencia documental terminó en modo de prueba y conservó su evidencia." });
      });
      return;
    }
    if (primaryAction.kind === "reconcile") {
      setAdvancedModal("reconcile");
      return;
    }
    if (primaryAction.kind === "review_rejection") {
      setAdvancedModal("correct");
      return;
    }
    if (primaryAction.kind === "print" || primaryAction.kind === "view") {
      document.getElementById("documentos-historial")?.scrollIntoView({ behavior: "smooth" });
    }
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      setNotice({ tone: "bad", text: cause instanceof Error ? cause.message.replace(/^.*?: /, "") : "No fue posible completar la acción." });
    } finally {
      setBusy(false);
    }
  }

  async function callDispatchRoute(route: "emit" | "fulfill", body: Record<string, unknown>) {
    const response = await fetch(`/api/rndc/dispatches/${expedienteId}/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json() as { error?: string; detail?: string; blockers?: unknown; nextAction?: string };
    if (!response.ok) throw new Error(result.detail ?? result.error ?? "La operación RNDC no terminó correctamente.");
    return result;
  }

  const currentForm = renderStage({
    detail,
    selectedStage,
    isDraft,
    orderReadOnly: !isDraft || Boolean(orderDocument && orderDocument.officialState !== "draft"),
    manifestReadOnly: !isDraft || Boolean(manifestDocument && manifestDocument.officialState !== "draft"),
    saveOrder,
    saveRemesas,
    saveFleet,
    saveManifestStage,
    saveLogistics,
    fulfillRemesas,
    fulfillManifest
  });

  return (
    <>
      <div className="detail-breadcrumb"><Link href="/expedientes">Despachos</Link><span>›</span><span>{detail.expediente.code}</span></div>
      <section className="dispatch-detail-hero">
        <div>
          <div className="hero-title-line"><span className="dispatch-file-label">Expediente de viaje</span><StatusBadge status={detail.expediente.status} /></div>
          <h2>{detail.expediente.code}</h2>
          <p>{detail.customer.name} · Orden de servicio {detail.serviceOrder.code}</p>
        </div>
        <div className="dispatch-hero-route"><span>{detail.loadingLocation.city}</span><strong>→</strong><span>{detail.unloadingLocation.city}</span></div>
      </section>

      <section className="dispatch-compact-summary" aria-label="Resumen del despacho">
        <Summary label="Vehículo" value={detail.vehicle?.plate ?? "Sin asignar"} />
        <Summary label="Conductor" value={detail.driver?.name ?? "Sin asignar"} />
        <Summary label="Orden de cargue" value={detail.expediente.loadingOrderDraft?.orderNumber ?? "Automática"} />
        <Summary label="Remesas" value={detail.remesas.length ? String(detail.remesas.length) : "Pendientes"} />
        <Summary label="Manifiesto" value={detail.expediente.manifestDraft?.manifestNumber ?? "Automático"} />
        <Summary label="RNDC" value={hasUncertainOperation ? "Resultado incierto" : hasRejectedOperation ? "Requiere atención" : hasOperationInFlight ? "En proceso" : "Modo prueba"} />
      </section>

      {notice ? <div className={`operation-notice ${notice.tone}`} role="status"><span />{notice.text}<button aria-label="Cerrar aviso" onClick={() => setNotice(null)} type="button">×</button></div> : null}

      <DispatchStageNav currentStage={stageResult.stage} onSelect={(stage) => { setSelectedStage(stage); requestAnimationFrame(() => document.getElementById("active-stage-title")?.focus()); }} selectedStage={selectedStage} />
      <NextActionCard action={primaryAction} blockers={stageResult.blockers} busy={busy} formId={formId} onAction={() => void runPrimaryAction()} />

      <div className="guided-detail-layout">
        <section className="active-stage-panel" aria-live="polite">
          {currentForm}
          {selectedStage !== stageResult.stage && stageResult.blockers.length > 0 ? <BlockerList blockers={stageResult.blockers} /> : null}
        </section>
        <aside className="dispatch-side-context">
          <div><span className="eyebrow">Documentos vinculados</span><strong>{detail.documents.length}</strong><p>{detail.remesas.length} remesas · {detail.deliveryEvidence.length} soportes</p></div>
          <div><span className="eyebrow">Último cambio</span><strong>{detail.events[0]?.title ?? "Despacho creado"}</strong><p>{formatDate(detail.events[0]?.occurredAt ?? detail.expediente.updatedAt)}</p></div>
          <a href="#documentos-historial">Ver documentos e historial</a>
        </aside>
      </div>

      <DocumentHistory deliveryEvidence={detail.deliveryEvidence} documents={detail.documents} events={detail.events} technicalEvidence={(evidence ?? []).map((item) => ({ _id: item._id, fileName: item.fileName, createdAt: item.createdAt }))} />
      <AdvancedActions canManage={user?.role === "admin"} onAction={setAdvancedModal} />
      {advancedModal ? <AdvancedActionModal detail={detail} modal={advancedModal} onClose={() => setAdvancedModal(null)} operations={uncertainOperations ?? []} onDone={(message) => { setAdvancedModal(null); setNotice({ tone: "ok", text: message }); }} /> : null}
    </>
  );
}

function renderStage(input: {
  detail: Detail;
  selectedStage: DispatchStage;
  isDraft: boolean;
  orderReadOnly: boolean;
  manifestReadOnly: boolean;
  saveOrder: (data: FormData) => void;
  saveRemesas: (data: FormData) => void;
  saveFleet: (values: { driverId?: string; vehicleId?: string }) => void;
  saveManifestStage: (data: FormData) => void;
  saveLogistics: (data: FormData) => void;
  fulfillRemesas: (data: FormData) => void;
  fulfillManifest: (data: FormData) => void;
}) {
  const detail = input.detail;
  if (input.selectedStage === "orden_cargue") return <LoadingOrderForm draft={detail.expediente.loadingOrderDraft ?? {}} onSubmit={input.saveOrder} readOnly={input.orderReadOnly} />;
  if (input.selectedStage === "remesas") return <ConsignmentsForm onSubmit={input.saveRemesas} readOnly={!input.isDraft} remesas={detail.remesas} />;
  if (input.selectedStage === "vehiculo_conductor") return <AssignmentForm currentDriverDocument={detail.driver?.document} currentVehiclePlate={detail.vehicle?.plate} onSubmit={input.saveFleet} readOnly={!input.isDraft} />;
  if (input.selectedStage === "manifiesto") return <ManifestForm draft={detail.expediente.manifestDraft ?? {}} onSubmit={input.saveManifestStage} readOnly={input.manifestReadOnly} />;
  if (input.selectedStage === "envio_rndc") return <ReviewStage mode="PRUEBA" summary={[
    { label: "Orden de cargue", value: detail.expediente.loadingOrderDraft?.orderNumber ?? "Se asignará al enviar" },
    { label: "Remesas", value: `${detail.remesas.length} preparadas`, warning: detail.remesas.length === 0 },
    { label: "Vehículo y conductor", value: detail.vehicle && detail.driver ? `${detail.vehicle.plate} · ${detail.driver.name ?? detail.driver.document}` : "Asignación incompleta", warning: !detail.vehicle || !detail.driver },
    { label: "Manifiesto", value: detail.expediente.manifestDraft?.manifestNumber ?? "Se asignará al enviar" }
  ]} />;
  if (input.selectedStage === "cargue_descargue") return <LogisticsTimesForm destination={detail.expediente.logisticsTimes?.destination} finalDelivery={detail.expediente.logisticsTimes?.finalDelivery} onSubmit={input.saveLogistics} origin={detail.expediente.logisticsTimes?.origin} />;
  if (input.selectedStage === "cumplido_inicial") return <ConsignmentFulfillmentForm onSubmit={input.fulfillRemesas} remesas={detail.remesas} />;
  return <ManifestFulfillmentForm defaultDate={detail.expediente.manifestFulfillmentDraft?.documentsDeliveryDate} defaultObservation={detail.expediente.manifestFulfillmentDraft?.observation} onSubmit={input.fulfillManifest} />;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function logisticsSite(data: FormData, prefix: "origin" | "destination") {
  const event = (key: string) => ({ occurredAt: timestamp(data, `${prefix}_${key}`), observation: value(data, `${prefix}_${key}_observation`) });
  return { arrival: event("arrival"), entry: event("entry"), start: event("start"), end: event("end"), exit: event("exit") };
}

function value(data: FormData, key: string): string | undefined {
  const result = String(data.get(key) ?? "").trim();
  return result || undefined;
}

function required(data: FormData, key: string): string {
  const result = value(data, key);
  if (!result) throw new Error(`Completa ${key.replaceAll(/([A-Z])/g, " $1").toLocaleLowerCase("es")}.`);
  return result;
}

function timestamp(data: FormData, key: string): number {
  const result = new Date(required(data, key)).getTime();
  if (!Number.isFinite(result)) throw new Error(`La fecha de ${key} no es válida.`);
  return result;
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function AdvancedActionModal({ detail, modal, onClose, onDone, operations }: { detail: Detail; modal: Exclude<AdvancedModal, null>; onClose: () => void; onDone: (message: string) => void; operations: Array<{ _id: Id<"rndcOperations">; documentId?: Id<"documents">; status: string }> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const eligible = detail.documents.filter((document) => document.kind === "remesa" || document.kind === "manifiesto");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const documentId = required(data, "documentId") as Id<"documents">;
    const document = detail.documents.find((item) => item._id === documentId);
    if (!document) return;
    const remesa = detail.remesas.find((item) => item.documentId === documentId);
    const original = operations.find((operation) => operation.documentId === documentId && operation.status === "uncertain");
    const action = modal === "correct" ? "correct_remesa" : modal === "reconcile" ? "reconcile" : document.kind === "manifiesto" ? "annul_manifest" : "annul_remesa";
    const payload = modal === "correct"
      ? { remesaNumber: document.number, reasonCode: 1, change: { code: 1, appointmentDate: slashDate(required(data, "appointmentDate")), appointmentTime: required(data, "appointmentTime") } }
      : modal === "annul"
        ? { target: document.kind === "manifiesto" ? "manifest" : "remesa", manifestNumber: document.kind === "manifiesto" ? document.number : undefined, remesaNumber: document.kind === "remesa" ? document.number : undefined, reasonCode: required(data, "reasonCode"), observations: required(data, "observations") }
        : {};
    try {
      const response = await fetch(`/api/rndc/actions/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: detail.expediente.organizationId, expedienteId: detail.expediente._id, documentId, expedienteRemesaId: remesa?._id, originalOperationId: original?._id, requestKey: crypto.randomUUID(), businessKey: `${action}:${documentId}:${Date.now()}`, payload }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "La acción avanzada no terminó correctamente.");
      onDone(modal === "reconcile" ? "La conciliación quedó registrada sin reenviar el documento." : modal === "correct" ? "La corrección quedó registrada con evidencia." : "La anulación quedó registrada con motivo y evidencia.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible completar la acción.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section aria-labelledby="advanced-modal-title" aria-modal="true" className="modal-card" role="dialog"><div className="modal-head"><div><span className="eyebrow">Acción protegida</span><h2 id="advanced-modal-title">{modal === "correct" ? "Corregir remesa" : modal === "annul" ? "Anular documento" : "Conciliar resultado"}</h2></div><button aria-label="Cerrar" onClick={onClose} type="button">×</button></div><form className="modal-form" onSubmit={submit}><label className="wide"><span>Documento</span><select name="documentId" required><option value="">Selecciona</option>{eligible.map((document) => <option key={document._id} value={document._id}>{document.kind} {document.number ?? "sin número"}</option>)}</select></label>{modal === "correct" ? <><label><span>Nueva fecha de cita</span><input name="appointmentDate" required type="date" /></label><label><span>Nueva hora</span><input name="appointmentTime" required type="time" /></label></> : null}{modal === "annul" ? <><label><span>Código de motivo</span><input defaultValue="A" maxLength={1} name="reasonCode" required /></label><label className="wide"><span>Justificación</span><textarea name="observations" required rows={4} /></label></> : null}{modal === "reconcile" ? <div className="modal-info wide">La consulta usa el intento incierto del documento y nunca lo reenvía.</div> : null}{error ? <div className="form-error wide" role="alert">{error}</div> : null}<div className="modal-actions wide"><button className="ghost-button" onClick={onClose} type="button">Cancelar</button><button className={modal === "annul" ? "danger-action" : "primary-action"} disabled={busy} type="submit">{busy ? "Procesando…" : "Confirmar"}</button></div></form></section></div>;
}

function slashDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

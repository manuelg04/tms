"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { dispatchPrimaryAction } from "../../../convex/model/dispatchPresentation";
import {
  consignmentMissingFields,
  emissionDependencyBlockers,
  loadingOrderMissingFields,
  manifestMissingFields,
  type DispatchStage,
  type EmissionScope
} from "../../../convex/model/dispatchWorkflow";
import type { OfficialDocumentState } from "../../../convex/model/documentLifecycle";
import { useDemoUser } from "../../providers";
import { StatusBadge } from "../status-badge";
import { AdvancedActions, type AdvancedAction } from "../components/advanced-actions";
import { BlockerList } from "../components/blocker-list";
import { ConsignmentFulfillmentForm, ManifestFulfillmentForm } from "../components/consignment-fulfillment-form";
import { DocumentHub, type DocumentHubItem } from "../components/document-hub";
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
import { resolveDispatchEntry } from "../../lib/document-workspace";

type Detail = NonNullable<FunctionReturnType<typeof api.expedientes.detail>>;
type AdvancedModal = AdvancedAction | null;

export default function DespachoDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const expedienteId = params.id as Id<"expedientes">;
  const entryStage = searchParams.get("stage");
  const entryPanel = searchParams.get("panel");
  const entryAction = searchParams.get("action");
  const entry = resolveDispatchEntry({ stage: entryStage, panel: entryPanel, action: entryAction });
  const entryKey = `${entryStage ?? ""}:${entryPanel ?? ""}:${entryAction ?? ""}`;
  const detailResult = useQuery(api.expedientes.detail, { expedienteId });
  const stageResult = useQuery(api.dispatches.stage, { expedienteId });
  const operations = useQuery(api.rndcOperations.listForExpediente, { expedienteId, limit: 60 });
  const uncertainOperations = useQuery(api.rndcOperations.listUncertainForExpediente, { expedienteId });
  const evidence = useQuery(api.evidence.listForExpediente, { expedienteId, limit: 80 });
  const exceptions = useQuery(api.dispatchExceptions.listForExpediente, { expedienteId });
  const { user } = useDemoUser();
  const [selectedStage, setSelectedStage] = useState<DispatchStage>(entry.stage ?? "orden_cargue");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad" | "wait"; text: string } | null>(null);
  const [advancedModal, setAdvancedModal] = useState<AdvancedModal>(null);
  const appliedActionEntry = useRef("");
  const saveLoadingOrder = useMutation(api.dispatches.saveLoadingOrderDraft);
  const saveConsignments = useMutation(api.dispatches.saveConsignmentsDraft);
  const saveAssignment = useMutation(api.dispatches.saveAssignmentDraft);
  const saveManifest = useMutation(api.dispatches.saveManifestDraft);
  const recordLogistics = useMutation(api.dispatches.recordLogisticsTimes);
  const recordFulfillment = useMutation(api.dispatches.recordFulfillmentDraft);
  const recordManifestFulfillment = useMutation(api.dispatches.recordManifestFulfillmentDraft);

  useEffect(() => {
    if (entry.stage) setSelectedStage(entry.stage);
  }, [entry.stage]);

  useEffect(() => {
    if (!detailResult || (!entry.stage && !entry.showCorrections)) return;
    requestAnimationFrame(() => document.getElementById(entry.showCorrections ? "correcciones" : "centro-documental")?.scrollIntoView());
  }, [detailResult, entry.showCorrections, entry.stage]);

  useEffect(() => {
    if (!entry.action || !entry.showCorrections || appliedActionEntry.current === entryKey || (user?.role !== "operator" && user?.role !== "admin")) return;
    appliedActionEntry.current = entryKey;
    setAdvancedModal(entry.action);
  }, [entry.action, entry.showCorrections, entryKey, user?.role]);

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
  const isEditable = ["draft", "in_progress", "ready"].includes(detail.expediente.status);
  const formId = canEdit && selectedStage === stageResult.stage && ["orden_cargue", "remesas", "vehiculo_conductor", "manifiesto", "cargue_descargue", "cumplido_inicial", "cumplido_final"].includes(stageResult.stage)
    && !["reconcile", "review_rejection", "wait"].includes(primaryAction.kind)
    ? "stage-primary-form"
    : undefined;

  function moveTo(stage: DispatchStage, message: string) {
    setSelectedStage(stage);
    setNotice({ tone: "ok", text: message });
    requestAnimationFrame(() => document.getElementById("active-stage-title")?.focus());
  }

  async function saveOrder(data: FormData) {
    if (!isEditable) return;
    await run(async () => {
      const previous = detail.expediente.loadingOrderDraft;
      await saveLoadingOrder({
        expedienteId,
        draft: {
          ...previous,
          agencyCode: value(data, "agencyCode"),
          customerReference: value(data, "customerReference"),
          sender: { ...previous?.sender, name: required(data, "senderName"), identificationType: required(data, "senderIdType"), identificationNumber: required(data, "senderId"), siteCode: required(data, "senderSiteCode"), municipalityCode: required(data, "loadingMunicipality") },
          recipient: { ...previous?.recipient, name: required(data, "recipientName"), identificationType: required(data, "recipientIdType"), identificationNumber: required(data, "recipientId"), siteCode: required(data, "recipientSiteCode"), municipalityCode: required(data, "unloadingMunicipality") },
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
    if (!isEditable) return;
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
              policyNumber: required(data, `${key}_policyNumber`),
              policyExpiresOn: required(data, `${key}_policyExpiresOn`),
              insurerNit: required(data, `${key}_insurerNit`),
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
    if (!isEditable) return;
    await run(async () => {
      if (!values.driverId || !values.vehicleId) throw new Error("Selecciona un conductor y un vehículo existentes en maestros.");
      await saveAssignment({ expedienteId, driverId: values.driverId as Id<"drivers">, vehicleId: values.vehicleId as Id<"vehicles"> });
      moveTo("manifiesto", "El vehículo y el conductor quedaron asignados al despacho.");
    });
  }

  async function saveManifestStage(data: FormData) {
    if (!isEditable) return;
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
          originCityName: detail.remesas[0]?.draft?.loading?.cityName ?? detail.loadingLocation.city,
          originMunicipalityCode: detail.remesas[0]?.draft?.loading?.municipalityCode ?? detail.expediente.manifestDraft?.originMunicipalityCode,
          destinationCityName: detail.remesas[0]?.draft?.unloading?.cityName ?? detail.unloadingLocation.city,
          destinationMunicipalityCode: detail.remesas[0]?.draft?.unloading?.municipalityCode ?? detail.expediente.manifestDraft?.destinationMunicipalityCode,
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
      return;
    }
    if (stageResult) setSelectedStage(stageResult.stage);
    requestAnimationFrame(() => document.getElementById("active-stage-title")?.focus());
  }

  async function emitScope(scope: Exclude<EmissionScope, "todo">) {
    await run(async () => {
      await callDispatchRoute("emit", { scope });
      const labels = { orden: "La orden de cargue", remesas: "Las remesas", manifiesto: "El manifiesto" };
      setNotice({ tone: "ok", text: `${labels[scope]} terminó su emisión en modo de prueba y conservó su evidencia.` });
    });
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
    if (!response.ok) throw new Error(result.detail ?? result.error ?? blockerMessage(result.blockers) ?? "La operación RNDC no terminó correctamente.");
    return result;
  }

  const currentForm = renderStage({
    detail,
    selectedStage,
    isEditable,
    orderReadOnly: !isEditable || documentState(orderDocument) !== "draft",
    manifestReadOnly: !isEditable || documentState(manifestDocument) !== "draft",
    saveOrder,
    saveRemesas,
    saveFleet,
    saveManifestStage,
    saveLogistics,
    fulfillRemesas,
    fulfillManifest
  });
  const documentHubItems = buildDocumentHubItems({ detail, evidence: evidence ?? [], isEditable });
  const selectedDocument = documentHubItems.find((item) => item.stage === selectedStage);

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

      <NextActionCard action={primaryAction} blockers={stageResult.blockers} busy={busy} formId={formId} onAction={() => void runPrimaryAction()} />

      <div className="document-hub-anchor" id="centro-documental">
        <DocumentHub
          busy={busy}
          items={documentHubItems}
          onEdit={(stage) => { setSelectedStage(stage); requestAnimationFrame(() => document.getElementById("active-stage-title")?.focus()); }}
          onEmit={(scope) => void emitScope(scope)}
        />
      </div>

      <div id="correcciones">
        <AdvancedActions canManageOfficial={user?.role === "operator" || user?.role === "admin"} canManageStructural={user?.role === "admin"} exceptions={(exceptions ?? []).map((item) => ({ _id: item._id, type: item.type, status: item.status, reason: item.reason, createdAt: item.createdAt }))} onAction={setAdvancedModal} />
      </div>

      <div className="guided-detail-layout">
        <section className="active-stage-panel" aria-live="polite">
          {currentForm}
          {canEdit && selectedDocument?.canEdit ? <div className="active-stage-actions"><button className="primary-action" disabled={busy} form="stage-primary-form" type="submit">{busy ? "Guardando…" : "Guardar cambios"}</button></div> : null}
          {selectedStage !== stageResult.stage && stageResult.blockers.length > 0 ? <BlockerList blockers={stageResult.blockers} /> : null}
        </section>
        <aside className="dispatch-side-context">
          <div><span className="eyebrow">Documentos vinculados</span><strong>{detail.documents.length}</strong><p>{detail.remesas.length} remesas · {detail.deliveryEvidence.length} soportes</p></div>
          <div><span className="eyebrow">Último cambio</span><strong>{detail.events[0]?.title ?? "Despacho creado"}</strong><p>{formatDate(detail.events[0]?.occurredAt ?? detail.expediente.updatedAt)}</p></div>
          <a href="#documentos-historial">Ver documentos e historial</a>
        </aside>
      </div>

      <DocumentHistory deliveryEvidence={detail.deliveryEvidence} documents={detail.documents} events={detail.events} technicalEvidence={(evidence ?? []).map((item) => ({ _id: item._id, documentId: item.documentId, kind: item.kind, fileName: item.fileName, createdAt: item.createdAt }))} />
      {advancedModal ? <AdvancedActionModal detail={detail} modal={advancedModal} onClose={() => setAdvancedModal(null)} operations={uncertainOperations ?? []} onDone={(message) => { setAdvancedModal(null); setNotice({ tone: "ok", text: message }); }} /> : null}
    </>
  );
}

function renderStage(input: {
  detail: Detail;
  selectedStage: DispatchStage;
  isEditable: boolean;
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
  if (input.selectedStage === "remesas") return <ConsignmentsForm onSubmit={input.saveRemesas} readOnly={!input.isEditable} remesas={detail.remesas} />;
  if (input.selectedStage === "vehiculo_conductor") return <AssignmentForm currentDriverDocument={detail.driver?.document} currentVehiclePlate={detail.vehicle?.plate} onSubmit={input.saveFleet} readOnly={!input.isEditable} />;
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

function buildDocumentHubItems(input: {
  detail: Detail;
  evidence: Array<{ _id: Id<"evidenceArtifacts">; documentId?: Id<"documents">; kind: string; createdAt: number }>;
  isEditable: boolean;
}): DocumentHubItem[] {
  const { detail, evidence, isEditable } = input;
  const orderDocument = latestDocument(detail, "orden_cargue");
  const manifestDocument = latestDocument(detail, "manifiesto");
  const remesaDocuments = detail.documents.filter((document) => document.kind === "remesa");
  const orderState = documentState(orderDocument);
  const manifestState = documentState(manifestDocument);
  const remesaState = aggregateOfficialState(detail.remesas.map((remesa) => remesa.officialState));
  const assignmentBlockers = [
    ...(!detail.vehicle ? ["Falta asignar el vehículo"] : []),
    ...(!detail.driver ? ["Falta asignar el conductor"] : [])
  ];
  const dependencyInput = {
    workflowVariant: detail.expediente.workflowVariant,
    orderOfficialState: orderState,
    consignmentOfficialStates: detail.remesas.map((remesa) => remesa.officialState)
  };
  const orderBlockers = isOfficial(orderState) ? [] : unique([
    ...loadingOrderMissingFields(detail.expediente.loadingOrderDraft),
    ...assignmentBlockers,
    ...emissionDependencyBlockers("orden", dependencyInput)
  ]);
  const remesaBlockers = isOfficial(remesaState) ? [] : unique([
    ...(detail.remesas.length === 0 ? ["Agrega al menos una remesa"] : detail.remesas.flatMap((remesa) => consignmentMissingFields(remesa.draft, detail.expediente.loadingOrderDraft).map((blocker) => `Remesa ${remesa.sequence}: ${blocker}`))),
    ...emissionDependencyBlockers("remesas", dependencyInput)
  ]);
  const manifestBlockers = isOfficial(manifestState) ? [] : unique([
    ...manifestMissingFields(detail.expediente.manifestDraft),
    ...assignmentBlockers,
    ...emissionDependencyBlockers("manifiesto", dependencyInput)
  ]);
  const fulfillmentComplete = manifestDocument?.fulfillmentState === "fulfilled" && detail.remesas.every((remesa) => remesa.fulfillmentState === "fulfilled");
  const fulfillmentState = fulfillmentComplete ? "fulfilled" : isOfficial(manifestState) ? "pending" : "draft";
  const fulfilledRemesas = detail.remesas.filter((remesa) => remesa.fulfillmentState === "fulfilled").length;

  return [
    {
      key: "order",
      title: "Orden de cargue",
      description: "Documento de salida",
      number: detail.expediente.loadingOrderDraft?.orderNumber ?? detail.expediente.cargoNumber,
      state: orderState,
      stage: "orden_cargue",
      scope: "orden",
      blockers: orderBlockers,
      canEdit: isEditable && orderState === "draft",
      pdfHref: pdfHref(evidence, orderDocument ? [orderDocument._id] : [])
    },
    {
      key: "consignments",
      title: "Remesas",
      description: `${detail.remesas.length} vinculadas`,
      number: detail.remesas.flatMap((remesa) => remesa.number ? [remesa.number] : []).join(", ") || undefined,
      state: remesaState,
      stage: "remesas",
      scope: "remesas",
      blockers: remesaBlockers,
      canEdit: isEditable && (detail.remesas.length === 0 || detail.remesas.some((remesa) => remesa.officialState === "draft")),
      pdfHref: pdfHref(evidence, remesaDocuments.map((document) => document._id))
    },
    {
      key: "assignment",
      title: "Vehículo y conductor",
      description: "Recursos del viaje",
      number: [detail.vehicle?.plate, detail.driver?.name ?? detail.driver?.document].filter(Boolean).join(" · ") || undefined,
      state: assignmentBlockers.length === 0 ? "completed" : "draft",
      stage: "vehiculo_conductor",
      blockers: assignmentBlockers,
      canEdit: isEditable
    },
    {
      key: "manifest",
      title: "Manifiesto",
      description: "Documento del viaje",
      number: detail.expediente.manifestDraft?.manifestNumber ?? detail.expediente.manifestNumber,
      state: manifestState,
      stage: "manifiesto",
      scope: "manifiesto",
      blockers: manifestBlockers,
      canEdit: isEditable && manifestState === "draft",
      pdfHref: pdfHref(evidence, manifestDocument ? [manifestDocument._id] : [])
    },
    {
      key: "fulfillment",
      title: "Cumplidos",
      description: "Cierre documental",
      number: `${fulfilledRemesas}/${detail.remesas.length} remesas`,
      state: fulfillmentState,
      stage: fulfillmentComplete ? "cumplido" : "cumplido_inicial",
      blockers: isOfficial(manifestState) ? [] : ["Requiere manifiesto autorizado"],
      canEdit: isOfficial(manifestState) && !fulfillmentComplete
    }
  ];
}

function latestDocument(detail: Detail, kind: string) {
  return detail.documents.filter((document) => document.kind === kind).sort((left, right) => right.updatedAt - left.updatedAt)[0];
}

function documentState(document: Detail["documents"][number] | undefined): OfficialDocumentState {
  const state = document?.officialState ?? document?.status;
  return state === "authorized" || state === "fulfilled" || state === "annulled" || state === "pending" ? state : "draft";
}

function aggregateOfficialState(states: OfficialDocumentState[]): OfficialDocumentState {
  if (states.length === 0) return "draft";
  if (states.every((state) => state === "fulfilled")) return "fulfilled";
  if (states.every(isOfficial)) return "authorized";
  if (states.some((state) => state === "pending")) return "pending";
  if (states.every((state) => state === "annulled")) return "annulled";
  return "draft";
}

function isOfficial(state: OfficialDocumentState): boolean {
  return state === "authorized" || state === "fulfilled";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function blockerMessage(blockers: unknown): string | undefined {
  if (!Array.isArray(blockers)) return undefined;
  const values = blockers.flatMap((blocker) => {
    if (typeof blocker === "string") return [blocker];
    if (!blocker || typeof blocker !== "object") return [];
    const missingFields = (blocker as { missingFields?: unknown }).missingFields;
    return Array.isArray(missingFields) ? missingFields.filter((field): field is string => typeof field === "string") : [];
  });
  return values.length > 0 ? `Completa: ${values.join(", ")}` : undefined;
}

function pdfHref(evidence: Array<{ _id: Id<"evidenceArtifacts">; documentId?: Id<"documents">; kind: string; createdAt: number }>, documentIds: Id<"documents">[]): string | undefined {
  const artifact = evidence.filter((item) => item.kind === "pdf" && item.documentId && documentIds.includes(item.documentId)).sort((left, right) => right.createdAt - left.createdAt)[0];
  return artifact ? `/api/evidence/${artifact._id}` : undefined;
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
  const eligible = detail.documents.filter((document) => document.kind === "orden_cargue" || document.kind === "remesa" || document.kind === "manifiesto");
  const remesaDocuments = eligible.filter((document) => document.kind === "remesa");
  const manifestDocuments = eligible.filter((document) => document.kind === "manifiesto");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const requestKey = crypto.randomUUID();
    const common = { requestKey, reason: required(data, "reason"), observation: required(data, "observation"), confirmed: data.get("confirmed") === "on" };

    try {
      let route = `/api/rndc/dispatches/${detail.expediente._id}/exceptions`;
      let body: Record<string, unknown>;

      if (modal === "remesa_without_order") {
        body = { ...common, type: modal, payload: remesaWithoutOrderPayload(data) };
      } else if (modal === "empty_manifest") {
        body = { ...common, type: modal, payload: emptyManifestPayload(data) };
      } else if (modal === "transshipment") {
        body = { ...common, type: modal, reasonCode: required(data, "reasonCode"), sourceManifestDocumentId: required(data, "documentId"), replacementVehicleId: required(data, "vehicleId"), replacementDriverId: required(data, "driverId"), payload: { municipalityCode: required(data, "municipalityCode"), sourceSuspended: data.get("sourceSuspended") === "on", releasedRemesaIds: data.getAll("releasedRemesaIds").map(String) } };
      } else if (modal === "reconcile") {
        const operationId = required(data, "operationId") as Id<"rndcOperations">;
        const operation = operations.find((item) => item._id === operationId);
        if (!operation?.documentId) throw new Error("El intento incierto no está vinculado a un documento.");
        route = `/api/rndc/dispatches/${detail.expediente._id}/reconcile`;
        body = { ...common, documentId: operation.documentId, originalOperationId: operation._id };
      } else {
        const documentId = required(data, "documentId") as Id<"documents">;
        const document = detail.documents.find((item) => item._id === documentId);
        if (!document) throw new Error("Selecciona un documento disponible.");
        const remesa = detail.remesas.find((item) => item.documentId === documentId);
        route = `/api/rndc/dispatches/${detail.expediente._id}/${modal}`;
        body = modal === "correct"
          ? { ...common, documentId, expedienteRemesaId: remesa?._id, reasonCode: required(data, "reasonCode"), before: appointmentBefore(remesa?.draft?.unloading?.appointmentAt, document.number), after: { remesaNumber: document.number, appointmentDate: required(data, "appointmentDate"), appointmentTime: required(data, "appointmentTime") } }
          : { ...common, documentId, reasonCode: required(data, "reasonCode"), wholeSet: data.get("wholeSet") === "on" };
      }

      if (!common.confirmed) throw new Error("Debes confirmar que revisaste el alcance y las dependencias.");
      const response = await fetch(route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string; blockers?: string[] };
      if (!response.ok) throw new Error(result.error ?? result.blockers?.[0] ?? "La acción avanzada no terminó correctamente.");
      onDone(successMessage(modal));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible completar la acción.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section aria-labelledby="advanced-modal-title" aria-modal="true" className="modal-card advanced-modal-card" role="dialog"><div className="modal-head"><div><span className="eyebrow">Acción oficial protegida</span><h2 id="advanced-modal-title">{modalTitle(modal)}</h2></div><button aria-label="Cerrar" onClick={onClose} type="button">×</button></div><form className="modal-form" onSubmit={submit}>{modalFields(modal, detail, operations, eligible, remesaDocuments, manifestDocuments)}<div className="advanced-common-fields wide"><label><span>Motivo operativo</span><input name="reason" placeholder="Por qué se necesita esta acción" required /></label><label><span>Observación detallada</span><textarea name="observation" placeholder="Contexto, alcance y soporte revisado" required rows={3} /></label><label className="confirmation-check"><input name="confirmed" required type="checkbox" /><span>Confirmo que revisé el documento, sus dependencias y el alcance de esta acción.</span></label></div>{error ? <div className="form-error wide" role="alert">{error}</div> : null}<div className="modal-actions wide"><button className="ghost-button" onClick={onClose} type="button">Cancelar</button><button className={modal === "annul" ? "danger-action" : "primary-action"} disabled={busy} type="submit">{busy ? "Procesando…" : "Confirmar acción"}</button></div></form></section></div>;
}

function modalFields(modal: AdvancedAction, detail: Detail, operations: Array<{ _id: Id<"rndcOperations">; documentId?: Id<"documents">; status: string }>, eligible: Detail["documents"], remesas: Detail["documents"], manifests: Detail["documents"]) {
  if (modal === "correct") return <><label className="wide"><span>Remesa autorizada</span><select name="documentId" required><option value="">Selecciona</option>{remesas.map(documentOption)}</select></label><label><span>Motivo RNDC</span><select defaultValue="1" name="reasonCode"><option value="1">Ajuste de cita</option><option value="2">Corrección operativa</option></select></label><label><span>Nueva fecha de cita</span><input name="appointmentDate" required type="date" /></label><label><span>Nueva hora</span><input name="appointmentTime" required type="time" /></label><div className="modal-info wide">La pantalla guardará y mostrará la comparación antes/después antes de cerrar la excepción.</div></>;
  if (modal === "annul") return <><label className="wide"><span>Documento</span><select name="documentId" required><option value="">Selecciona</option>{eligible.map(documentOption)}</select></label><label><span>Motivo RNDC</span><select defaultValue="A" name="reasonCode"><option value="A">Ajuste autorizado</option><option value="R">Reemplazo</option><option value="V">Varada</option></select></label><label className="confirmation-check wide"><input name="wholeSet" type="checkbox" /><span>Anular el conjunto documental completo cuando el plan de dependencias lo permita.</span></label><div className="modal-info wide">La anulación se detiene si existe un documento dependiente que debe reversarse o liberarse primero.</div></>;
  if (modal === "reconcile") return <><label className="wide"><span>Intento con resultado incierto</span><select name="operationId" required><option value="">Selecciona</option>{operations.map((operation) => <option key={operation._id} value={operation._id}>Intento {operation._id.slice(-6)} · documento {operation.documentId?.slice(-6) ?? "sin vínculo"}</option>)}</select></label><div className="modal-info wide">La consulta usa el intento exacto, verifica tipo y número de documento y nunca reenvía la operación.</div></>;
  if (modal === "transshipment") return <TransshipmentFields detail={detail} manifests={manifests} />;
  if (modal === "empty_manifest") return <><div className="modal-info wide">Disponible únicamente para el tipo oficial Viaje Vacío. No solicita ni guarda seguimiento GPS.</div><input name="manifestType" type="hidden" value="W" /><label><span>Fecha de expedición</span><input name="issueDate" required type="date" /></label><label><span>Entrega estimada</span><input name="estimatedDeliveryDate" required type="date" /></label><label><span>Flete total</span><input inputMode="decimal" name="freightTotal" required /></label><label><span>Responsable de pago</span><input name="paymentResponsible" required /></label><label className="wide"><span>Razón del viaje vacío</span><input name="emptyManifestReason" required /></label></>;
  return <><div className="modal-info wide">Esta remesa no heredará datos de una orden de cargue. Todos los datos operativos y RNDC son obligatorios.</div><label><span>Remitente</span><input name="senderName" required /></label><label><span>Identificación remitente</span><input name="senderId" required /></label><label><span>Sede remitente</span><input name="senderSiteCode" required /></label><label><span>Destinatario</span><input name="recipientName" required /></label><label><span>Identificación destinatario</span><input name="recipientId" required /></label><label><span>Sede destinatario</span><input name="recipientSiteCode" required /></label><label><span>Dirección de cargue</span><input name="loadingAddress" required /></label><label><span>Ciudad de cargue</span><input name="loadingCity" required /></label><label><span>Código DANE cargue</span><input name="loadingMunicipality" required /></label><label><span>Cita de cargue</span><input name="loadingAppointment" required type="datetime-local" /></label><label><span>Dirección de descargue</span><input name="unloadingAddress" required /></label><label><span>Ciudad de descargue</span><input name="unloadingCity" required /></label><label><span>Código DANE descargue</span><input name="unloadingMunicipality" required /></label><label><span>Cita de descargue</span><input name="unloadingAppointment" required type="datetime-local" /></label><label><span>Mercancía</span><input name="cargoDescription" required /></label><label><span>Código mercancía</span><input name="merchandiseCode" required /></label><label><span>Cantidad</span><input name="quantity" required /></label><label><span>Peso (TN)</span><input name="weightTons" required /></label><label><span>Código empaque</span><input name="packagingCode" required /></label><label><span>Naturaleza de carga</span><input defaultValue="1" name="natureOfCargo" required /></label><label><span>Valor declarado</span><input name="declaredValue" required /></label><label><span>Número de póliza</span><input name="policyNumber" required /></label><label><span>Vencimiento póliza</span><input name="policyExpiresOn" required type="date" /></label><label><span>NIT aseguradora</span><input name="insurerNit" required /></label></>;
}

function TransshipmentFields({ detail, manifests }: { detail: Detail; manifests: Detail["documents"] }) {
  const vehicles = usePaginatedQuery(api.fleet.vehiclesPage, {}, { initialNumItems: 60 }).results;
  const drivers = usePaginatedQuery(api.fleet.driversPage, {}, { initialNumItems: 60 }).results;
  return <><label className="wide"><span>Manifiesto anterior</span><select name="documentId" required><option value="">Selecciona</option>{manifests.map(documentOption)}</select></label><label><span>Motivo del transbordo</span><select name="reasonCode" required><option value="">Selecciona</option><option value="A">Accidente</option><option value="V">Varada</option><option value="S">Siniestro</option></select></label><label><span>Municipio del transbordo</span><input name="municipalityCode" placeholder="Código DANE" required /></label><label><span>Vehículo de reemplazo</span><select name="vehicleId" required><option value="">Selecciona</option>{vehicles.map((vehicle) => <option key={vehicle._id} value={vehicle._id}>{vehicle.plate}</option>)}</select></label><label><span>Conductor de reemplazo</span><select name="driverId" required><option value="">Selecciona</option>{drivers.map((driver) => <option key={driver._id} value={driver._id}>{driver.name ?? driver.document}</option>)}</select></label><fieldset className="wide"><legend>Remesas ya liberadas en RNDC</legend>{detail.remesas.map((remesa) => <label className="confirmation-check" key={remesa._id}><input name="releasedRemesaIds" type="checkbox" value={remesa._id} /><span>{remesa.number ?? `Remesa ${remesa.sequence}`}</span></label>)}</fieldset><label className="confirmation-check wide"><input name="sourceSuspended" type="checkbox" /><span>El manifiesto anterior fue cumplido con suspensión; déjalo sin marcar si fue anulado.</span></label></>;
}

function documentOption(document: Detail["documents"][number]) {
  return <option key={document._id} value={document._id}>{document.kind.replaceAll("_", " ")} {document.number ?? "sin número"} · {document.officialState ?? document.status}</option>;
}

function remesaWithoutOrderPayload(data: FormData) {
  return { consignmentClass: "terrestre_carga", sender: { name: required(data, "senderName"), identificationType: "N", identificationNumber: required(data, "senderId"), siteCode: required(data, "senderSiteCode"), municipalityCode: required(data, "loadingMunicipality") }, recipient: { name: required(data, "recipientName"), identificationType: "N", identificationNumber: required(data, "recipientId"), siteCode: required(data, "recipientSiteCode"), municipalityCode: required(data, "unloadingMunicipality") }, loading: { address: required(data, "loadingAddress"), cityName: required(data, "loadingCity"), municipalityCode: required(data, "loadingMunicipality"), appointmentAt: timestamp(data, "loadingAppointment") }, unloading: { address: required(data, "unloadingAddress"), cityName: required(data, "unloadingCity"), municipalityCode: required(data, "unloadingMunicipality"), appointmentAt: timestamp(data, "unloadingAppointment") }, declaredValue: required(data, "declaredValue"), packagingCode: required(data, "packagingCode"), merchandiseCode: required(data, "merchandiseCode"), natureOfCargo: required(data, "natureOfCargo"), policyNumber: required(data, "policyNumber"), policyExpiresOn: required(data, "policyExpiresOn"), insurerNit: required(data, "insurerNit"), remissions: [{ quantity: required(data, "quantity"), description: required(data, "cargoDescription"), weightTons: required(data, "weightTons"), packagingClass: required(data, "packagingCode") }] };
}

function emptyManifestPayload(data: FormData) {
  return { manifestType: "W", issueDate: required(data, "issueDate"), estimatedDeliveryDate: required(data, "estimatedDeliveryDate"), operationScope: "intermunicipal", freightTotal: required(data, "freightTotal"), netPayable: required(data, "freightTotal"), paymentResponsible: required(data, "paymentResponsible"), emptyManifestReason: required(data, "emptyManifestReason"), observations: required(data, "emptyManifestReason") };
}

function appointmentBefore(value: number | undefined, remesaNumber: string | undefined) {
  const date = value ? new Date(value) : null;
  return { remesaNumber, appointmentDate: date?.toISOString().slice(0, 10), appointmentTime: date?.toTimeString().slice(0, 5) };
}

function modalTitle(modal: AdvancedAction): string {
  const titles: Record<AdvancedAction, string> = { remesa_without_order: "Crear remesa sin orden", empty_manifest: "Crear manifiesto vacío", transshipment: "Registrar transbordo", correct: "Corregir remesa", annul: "Anular documento", reconcile: "Conciliar resultado" };
  return titles[modal];
}

function successMessage(modal: AdvancedAction): string {
  const messages: Record<AdvancedAction, string> = { remesa_without_order: "La remesa independiente quedó creada y auditada.", empty_manifest: "El viaje vacío quedó preparado sin campos de seguimiento.", transshipment: "El transbordo conservó la flota anterior y creó la nueva fotografía.", correct: "La corrección quedó registrada con comparación y evidencia.", annul: "La anulación quedó registrada con dependencias y evidencia.", reconcile: "La conciliación quedó registrada sin reenviar el documento." };
  return messages[modal];
}

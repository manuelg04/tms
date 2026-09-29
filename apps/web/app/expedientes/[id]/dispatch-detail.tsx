"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { dispatchPrimaryAction } from "../../../convex/model/dispatchPresentation";
import type {
  DispatchStage,
  EmissionScope,
} from "../../../convex/model/dispatchWorkflow";
import { useDemoUser } from "../../providers";
import { StatusBadge } from "../status-badge";
import {
  AdvancedActions,
  type AdvancedAction,
} from "../components/advanced-actions";
import { BlockerList } from "../components/blocker-list";
import { DocumentHub } from "../components/document-hub";
import { NextActionCard } from "../components/next-action-card";
import { resolveDispatchEntry } from "../../lib/document-workspace";
import { AdvancedActionModal } from "./advanced-action-modal";
import {
  blockerMessage,
  buildDocumentHubItems,
  documentState,
} from "./document-hub-items";
import { renderStage } from "./stage-panel";
import {
  consignmentUpsertsFromForm,
  loadingOrderDraftFromForm,
  manifestDraftFromForm,
  manifestFulfillmentDraftFromForm,
  remesaFulfillmentDraftFromForm,
} from "./stage-payloads";

type AdvancedModal = AdvancedAction | null;

type DocumentFocus = {
  stage: "orden_cargue" | "remesas" | "manifiesto";
  remesaId?: Id<"expedienteRemesas">;
  documentId?: Id<"documents">;
  action?: "actualizar" | "insertar" | "anular" | "ver";
  onClose: () => void;
};

export function DispatchDetail({
  id,
  focus,
}: {
  id?: Id<"expedientes">;
  focus?: DocumentFocus;
}) {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const expedienteId = id ?? (params.id as Id<"expedientes">);
  const entryStage = focus?.stage ?? searchParams.get("stage");
  const entryPanel = focus ? null : searchParams.get("panel");
  const entryAction = focus ? null : searchParams.get("action");
  const entry = resolveDispatchEntry({
    stage: entryStage,
    panel: entryPanel,
    action: entryAction,
  });
  const entryKey = `${entryStage ?? ""}:${entryPanel ?? ""}:${entryAction ?? ""}`;
  const detailResult = useQuery(api.expedientes.detail, { expedienteId });
  const stageResult = useQuery(api.dispatches.stage, { expedienteId });
  const operations = useQuery(api.rndcOperations.listForExpediente, {
    expedienteId,
    limit: 60,
  });
  const uncertainOperations = useQuery(
    api.rndcOperations.listUncertainForExpediente,
    { expedienteId },
  );
  const evidence = useQuery(api.evidence.listForExpediente, {
    expedienteId,
    limit: 80,
  });
  const exceptions = useQuery(api.dispatchExceptions.listForExpediente, {
    expedienteId,
  });
  const { user } = useDemoUser();
  const [selectedStage, setSelectedStage] = useState<DispatchStage | null>(
    entry.stage ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "ok" | "bad" | "wait";
    text: string;
  } | null>(null);
  const [advancedModal, setAdvancedModal] = useState<AdvancedModal>(null);
  const appliedActionEntry = useRef("");
  const ensuringConsignment = useRef("");
  const saveLoadingOrder = useMutation(api.dispatches.saveLoadingOrderDraft);
  const ensureConsignment = useMutation(api.dispatches.ensureConsignmentDraft);
  const saveConsignments = useMutation(api.dispatches.saveConsignmentsDraft);
  const saveAssignment = useMutation(api.dispatches.saveAssignmentDraft);
  const saveManifest = useMutation(api.dispatches.saveManifestDraft);
  const recordFulfillment = useMutation(api.dispatches.recordFulfillmentDraft);
  const recordManifestFulfillment = useMutation(
    api.dispatches.recordManifestFulfillmentDraft,
  );

  useEffect(() => {
    if (entry.stage) setSelectedStage(entry.stage);
  }, [entry.stage]);

  useEffect(() => {
    if (focus || !detailResult || (!entry.stage && !entry.showCorrections))
      return;
    requestAnimationFrame(() =>
      document
        .getElementById(
          entry.showCorrections ? "correcciones" : "centro-documental",
        )
        ?.scrollIntoView(),
    );
  }, [detailResult, entry.showCorrections, entry.stage, focus]);

  useEffect(() => {
    if (
      !entry.action ||
      !entry.showCorrections ||
      appliedActionEntry.current === entryKey ||
      (user?.role !== "operator" && user?.role !== "admin")
    )
      return;
    appliedActionEntry.current = entryKey;
    setAdvancedModal(entry.action);
  }, [entry.action, entry.showCorrections, entryKey, user?.role]);

  useEffect(() => {
    if (
      selectedStage !== "remesas" ||
      focus?.action === "ver" ||
      focus?.action === "anular"
    ) {
      ensuringConsignment.current = "";
      return;
    }
    if (
      !detailResult ||
      (user?.role !== "operator" && user?.role !== "admin") ||
      !["draft", "in_progress", "ready"].includes(
        detailResult.expediente.status,
      )
    )
      return;
    if (
      focus &&
      (!operations ||
        operations.some((operation) =>
          ["queued", "claimed", "uncertain", "reconciling"].includes(
            operation.status,
          ),
        ))
    )
      return;
    if (
      focus?.documentId &&
      !detailResult.documents.some(
        (document) => document._id === focus.documentId,
      )
    )
      return;
    const withoutNumber = detailResult.remesas.find(
      (remesa) =>
        !remesa.number && (!focus?.remesaId || remesa._id === focus.remesaId),
    );
    const sequence =
      withoutNumber?.sequence ??
      (detailResult.remesas.length === 0 ? 1 : undefined);
    if (sequence === undefined) return;
    const key = `${detailResult.expediente._id}:${sequence}`;
    if (ensuringConsignment.current === key) return;
    ensuringConsignment.current = key;
    void ensureConsignment({ expedienteId, sequence }).catch((cause) => {
      setNotice({
        tone: "bad",
        text:
          cause instanceof Error
            ? cause.message
            : "No fue posible preparar el consecutivo de la remesa. Vuelve a abrir esta etapa para reintentar.",
      });
    });
  }, [
    detailResult,
    ensureConsignment,
    expedienteId,
    selectedStage,
    user?.role,
    focus?.remesaId,
    focus?.action,
    focus?.documentId,
    operations,
  ]);

  if (detailResult === undefined || stageResult === undefined) {
    return <div className="full-page-state">Preparando el despacho…</div>;
  }

  if (detailResult === null || stageResult === null) {
    return (
      <section className="panel expediente-empty">
        <strong>El despacho no existe o no está disponible.</strong>
        <Link className="ghost-button action-link" href="/expedientes">
          Volver a Despachos
        </Link>
      </section>
    );
  }

  const detail = focus?.remesaId
    ? {
        ...detailResult,
        remesas: detailResult.remesas.filter(
          (remesa) => remesa._id === focus.remesaId,
        ),
      }
    : detailResult;
  const manifestDocument = detail.documents.find(
    (document) => document.kind === "manifiesto",
  );
  const orderDocument = detail.documents.find(
    (document) => document.kind === "orden_cargue",
  );
  const hasUncertainOperation = (operations ?? []).some(
    (operation) =>
      operation.status === "uncertain" || operation.status === "reconciling",
  );
  const hasRejectedOperation = (operations ?? []).some(
    (operation) => operation.status === "failed",
  );
  const hasOperationInFlight = (operations ?? []).some(
    (operation) =>
      operation.status === "queued" || operation.status === "claimed",
  );
  const primaryAction = dispatchPrimaryAction({
    stage: stageResult.stage,
    blockers: stageResult.blockers,
    hasRejectedOperation,
    hasUncertainOperation,
    hasOperationInFlight,
    printed: Boolean(
      detail.expediente.loadingOrderDraft?.printedAt &&
      detail.expediente.manifestDraft?.printedAt,
    ),
  });
  const canEdit = user?.role === "operator" || user?.role === "admin";
  const isEditable =
    canEdit &&
    focus?.action !== "ver" &&
    (!focus ||
      (operations !== undefined &&
        !hasOperationInFlight &&
        !hasUncertainOperation)) &&
    ["draft", "in_progress", "ready"].includes(detail.expediente.status);
  const formId =
    canEdit &&
    selectedStage !== null &&
    selectedStage === stageResult.stage &&
    [
      "orden_cargue",
      "remesas",
      "vehiculo_conductor",
      "manifiesto",
      "cumplido_inicial",
      "cumplido_final",
    ].includes(stageResult.stage) &&
    !["reconcile", "review_rejection", "wait"].includes(primaryAction.kind)
      ? "stage-primary-form"
      : undefined;

  function moveTo(stage: DispatchStage, message: string) {
    if (!focus) setSelectedStage(stage);
    setNotice({
      tone: "ok",
      text: focus ? "Los cambios quedaron guardados." : message,
    });
    requestAnimationFrame(() =>
      document.getElementById("active-stage-title")?.focus(),
    );
  }

  async function saveOrder(data: FormData) {
    if (!isEditable) return;
    await run(async () => {
      const previous = detail.expediente.loadingOrderDraft;
      await saveLoadingOrder({
        expedienteId,
        draft: loadingOrderDraftFromForm(
          data,
          detail.expediente.loadingOrderDraft,
        ),
      });
      moveTo(
        "remesas",
        "La orden de cargue quedó guardada. Los datos conocidos ya están disponibles para las remesas.",
      );
    }, true);
  }

  async function saveRemesas(data: FormData) {
    if (!isEditable) return;
    await run(async () => {
      await saveConsignments({
        expedienteId,
        upserts: consignmentUpsertsFromForm(data, detail),
      });
      moveTo(
        "vehiculo_conductor",
        "Las remesas quedaron guardadas y siguen heredando la información de la orden.",
      );
    }, true);
  }

  async function saveFleet(values: { driverId?: string; vehicleId?: string }) {
    if (!isEditable) return;
    await run(async () => {
      if (!values.driverId || !values.vehicleId)
        throw new Error(
          "Selecciona un conductor y un vehículo existentes en maestros.",
        );
      await saveAssignment({
        expedienteId,
        driverId: values.driverId as Id<"drivers">,
        vehicleId: values.vehicleId as Id<"vehicles">,
      });
      moveTo(
        "manifiesto",
        "El vehículo y el conductor quedaron asignados al despacho.",
      );
    }, true);
  }

  async function saveManifestStage(data: FormData) {
    if (!isEditable) return;
    await run(async () => {
      await saveManifest({
        expedienteId,
        draft: manifestDraftFromForm(data, detail),
      });
      moveTo(
        "envio_rndc",
        "El manifiesto quedó guardado. Revisa el resumen y los bloqueos antes de enviar.",
      );
    }, true);
  }

  async function fulfillRemesas(data: FormData) {
    await run(async () => {
      for (const remesa of detail.remesas.filter(
        (row) => row.fulfillmentState !== "fulfilled",
      )) {
        await recordFulfillment({
          expedienteId,
          remesaId: remesa._id,
          draft: remesaFulfillmentDraftFromForm(data, remesa),
        });
      }
      await callDispatchRoute("fulfill", { scope: "remesas" });
      moveTo(
        "cumplido_final",
        "Todas las remesas disponibles quedaron cumplidas. El manifiesto sigue abierto hasta el cierre final.",
      );
    }, true);
  }

  async function fulfillManifest(data: FormData) {
    await run(async () => {
      await recordManifestFulfillment({
        expedienteId,
        draft: manifestFulfillmentDraftFromForm(data),
      });
      await callDispatchRoute("fulfill", { scope: "manifiesto" });
      setNotice({
        tone: "ok",
        text: "El manifiesto quedó cumplido y el despacho está cerrado.",
      });
    }, true);
  }

  async function runPrimaryAction() {
    if (primaryAction.kind === "emit") {
      await run(async () => {
        await callDispatchRoute("emit", {});
        setNotice({
          tone: "ok",
          text: "La secuencia documental terminó en modo de prueba y conservó su evidencia.",
        });
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
      document
        .getElementById("centro-documental")
        ?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (stageResult) setSelectedStage(stageResult.stage);
    requestAnimationFrame(() =>
      document.getElementById("active-stage-title")?.focus(),
    );
  }

  async function emitScope(scope: Exclude<EmissionScope, "todo">) {
    await run(async () => {
      await callDispatchRoute("emit", { scope });
      const labels = {
        orden: "La orden de cargue",
        remesas: "Las remesas",
        manifiesto: "El manifiesto",
      };
      setNotice({
        tone: "ok",
        text: `${labels[scope]} terminó su emisión en modo de prueba y conservó su evidencia.`,
      });
    });
  }

  async function run(action: () => Promise<void>, formSubmission = false) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      if (formSubmission) throw cause;
      setNotice({
        tone: "bad",
        text:
          cause instanceof Error
            ? cause.message.replace(/^.*?: /, "")
            : "No fue posible completar la acción.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function callDispatchRoute(
    route: "emit" | "fulfill",
    body: Record<string, unknown>,
  ) {
    const response = await fetch(
      `/api/rndc/dispatches/${expedienteId}/${route}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const result = (await response.json()) as {
      error?: string;
      detail?: string;
      blockers?: unknown;
      nextAction?: string;
    };
    if (!response.ok)
      throw new Error(
        result.detail ??
          result.error ??
          blockerMessage(result.blockers) ??
          "La operación RNDC no terminó correctamente.",
      );
    return result;
  }

  const currentForm = selectedStage
    ? renderStage({
        detail,
        selectedStage,
        isEditable,
        orderReadOnly: !isEditable || documentState(orderDocument) !== "draft",
        manifestReadOnly:
          !isEditable || documentState(manifestDocument) !== "draft",
        saveOrder,
        saveRemesas,
        saveFleet,
        saveManifestStage,
        fulfillRemesas,
        fulfillManifest,
      })
    : null;
  const documentHubItems = buildDocumentHubItems({
    detail,
    evidence: evidence ?? [],
    isEditable,
  });
  const selectedDocument = documentHubItems.find(
    (item) => item.stage === selectedStage,
  );

  if (focus) {
    const focusedDocument = focus.documentId
      ? detail.documents.find((document) => document._id === focus.documentId)
      : undefined;
    if (
      (focus.documentId && !focusedDocument) ||
      (focus.remesaId && detail.remesas.length === 0)
    )
      return (
        <section className="registry-action-panel">
          <p>
            Este documento no está disponible en el despacho seleccionado para
            esta acción.
          </p>
          <button
            className="ghost-button"
            onClick={focus.onClose}
            type="button"
          >
            Volver al listado
          </button>
        </section>
      );
    const canAnnul = Boolean(
      focusedDocument &&
      ["authorized", "fulfilled"].includes(documentState(focusedDocument)) &&
      canEdit &&
      operations !== undefined &&
      !hasOperationInFlight &&
      !hasUncertainOperation,
    );
    const canSave =
      canEdit &&
      isEditable &&
      (focus.stage === "remesas"
        ? detail.remesas.some((remesa) => remesa.officialState === "draft")
        : documentState(
            focus.stage === "orden_cargue" ? orderDocument : manifestDocument,
          ) === "draft");
    return (
      <section className="document-focused-editor">
        <div className="registry-selection">
          <div>
            <strong>{detail.customer.name}</strong>
            <span>
              {detail.vehicle?.plate ?? "Sin placa"} ·{" "}
              {detail.loadingLocation.city} → {detail.unloadingLocation.city}
            </span>
          </div>
          <button
            className="ghost-button"
            onClick={focus.onClose}
            type="button"
          >
            Volver
          </button>
        </div>
        {notice ? (
          <div className={`operation-notice ${notice.tone}`} role="status">
            {notice.text}
          </div>
        ) : null}
        {focus.action === "anular" ? (
          <div className="registry-action-panel">
            <p>
              Documento seleccionado:{" "}
              <strong>
                {focusedDocument?.number ?? "Sin documento emitido"}
              </strong>
            </p>
            {canAnnul ? (
              <button
                className="danger-action"
                onClick={() => setAdvancedModal("annul")}
                type="button"
              >
                Anular documento
              </button>
            ) : (
              <p>Este documento no admite anulación en su estado actual.</p>
            )}
          </div>
        ) : (
          <section className="active-stage-panel">
            {currentForm}
            <div className="active-stage-actions">
              <button
                className="ghost-button"
                onClick={focus.onClose}
                type="button"
              >
                Volver al listado
              </button>
              {canSave ? (
                <button
                  className="primary-action"
                  disabled={busy}
                  form="stage-primary-form"
                  type="submit"
                >
                  {busy ? "Guardando…" : "Guardar cambios"}
                </button>
              ) : null}
            </div>
            {!canSave && focus.action !== "ver" ? (
              <p className="registry-note">
                {hasOperationInFlight
                  ? "Hay una operación en proceso. Espera su resultado antes de editar."
                  : hasUncertainOperation
                    ? "El documento tiene un resultado pendiente de conciliación. Resuélvelo antes de editar."
                    : "El documento está en consulta. Su estado actual no permite editar el borrador."}
              </p>
            ) : null}
          </section>
        )}
        {advancedModal && canAnnul ? (
          <AdvancedActionModal
            detail={
              focus.documentId
                ? {
                    ...detail,
                    documents: detail.documents.filter(
                      (document) => document._id === focus.documentId,
                    ),
                  }
                : detail
            }
            modal={advancedModal}
            onClose={() => setAdvancedModal(null)}
            operations={uncertainOperations ?? []}
            onDone={(message) => {
              setAdvancedModal(null);
              setNotice({ tone: "ok", text: message });
            }}
          />
        ) : null}
      </section>
    );
  }

  return (
    <>
      <div className="detail-breadcrumb">
        <Link href="/expedientes">Despachos</Link>
        <span>›</span>
        <span>{detail.expediente.code}</span>
      </div>
      <section className="dispatch-detail-hero compact">
        <div>
          <div className="hero-title-line">
            <h2>{detail.expediente.code}</h2>
            <StatusBadge status={detail.expediente.status} />
          </div>
          <p>
            {detail.customer.name} · Orden de servicio{" "}
            {detail.serviceOrder.code}
          </p>
        </div>
        <div className="dispatch-hero-side">
          <div className="dispatch-hero-route">
            <span>{detail.loadingLocation.city}</span>
            <strong>→</strong>
            <span>{detail.unloadingLocation.city}</span>
          </div>
          {detail.expediente.loadingOrderDraft ? (
            <Link
              className="ghost-button duplicate-link"
              href={`/expedientes/nuevo?desde=${detail.expediente._id}`}
              title="Crear un despacho nuevo con los mismos datos base"
            >
              Duplicar despacho
            </Link>
          ) : null}
        </div>
      </section>

      <section
        className="dispatch-compact-summary"
        aria-label="Resumen del despacho"
      >
        <Summary
          label="Vehículo"
          value={detail.vehicle?.plate ?? "Sin asignar"}
        />
        <Summary
          label="Conductor"
          value={detail.driver?.name ?? "Sin asignar"}
        />
        <Summary
          label="Orden de cargue"
          value={
            detail.expediente.loadingOrderDraft?.orderNumber ?? "Automática"
          }
        />
        <Summary
          label="Remesas"
          value={
            detail.remesas.length ? String(detail.remesas.length) : "Pendientes"
          }
        />
        <Summary
          label="Manifiesto"
          value={
            detail.expediente.manifestDraft?.manifestNumber ?? "Automático"
          }
        />
        <Summary
          label="RNDC"
          value={
            hasUncertainOperation
              ? "Resultado incierto"
              : hasRejectedOperation
                ? "Requiere atención"
                : hasOperationInFlight
                  ? "En proceso"
                  : "Modo prueba"
          }
        />
      </section>

      {notice ? (
        <div className={`operation-notice ${notice.tone}`} role="status">
          <span />
          {notice.text}
          <button
            aria-label="Cerrar aviso"
            onClick={() => setNotice(null)}
            type="button"
          >
            ×
          </button>
        </div>
      ) : null}

      <NextActionCard
        action={primaryAction}
        blockers={stageResult.blockers}
        busy={busy}
        formId={formId}
        onAction={() => void runPrimaryAction()}
      />

      <div className="document-hub-anchor" id="centro-documental">
        <DocumentHub
          busy={busy}
          items={documentHubItems}
          onEdit={(stage) => {
            setSelectedStage(stage);
            requestAnimationFrame(() => {
              const title = document.getElementById("active-stage-title");
              title?.focus();
              title?.scrollIntoView({ behavior: "smooth", block: "start" });
            });
          }}
          onEmit={(scope) => void emitScope(scope)}
        />
      </div>

      <div id="correcciones">
        <AdvancedActions
          canManageOfficial={
            user?.role === "operator" || user?.role === "admin"
          }
          canManageStructural={user?.role === "admin"}
          exceptions={(exceptions ?? []).map((item) => ({
            _id: item._id,
            type: item.type,
            status: item.status,
            reason: item.reason,
            createdAt: item.createdAt,
          }))}
          onAction={setAdvancedModal}
        />
      </div>

      {selectedStage && currentForm ? (
        <div className="guided-detail-layout single">
          <section className="active-stage-panel" aria-live="polite">
            {currentForm}
            <div className="active-stage-actions">
              <button
                className="ghost-button"
                onClick={() => setSelectedStage(null)}
                type="button"
              >
                Cerrar
              </button>
              {canEdit && selectedDocument?.canEdit ? (
                <button
                  className="primary-action"
                  disabled={busy}
                  form="stage-primary-form"
                  type="submit"
                >
                  {busy ? "Guardando…" : "Guardar cambios"}
                </button>
              ) : null}
            </div>
            {selectedStage !== stageResult.stage &&
            stageResult.blockers.length > 0 ? (
              <BlockerList blockers={stageResult.blockers} />
            ) : null}
          </section>
        </div>
      ) : null}

      {advancedModal ? (
        <AdvancedActionModal
          detail={detail}
          modal={advancedModal}
          onClose={() => setAdvancedModal(null)}
          operations={uncertainOperations ?? []}
          onDone={(message) => {
            setAdvancedModal(null);
            setNotice({ tone: "ok", text: message });
          }}
        />
      ) : null}
    </>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

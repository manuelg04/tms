"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "../../lib/convex-hooks";
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
import { DispatchRoutePlan } from "../components/dispatch-route-plan";
import { OperacionesPanel } from "../components/operaciones-panel";
import { useOperacionesSuggestions } from "../components/use-operaciones-suggestions";
import { TripDocumentStrip } from "../components/trip-documents";
import { fulfillmentHref, moduleHref, type ModuleSlug } from "../../lib/module-links";
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
import { Skeleton } from "../../components/skeleton";
import { emissionNotice } from "../../lib/emission-notice";
import { currentManifestDocument } from "../../../convex/model/currentManifest";
import type { ChainScope } from "../../../convex/model/pendingEmission";

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
  const pending = useQuery(api.pendingEmissions.forDispatch, { expedienteId });
  const operaciones = useOperacionesSuggestions(expedienteId);
  const cancelPending = useMutation(api.pendingEmissions.cancel);
  const emitIntent = useRef(true);
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
    try {
      const key = `tms:aviso:${expedienteId}`;
      const stored = window.sessionStorage.getItem(key);
      if (!stored) return;
      window.sessionStorage.removeItem(key);
      const parsed = JSON.parse(stored) as { tone?: unknown; text?: unknown };
      if ((parsed.tone === "ok" || parsed.tone === "bad" || parsed.tone === "wait") && typeof parsed.text === "string") {
        setNotice({ tone: parsed.tone, text: parsed.text });
      }
    } catch {
      return;
    }
  }, [expedienteId]);

  useEffect(() => {
    if (focus || !detailResult || (!entry.stage && !entry.showCorrections))
      return;
    requestAnimationFrame(() =>
      document
        .getElementById(
          entry.showCorrections ? "correcciones" : inlineStages.includes(entry.stage ?? "") ? "cumplidos" : "centro-documental",
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
    return <Skeleton label="Preparando el despacho" variant="detail" />;
  }

  if (detailResult === null || stageResult === null) {
    return (
      <section className="panel expediente-empty">
        <strong>El viaje no existe o no está disponible.</strong>
        <Link className="ghost-button action-link" href="/expedientes">
          Volver a Viajes
        </Link>
      </section>
    );
  }

  const focusRemesaId =
    focus?.remesaId ??
    (focus?.stage === "remesas" && focus.documentId
      ? detailResult.remesas.find(
          (remesa) => remesa.documentId === focus.documentId,
        )?._id
      : undefined);
  const detail = focusRemesaId
    ? {
        ...detailResult,
        remesas: detailResult.remesas.filter(
          (remesa) => remesa._id === focusRemesaId,
        ),
      }
    : detailResult;
  const manifestDocument = currentManifestDocument(
    detail.expediente,
    detail.documents,
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
      await emitIfRequested("orden");
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
      await emitIfRequested("remesas");
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
      await emitIfRequested("remesas");
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
      await emitIfRequested("manifiesto");
    }, true);
  }

  async function emitIfRequested(scope: ChainScope) {
    const requested = emitIntent.current;
    emitIntent.current = true;
    if (!requested) return;
    try {
      const response = await fetch(
        `/api/rndc/dispatches/${expedienteId}/emit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope, chain: true, queueIfUnavailable: true }),
        },
      );
      setNotice(
        emissionNotice(response.status, await response.json().catch(() => null)),
      );
    } catch {
      setNotice({
        tone: "bad",
        text: "Guardado, pero no fue posible iniciar la transmisión. Vuelve a intentarlo desde el documento.",
      });
    }
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
      emitIntent.current = true;
      await emitIfRequested(scope);
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

  const currentForm = selectedStage && operaciones.loading
    ? <Skeleton label="Trayendo datos de la solicitud de planilla" />
    : selectedStage
    ? renderStage({
        operaciones: operaciones.suggestions,
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
  const tripEditable =
    canEdit &&
    ["draft", "in_progress", "ready"].includes(detail.expediente.status);
  const tripItems = focus
    ? buildDocumentHubItems({
        detail: detailResult,
        evidence: evidence ?? [],
        isEditable: tripEditable,
      })
    : documentHubItems;

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
    const focusKey =
      focus.stage === "orden_cargue"
        ? "order"
        : focus.stage === "remesas"
          ? "consignments"
          : "manifest";
    const focusSlug: ModuleSlug =
      focus.stage === "orden_cargue"
        ? "ordenes"
        : focus.stage === "remesas"
          ? "remesas"
          : "manifiestos";
    const focusName =
      focus.stage === "orden_cargue"
        ? "Orden de cargue"
        : focus.stage === "remesas"
          ? detail.remesas.length > 1
            ? "Remesas"
            : "Remesa"
          : "Manifiesto";
    const focusState =
      focus.stage === "orden_cargue"
        ? documentState(orderDocument)
        : focus.stage === "manifiesto"
          ? documentState(manifestDocument)
          : detail.remesas.length > 0 &&
              detail.remesas.every((remesa) =>
                ["authorized", "fulfilled"].includes(remesa.officialState),
              )
            ? "authorized"
            : detail.remesas.some((remesa) => remesa.officialState === "annulled")
              ? "annulled"
              : "draft";
    const focusNumber =
      focus.stage === "orden_cargue"
        ? (detail.expediente.loadingOrderDraft?.orderNumber ??
          detail.expediente.cargoNumber)
        : focus.stage === "manifiesto"
          ? (manifestDocument?.number ??
            detail.expediente.manifestDraft?.manifestNumber ??
            detail.expediente.manifestNumber)
          : detail.remesas
              .flatMap((remesa) => (remesa.number ? [remesa.number] : []))
              .join(", ") || undefined;
    const focusDone = ["authorized", "fulfilled"].includes(focusState);
    const focusTarget = {
      viaje: detail.expediente._id,
      remesa: focusRemesaId,
      doc: focus.documentId,
    };
    const trial =
      (focus.stage === "orden_cargue"
        ? orderDocument?.mode
        : focus.stage === "manifiesto"
          ? manifestDocument?.mode
          : detail.documents.find((document) => document.kind === "remesa")
              ?.mode) === "dry-run";
    const official = (key: string) =>
      ["authorized", "fulfilled"].includes(
        tripItems.find((item) => item.key === key)?.state ?? "",
      );
    const followUp =
      focus.stage === "orden_cargue"
        ? official("consignments")
          ? null
          : {
              label:
                detailResult.remesas.length > 0
                  ? "Continuar con la remesa"
                  : "Crear la remesa",
              href: moduleHref(
                "remesas",
                detailResult.remesas.length > 0 ? "actualizar" : "insertar",
                { viaje: detail.expediente._id },
              ),
            }
        : focus.stage === "remesas"
          ? official("manifest")
            ? null
            : {
                label: "Crear el manifiesto",
                href: moduleHref("manifiestos", "insertar", {
                  viaje: detail.expediente._id,
                }),
              }
          : tripItems.find((item) => item.key === "fulfillment")?.state ===
              "fulfilled"
            ? null
            : {
                label: "Registrar cumplidos",
                href: fulfillmentHref(detail.expediente._id),
              };
    return (
      <section className="document-focused-editor">
        <div className="registry-selection">
          <div>
            <strong>
              {focusName} {focusNumber ?? "sin número"} · {detail.customer.name}
            </strong>
            <span>
              {detail.vehicle?.plate ?? "Sin placa"} ·{" "}
              {detail.loadingLocation.city} → {detail.unloadingLocation.city}
            </span>
          </div>
          <div className="registry-selection-actions">
            <StatusBadge status={focusState} />
            {focus.action === "ver" && tripEditable && focusState === "draft" ? (
              <Link
                className="ghost-button action-link"
                href={moduleHref(focusSlug, "actualizar", focusTarget)}
              >
                Editar
              </Link>
            ) : null}
            {focus.action !== "insertar" || focusNumber ? (
              <Link
                className="ghost-button action-link"
                href={moduleHref(focusSlug, "imprimir", focusTarget)}
              >
                {focus.stage === "manifiesto" && !focusDone
                  ? "Vista previa"
                  : "Imprimir"}
              </Link>
            ) : null}
            <button
              className="ghost-button"
              onClick={focus.onClose}
              type="button"
            >
              Volver al listado
            </button>
          </div>
        </div>
        <TripDocumentStrip
          code={detail.expediente.code}
          current={focusKey}
          expedienteId={detail.expediente._id}
          items={tripItems}
          remesaCount={detailResult.remesas.length}
        />
        {focusDone && focus.action !== "anular" ? (
          <div className="document-done" role="status">
            <div>
              <strong>
                Listo: {focusName.toLowerCase()} {focusNumber ?? ""}{" "}
                {focus.stage === "manifiesto" ? "autorizado" : "autorizada"}
                {focus.stage === "remesas" && detail.remesas.length > 1
                  ? "s"
                  : ""}
                {trial ? " (modo prueba)" : " por el RNDC"}.
              </strong>
              <span>
                Este documento ya está terminado.
                {followUp ? " El viaje sigue con el próximo documento." : ""}
              </span>
            </div>
            <div className="document-done-actions">
              <Link
                className="ghost-button action-link"
                href={moduleHref(focusSlug, "imprimir", focusTarget)}
              >
                Imprimir
              </Link>
              {followUp && canEdit ? (
                <Link className="primary-action action-link" href={followUp.href}>
                  {followUp.label}
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
        {notice && !(focusDone && notice.tone === "ok") ? (
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
                <SaveButtons
                  busy={busy}
                  emits={emitStages.includes(selectedStage ?? "")}
                  onIntent={(emit) => {
                    emitIntent.current = emit;
                  }}
                />
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
        <Link href="/expedientes">Viajes</Link>
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
              href={`/documentos/ordenes/insertar?desde=${detail.expediente._id}`}
              title="Crear una orden de cargue nueva con los mismos datos"
            >
              Duplicar viaje
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
                  : pending
                    ? pending.status === "attention"
                      ? "Requiere revisión"
                      : "En cola"
                    : "Modo prueba"
          }
        />
      </section>

      {pending ? (
        <div
          className={`operation-notice ${pending.status === "attention" ? "bad" : "wait"}`}
        >
          <span />
          {pending.status === "attention"
            ? `Este despacho no se pudo transmitir de forma automática: ${pending.lastError ?? "requiere revisión"}. Corrige y vuelve a guardar.`
            : "En cola para transmitir al RNDC. Se enviará solo cuando el servicio esté disponible."}
          {canEdit ? (
            <button
              aria-label="Quitar de la cola"
              onClick={() => void cancelPending({ expedienteId })}
              title="Quitar de la cola"
              type="button"
            >
              ×
            </button>
          ) : null}
        </div>
      ) : null}

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

      {primaryAction.kind === "reconcile" ||
      primaryAction.kind === "review_rejection" ? (
        <div className="operation-notice bad">
          <span />
          {primaryAction.description}
          {canEdit ? (
            <button
              className="text-button"
              onClick={() => void runPrimaryAction()}
              type="button"
            >
              {primaryAction.label}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="document-hub-anchor" id="centro-documental">
        <DocumentHub
          busy={busy}
          canEdit={canEdit}
          expedienteId={detail.expediente._id}
          items={documentHubItems}
          onOpenInline={(stage) => {
            setSelectedStage(stage);
            requestAnimationFrame(() => {
              const title = document.getElementById("active-stage-title");
              title?.focus();
              document
                .getElementById("cumplidos")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            });
          }}
          remesaCount={detail.remesas.length}
        />
      </div>

      <div id="cumplidos">
        {selectedStage && inlineStages.includes(selectedStage) && currentForm ? (
          <section className="active-stage-panel trip-inline-panel" aria-live="polite">
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
                <SaveButtons
                  busy={busy}
                  emits={emitStages.includes(selectedStage ?? "")}
                  onIntent={(emit) => {
                    emitIntent.current = emit;
                  }}
                />
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

      <details className="trip-more">
        <summary>Plan de ruta</summary>
        <DispatchRoutePlan
          destination={detail.unloadingLocation.city}
          expedienteId={detail.expediente._id}
          origin={detail.loadingLocation.city}
        />
      </details>

      <details className="trip-more">
        <summary>MTM Operaciones</summary>
        <OperacionesPanel canSend={isEditable} expedienteId={detail.expediente._id} />
      </details>

      <details className="trip-more" id="correcciones" open={entry.showCorrections || undefined}>
        <summary>Correcciones y anulaciones</summary>
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
      </details>

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

const inlineStages: string[] = [
  "vehiculo_conductor",
  "cumplido_inicial",
  "cumplido_final",
];

const emitStages: string[] = [
  "orden_cargue",
  "remesas",
  "vehiculo_conductor",
  "manifiesto",
];

function SaveButtons({
  busy,
  emits,
  onIntent,
}: {
  busy: boolean;
  emits: boolean;
  onIntent: (emit: boolean) => void;
}) {
  if (!emits)
    return (
      <button
        className="primary-action"
        disabled={busy}
        form="stage-primary-form"
        type="submit"
      >
        {busy ? "Guardando…" : "Guardar cambios"}
      </button>
    );
  return (
    <>
      <button
        className="ghost-button"
        disabled={busy}
        form="stage-primary-form"
        onClick={() => onIntent(false)}
        type="submit"
      >
        Guardar borrador
      </button>
      <button
        className="primary-action"
        disabled={busy}
        form="stage-primary-form"
        onClick={() => onIntent(true)}
        type="submit"
      >
        {busy ? "Guardando y transmitiendo…" : "Guardar y emitir"}
      </button>
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

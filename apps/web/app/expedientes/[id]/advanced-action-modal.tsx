"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { AdvancedAction } from "../components/advanced-actions";
import { MoneyField } from "../../components/fields/money-field";
import {
  CargoNatureField,
  DriverField,
  IdTypeField,
  MunicipalityField,
  VehicleField,
  type DivisionPick,
  type DriverPick,
  type VehiclePick,
} from "../../components/fields/lookup-fields";
import { kindLabels, statusLabels } from "../../lib/labels";
import type { Detail } from "./detail-types";
import { required } from "../../lib/form-data";
import { useQuery } from "../../lib/convex-hooks";
import { api } from "../../../convex/_generated/api";
import {
  appointmentBefore,
  emptyManifestPayload,
  remesaWithoutOrderPayload,
} from "./stage-payloads";

export function AdvancedActionModal({
  detail,
  modal,
  onClose,
  onDone,
  operations,
}: {
  detail: Detail;
  modal: AdvancedAction;
  onClose: () => void;
  onDone: (message: string) => void;
  operations: Array<{
    _id: Id<"rndcOperations">;
    documentId?: Id<"documents">;
    status: string;
  }>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);
  const eligible = detail.documents.filter(
    (document) =>
      document.kind === "orden_cargue" ||
      document.kind === "remesa" ||
      document.kind === "manifiesto",
  );
  const remesaDocuments = eligible.filter(
    (document) => document.kind === "remesa",
  );
  const manifestDocuments = eligible.filter(
    (document) => document.kind === "manifiesto",
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const requestKey = crypto.randomUUID();

    try {
      const common = {
        requestKey,
        reason: required(data, "reason"),
        observation: required(data, "observation"),
        confirmed: data.get("confirmed") === "on",
      };
      let route = `/api/rndc/dispatches/${detail.expediente._id}/exceptions`;
      let body: Record<string, unknown>;

      if (modal === "remesa_without_order") {
        body = {
          ...common,
          type: modal,
          payload: remesaWithoutOrderPayload(data),
        };
      } else if (modal === "empty_manifest") {
        body = { ...common, type: modal, payload: emptyManifestPayload(data) };
      } else if (modal === "transshipment") {
        body = {
          ...common,
          type: modal,
          reasonCode: required(data, "reasonCode"),
          sourceManifestDocumentId: required(data, "documentId"),
          replacementVehicleId: required(data, "vehicleId"),
          replacementDriverId: required(data, "driverId"),
          payload: {
            municipalityCode: required(data, "municipalityCode"),
            sourceSuspended: data.get("sourceSuspended") === "on",
            releasedRemesaIds: data.getAll("releasedRemesaIds").map(String),
          },
        };
      } else if (modal === "reconcile") {
        const operationId = required(
          data,
          "operationId",
        ) as Id<"rndcOperations">;
        const operation = operations.find((item) => item._id === operationId);
        if (!operation?.documentId)
          throw new Error(
            "El intento incierto no está vinculado a un documento.",
          );
        route = `/api/rndc/dispatches/${detail.expediente._id}/reconcile`;
        body = {
          ...common,
          documentId: operation.documentId,
          originalOperationId: operation._id,
        };
      } else {
        const documentId = required(data, "documentId") as Id<"documents">;
        const document = detail.documents.find(
          (item) => item._id === documentId,
        );
        if (!document) throw new Error("Selecciona un documento disponible.");
        const remesa = detail.remesas.find(
          (item) => item.documentId === documentId,
        );
        route = `/api/rndc/dispatches/${detail.expediente._id}/${modal}`;
        body =
          modal === "correct"
            ? {
                ...common,
                documentId,
                expedienteRemesaId: remesa?._id,
                reasonCode: required(data, "reasonCode"),
                before: appointmentBefore(
                  data.get("changeCode") === "2"
                    ? remesa?.draft?.unloading?.appointmentAt
                    : remesa?.draft?.loading?.appointmentAt,
                  document.number,
                ),
                after: {
                  remesaNumber: document.number,
                  changeCode: data.get("changeCode") === "2" ? 2 : 1,
                  appointmentDate: required(data, "appointmentDate"),
                  appointmentTime: required(data, "appointmentTime"),
                },
              }
            : {
                ...common,
                documentId,
                reasonCode: required(data, "reasonCode"),
                wholeSet: data.get("wholeSet") === "on",
              };
      }

      if (!common.confirmed)
        throw new Error(
          "Debes confirmar que revisaste el alcance y las dependencias.",
        );
      const response = await fetch(route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as {
        error?: string;
        blockers?: string[];
        replacementManifestNumber?: string;
      };
      if (!response.ok)
        throw new Error(
          result.error ??
            result.blockers?.[0] ??
            "La acción avanzada no terminó correctamente.",
        );
      onDone(
        result.replacementManifestNumber
          ? `El manifiesto quedó anulado y se reabrió con el número ${result.replacementManifestNumber} como reemplazo. Cambia lo necesario (conductor, vehículo o liquidación) y usa "Guardar y emitir" en el manifiesto antes de cinco días.`
          : successMessage(modal),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No fue posible completar la acción.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        aria-labelledby="advanced-modal-title"
        aria-modal="true"
        className="modal-card advanced-modal-card"
        role="dialog"
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">Acción oficial protegida</span>
            <h2 id="advanced-modal-title">{modalTitle(modal)}</h2>
          </div>
          <button aria-label="Cerrar" onClick={onClose} type="button">
            ×
          </button>
        </div>
        <form className="modal-form" onSubmit={submit}>
          {modalFields(
            modal,
            detail,
            operations,
            eligible,
            remesaDocuments,
            manifestDocuments,
          )}
          <div className="advanced-common-fields wide">
            <label>
              <span>Motivo operativo</span>
              <input
                name="reason"
                placeholder="Por qué se necesita esta acción"
                required
              />
            </label>
            <label>
              <span>Observación detallada</span>
              <textarea
                maxLength={modal === "annul" ? 200 : undefined}
                minLength={modal === "annul" ? 20 : undefined}
                name="observation"
                placeholder="Contexto, alcance y soporte revisado"
                required
                rows={3}
              />
            </label>
            <label className="confirmation-check">
              <input name="confirmed" required type="checkbox" />
              <span>
                Confirmo que revisé el documento, sus dependencias y el alcance
                de esta acción.
              </span>
            </label>
          </div>
          {error ? (
            <div className="form-error wide" role="alert">
              {error}
            </div>
          ) : null}
          <div className="modal-actions wide">
            <button className="ghost-button" onClick={onClose} type="button">
              Cancelar
            </button>
            <button
              className={modal === "annul" ? "danger-action" : "primary-action"}
              disabled={busy}
              type="submit"
            >
              {busy ? "Procesando…" : "Confirmar acción"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function modalFields(
  modal: AdvancedAction,
  detail: Detail,
  operations: Array<{
    _id: Id<"rndcOperations">;
    documentId?: Id<"documents">;
    status: string;
  }>,
  eligible: Detail["documents"],
  remesas: Detail["documents"],
  manifests: Detail["documents"],
) {
  if (modal === "correct")
    return (
      <>
        <label className="wide">
          <span>Remesa autorizada</span>
          <select name="documentId" required>
            <option value="">Selecciona</option>
            {remesas.map(documentOption)}
          </select>
        </label>
        <label>
          <span>Motivo RNDC</span>
          <select defaultValue="" name="reasonCode" required>
            <option value="">Selecciona</option>
            <option value="1">Incumplimiento del generador de la carga</option>
            <option value="2">Incumplimiento del titular del manifiesto</option>
            <option value="3">Decisión del generador de la carga</option>
          </select>
        </label>
        <label>
          <span>Cita que cambia</span>
          <select defaultValue="1" name="changeCode" required>
            <option value="1">Cita de cargue</option>
            <option value="2">Cita de descargue</option>
          </select>
        </label>
        <label>
          <span>Nueva fecha de cita</span>
          <input name="appointmentDate" required type="date" />
        </label>
        <label>
          <span>Nueva hora</span>
          <input name="appointmentTime" required type="time" />
        </label>
        <div className="modal-info wide">
          La pantalla guardará y mostrará la comparación antes/después antes de
          cerrar la excepción.
        </div>
      </>
    );
  if (modal === "annul")
    return <AnnulFields detail={detail} eligible={eligible} />;
  if (modal === "reconcile")
    return (
      <>
        <label className="wide">
          <span>Intento con resultado incierto</span>
          <select name="operationId" required>
            <option value="">Selecciona</option>
            {operations.map((operation) => (
              <option key={operation._id} value={operation._id}>
                Intento {operation._id.slice(-6)} · documento{" "}
                {operation.documentId?.slice(-6) ?? "sin vínculo"}
              </option>
            ))}
          </select>
        </label>
        <div className="modal-info wide">
          La consulta usa el intento exacto, verifica tipo y número de documento
          y nunca reenvía la operación.
        </div>
      </>
    );
  if (modal === "transshipment")
    return <TransshipmentFields detail={detail} manifests={manifests} />;
  if (modal === "empty_manifest")
    return (
      <>
        <div className="modal-info wide">
          Disponible únicamente para el tipo oficial Viaje Vacío. No solicita ni
          guarda seguimiento GPS.
        </div>
        <input name="manifestType" type="hidden" value="W" />
        <label>
          <span>Fecha de expedición</span>
          <input name="issueDate" required type="date" />
        </label>
        <label>
          <span>Entrega estimada</span>
          <input name="estimatedDeliveryDate" required type="date" />
        </label>
        <MoneyField label="Flete total" name="freightTotal" required />
        <label>
          <span>Responsable de pago</span>
          <input name="paymentResponsible" required />
        </label>
        <label className="wide">
          <span>Razón del viaje vacío</span>
          <input name="emptyManifestReason" required />
        </label>
      </>
    );
  return (
    <>
      <div className="modal-info wide">
        Esta remesa no heredará datos de una orden de cargue. Todos los datos
        operativos y RNDC son obligatorios.
      </div>
      <label>
        <span>Remitente</span>
        <input name="senderName" required />
      </label>
      <IdTypeField label="Tipo de identificación remitente" name="senderIdType" required />
      <label>
        <span>Identificación remitente</span>
        <input name="senderId" required />
      </label>
      <label>
        <span>Sede remitente</span>
        <input name="senderSiteCode" required />
      </label>
      <label>
        <span>Destinatario</span>
        <input name="recipientName" required />
      </label>
      <IdTypeField label="Tipo de identificación destinatario" name="recipientIdType" required />
      <label>
        <span>Identificación destinatario</span>
        <input name="recipientId" required />
      </label>
      <label>
        <span>Sede destinatario</span>
        <input name="recipientSiteCode" required />
      </label>
      <label>
        <span>Dirección de cargue</span>
        <input name="loadingAddress" required />
      </label>
      <ModalMunicipalityField
        cityInputName="loadingCity"
        label="Municipio de cargue"
        municipalityInputName="loadingMunicipality"
      />
      <label>
        <span>Cita de cargue</span>
        <input name="loadingAppointment" required type="datetime-local" />
      </label>
      <label>
        <span>Dirección de descargue</span>
        <input name="unloadingAddress" required />
      </label>
      <ModalMunicipalityField
        cityInputName="unloadingCity"
        label="Municipio de descargue"
        municipalityInputName="unloadingMunicipality"
      />
      <label>
        <span>Cita de descargue</span>
        <input name="unloadingAppointment" required type="datetime-local" />
      </label>
      <label>
        <span>Mercancía</span>
        <input name="cargoDescription" required />
      </label>
      <label>
        <span>Código mercancía</span>
        <input name="merchandiseCode" required />
      </label>
      <label>
        <span>Cantidad</span>
        <input name="quantity" required />
      </label>
      <label>
        <span>Peso (TN)</span>
        <input inputMode="decimal" min="0" name="weightTons" required step="0.001" type="number" />
      </label>
      <label>
        <span>Código empaque</span>
        <input name="packagingCode" required />
      </label>
      <CargoNatureField name="natureOfCargo" required />
      <MoneyField label="Valor declarado" name="declaredValue" required />
      <label>
        <span>Número de póliza</span>
        <input name="policyNumber" required />
      </label>
      <label>
        <span>Vencimiento póliza</span>
        <input name="policyExpiresOn" required type="date" />
      </label>
      <label>
        <span>NIT aseguradora</span>
        <input name="insurerNit" required />
      </label>
    </>
  );
}

function ModalMunicipalityField({
  label,
  municipalityInputName,
  cityInputName,
}: {
  label: string;
  municipalityInputName: string;
  cityInputName?: string;
}) {
  const [division, setDivision] = useState<DivisionPick | null>(null);
  return (
    <>
      <MunicipalityField
        code={division?.code}
        label={label}
        name={municipalityInputName}
        onClear={() => setDivision(null)}
        onSelect={setDivision}
        required
      />
      {cityInputName ? (
        <input
          name={cityInputName}
          type="hidden"
          value={
            division
              ? division.isMunicipality
                ? division.name
                : division.municipalityName
              : ""
          }
        />
      ) : null}
    </>
  );
}

const replacementReasons = ["R", "T", "G", "C", "V"];

function AnnulFields({
  detail,
  eligible,
}: {
  detail: Detail;
  eligible: Detail["documents"];
}) {
  const [documentId, setDocumentId] = useState(
    eligible.length === 1 ? eligible[0]._id : "",
  );
  const [reason, setReason] = useState("");
  const [wholeSet, setWholeSet] = useState(false);
  const quota = useQuery(api.dispatchExceptions.annulmentQuota, {
    expedienteId: detail.expediente._id,
  });
  const kind = eligible.find((document) => document._id === documentId)?.kind;
  const manifest = kind === "manifiesto" && !wholeSet;
  const replacement = manifest && replacementReasons.includes(reason);
  const countsForQuota =
    quota && !replacement && (kind === "manifiesto" || wholeSet);
  return (
    <>
      <label className="wide">
        <span>Documento</span>
        <select
          name="documentId"
          onChange={(event) => {
            setDocumentId(event.target.value);
            setReason("");
          }}
          required
          value={documentId}
        >
          <option value="">Selecciona</option>
          {eligible.map(documentOption)}
        </select>
      </label>
      <label>
        <span>Motivo RNDC</span>
        <select
          name="reasonCode"
          onChange={(event) => setReason(event.target.value)}
          required
          value={reason}
        >
          <option value="">Selecciona</option>
          <option value="S">Cancelación del servicio</option>
          <option value="D">Error de digitación</option>
          {manifest ? (
            <optgroup label="Con manifiesto de reemplazo">
              <option value="C">Cambio de conductor</option>
              <option value="V">Cambio de vehículo</option>
              <option value="T">Cambio de tarifa</option>
              <option value="G">Cambio de destino por el generador</option>
              <option value="R">Cambio en las remesas</option>
            </optgroup>
          ) : null}
        </select>
      </label>
      <label className="confirmation-check wide">
        <input
          checked={wholeSet}
          name="wholeSet"
          onChange={(event) => {
            setWholeSet(event.target.checked);
            if (event.target.checked && replacementReasons.includes(reason))
              setReason("");
          }}
          type="checkbox"
        />
        <span>
          Anular el conjunto documental completo (cumplidos, manifiesto,
          remesas e información del viaje) cuando el plan de dependencias lo
          permita.
        </span>
      </label>
      {replacement ? (
        <div className="modal-info wide">
          El TMS reserva el siguiente consecutivo de manifiesto y lo reporta al
          RNDC como el que reemplaza a este. El manifiesto nuevo se debe expedir
          con ese número y con este como manifiesto anterior, máximo cinco días
          después. Este reemplazo no cuenta para el tope mensual. Al terminar,
          el manifiesto de este despacho queda reabierto con ese número para
          que cambies lo necesario y lo emitas.
        </div>
      ) : null}
      {countsForQuota ? (
        <div
          className={quota.exceeded ? "form-error wide" : "modal-info wide"}
          role={quota.exceeded ? "alert" : undefined}
        >
          Tope mensual del RNDC ({quota.month}): {quota.annulled} de{" "}
          {quota.issued} manifiestos expedidos desde el TMS están anulados; se
          permiten {quota.allowed} ({quota.limitPercent}%).{" "}
          {quota.exceeded
            ? "Esta anulación supera el tope: el RNDC solo la acepta si la empresa manifiesta en su portal que continúa, y la reporta a la Superintendencia de Transporte."
            : `Después de esta quedan ${Math.max(0, quota.remaining - 1)}.`}
          {quota.replaced > 0
            ? ` Hay ${quota.replaced} anulados con reemplazo, que no cuentan.`
            : ""}
          {quota.partial ? " El conteo puede estar incompleto." : ""}
        </div>
      ) : null}
      <div className="modal-info wide">
        La anulación se detiene si existe un documento dependiente que debe
        reversarse o liberarse primero. La observación se envía al RNDC: debe
        ser clara y tener entre 20 y 200 caracteres.
      </div>
    </>
  );
}

function TransshipmentFields({
  detail,
  manifests,
}: {
  detail: Detail;
  manifests: Detail["documents"];
}) {
  const [vehicle, setVehicle] = useState<VehiclePick | null>(null);
  const [driver, setDriver] = useState<DriverPick | null>(null);
  return (
    <>
      <label className="wide">
        <span>Manifiesto anterior</span>
        <select name="documentId" required>
          <option value="">Selecciona</option>
          {manifests.map(documentOption)}
        </select>
      </label>
      <label>
        <span>Motivo del transbordo</span>
        <select name="reasonCode" required>
          <option value="">Selecciona</option>
          <option value="A">Accidente</option>
          <option value="V">Varada</option>
          <option value="S">Siniestro</option>
        </select>
      </label>
      <ModalMunicipalityField
        label="Municipio del transbordo"
        municipalityInputName="municipalityCode"
      />
      <VehicleField
        label="Vehículo de reemplazo"
        onClear={() => setVehicle(null)}
        onSelect={setVehicle}
        required
        selected={vehicle}
      />
      <input name="vehicleId" type="hidden" value={vehicle?._id ?? ""} />
      <DriverField
        label="Conductor de reemplazo"
        onClear={() => setDriver(null)}
        onSelect={setDriver}
        required
        selected={driver}
      />
      <input name="driverId" type="hidden" value={driver?._id ?? ""} />
      <fieldset className="wide">
        <legend>Remesas ya liberadas en RNDC</legend>
        {detail.remesas.map((remesa) => (
          <label className="confirmation-check" key={remesa._id}>
            <input
              name="releasedRemesaIds"
              type="checkbox"
              value={remesa._id}
            />
            <span>{remesa.number ?? `Remesa ${remesa.sequence}`}</span>
          </label>
        ))}
      </fieldset>
      <label className="confirmation-check wide">
        <input name="sourceSuspended" type="checkbox" />
        <span>
          El manifiesto anterior fue cumplido con suspensión; déjalo sin marcar
          si fue anulado.
        </span>
      </label>
    </>
  );
}

function documentOption(document: Detail["documents"][number]) {
  return (
    <option key={document._id} value={document._id}>
      {kindLabels[document.kind] ?? document.kind} {document.number ?? "sin número"} ·{" "}
      {statusLabels[document.officialState ?? document.status] ??
        document.officialState ??
        document.status}
    </option>
  );
}

function modalTitle(modal: AdvancedAction): string {
  const titles: Record<AdvancedAction, string> = {
    remesa_without_order: "Crear remesa sin orden",
    empty_manifest: "Crear manifiesto vacío",
    transshipment: "Registrar transbordo",
    correct: "Corregir remesa",
    annul: "Anular documento",
    reconcile: "Conciliar resultado",
  };
  return titles[modal];
}

function successMessage(modal: AdvancedAction): string {
  const messages: Record<AdvancedAction, string> = {
    remesa_without_order: "La remesa independiente quedó creada y auditada.",
    empty_manifest: "El viaje vacío quedó preparado sin campos de seguimiento.",
    transshipment:
      "El transbordo conservó la flota anterior y creó la nueva fotografía.",
    correct: "La corrección quedó registrada con comparación y evidencia.",
    annul: "La anulación quedó registrada con dependencias y evidencia.",
    reconcile: "La conciliación quedó registrada sin reenviar el documento.",
  };
  return messages[modal];
}


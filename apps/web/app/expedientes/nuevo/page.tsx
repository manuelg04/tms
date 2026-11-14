"use client";

import { CargoGuidance, cargoHints } from "../components/cargo-guidance";
import { FormField, FormValidationError, ValidatedForm } from "../../components/fields/form-validation";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { emissionNotice } from "../../lib/emission-notice";
import { moduleHref } from "../../lib/module-links";
import { requestedDriverId } from "../../lib/operaciones-request";
import { Suspense, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "../../lib/convex-hooks";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DateField } from "../../components/fields/date-field";
import { MoneyField } from "../../components/fields/money-field";
import { CargoNatureField, IdTypeField, MerchandiseField, MunicipalityField, PackagingField, PartyField, SiteField, VehicleField, type PartyPick, type VehiclePick } from "../../components/fields/lookup-fields";
import { requiredDriverFreight } from "../components/vehicle-assignment-state";
import { DEFAULT_PARTY_SITE } from "../../../convex/model/masterSync";
import { loadingWindowEnd, optionalNumber, required, value } from "../../lib/form-data";
import { Skeleton } from "../../components/skeleton";
import { SolicitudPrefillLoader, SolicitudSummary, type SolicitudPrefill } from "./solicitud-prefill";
import { TripRouteLine } from "../components/trip-route";

type BaseState = {
  client: PartyPick | null;
  clientName: string;
  clientDocument: string;
  clientIdType: string;
  sender: PartyPick | null;
  senderName: string;
  senderIdType: string;
  senderId: string;
  senderAddress: string;
  senderCity: string;
  senderMunicipality: string;
  senderPhone: string;
  senderCellphone: string;
  senderSiteCode: string;
  recipient: PartyPick | null;
  recipientName: string;
  recipientIdType: string;
  recipientId: string;
  recipientAddress: string;
  recipientCity: string;
  recipientMunicipality: string;
  recipientPhone: string;
  recipientCellphone: string;
  recipientSiteCode: string;
  vehicle: VehiclePick | null;
  packagingCode: string;
  packagingDescription: string;
};

const EMPTY_STATE: BaseState = {
  client: null,
  clientName: "",
  clientDocument: "",
  clientIdType: "N",
  sender: null,
  senderName: "",
  senderIdType: "N",
  senderId: "",
  senderAddress: "",
  senderCity: "",
  senderMunicipality: "",
  senderPhone: "",
  senderCellphone: "",
  senderSiteCode: "",
  recipient: null,
  recipientName: "",
  recipientIdType: "N",
  recipientId: "",
  recipientAddress: "",
  recipientCity: "",
  recipientMunicipality: "",
  recipientPhone: "",
  recipientCellphone: "",
  recipientSiteCode: "",
  vehicle: null,
  packagingCode: "",
  packagingDescription: ""
};

type Detail = NonNullable<typeof api.expedientes.detail._returnType>;

type Template = {
  code: string;
  customerName: string;
  order: NonNullable<Detail["expediente"]["loadingOrderDraft"]>;
};

type Reservation = {
  reservationId: Id<"loadingOrderReservations">;
  number: string;
};

function templateState(template: Template | null): BaseState {
  if (!template) return EMPTY_STATE;
  const order = template.order;
  return {
    ...EMPTY_STATE,
    clientName: template.customerName,
    senderName: order.sender?.name ?? "",
    senderIdType: order.sender?.identificationType ?? "N",
    senderId: order.sender?.identificationNumber ?? "",
    senderAddress: order.sender?.address ?? order.loading?.address ?? "",
    senderCity: order.sender?.cityName ?? order.loading?.cityName ?? "",
    senderMunicipality: order.sender?.municipalityCode ?? order.loading?.municipalityCode ?? "",
    senderPhone: order.sender?.phone ?? "",
    senderCellphone: order.sender?.cellphone ?? "",
    senderSiteCode: order.sender?.siteCode ?? "",
    recipientName: order.recipient?.name ?? "",
    recipientIdType: order.recipient?.identificationType ?? "N",
    recipientId: order.recipient?.identificationNumber ?? "",
    recipientAddress: order.recipient?.address ?? order.unloading?.address ?? "",
    recipientCity: order.recipient?.cityName ?? order.unloading?.cityName ?? "",
    recipientMunicipality: order.recipient?.municipalityCode ?? order.unloading?.municipalityCode ?? "",
    recipientPhone: order.recipient?.phone ?? "",
    recipientCellphone: order.recipient?.cellphone ?? "",
    recipientSiteCode: order.recipient?.siteCode ?? "",
    packagingCode: order.packagingCode ?? ""
  };
}

export default function NuevoDespachoPage() {
  return <Suspense fallback={<Skeleton label="Preparando el formulario" variant="detail" />}><NuevoDespachoLoader /></Suspense>;
}

function NuevoDespachoLoader() {
  const params = useSearchParams();
  const sourceId = params.get("desde");
  const solicitudId = params.get("solicitud");
  if (solicitudId) {
    return <SolicitudPrefillLoader solicitudId={solicitudId}>{(prefill) => <NuevoDespachoForm key={`solicitud-${solicitudId}`} prefill={prefill} sourceId={null} template={null} />}</SolicitudPrefillLoader>;
  }
  const source = useQuery(api.expedientes.detail, sourceId ? { expedienteId: sourceId as Id<"expedientes"> } : "skip");
  if (sourceId && source === undefined) return <Skeleton label="Copiando datos del despacho anterior" variant="detail" />;
  const template: Template | null = sourceId && source?.expediente.loadingOrderDraft
    ? { code: source.expediente.code, customerName: source.customer.name, order: source.expediente.loadingOrderDraft }
    : null;
  return <NuevoDespachoForm key={sourceId ?? "nuevo"} sourceId={sourceId} template={template} />;
}

function NuevoDespachoForm({ sourceId, template, prefill }: { sourceId: string | null; template: Template | null; prefill?: SolicitudPrefill }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const me = useQuery(api.access.me, {});
  const organizationId = me?.organizationId;
  const [reservationError, setReservationError] = useState("");
  const [reservationAttempt, setReservationAttempt] = useState(0);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [reservationToken] = useState(() => `loading-order-${crypto.randomUUID()}`);
  const [savingAction, setSavingAction] = useState<"draft" | "open" | null>(null);
  const [state, setState] = useState<BaseState>(() => ({ ...templateState(template), ...prefill?.state }));
  const copied: Partial<Template["order"]> | undefined = template?.order ?? prefill?.defaults;
  const update = (patch: Partial<BaseState>) => setState((current) => ({ ...current, ...patch }));
  const today = new Date().toISOString().slice(0, 10);
  const keepsRequestOrigin = Boolean(prefill?.state.senderMunicipality) && state.senderMunicipality === prefill?.state.senderMunicipality;
  const keepsRequestDestination = Boolean(prefill?.state.recipientMunicipality) && state.recipientMunicipality === prefill?.state.recipientMunicipality;
  const sameMunicipality = Boolean(state.senderMunicipality) && state.senderMunicipality === state.recipientMunicipality;
  const reserveLoadingOrderNumber = useMutation(api.dispatches.reserveLoadingOrderNumber);
  const upsertCustomer = useMutation(api.masterData.upsertCustomer);
  const upsertLocation = useMutation(api.masterData.upsertCustomerLocation);
  const upsertOrder = useMutation(api.masterData.upsertServiceOrder);
  const createDraft = useMutation(api.dispatches.createDraft);
  const saveLoadingOrder = useMutation(api.dispatches.saveLoadingOrderDraft);
  const saveAssignment = useMutation(api.dispatches.saveAssignmentDraft);
  const linkSolicitud = useMutation(api.operaciones.link);

  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    setReservationError("");
    void reserveLoadingOrderNumber({ token: reservationToken })
      .then((result) => {
        if (active) setReservation(result);
      })
      .catch((cause: unknown) => {
        if (active) setReservationError(readError(cause));
      });
    return () => {
      active = false;
    };
  }, [organizationId, reservationAttempt, reservationToken, reserveLoadingOrderNumber]);

  async function saveBase(action: "draft" | "open") {
    if (!me || !formRef.current) {
      throw new Error("La sesión todavía no está conectada al espacio de trabajo.");
    }
    if (!reservation) {
      throw new Error("Espera a que se reserve el consecutivo de la orden.");
    }

    setSavingAction(action);
    const data = new FormData(formRef.current);

    try {
      if (!state.vehicle) throw new FormValidationError("vehicleId", "Selecciona una placa existente en maestros.");
      if (sameMunicipality && data.get("urbanTrip") !== "on") {
        throw new FormValidationError("recipientMunicipality", `El destino es el mismo municipio que el origen (${state.senderCity}). Elige el municipio de descargue o marca que es un viaje urbano.`);
      }
      const preparedOrder = loadingOrderDraft(data);
      const senderId = required(data, "senderId");
      const clientDocument = value(data, "clientDocument") ?? senderId;
      const clientIdType = value(data, "clientIdType") ?? required(data, "senderIdType");
      const customerId = await upsertCustomer({
        organizationId: me.organizationId,
        code: clientDocument,
        name: required(data, "clientName"),
        identificationType: clientIdType,
        identificationNumber: clientDocument,
        phone: value(data, "senderPhone"),
        status: "active"
      });
      const [loadingLocationId, unloadingLocationId] = await Promise.all([
        upsertLocation({
          customerId,
          code: `${clientDocument}-${senderId}-ORI`,
          name: required(data, "senderName"),
          kind: "loading",
          address: required(data, "senderAddress"),
          city: required(data, "senderCity"),
          municipalityCode: required(data, "senderMunicipality"),
          status: "active"
        }),
        upsertLocation({
          customerId,
          code: `${clientDocument}-${required(data, "recipientId")}-DES`,
          name: required(data, "recipientName"),
          kind: "unloading",
          address: required(data, "recipientAddress"),
          city: required(data, "recipientCity"),
          municipalityCode: required(data, "recipientMunicipality"),
          status: "active"
        })
      ]);
      const serviceOrderId = await upsertOrder({
        organizationId: me.organizationId,
        code: reservation.number,
        customerId,
        loadingLocationId,
        unloadingLocationId,
        status: "confirmed",
        cargoDescription: required(data, "cargoDescription"),
        cargoQuantity: optionalNumber(data, "cargoQuantity"),
        cargoWeightKg: (optionalNumber(data, "weightTons") ?? 0) * 1000,
        agreedRate: 0,
        currency: "COP",
        scheduledLoadingAt: loadingDateTime(data, "minLoadingDate", false),
        scheduledUnloadingAt: loadingDateTime(data, "maxLoadingDate", true),
        notes: value(data, "orderObservations")
      });
      const created = await createDraft({
        serviceOrderId,
        orderReservationId: reservation.reservationId,
        orderReservationToken: reservationToken,
        agencyCode: value(data, "agencyCode"),
        notes: value(data, "orderObservations")
      });
      await Promise.all([
        saveLoadingOrder({
          expedienteId: created.expedienteId,
          draft: { ...preparedOrder, customerId }
        }),
        saveAssignment({ expedienteId: created.expedienteId, vehicleId: state.vehicle._id, driverId: assignedDriverId(state.vehicle, prefill) }),
        ...(prefill ? [linkSolicitud({
          expedienteId: created.expedienteId,
          operacionesExpedienteId: prefill.request.expedienteId,
          plate: prefill.request.vehicle.plate,
          driverName: prefill.request.driver.name
        })] : [])
      ]);

      if (action === "open") {
        let notice: { tone: "ok" | "bad" | "wait"; text: string } = {
          tone: "bad",
          text: "La orden quedó guardada como borrador, pero no se pudo dejar lista. Ábrela y usa Guardar orden para intentarlo de nuevo."
        };
        try {
          const response = await fetch(`/api/rndc/dispatches/${created.expedienteId}/emit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scope: "orden", chain: true, queueIfUnavailable: true })
          });
          notice = emissionNotice(response.status, await response.json().catch(() => null));
        } catch {
          notice = { ...notice };
        }
        try {
          window.sessionStorage.setItem(`tms:aviso:${created.expedienteId}`, JSON.stringify(notice));
        } catch {
          notice = { ...notice };
        }
      }

      router.push(moduleHref("ordenes", "actualizar", { viaje: created.expedienteId }));
    } catch (cause) {
      setSavingAction(null);
      throw cause;
    }
  }

  const saving = savingAction !== null;

  return (
    <ValidatedForm className="guided-dispatch-form base-dispatch-form form-compact" onSubmit={(event) => saveBase((event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "draft" ? "draft" : "open")} ref={formRef}>
      {template || prefill ? <section className="base-dispatch-intro">
        <div>
          <span className="eyebrow">Nueva orden de cargue</span>
          <h2>{template ? `Copia de ${template.code}` : prefill ? `Solicitud de planilla · ${prefill.request.vehicle.plate ?? "sin placa"}` : "Datos de la orden de cargue"}</h2>
          <p>{prefill ? "Datos traídos de MTM Operaciones. Revisa cada campo antes de guardar; nada se crea hasta que guardes." : "La misma información operativa de Avansat, con búsquedas en los maestros del TMS."}</p>
        </div>
        <div className="base-dispatch-outcome"><strong>Al guardar la orden</strong><span>Queda numerada y lista para imprimir y para hacer la remesa. Es un documento interno: no se envía al RNDC</span></div>
      </section> : null}

      {template ? <div className="operation-notice ok" role="status"><span />Datos copiados de <Link href={`/expedientes/${sourceId}`}>{template.code}</Link>: revisa fechas, peso y observaciones antes de guardar. Nada se crea hasta que guardes.</div> : null}
      {prefill ? <SolicitudSummary prefill={prefill} /> : null}
      <div className="base-document-path" aria-label="Documentos que se completan después"><span className="active">1. Orden de cargue</span><span>2. Remesa</span><span>3. Manifiesto</span><span>4. Cumplidos</span></div>

      <div className="guided-form-stage">
        <section aria-labelledby="loading-order-title">
          <StageHeading id="loading-order-title" title="Orden de cargue" text="Completa los campos operativos que usa Avansat para insertar la orden." />
          <div className="stage-form-fields">
            <div className="field-group-note"><strong>Datos básicos</strong></div>
            <DateField label="Fecha" name="expeditionDate" required value={today} />
            <Field label="Nro. de orden de cargue" name="orderNumber" placeholder={reservationError ? "No disponible" : "Reservando…"} readOnly value={reservation?.number ?? ""} />
            <Field defaultValue={copied?.agencyCode} label="Agencia responsable" name="agencyCode" placeholder="Principal" />
            <FormField className="checkbox-field"><span>Genera remesa</span><span className="checkbox-control"><input defaultChecked={copied?.generatesConsignment ?? true} name="generatesConsignment" type="checkbox" /><em>Crear la remesa desde esta orden</em></span></FormField>
            <PartyField
              className="span-2"
              label="Cliente"
              onClear={() => update({ client: null, clientName: "", clientDocument: "", clientIdType: "N" })}
              onSelect={(party) => update({ client: party, clientName: party.name, clientDocument: party.document, clientIdType: party.documentType })}
              onType={(name) => update({ client: null, clientName: name, clientDocument: "", clientIdType: "N" })}
              required
              selected={state.client ?? (state.clientName && state.clientDocument ? { name: state.clientName, document: state.clientDocument, documentType: state.clientIdType } : null)}
              typedName={state.client ? undefined : state.clientName}
            />
            <input name="clientName" type="hidden" value={state.clientName} />
            <input name="clientDocument" type="hidden" value={state.clientDocument} />
            <input name="clientIdType" type="hidden" value={state.clientIdType} />

            <div className="field-group-note"><strong>Datos del remitente</strong></div>
            <PartyField
              className="span-2"
              label="Nombre del remitente"
              onClear={() => update({ sender: null, senderName: "", senderIdType: "N", senderId: "", senderAddress: "", senderCity: "", senderMunicipality: "", senderPhone: "", senderCellphone: "", senderSiteCode: "" })}
              onSelect={(party) => update({ sender: party, senderName: party.name, senderIdType: party.documentType, senderId: party.document, senderAddress: party.address ?? state.senderAddress, senderCity: keepsRequestOrigin ? state.senderCity : party.city ?? state.senderCity, senderMunicipality: keepsRequestOrigin ? state.senderMunicipality : party.cityCode ?? state.senderMunicipality, senderPhone: party.phone ?? state.senderPhone, senderSiteCode: "" })}
              onType={(name) => update({ sender: null, senderName: name })}
              required
              role="sender"
              selected={state.sender ?? (state.senderName && state.senderId ? { name: state.senderName, document: state.senderId, documentType: state.senderIdType } : null)}
              typedName={state.sender ? undefined : state.senderName}
            />
            <IdTypeField label="Tipo de identificación remitente" name="senderIdType" onChange={(value) => update({ senderIdType: value })} required value={state.senderIdType} />
            <Field label="Número de identificación remitente" name="senderId" onChange={(event) => update({ senderId: event.target.value })} required value={state.senderId} />
            <Field className="span-2" label="Dirección remitente" name="senderAddress" onChange={(event) => update({ senderAddress: event.target.value })} required value={state.senderAddress} />
            <MunicipalityField code={state.senderMunicipality || undefined} label="Ciudad remitente" name="senderMunicipality" onClear={() => update({ senderMunicipality: "", senderCity: "" })} onSelect={(division) => update({ senderMunicipality: division.code, senderCity: division.isMunicipality ? division.name : division.municipalityName })} required />
            <Field label="Teléfono remitente" name="senderPhone" onChange={(event) => update({ senderPhone: event.target.value })} required type="tel" value={state.senderPhone} />
            <Field label="Celular remitente" name="senderCellphone" onChange={(event) => update({ senderCellphone: event.target.value })} type="tel" value={state.senderCellphone} />
            <input name="senderName" type="hidden" value={state.senderName} />
            <input name="senderCity" type="hidden" value={state.senderCity} />
            <OrderPartySite document={state.senderId} label="Sede del remitente" name="senderSiteCode" onParty={(party) => update({ sender: party })} onSite={(siteCode) => update({ senderSiteCode: siteCode })} party={state.sender} role="sender" siteCode={state.senderSiteCode} />

            <div className="field-group-note"><strong>Datos del destinatario</strong></div>
            <PartyField
              className="span-2"
              label="Nombre del destinatario"
              onClear={() => update({ recipient: null, recipientName: "", recipientIdType: "N", recipientId: "", recipientAddress: "", recipientCity: "", recipientMunicipality: "", recipientPhone: "", recipientCellphone: "", recipientSiteCode: "" })}
              onSelect={(party) => update({ recipient: party, recipientName: party.name, recipientIdType: party.documentType, recipientId: party.document, recipientAddress: party.address ?? state.recipientAddress, recipientCity: keepsRequestDestination ? state.recipientCity : party.city ?? state.recipientCity, recipientMunicipality: keepsRequestDestination ? state.recipientMunicipality : party.cityCode ?? state.recipientMunicipality, recipientPhone: party.phone ?? state.recipientPhone, recipientSiteCode: "" })}
              onType={(name) => update({ recipient: null, recipientName: name })}
              required
              role="recipient"
              selected={state.recipient ?? (state.recipientName && state.recipientId ? { name: state.recipientName, document: state.recipientId, documentType: state.recipientIdType } : null)}
              typedName={state.recipient ? undefined : state.recipientName}
            />
            <IdTypeField label="Tipo de identificación destinatario" name="recipientIdType" onChange={(value) => update({ recipientIdType: value })} required value={state.recipientIdType} />
            <Field label="Número de identificación destinatario" name="recipientId" onChange={(event) => update({ recipientId: event.target.value })} required value={state.recipientId} />
            <Field className="span-2" label="Dirección destinatario" name="recipientAddress" onChange={(event) => update({ recipientAddress: event.target.value })} required value={state.recipientAddress} />
            <MunicipalityField code={state.recipientMunicipality || undefined} label="Ciudad destinatario" name="recipientMunicipality" onClear={() => update({ recipientMunicipality: "", recipientCity: "" })} onSelect={(division) => update({ recipientMunicipality: division.code, recipientCity: division.isMunicipality ? division.name : division.municipalityName })} required />
            <Field label="Teléfono destinatario" name="recipientPhone" onChange={(event) => update({ recipientPhone: event.target.value })} required type="tel" value={state.recipientPhone} />
            <Field label="Celular destinatario" name="recipientCellphone" onChange={(event) => update({ recipientCellphone: event.target.value })} type="tel" value={state.recipientCellphone} />
            <input name="recipientName" type="hidden" value={state.recipientName} />
            <input name="recipientCity" type="hidden" value={state.recipientCity} />
            {sameMunicipality ? <FormField className="checkbox-field span-2"><span>Origen y destino iguales</span><span className="checkbox-control"><input name="urbanTrip" type="checkbox" /><em>Es un viaje urbano dentro de {state.senderCity}. Si el viaje es entre ciudades, corrige la ciudad del destinatario.</em></span></FormField> : null}
            <OrderPartySite document={state.recipientId} label="Sede del destinatario" name="recipientSiteCode" onParty={(party) => update({ recipient: party })} onSite={(siteCode) => update({ recipientSiteCode: siteCode })} party={state.recipient} role="recipient" siteCode={state.recipientSiteCode} />

            <div className="field-group-note"><strong>Datos del vehículo</strong></div>
            <VehicleField label="Placa" onClear={() => update({ vehicle: null })} onSelect={(vehicle) => update({ vehicle })} required selected={state.vehicle} />
            <MoneyField label="Flete conductor" name="driverFreight" required value={copied?.driverFreight} />

            <div className="field-group-note"><strong>Datos de la mercancía</strong></div>
            <CargoGuidance />
            <MerchandiseField className="span-2" code={copied?.merchandiseCode} codeName="merchandiseCode" name="cargoDescription" onProduct={(product) => { if (!state.packagingCode && product.packagingCode) update({ packagingCode: product.packagingCode, packagingDescription: "" }); }} required value={copied?.cargoDescription} />
            <Field defaultValue={copied?.weightTons} hint={cargoHints.weight} label="Peso (TN)" min="0" name="weightTons" required step="0.001" type="number" />
            <Field defaultValue={copied?.volumeM3} hint={cargoHints.volume} label="Volumen (m³)" min="0" name="volumeM3" step="0.01" type="number" />
            <Field defaultValue={copied?.cargoQuantity} hint={cargoHints.quantity} label="Cantidad" min="0" name="cargoQuantity" type="number" />
            <PackagingField code={state.packagingCode || undefined} description={state.packagingDescription} label="Tipo de empaque" name="packagingCode" onClear={() => update({ packagingCode: "", packagingDescription: "" })} onSelect={(option) => update({ packagingCode: option.code, packagingDescription: option.description })} required />
            <Field defaultValue={copied?.optionalCargoField} label="Campo opcional" name="optionalCargoField" />
            <input defaultValue={copied?.cargoUnit} name="cargoUnit" type="hidden" />
            <CargoNatureField name="natureOfCargo" required value={copied?.natureOfCargo} />

            <div className="field-group-note"><strong>Observaciones especiales</strong></div>
            <FormField><span>Sellos y/o precintos</span><textarea defaultValue={copied?.sealNumbers} name="sealNumbers" rows={3} /></FormField>
            <FormField><span>Condiciones de cargue</span><textarea defaultValue={copied?.loadingConditions} name="loadingConditions" rows={3} /></FormField>
            <FormField><span>Embalaje especial</span><textarea defaultValue={copied?.specialPackaging} name="specialPackaging" rows={3} /></FormField>
            <FormField><span>Observaciones</span><textarea defaultValue={copied?.observations} name="orderObservations" rows={3} /></FormField>

            <div className="field-group-note"><strong>Fechas de cargue</strong></div>
            <DateField label="Fecha mínima" name="minLoadingDate" required value={copied?.minLoadingDate ?? today} />
            <DateField label="Fecha máxima" name="maxLoadingDate" required value={copied?.maxLoadingDate ?? today} />
          </div>
        </section>
      </div>

      {reservationError ? <div className="form-error" role="alert">{reservationError} <button className="link-button" onClick={() => setReservationAttempt((current) => current + 1)} type="button">Reintentar consecutivo</button></div> : null}
      <div className="guided-action-bar base-action-bar">
        <span className="base-action-route"><TripRouteLine route={{ origin: state.senderCity || undefined, destination: state.recipientCity || undefined }} /></span>
        <div>
          <button className="ghost-button" disabled={saving || !me || !reservation} value="draft" type="submit">{savingAction === "draft" ? "Guardando…" : "Guardar borrador"}</button>
          <button className="primary-action" disabled={saving || !me || !reservation} value="open" type="submit">{savingAction === "open" ? "Guardando la orden…" : "Guardar orden"}</button>
        </div>
      </div>
    </ValidatedForm>
  );
}

function assignedDriverId(vehicle: VehiclePick, prefill: SolicitudPrefill | undefined) {
  return requestedDriverId({ requestedDocument: prefill?.request.driver.document, matched: prefill?.driver, linked: vehicle.drivers ?? [] });
}

function StageHeading({ id, text, title }: { id: string; text: string; title: string }) {
  return <div className="guided-stage-heading"><span>01</span><div><h3 id={id}>{title}</h3><p>{text}</p></div></div>;
}

function Field({ className = "", label, name, hint, ...props }: { hint?: string; className?: string; label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <FormField className={className}><span>{label}{props.required ? <em aria-hidden="true"> *</em> : null}</span><input aria-describedby={hint ? `${name}-hint` : undefined} name={name} {...props} />{hint ? <small className="cargo-field-hint" id={`${name}-hint`}>{hint}</small> : null}</FormField>;
}

function loadingOrderDraft(data: FormData) {
  const loadingAppointment = loadingDateTime(data, "minLoadingDate", false);
  const unloadingAppointment = loadingDateTime(data, "maxLoadingDate", true);
  return {
    orderNumber: required(data, "orderNumber"),
    expeditionDate: required(data, "expeditionDate"),
    agencyCode: value(data, "agencyCode"),
    sender: compact({
      name: required(data, "senderName"),
      identificationType: required(data, "senderIdType"),
      identificationNumber: required(data, "senderId"),
      siteCode: value(data, "senderSiteCode"),
      municipalityCode: required(data, "senderMunicipality"),
      address: required(data, "senderAddress"),
      cityName: required(data, "senderCity"),
      phone: required(data, "senderPhone"),
      cellphone: value(data, "senderCellphone")
    }),
    recipient: compact({
      name: required(data, "recipientName"),
      identificationType: required(data, "recipientIdType"),
      identificationNumber: required(data, "recipientId"),
      siteCode: value(data, "recipientSiteCode"),
      municipalityCode: required(data, "recipientMunicipality"),
      address: required(data, "recipientAddress"),
      cityName: required(data, "recipientCity"),
      phone: required(data, "recipientPhone"),
      cellphone: value(data, "recipientCellphone")
    }),
    loading: {
      siteName: required(data, "senderName"),
      address: required(data, "senderAddress"),
      cityName: required(data, "senderCity"),
      municipalityCode: required(data, "senderMunicipality"),
      appointmentAt: loadingAppointment
    },
    unloading: {
      siteName: required(data, "recipientName"),
      address: required(data, "recipientAddress"),
      cityName: required(data, "recipientCity"),
      municipalityCode: required(data, "recipientMunicipality"),
      appointmentAt: unloadingAppointment
    },
    cargoDescription: required(data, "cargoDescription"),
    cargoQuantity: value(data, "cargoQuantity"),
    cargoUnit: value(data, "cargoUnit"),
    optionalCargoField: value(data, "optionalCargoField"),
    weightTons: required(data, "weightTons"),
    volumeM3: value(data, "volumeM3"),
    packagingCode: required(data, "packagingCode"),
    merchandiseCode: value(data, "merchandiseCode"),
    natureOfCargo: value(data, "natureOfCargo"),
    driverFreight: requiredDriverFreight(value(data, "driverFreight")),
    sealNumbers: value(data, "sealNumbers"),
    loadingConditions: value(data, "loadingConditions"),
    specialPackaging: value(data, "specialPackaging"),
    observations: value(data, "orderObservations"),
    minLoadingDate: required(data, "minLoadingDate"),
    maxLoadingDate: loadingWindowEnd(data),
    generatesConsignment: data.get("generatesConsignment") === "on"
  };
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function loadingDateTime(data: FormData, key: string, endOfDay: boolean): number {
  const value = required(data, key);
  const timestamp = new Date(`${value}T${endOfDay ? "23:59:00" : "00:00:00"}-05:00`).getTime();
  if (!Number.isFinite(timestamp)) throw new FormValidationError(key, "Selecciona una fecha válida.");
  return timestamp;
}

function readError(cause: unknown): string {
  return cause instanceof Error ? cause.message.replace(/^.*?: /, "") : "No fue posible guardar el despacho.";
}

function OrderPartySite({ document, label, name, onParty, onSite, party, role, siteCode }: { document: string; label: string; name: string; onParty: (party: PartyPick) => void; onSite: (siteCode: string) => void; party: PartyPick | null; role: "sender" | "recipient"; siteCode: string }) {
  const matches = useQuery(api.lookups.partiesSearch, !party && document.trim().length >= 5 ? { term: document.trim(), role } : "skip");
  const exact = matches?.find((row) => row.document === document.trim());
  const onPartyRef = useRef(onParty);
  onPartyRef.current = onParty;
  const onSiteRef = useRef(onSite);
  onSiteRef.current = onSite;
  useEffect(() => {
    if (!party && exact) onPartyRef.current(exact);
  }, [party, exact]);
  const unknown = !party && (document.trim().length < 5 || (matches !== undefined && !exact));
  useEffect(() => {
    if (unknown && document.trim() && !siteCode) onSiteRef.current(DEFAULT_PARTY_SITE.siteCode);
  }, [unknown, document, siteCode]);
  return (
    <>
      {party ? (
        <SiteField
          className="span-2"
          label={label}
          name={name}
          onClear={() => onSite("")}
          onDefault={(site) => onSite(site.siteCode)}
          onSelect={(site) => onSite(site.siteCode)}
          required
          selectedCode={siteCode || undefined}
          thirdPartyId={party._id}
        />
      ) : null}
      <input name={name} type="hidden" value={siteCode} />
    </>
  );
}

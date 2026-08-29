"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DateField } from "../../components/fields/date-field";
import { MoneyField } from "../../components/fields/money-field";
import { IdTypeField, MunicipalityField, PackagingField, PartyField, VehicleField, type PartyPick, type VehiclePick } from "../../components/fields/lookup-fields";
import { requiredDriverFreight } from "../components/vehicle-assignment-state";

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
  return <Suspense fallback={<div className="skeleton">Preparando el formulario…</div>}><NuevoDespachoLoader /></Suspense>;
}

function NuevoDespachoLoader() {
  const params = useSearchParams();
  const sourceId = params.get("desde");
  const source = useQuery(api.expedientes.detail, sourceId ? { expedienteId: sourceId as Id<"expedientes"> } : "skip");
  if (sourceId && source === undefined) return <div className="skeleton">Copiando datos del despacho anterior…</div>;
  const template: Template | null = sourceId && source?.expediente.loadingOrderDraft
    ? { code: source.expediente.code, customerName: source.customer.name, order: source.expediente.loadingOrderDraft }
    : null;
  return <NuevoDespachoForm key={sourceId ?? "nuevo"} sourceId={sourceId} template={template} />;
}

function NuevoDespachoForm({ sourceId, template }: { sourceId: string | null; template: Template | null }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const me = useQuery(api.access.me, {});
  const organizationId = me?.organizationId;
  const [error, setError] = useState("");
  const [reservationError, setReservationError] = useState("");
  const [reservationAttempt, setReservationAttempt] = useState(0);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [reservationToken] = useState(() => `loading-order-${crypto.randomUUID()}`);
  const [savingAction, setSavingAction] = useState<"draft" | "open" | null>(null);
  const [state, setState] = useState<BaseState>(() => templateState(template));
  const copied = template?.order;
  const update = (patch: Partial<BaseState>) => setState((current) => ({ ...current, ...patch }));
  const today = new Date().toISOString().slice(0, 10);
  const reserveLoadingOrderNumber = useMutation(api.dispatches.reserveLoadingOrderNumber);
  const upsertCustomer = useMutation(api.masterData.upsertCustomer);
  const upsertLocation = useMutation(api.masterData.upsertCustomerLocation);
  const upsertOrder = useMutation(api.masterData.upsertServiceOrder);
  const createDraft = useMutation(api.dispatches.createDraft);
  const saveLoadingOrder = useMutation(api.dispatches.saveLoadingOrderDraft);
  const saveAssignment = useMutation(api.dispatches.saveAssignmentDraft);

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
      setError("La sesión todavía no está conectada al espacio de trabajo.");
      return;
    }
    if (!reservation) {
      setError("Espera a que se reserve el consecutivo de la orden.");
      return;
    }

    setSavingAction(action);
    setError("");
    const data = new FormData(formRef.current);

    try {
      if (!state.vehicle) throw new Error("Selecciona una placa existente en maestros.");
      const senderId = requiredText(data, "senderId");
      const clientDocument = optionalText(data, "clientDocument") ?? senderId;
      const clientIdType = optionalText(data, "clientIdType") ?? requiredText(data, "senderIdType");
      const customerId = await upsertCustomer({
        organizationId: me.organizationId,
        code: clientDocument,
        name: requiredText(data, "clientName"),
        identificationType: clientIdType,
        identificationNumber: clientDocument,
        phone: optionalText(data, "senderPhone"),
        status: "active"
      });
      const [loadingLocationId, unloadingLocationId] = await Promise.all([
        upsertLocation({
          customerId,
          code: `${clientDocument}-${senderId}-ORI`,
          name: requiredText(data, "senderName"),
          kind: "loading",
          address: requiredText(data, "senderAddress"),
          city: requiredText(data, "senderCity"),
          municipalityCode: requiredText(data, "senderMunicipality"),
          status: "active"
        }),
        upsertLocation({
          customerId,
          code: `${clientDocument}-${requiredText(data, "recipientId")}-DES`,
          name: requiredText(data, "recipientName"),
          kind: "unloading",
          address: requiredText(data, "recipientAddress"),
          city: requiredText(data, "recipientCity"),
          municipalityCode: requiredText(data, "recipientMunicipality"),
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
        cargoDescription: requiredText(data, "cargoDescription"),
        cargoQuantity: optionalNumber(data, "cargoQuantity"),
        cargoWeightKg: money(requiredText(data, "weightTons")) * 1000,
        agreedRate: 0,
        currency: "COP",
        scheduledLoadingAt: loadingDateTime(data, "minLoadingDate", false),
        scheduledUnloadingAt: loadingDateTime(data, "maxLoadingDate", true),
        notes: optionalText(data, "orderObservations")
      });
      const created = await createDraft({
        serviceOrderId,
        orderReservationId: reservation.reservationId,
        orderReservationToken: reservationToken,
        agencyCode: optionalText(data, "agencyCode"),
        notes: optionalText(data, "orderObservations")
      });
      await Promise.all([
        saveLoadingOrder({
          expedienteId: created.expedienteId,
          draft: loadingOrderDraft(data, customerId)
        }),
        saveAssignment({ expedienteId: created.expedienteId, vehicleId: state.vehicle._id, driverId: state.vehicle.drivers?.length === 1 ? state.vehicle.drivers[0]._id : undefined })
      ]);

      router.push(action === "open" ? `/expedientes/${created.expedienteId}?stage=orden_cargue#centro-documental` : `/expedientes/${created.expedienteId}`);
    } catch (cause) {
      setError(readError(cause));
      setSavingAction(null);
    }
  }

  const saving = savingAction !== null;

  return (
    <form className="guided-dispatch-form base-dispatch-form form-compact" onSubmit={(event) => event.preventDefault()} ref={formRef}>
      <section className="base-dispatch-intro">
        <div>
          <span className="eyebrow">Nueva orden de cargue</span>
          <h2>{template ? `Copia de ${template.code}` : "Datos de la orden de cargue"}</h2>
          <p>La misma información operativa de Avansat, con búsquedas en los maestros del TMS.</p>
        </div>
        <div className="base-dispatch-outcome"><strong>Al guardar</strong><span>Se abre el centro documental del despacho</span></div>
      </section>

      {template ? <div className="operation-notice ok" role="status"><span />Datos copiados de <Link href={`/expedientes/${sourceId}`}>{template.code}</Link>: revisa fechas, peso y observaciones antes de guardar. Nada se crea hasta que guardes.</div> : null}
      <div className="base-document-path" aria-label="Documentos que se completan después"><span className="active">1. Orden de cargue</span><span>Remesas</span><span>Vehículo y conductor</span><span>Manifiesto</span><span>Cumplidos</span></div>

      <div className="guided-form-stage">
        <section aria-labelledby="loading-order-title">
          <StageHeading id="loading-order-title" title="Orden de cargue" text="Completa los campos operativos que usa Avansat para insertar la orden." />
          <div className="stage-form-fields">
            <div className="field-group-note"><strong>Datos básicos</strong></div>
            <DateField label="Fecha" name="expeditionDate" required value={today} />
            <Field label="Nro. de orden de cargue" name="orderNumber" placeholder={reservationError ? "No disponible" : "Reservando…"} readOnly value={reservation?.number ?? ""} />
            <Field defaultValue={copied?.agencyCode} label="Agencia responsable" name="agencyCode" placeholder="Principal" />
            <label className="form-field checkbox-field"><span>Genera remesa</span><span className="checkbox-control"><input defaultChecked={copied?.generatesConsignment ?? true} name="generatesConsignment" type="checkbox" /><em>Crear la remesa desde esta orden</em></span></label>
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
              onSelect={(party) => update({ sender: party, senderName: party.name, senderIdType: party.documentType, senderId: party.document, senderAddress: party.address ?? state.senderAddress, senderCity: party.city ?? state.senderCity, senderMunicipality: party.cityCode ?? state.senderMunicipality, senderPhone: party.phone ?? state.senderPhone, senderSiteCode: "" })}
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
            <input name="senderSiteCode" type="hidden" value={state.senderSiteCode} />

            <div className="field-group-note"><strong>Datos del destinatario</strong></div>
            <PartyField
              className="span-2"
              label="Nombre del destinatario"
              onClear={() => update({ recipient: null, recipientName: "", recipientIdType: "N", recipientId: "", recipientAddress: "", recipientCity: "", recipientMunicipality: "", recipientPhone: "", recipientCellphone: "", recipientSiteCode: "" })}
              onSelect={(party) => update({ recipient: party, recipientName: party.name, recipientIdType: party.documentType, recipientId: party.document, recipientAddress: party.address ?? state.recipientAddress, recipientCity: party.city ?? state.recipientCity, recipientMunicipality: party.cityCode ?? state.recipientMunicipality, recipientPhone: party.phone ?? state.recipientPhone, recipientSiteCode: "" })}
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
            <input name="recipientSiteCode" type="hidden" value={state.recipientSiteCode} />

            <div className="field-group-note"><strong>Datos del vehículo</strong></div>
            <VehicleField label="Placa" onClear={() => update({ vehicle: null })} onSelect={(vehicle) => update({ vehicle })} required selected={state.vehicle} />
            <MoneyField label="Flete conductor" name="driverFreight" required value={copied?.driverFreight} />

            <div className="field-group-note"><strong>Datos de la mercancía</strong></div>
            <Field defaultValue={copied?.weightTons} label="Peso (TN)" min="0" name="weightTons" required step="0.001" type="number" />
            <Field defaultValue={copied?.volumeM3} label="Volumen (m³)" min="0" name="volumeM3" step="0.01" type="number" />
            <Field defaultValue={copied?.cargoQuantity} label="Cantidad" min="0" name="cargoQuantity" type="number" />
            <Field defaultValue={copied?.cargoDescription} label="Mercancía" name="cargoDescription" required />
            <PackagingField code={state.packagingCode || undefined} description={state.packagingDescription} label="Tipo de empaque" name="packagingCode" onClear={() => update({ packagingCode: "", packagingDescription: "" })} onSelect={(option) => update({ packagingCode: option.code, packagingDescription: option.description })} required />
            <Field defaultValue={copied?.optionalCargoField} label="Campo opcional" name="optionalCargoField" />
            <input defaultValue={copied?.cargoUnit} name="cargoUnit" type="hidden" />
            <input defaultValue={copied?.merchandiseCode} name="merchandiseCode" type="hidden" />
            <input defaultValue={copied?.natureOfCargo} name="natureOfCargo" type="hidden" />

            <div className="field-group-note"><strong>Observaciones especiales</strong></div>
            <label className="form-field"><span>Sellos y/o precintos</span><textarea defaultValue={copied?.sealNumbers} name="sealNumbers" rows={3} /></label>
            <label className="form-field"><span>Condiciones de cargue</span><textarea defaultValue={copied?.loadingConditions} name="loadingConditions" rows={3} /></label>
            <label className="form-field"><span>Embalaje especial</span><textarea defaultValue={copied?.specialPackaging} name="specialPackaging" rows={3} /></label>
            <label className="form-field"><span>Observaciones</span><textarea defaultValue={copied?.observations} name="orderObservations" rows={3} /></label>

            <div className="field-group-note"><strong>Fechas de cargue</strong></div>
            <DateField label="Fecha mínima" name="minLoadingDate" required value={copied?.minLoadingDate ?? today} />
            <DateField label="Fecha máxima" name="maxLoadingDate" required value={copied?.maxLoadingDate ?? today} />
          </div>
        </section>
      </div>

      {reservationError ? <div className="form-error" role="alert">{reservationError} <button className="link-button" onClick={() => setReservationAttempt((current) => current + 1)} type="button">Reintentar consecutivo</button></div> : null}
      {error ? <div className="form-error" role="alert" tabIndex={-1}>{error}</div> : null}
      <div className="guided-action-bar base-action-bar">
        <span>Los demás documentos quedarán disponibles como borradores independientes.</span>
        <div>
          <button className="ghost-button" disabled={saving || !me || !reservation} onClick={() => void saveBase("draft")} type="button">{savingAction === "draft" ? "Guardando…" : "Guardar borrador"}</button>
          <button className="primary-action" disabled={saving || !me || !reservation} onClick={() => void saveBase("open")} type="button">{savingAction === "open" ? "Creando…" : "Crear despacho y abrir documentos"}</button>
        </div>
      </div>
    </form>
  );
}

function StageHeading({ id, text, title }: { id: string; text: string; title: string }) {
  return <div className="guided-stage-heading"><span>01</span><div><h3 id={id}>{title}</h3><p>{text}</p></div></div>;
}

function Field({ className = "", label, name, ...props }: { className?: string; label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <label className={`form-field ${className}`}><span>{label}</span><input name={name} {...props} /></label>;
}

function loadingOrderDraft(data: FormData, customerId: Id<"customers">) {
  const loadingAppointment = loadingDateTime(data, "minLoadingDate", false);
  const unloadingAppointment = loadingDateTime(data, "maxLoadingDate", true);
  return {
    orderNumber: requiredText(data, "orderNumber"),
    expeditionDate: requiredText(data, "expeditionDate"),
    agencyCode: optionalText(data, "agencyCode"),
    customerId,
    sender: compact({
      name: requiredText(data, "senderName"),
      identificationType: requiredText(data, "senderIdType"),
      identificationNumber: requiredText(data, "senderId"),
      siteCode: optionalText(data, "senderSiteCode"),
      municipalityCode: requiredText(data, "senderMunicipality"),
      address: requiredText(data, "senderAddress"),
      cityName: requiredText(data, "senderCity"),
      phone: requiredText(data, "senderPhone"),
      cellphone: optionalText(data, "senderCellphone")
    }),
    recipient: compact({
      name: requiredText(data, "recipientName"),
      identificationType: requiredText(data, "recipientIdType"),
      identificationNumber: requiredText(data, "recipientId"),
      siteCode: optionalText(data, "recipientSiteCode"),
      municipalityCode: requiredText(data, "recipientMunicipality"),
      address: requiredText(data, "recipientAddress"),
      cityName: requiredText(data, "recipientCity"),
      phone: requiredText(data, "recipientPhone"),
      cellphone: optionalText(data, "recipientCellphone")
    }),
    loading: {
      siteName: requiredText(data, "senderName"),
      address: requiredText(data, "senderAddress"),
      cityName: requiredText(data, "senderCity"),
      municipalityCode: requiredText(data, "senderMunicipality"),
      appointmentAt: loadingAppointment
    },
    unloading: {
      siteName: requiredText(data, "recipientName"),
      address: requiredText(data, "recipientAddress"),
      cityName: requiredText(data, "recipientCity"),
      municipalityCode: requiredText(data, "recipientMunicipality"),
      appointmentAt: unloadingAppointment
    },
    cargoDescription: requiredText(data, "cargoDescription"),
    cargoQuantity: optionalText(data, "cargoQuantity"),
    cargoUnit: optionalText(data, "cargoUnit"),
    optionalCargoField: optionalText(data, "optionalCargoField"),
    weightTons: requiredText(data, "weightTons"),
    volumeM3: optionalText(data, "volumeM3"),
    packagingCode: requiredText(data, "packagingCode"),
    merchandiseCode: optionalText(data, "merchandiseCode"),
    natureOfCargo: optionalText(data, "natureOfCargo"),
    driverFreight: requiredDriverFreight(optionalText(data, "driverFreight")),
    sealNumbers: optionalText(data, "sealNumbers"),
    loadingConditions: optionalText(data, "loadingConditions"),
    specialPackaging: optionalText(data, "specialPackaging"),
    observations: optionalText(data, "orderObservations"),
    minLoadingDate: requiredText(data, "minLoadingDate"),
    maxLoadingDate: loadingWindowEnd(data),
    generatesConsignment: data.get("generatesConsignment") === "on"
  };
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function loadingWindowEnd(data: FormData): string {
  const min = requiredText(data, "minLoadingDate");
  const max = requiredText(data, "maxLoadingDate");
  if (max < min) throw new Error("La fecha máxima de cargue no puede ser anterior a la fecha mínima.");
  return max;
}

function requiredText(data: FormData, key: string): string {
  const value = String(data.get(key) ?? "").trim();
  if (!value) throw new Error(`Completa el campo ${fieldLabel(key)}.`);
  return value;
}

function optionalText(data: FormData, key: string): string | undefined {
  const value = String(data.get(key) ?? "").trim();
  return value || undefined;
}

function optionalNumber(data: FormData, key: string): number | undefined {
  const value = optionalText(data, key);
  return value ? money(value) : undefined;
}

function money(value: string): number {
  const number = Number(value || "0");
  return Number.isFinite(number) ? number : 0;
}

function loadingDateTime(data: FormData, key: string, endOfDay: boolean): number {
  const value = requiredText(data, key);
  const timestamp = new Date(`${value}T${endOfDay ? "23:59:00" : "00:00:00"}-05:00`).getTime();
  if (!Number.isFinite(timestamp)) throw new Error(`Completa ${fieldLabel(key)}.`);
  return timestamp;
}

function fieldLabel(key: string): string {
  return key.replaceAll(/([A-Z])/g, " $1").toLocaleLowerCase("es");
}

function readError(cause: unknown): string {
  return cause instanceof Error ? cause.message.replace(/^.*?: /, "") : "No fue posible guardar el despacho.";
}

"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DateField } from "../../components/fields/date-field";
import { CargoNatureField, IdTypeField, MunicipalityField, PackagingField, PartyField, SiteField, type PartyPick, type SitePick } from "../../components/fields/lookup-fields";

type BaseState = {
  customer: PartyPick | null;
  customerCode: string;
  customerName: string;
  customerIdType: string;
  customerId: string;
  customerPhone: string;
  senderSite: SitePick | null;
  senderSiteCode: string;
  originName: string;
  originAddress: string;
  originCity: string;
  originMunicipality: string;
  destinationName: string;
  destinationAddress: string;
  destinationCity: string;
  destinationMunicipality: string;
  recipient: PartyPick | null;
  recipientName: string;
  recipientIdType: string;
  recipientId: string;
  recipientSite: SitePick | null;
  recipientSiteCode: string;
  packagingCode: string;
  packagingDescription: string;
};

const EMPTY_STATE: BaseState = {
  customer: null, customerCode: "", customerName: "", customerIdType: "N", customerId: "", customerPhone: "",
  senderSite: null, senderSiteCode: "", originName: "", originAddress: "", originCity: "", originMunicipality: "",
  destinationName: "", destinationAddress: "", destinationCity: "", destinationMunicipality: "",
  recipient: null, recipientName: "", recipientIdType: "N", recipientId: "", recipientSite: null, recipientSiteCode: "",
  packagingCode: "", packagingDescription: ""
};

export default function NuevoDespachoPage() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const me = useQuery(api.access.me, {});
  const [error, setError] = useState("");
  const [savingAction, setSavingAction] = useState<"draft" | "open" | null>(null);
  const [state, setState] = useState<BaseState>(EMPTY_STATE);
  const update = (patch: Partial<BaseState>) => setState((current) => ({ ...current, ...patch }));
  const upsertCustomer = useMutation(api.masterData.upsertCustomer);
  const upsertLocation = useMutation(api.masterData.upsertCustomerLocation);
  const upsertOrder = useMutation(api.masterData.upsertServiceOrder);
  const createDraft = useMutation(api.dispatches.createDraft);
  const saveLoadingOrder = useMutation(api.dispatches.saveLoadingOrderDraft);

  async function saveBase(action: "draft" | "open") {
    if (!me || !formRef.current) {
      setError("La sesión todavía no está conectada al espacio de trabajo.");
      return;
    }

    setSavingAction(action);
    setError("");
    const data = new FormData(formRef.current);

    try {
      const customerCode = requiredText(data, "customerCode");
      const customerId = await upsertCustomer({
        organizationId: me.organizationId,
        code: customerCode,
        name: requiredText(data, "customerName"),
        identificationType: optionalText(data, "customerIdType"),
        identificationNumber: requiredText(data, "customerId"),
        phone: optionalText(data, "customerPhone"),
        status: "active"
      });
      const loadingLocationId = await upsertLocation({
        customerId,
        code: `${customerCode}-ORI`,
        name: requiredText(data, "originName"),
        kind: "loading",
        address: requiredText(data, "originAddress"),
        city: requiredText(data, "originCity"),
        municipalityCode: optionalText(data, "originMunicipality"),
        status: "active"
      });
      const unloadingLocationId = await upsertLocation({
        customerId,
        code: `${customerCode}-DES`,
        name: requiredText(data, "destinationName"),
        kind: "unloading",
        address: requiredText(data, "destinationAddress"),
        city: requiredText(data, "destinationCity"),
        municipalityCode: optionalText(data, "destinationMunicipality"),
        status: "active"
      });
      const serviceOrderId = await upsertOrder({
        organizationId: me.organizationId,
        code: requiredText(data, "serviceOrderCode"),
        customerId,
        loadingLocationId,
        unloadingLocationId,
        status: "confirmed",
        customerReference: optionalText(data, "customerReference"),
        cargoDescription: requiredText(data, "cargoDescription"),
        cargoQuantity: optionalNumber(data, "cargoQuantity"),
        cargoUnit: optionalText(data, "cargoUnit"),
        cargoWeightKg: money(requiredText(data, "weightTons")) * 1000,
        agreedRate: 0,
        currency: "COP",
        scheduledLoadingAt: dateTime(data, "loadingAppointment"),
        scheduledUnloadingAt: dateTime(data, "unloadingAppointment"),
        notes: optionalText(data, "orderObservations")
      });
      const created = await createDraft({
        serviceOrderId,
        agencyCode: optionalText(data, "agencyCode"),
        notes: optionalText(data, "orderObservations")
      });
      await saveLoadingOrder({
        expedienteId: created.expedienteId,
        draft: loadingOrderDraft(data, customerId)
      });

      router.push(action === "open" ? `/expedientes/${created.expedienteId}?stage=orden_cargue#centro-documental` : `/expedientes/${created.expedienteId}`);
    } catch (cause) {
      setError(readError(cause));
      setSavingAction(null);
    }
  }

  const saving = savingAction !== null;

  return (
    <form className="guided-dispatch-form base-dispatch-form" onSubmit={(event) => event.preventDefault()} ref={formRef}>
      <section className="base-dispatch-intro">
        <div>
          <span className="eyebrow">Nuevo despacho</span>
          <h2>Datos base del despacho</h2>
          <p>Busca el cliente, el destinatario y sus sedes del RNDC: los datos de identificación, direcciones y municipios se completan solos.</p>
        </div>
        <div className="base-dispatch-outcome"><strong>Al guardar</strong><span>Se abre el centro documental del despacho</span></div>
      </section>

      <div className="base-document-path" aria-label="Documentos que se completan después"><span className="active">1. Datos base</span><span>Orden de cargue</span><span>Remesas</span><span>Vehículo y conductor</span><span>Manifiesto</span><span>Cumplidos</span></div>

      <div className="guided-form-stage">
        <section aria-labelledby="loading-order-title">
          <StageHeading id="loading-order-title" title="Orden de cargue" text="Registra la orden de servicio, el cliente que remite y la sede desde donde sale la carga." />
          <div className="stage-form-fields">
            <Field label="Orden de servicio" name="serviceOrderCode" placeholder="OS-2026-001" required />
            <Field label="Referencia del cliente" name="customerReference" placeholder="Pedido o contrato" />
            <Field label="Agencia responsable" name="agencyCode" placeholder="Principal" />
            <div className="field-group-note"><strong>Cliente remitente</strong></div>
            <PartyField
              className="span-2"
              label="Cliente o razón social"
              onClear={() => update({ customer: null, customerName: "", customerIdType: "N", customerId: "", customerPhone: "", senderSite: null, senderSiteCode: "", originName: "", originAddress: "", originCity: "", originMunicipality: "" })}
              onSelect={(party) => update({ customer: party, customerName: party.name, customerIdType: party.documentType, customerId: party.document, customerPhone: party.phone ?? "", customerCode: state.customerCode || party.document, senderSite: null, senderSiteCode: "", originName: "", originAddress: "", originCity: "", originMunicipality: "" })}
              onType={(name) => update({ customer: null, customerName: name })}
              required
              role="sender"
              selected={state.customer}
              typedName={state.customer ? undefined : state.customerName}
            />
            <Field label="Código del cliente" name="customerCode" onChange={(event) => update({ customerCode: event.target.value })} placeholder="Se toma del documento" required value={state.customerCode} />
            <IdTypeField label="Tipo de identificación" name="customerIdType" onChange={(value) => update({ customerIdType: value })} required value={state.customerIdType} />
            <Field label="Identificación del cliente" name="customerId" onChange={(event) => update({ customerId: event.target.value })} required value={state.customerId} />
            <Field label="Teléfono" name="customerPhone" onChange={(event) => update({ customerPhone: event.target.value })} type="tel" value={state.customerPhone} />
            <input name="customerName" type="hidden" value={state.customerName} />
            <SiteField
              className="span-2"
              label="Sede RNDC remitente"
              onClear={() => update({ senderSite: null, senderSiteCode: "" })}
              onManual={(code) => update({ senderSite: null, senderSiteCode: code })}
              onSelect={(site) => update({ senderSite: site, senderSiteCode: site.siteCode, originName: site.siteName, originAddress: site.address ?? state.originAddress, originCity: site.city ?? state.originCity, originMunicipality: site.cityCode ?? state.originMunicipality })}
              required
              selectedCode={state.senderSiteCode || undefined}
              selectedName={state.senderSite?.siteName}
              thirdPartyId={state.customer?._id}
            />
            <input name="senderSiteCode" type="hidden" value={state.senderSiteCode} />
          </div>
          <div className="route-guided-grid">
            <fieldset>
              <legend>Cargue</legend>
              <Field className="span-2" label="Lugar" name="originName" onChange={(event) => update({ originName: event.target.value })} required value={state.originName} />
              <MunicipalityField code={state.originMunicipality || undefined} label="Municipio" name="originMunicipality" onClear={() => update({ originMunicipality: "" })} onSelect={(division) => update({ originMunicipality: division.code, originCity: division.isMunicipality ? division.name : division.municipalityName })} required />
              <DateField label="Cita de cargue" name="loadingAppointment" required withTime />
              <Field className="span-2" label="Dirección" name="originAddress" onChange={(event) => update({ originAddress: event.target.value })} required value={state.originAddress} />
              <input name="originCity" type="hidden" value={state.originCity} />
            </fieldset>
            <span className="route-connector" aria-hidden>→</span>
            <fieldset>
              <legend>Descargue</legend>
              <Field className="span-2" label="Lugar" name="destinationName" onChange={(event) => update({ destinationName: event.target.value })} required value={state.destinationName} />
              <MunicipalityField code={state.destinationMunicipality || undefined} label="Municipio" name="destinationMunicipality" onClear={() => update({ destinationMunicipality: "" })} onSelect={(division) => update({ destinationMunicipality: division.code, destinationCity: division.isMunicipality ? division.name : division.municipalityName })} required />
              <DateField label="Cita de descargue" name="unloadingAppointment" required withTime />
              <Field className="span-2" label="Dirección" name="destinationAddress" onChange={(event) => update({ destinationAddress: event.target.value })} required value={state.destinationAddress} />
              <input name="destinationCity" type="hidden" value={state.destinationCity} />
            </fieldset>
          </div>
        </section>

        <section aria-labelledby="cargo-title">
          <StageHeading id="cargo-title" title="Destinatario y mercancía" text="Quién recibe la carga, en qué sede, y qué se transporta." />
          <div className="stage-form-fields">
            <PartyField
              className="span-2"
              label="Destinatario"
              onClear={() => update({ recipient: null, recipientName: "", recipientIdType: "N", recipientId: "", recipientSite: null, recipientSiteCode: "" })}
              onSelect={(party) => update({ recipient: party, recipientName: party.name, recipientIdType: party.documentType, recipientId: party.document, recipientSite: null, recipientSiteCode: "" })}
              onType={(name) => update({ recipient: null, recipientName: name })}
              required
              role="recipient"
              selected={state.recipient}
              typedName={state.recipient ? undefined : state.recipientName}
            />
            <IdTypeField label="Tipo de identificación" name="recipientIdType" onChange={(value) => update({ recipientIdType: value })} required value={state.recipientIdType} />
            <Field label="Identificación destinatario" name="recipientId" onChange={(event) => update({ recipientId: event.target.value })} required value={state.recipientId} />
            <input name="recipientName" type="hidden" value={state.recipientName} />
            <SiteField
              className="span-2"
              label="Sede RNDC destinatario"
              onClear={() => update({ recipientSite: null, recipientSiteCode: "" })}
              onManual={(code) => update({ recipientSite: null, recipientSiteCode: code })}
              onSelect={(site) => update({ recipientSite: site, recipientSiteCode: site.siteCode, destinationName: state.destinationName || site.siteName, destinationAddress: state.destinationAddress || (site.address ?? ""), destinationCity: state.destinationCity || (site.city ?? ""), destinationMunicipality: state.destinationMunicipality || (site.cityCode ?? "") })}
              required
              selectedCode={state.recipientSiteCode || undefined}
              selectedName={state.recipientSite?.siteName}
              thirdPartyId={state.recipient?._id}
            />
            <input name="recipientSiteCode" type="hidden" value={state.recipientSiteCode} />
            <div className="field-group-note"><strong>Mercancía</strong></div>
            <Field className="span-2" label="Mercancía" name="cargoDescription" required />
            <Field label="Código de mercancía" name="merchandiseCode" required />
            <Field label="Cantidad" name="cargoQuantity" type="number" />
            <Field label="Unidad" name="cargoUnit" placeholder="kg, unidades, galones" />
            <Field label="Peso total (TN)" min="0" name="weightTons" required step="0.001" type="number" />
            <Field label="Volumen m³" min="0" name="volumeM3" step="0.01" type="number" />
            <PackagingField code={state.packagingCode || undefined} description={state.packagingDescription} label="Tipo de empaque" name="packagingCode" onClear={() => update({ packagingCode: "", packagingDescription: "" })} onSelect={(option) => update({ packagingCode: option.code, packagingDescription: option.description })} required />
            <CargoNatureField name="natureOfCargo" required />
            <label className="form-field span-2"><span>Observaciones</span><textarea name="orderObservations" rows={3} /></label>
          </div>
        </section>
      </div>

      {error ? <div className="form-error" role="alert" tabIndex={-1}>{error}</div> : null}
      <div className="guided-action-bar base-action-bar">
        <span>Los demás documentos quedarán disponibles como borradores independientes.</span>
        <div>
          <button className="ghost-button" disabled={saving || !me} onClick={() => void saveBase("draft")} type="button">{savingAction === "draft" ? "Guardando…" : "Guardar borrador"}</button>
          <button className="primary-action" disabled={saving || !me} onClick={() => void saveBase("open")} type="button">{savingAction === "open" ? "Creando…" : "Crear despacho y abrir documentos"}</button>
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
  return {
    agencyCode: optionalText(data, "agencyCode"),
    customerId,
    customerReference: optionalText(data, "customerReference"),
    sender: {
      name: requiredText(data, "customerName"),
      identificationType: requiredText(data, "customerIdType"),
      identificationNumber: requiredText(data, "customerId"),
      siteCode: requiredText(data, "senderSiteCode"),
      municipalityCode: requiredText(data, "originMunicipality"),
      phone: optionalText(data, "customerPhone")
    },
    recipient: {
      name: requiredText(data, "recipientName"),
      identificationType: requiredText(data, "recipientIdType"),
      identificationNumber: requiredText(data, "recipientId"),
      siteCode: requiredText(data, "recipientSiteCode"),
      municipalityCode: requiredText(data, "destinationMunicipality")
    },
    loading: {
      siteName: requiredText(data, "originName"),
      address: requiredText(data, "originAddress"),
      cityName: requiredText(data, "originCity"),
      municipalityCode: optionalText(data, "originMunicipality"),
      appointmentAt: requiredDateTime(data, "loadingAppointment")
    },
    unloading: {
      siteName: requiredText(data, "destinationName"),
      address: requiredText(data, "destinationAddress"),
      cityName: requiredText(data, "destinationCity"),
      municipalityCode: optionalText(data, "destinationMunicipality"),
      appointmentAt: requiredDateTime(data, "unloadingAppointment")
    },
    cargoDescription: requiredText(data, "cargoDescription"),
    cargoQuantity: optionalText(data, "cargoQuantity"),
    cargoUnit: optionalText(data, "cargoUnit"),
    weightTons: requiredText(data, "weightTons"),
    volumeM3: optionalText(data, "volumeM3"),
    packagingCode: requiredText(data, "packagingCode"),
    merchandiseCode: optionalText(data, "merchandiseCode"),
    natureOfCargo: optionalText(data, "natureOfCargo"),
    observations: optionalText(data, "orderObservations"),
    generatesConsignment: true
  };
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

function dateTime(data: FormData, key: string): number | undefined {
  const value = optionalText(data, key);
  return value ? new Date(value).getTime() : undefined;
}

function requiredDateTime(data: FormData, key: string): number {
  const value = dateTime(data, key);
  if (!value || !Number.isFinite(value)) throw new Error(`Completa ${fieldLabel(key)}.`);
  return value;
}

function fieldLabel(key: string): string {
  return key.replaceAll(/([A-Z])/g, " $1").toLocaleLowerCase("es");
}

function readError(cause: unknown): string {
  return cause instanceof Error ? cause.message.replace(/^.*?: /, "") : "No fue posible guardar el despacho.";
}

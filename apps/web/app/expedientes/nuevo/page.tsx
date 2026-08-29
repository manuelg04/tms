"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DateField } from "../../components/fields/date-field";
import { MoneyField } from "../../components/fields/money-field";
import { CargoNatureField, IdTypeField, MunicipalityField, PackagingField, PartyField, SiteField, type PartyPick, type SitePick } from "../../components/fields/lookup-fields";
import { VehicleAssignmentPicker, type VehicleAssignmentValue } from "../components/vehicle-assignment-picker";
import { requiredAssignmentIds, requiredDriverFreight } from "../components/vehicle-assignment-state";

type BaseState = {
  customer: PartyPick | null;
  customerCode: string;
  customerName: string;
  customerIdType: string;
  customerId: string;
  customerPhone: string;
  customerCellphone: string;
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
  recipientPhone: string;
  recipientCellphone: string;
  recipientSite: SitePick | null;
  recipientSiteCode: string;
  packagingCode: string;
  packagingDescription: string;
};

const EMPTY_STATE: BaseState = {
  customer: null, customerCode: "", customerName: "", customerIdType: "N", customerId: "", customerPhone: "", customerCellphone: "",
  senderSite: null, senderSiteCode: "", originName: "", originAddress: "", originCity: "", originMunicipality: "",
  destinationName: "", destinationAddress: "", destinationCity: "", destinationMunicipality: "",
  recipient: null, recipientName: "", recipientIdType: "N", recipientId: "", recipientPhone: "", recipientCellphone: "", recipientSite: null, recipientSiteCode: "",
  packagingCode: "", packagingDescription: ""
};

type Template = {
  code: string;
  customerCode: string;
  order: NonNullable<Detail["expediente"]["loadingOrderDraft"]>;
};

type Detail = NonNullable<typeof api.expedientes.detail._returnType>;

function templateState(template: Template | null): BaseState {
  if (!template) return EMPTY_STATE;
  const order = template.order;
  return {
    ...EMPTY_STATE,
    customerCode: template.customerCode,
    customerName: order.sender?.name ?? "",
    customerIdType: order.sender?.identificationType ?? "N",
    customerId: order.sender?.identificationNumber ?? "",
    customerPhone: order.sender?.phone ?? "",
    customerCellphone: order.sender?.cellphone ?? "",
    senderSiteCode: order.sender?.siteCode ?? "",
    originName: order.loading?.siteName ?? "",
    originAddress: order.loading?.address ?? "",
    originCity: order.loading?.cityName ?? "",
    originMunicipality: order.loading?.municipalityCode ?? order.sender?.municipalityCode ?? "",
    destinationName: order.unloading?.siteName ?? "",
    destinationAddress: order.unloading?.address ?? "",
    destinationCity: order.unloading?.cityName ?? "",
    destinationMunicipality: order.unloading?.municipalityCode ?? order.recipient?.municipalityCode ?? "",
    recipientName: order.recipient?.name ?? "",
    recipientIdType: order.recipient?.identificationType ?? "N",
    recipientId: order.recipient?.identificationNumber ?? "",
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
    ? { code: source.expediente.code, customerCode: source.customer.code, order: source.expediente.loadingOrderDraft }
    : null;
  return <NuevoDespachoForm key={sourceId ?? "nuevo"} sourceId={sourceId} template={template} />;
}

function NuevoDespachoForm({ sourceId, template }: { sourceId: string | null; template: Template | null }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const me = useQuery(api.access.me, {});
  const [error, setError] = useState("");
  const [savingAction, setSavingAction] = useState<"draft" | "open" | null>(null);
  const [state, setState] = useState<BaseState>(() => templateState(template));
  const [assignment, setAssignment] = useState<VehicleAssignmentValue>({ vehicle: null, driver: null });
  const copied = template?.order;
  const update = (patch: Partial<BaseState>) => setState((current) => ({ ...current, ...patch }));
  const today = new Date().toISOString().slice(0, 10);
  const upsertCustomer = useMutation(api.masterData.upsertCustomer);
  const upsertLocation = useMutation(api.masterData.upsertCustomerLocation);
  const upsertOrder = useMutation(api.masterData.upsertServiceOrder);
  const createDraft = useMutation(api.dispatches.createDraft);
  const saveLoadingOrder = useMutation(api.dispatches.saveLoadingOrderDraft);
  const saveAssignment = useMutation(api.dispatches.saveAssignmentDraft);

  async function saveBase(action: "draft" | "open") {
    if (!me || !formRef.current) {
      setError("La sesión todavía no está conectada al espacio de trabajo.");
      return;
    }

    setSavingAction(action);
    setError("");
    const data = new FormData(formRef.current);

    try {
      const assignmentIds = requiredAssignmentIds(assignment);
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
      await Promise.all([
        saveLoadingOrder({
          expedienteId: created.expedienteId,
          draft: loadingOrderDraft(data, customerId)
        }),
        saveAssignment({ expedienteId: created.expedienteId, ...assignmentIds })
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
          <span className="eyebrow">Nuevo despacho</span>
          <h2>{template ? `Copia de ${template.code}` : "Datos base del despacho"}</h2>
          <p>Busca cliente, destinatario y sedes en el RNDC; identificación, direcciones y municipios se completan solos.</p>
        </div>
        <div className="base-dispatch-outcome"><strong>Al guardar</strong><span>Se abre el centro documental del despacho</span></div>
      </section>

      {template ? <div className="operation-notice ok" role="status"><span />Datos copiados de <Link href={`/expedientes/${sourceId}`}>{template.code}</Link>: revisa citas, peso, sellos y orden de servicio antes de guardar. Nada se crea hasta que guardes.</div> : null}
      <div className="base-document-path" aria-label="Documentos que se completan después"><span className="active">1. Datos base</span><span>Orden de cargue</span><span>Remesas</span><span>Vehículo y conductor</span><span>Manifiesto</span><span>Cumplidos</span></div>

      <div className="guided-form-stage">
        <section aria-labelledby="loading-order-title">
          <StageHeading id="loading-order-title" title="Orden de cargue" text="Registra los datos básicos, el cliente que remite y la sede desde donde sale la carga." />
          <div className="stage-form-fields">
            <div className="field-group-note"><strong>Datos básicos</strong></div>
            <DateField label="Fecha" name="expeditionDate" required value={today} />
            <Field label="Nro. de orden de cargue" name="orderNumberPreview" placeholder="Automático" readOnly />
            <Field defaultValue={copied?.agencyCode} label="Agencia responsable" name="agencyCode" placeholder="Principal" />
            <label className="form-field checkbox-field"><span>Genera remesa</span><span className="checkbox-control"><input defaultChecked name="generatesConsignment" type="checkbox" /><em>Crear la remesa desde esta orden</em></span></label>
            <Field className="span-2" label="Orden de servicio" name="serviceOrderCode" placeholder="OS-2026-001" required />
            <Field className="span-2" defaultValue={copied?.customerReference} label="Referencia del cliente" name="customerReference" placeholder="Pedido o contrato" />
            <div className="field-group-note"><strong>Datos del remitente</strong></div>
            <PartyField
              className="span-2"
              label="Cliente o razón social"
              onClear={() => update({ customer: null, customerName: "", customerIdType: "N", customerId: "", customerPhone: "", customerCellphone: "", senderSite: null, senderSiteCode: "", originName: "", originAddress: "", originCity: "", originMunicipality: "" })}
              onSelect={(party) => update({ customer: party, customerName: party.name, customerIdType: party.documentType, customerId: party.document, customerPhone: party.phone ?? "", customerCode: state.customerCode || party.document, senderSite: null, senderSiteCode: "", originName: "", originAddress: "", originCity: "", originMunicipality: "" })}
              onType={(name) => update({ customer: null, customerName: name })}
              required
              role="sender"
              selected={state.customer ?? (state.customerName && state.customerId ? { name: state.customerName, document: state.customerId, documentType: state.customerIdType } : null)}
              typedName={state.customer ? undefined : state.customerName}
            />
            <IdTypeField label="Tipo de identificación" name="customerIdType" onChange={(value) => update({ customerIdType: value })} required value={state.customerIdType} />
            <Field label="Identificación del cliente" name="customerId" onChange={(event) => update({ customerId: event.target.value })} required value={state.customerId} />
            <Field label="Código del cliente" name="customerCode" onChange={(event) => update({ customerCode: event.target.value })} placeholder="Se toma del documento" required value={state.customerCode} />
            <Field label="Teléfono remitente" name="customerPhone" onChange={(event) => update({ customerPhone: event.target.value })} required type="tel" value={state.customerPhone} />
            <Field label="Celular remitente" name="customerCellphone" onChange={(event) => update({ customerCellphone: event.target.value })} type="tel" value={state.customerCellphone} />
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
          <StageHeading id="cargo-title" number="02" title="Destinatario y mercancía" text="Quién recibe la carga, en qué sede, y qué se transporta." />
          <div className="stage-form-fields">
            <div className="field-group-note"><strong>Datos del destinatario</strong></div>
            <PartyField
              className="span-2"
              label="Destinatario"
              onClear={() => update({ recipient: null, recipientName: "", recipientIdType: "N", recipientId: "", recipientPhone: "", recipientCellphone: "", recipientSite: null, recipientSiteCode: "" })}
              onSelect={(party) => update({ recipient: party, recipientName: party.name, recipientIdType: party.documentType, recipientId: party.document, recipientPhone: party.phone ?? "", recipientSite: null, recipientSiteCode: "" })}
              onType={(name) => update({ recipient: null, recipientName: name })}
              required
              role="recipient"
              selected={state.recipient ?? (state.recipientName && state.recipientId ? { name: state.recipientName, document: state.recipientId, documentType: state.recipientIdType } : null)}
              typedName={state.recipient ? undefined : state.recipientName}
            />
            <IdTypeField label="Tipo de identificación" name="recipientIdType" onChange={(value) => update({ recipientIdType: value })} required value={state.recipientIdType} />
            <Field label="Identificación destinatario" name="recipientId" onChange={(event) => update({ recipientId: event.target.value })} required value={state.recipientId} />
            <input name="recipientName" type="hidden" value={state.recipientName} />
            <Field label="Teléfono destinatario" name="recipientPhone" onChange={(event) => update({ recipientPhone: event.target.value })} required type="tel" value={state.recipientPhone} />
            <Field label="Celular destinatario" name="recipientCellphone" onChange={(event) => update({ recipientCellphone: event.target.value })} type="tel" value={state.recipientCellphone} />
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
            <div className="field-group-note"><strong>Datos del vehículo</strong></div>
            <VehicleAssignmentPicker onChange={setAssignment} value={assignment} />
            <MoneyField label="Flete conductor" name="driverFreight" required value={copied?.driverFreight} />
            <span className="field-hint span-2">La asignación quedará guardada en el despacho y podrás corregirla después, antes de emitir documentos.</span>
            <div className="field-group-note"><strong>Datos de la mercancía</strong></div>
            <Field className="span-2" defaultValue={copied?.cargoDescription} label="Mercancía" name="cargoDescription" required />
            <Field defaultValue={copied?.merchandiseCode} label="Código de mercancía" name="merchandiseCode" required />
            <Field defaultValue={copied?.cargoQuantity} label="Cantidad" name="cargoQuantity" type="number" />
            <Field defaultValue={copied?.cargoUnit} label="Unidad" name="cargoUnit" placeholder="kg, unidades, galones" />
            <Field defaultValue={copied?.weightTons} label="Peso total (TN)" min="0" name="weightTons" required step="0.001" type="number" />
            <Field defaultValue={copied?.volumeM3} label="Volumen m³" min="0" name="volumeM3" step="0.01" type="number" />
            <PackagingField code={state.packagingCode || undefined} description={state.packagingDescription} label="Tipo de empaque" name="packagingCode" onClear={() => update({ packagingCode: "", packagingDescription: "" })} onSelect={(option) => update({ packagingCode: option.code, packagingDescription: option.description })} required />
            <CargoNatureField name="natureOfCargo" required value={copied?.natureOfCargo} />
            <div className="field-group-note"><strong>Observaciones especiales</strong></div>
            <label className="form-field"><span>Sellos y/o precintos</span><textarea name="sealNumbers" rows={3} /></label>
            <label className="form-field"><span>Condiciones de cargue</span><textarea defaultValue={copied?.loadingConditions} name="loadingConditions" rows={3} /></label>
            <label className="form-field"><span>Embalaje especial</span><textarea defaultValue={copied?.specialPackaging} name="specialPackaging" rows={3} /></label>
            <label className="form-field span-2"><span>Observaciones</span><textarea defaultValue={copied?.observations} name="orderObservations" rows={3} /></label>
            <div className="field-group-note"><strong>Fechas de cargue</strong></div>
            <DateField label="Fecha mínima" name="minLoadingDate" required value={today} />
            <DateField label="Fecha máxima" name="maxLoadingDate" required value={today} />
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

function StageHeading({ id, number = "01", text, title }: { id: string; number?: string; text: string; title: string }) {
  return <div className="guided-stage-heading"><span>{number}</span><div><h3 id={id}>{title}</h3><p>{text}</p></div></div>;
}

function Field({ className = "", label, name, ...props }: { className?: string; label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <label className={`form-field ${className}`}><span>{label}</span><input name={name} {...props} /></label>;
}

function loadingOrderDraft(data: FormData, customerId: Id<"customers">) {
  return {
    expeditionDate: requiredText(data, "expeditionDate"),
    agencyCode: optionalText(data, "agencyCode"),
    customerId,
    customerReference: optionalText(data, "customerReference"),
    sender: {
      name: requiredText(data, "customerName"),
      identificationType: requiredText(data, "customerIdType"),
      identificationNumber: requiredText(data, "customerId"),
      siteCode: requiredText(data, "senderSiteCode"),
      municipalityCode: requiredText(data, "originMunicipality"),
      address: requiredText(data, "originAddress"),
      cityName: requiredText(data, "originCity"),
      phone: requiredText(data, "customerPhone"),
      cellphone: optionalText(data, "customerCellphone")
    },
    recipient: {
      name: requiredText(data, "recipientName"),
      identificationType: requiredText(data, "recipientIdType"),
      identificationNumber: requiredText(data, "recipientId"),
      siteCode: requiredText(data, "recipientSiteCode"),
      municipalityCode: requiredText(data, "destinationMunicipality"),
      address: requiredText(data, "destinationAddress"),
      cityName: requiredText(data, "destinationCity"),
      phone: requiredText(data, "recipientPhone"),
      cellphone: optionalText(data, "recipientCellphone")
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

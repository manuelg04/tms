"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DateField } from "../../components/fields/date-field";
import { CargoNatureField, IdTypeField, InsurerField, MunicipalityField, PackagingField, PartyField, SiteField, formatDocument, type PartyPick } from "../../components/fields/lookup-fields";
import { MoneyField, formatThousands } from "../../components/fields/money-field";
import { SearchSelect } from "../../components/fields/search-select";

type LoadingOrder = {
  expeditionDate?: string;
  orderNumber?: string;
  agencyCode?: string;
  customerReference?: string;
  sender?: { name?: string; identificationType?: string; identificationNumber?: string; siteCode?: string; municipalityCode?: string; phone?: string; cellphone?: string };
  recipient?: { name?: string; identificationType?: string; identificationNumber?: string; siteCode?: string; municipalityCode?: string; phone?: string; cellphone?: string };
  loading?: { siteName?: string; address?: string; cityName?: string; municipalityCode?: string; appointmentAt?: number };
  unloading?: { siteName?: string; address?: string; cityName?: string; municipalityCode?: string; appointmentAt?: number };
  cargoDescription?: string;
  cargoQuantity?: string;
  cargoUnit?: string;
  weightTons?: string;
  volumeM3?: string;
  packagingCode?: string;
  merchandiseCode?: string;
  natureOfCargo?: string;
  driverFreight?: string;
  sealNumbers?: string;
  loadingConditions?: string;
  specialPackaging?: string;
  observations?: string;
  minLoadingDate?: string;
  maxLoadingDate?: string;
  generatesConsignment?: boolean;
};

type RemesaParty = { name?: string; identificationType?: string; identificationNumber?: string; siteCode?: string; address?: string; cityName?: string; municipalityCode?: string; phone?: string; cellphone?: string };
type RemesaSite = { siteName?: string; address?: string; cityName?: string; municipalityCode?: string; latitude?: string; longitude?: string; appointmentAt?: number; agreedHours?: string };
type Remission = { remissionNumber?: string; quantity?: string; packagingClass?: string; description?: string; weightTons?: string; volumeM3?: string };

type Remesa = {
  _id: string;
  sequence: number;
  number?: string;
  officialState: string;
  draft?: {
    expeditionDate?: string;
    consignmentClass?: "municipal" | "terrestre_carga";
    agencyCode?: string;
    sender?: RemesaParty;
    recipient?: RemesaParty;
    loading?: RemesaSite;
    unloading?: RemesaSite;
    declaredValue?: string;
    consignmentValue?: string;
    insurancePercent?: string;
    policyNumber?: string;
    policyExpiresOn?: string;
    insurerNit?: string;
    remissions?: Remission[];
    unitOfMeasure?: string;
    packagingCode?: string;
    natureOfCargo?: string;
    merchandiseCode?: string;
    transporterObservations?: string;
    generalObservations?: string;
  };
};

type Manifest = {
  manifestNumber?: string;
  issueDate?: string;
  estimatedDeliveryDate?: string;
  operationScope?: "municipal" | "intermunicipal";
  manifestType?: string;
  freightTotal?: string;
  advance?: string;
  withholdingSource?: string;
  withholdingIca?: string;
  fopatContribution?: string;
  adjustments?: string;
  netPayable?: string;
  paymentResponsible?: string;
  loadingResponsible?: string;
  unloadingResponsible?: string;
  paymentDate?: string;
  paymentAgencyCode?: string;
  contractNumber?: string;
  requiresTracking?: boolean;
  observations?: string;
};

type ManifestContext = {
  agencyCode?: string;
  originCity?: string;
  destinationCity?: string;
  vehicle?: { plate: string; make?: string; line?: string; lineName?: string; modelYear?: string; configuration?: string; configurationLabel?: string; capacityTn?: string; ownerName?: string; ownerDocument?: string; possessorName?: string; possessorDocument?: string } | null;
  trailer?: { plate: string; trailerType?: string } | null;
  driver?: { document: string; name?: string } | null;
  secondDriver?: { document: string; name?: string } | null;
};

const PAID_BY_OPTIONS = [
  { value: "", label: "Selecciona" },
  { value: "Remitente", label: "Remitente" },
  { value: "Destinatario", label: "Destinatario" },
  { value: "Empresa de transporte", label: "Empresa de transporte" }
];

function personLabel(person: { document: string; name?: string } | null | undefined): string {
  if (!person) return "";
  return person.name ? `${person.name} · ${formatDocument(person.document)}` : formatDocument(person.document);
}

function namedParty(name: string | undefined, document: string | undefined): string {
  if (!name && !document) return "";
  return [name, document ? formatDocument(document) : undefined].filter(Boolean).join(" · ");
}

type PartyState = { party: PartyPick | null; name: string; idType: string; document: string; siteCode: string; siteName: string };

function partyState(source: { name?: string; identificationType?: string; identificationNumber?: string; siteCode?: string } | undefined): PartyState {
  return { party: null, name: source?.name ?? "", idType: source?.identificationType ?? "N", document: source?.identificationNumber ?? "", siteCode: source?.siteCode ?? "", siteName: "" };
}

function PartyBlock({ label, role, state, onChange, siteLabel, onSite }: { label: string; role: "sender" | "recipient"; state: PartyState; onChange: (next: PartyState) => void; siteLabel: string; onSite?: (site: { siteName: string; address?: string; city?: string; cityCode?: string }) => void }) {
  const prefix = role === "sender" ? "sender" : "recipient";
  const resolved = useQuery(api.lookups.partiesSearch, !state.party && state.document.length >= 2 ? { term: state.document, role } : "skip");
  useEffect(() => {
    const exact = resolved?.find((row) => row.document === state.document);
    if (!state.party && exact) {
      onChange({ ...state, party: exact, name: state.name || exact.name });
    }
  }, [resolved, state, onChange]);
  return (
    <>
      <PartyField
        className="span-2"
        label={label}
        onClear={() => onChange({ party: null, name: "", idType: "N", document: "", siteCode: "", siteName: "" })}
        onSelect={(party) => onChange({ party, name: party.name, idType: party.documentType, document: party.document, siteCode: "", siteName: "" })}
        onType={(name) => onChange({ ...state, party: null, name })}
        required
        role={role}
        selected={state.party ?? (state.name ? { name: state.name, document: state.document, documentType: state.idType } : null)}
        typedName={state.party ? undefined : state.name}
      />
      <input name={`${prefix}Name`} type="hidden" value={state.name} />
      <IdTypeField label="Tipo de identificación" name={`${prefix}IdType`} onChange={(idType) => onChange({ ...state, idType })} required value={state.idType} />
      <label className="form-field"><span>Identificación<em aria-hidden="true"> *</em></span><input name={`${prefix}Id`} onChange={(event) => onChange({ ...state, document: event.target.value })} required value={state.document} /></label>
      <SiteField
        className="span-2"
        label={siteLabel}
        onClear={() => onChange({ ...state, siteCode: "", siteName: "" })}
        onManual={(siteCode) => onChange({ ...state, siteCode, siteName: "" })}
        onSelect={(site) => {
          onChange({ ...state, siteCode: site.siteCode, siteName: site.siteName });
          onSite?.(site);
        }}
        required
        selectedCode={state.siteCode || undefined}
        selectedName={state.siteName || undefined}
        thirdPartyId={state.party?._id}
      />
      <input name={`${prefix}SiteCode`} type="hidden" value={state.siteCode} />
    </>
  );
}

export function LoadingOrderForm({ draft, onSubmit, readOnly }: { draft: LoadingOrder; onSubmit: (data: FormData) => void; readOnly: boolean }) {
  const [sender, setSender] = useState<PartyState>(() => partyState(draft.sender));
  const [recipient, setRecipient] = useState<PartyState>(() => partyState(draft.recipient));
  const [loading, setLoading] = useState({ siteName: draft.loading?.siteName ?? "", address: draft.loading?.address ?? "", cityName: draft.loading?.cityName ?? "", municipalityCode: draft.loading?.municipalityCode ?? draft.sender?.municipalityCode ?? "" });
  const [unloading, setUnloading] = useState({ siteName: draft.unloading?.siteName ?? "", address: draft.unloading?.address ?? "", cityName: draft.unloading?.cityName ?? "", municipalityCode: draft.unloading?.municipalityCode ?? draft.recipient?.municipalityCode ?? "" });
  const [packaging, setPackaging] = useState({ code: draft.packagingCode ?? "", description: "" });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form className="form-compact" id="stage-primary-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
      <StageHeading number="01" title="Orden de cargue" text="Cliente, partes, sitios, citas y mercancía alimentan las siguientes etapas." readOnly={readOnly} />
      <fieldset className="stage-form-fields" disabled={readOnly}>
        <div className="field-group-note"><strong>Datos básicos</strong></div>
        <DateField label="Fecha" name="expeditionDate" required value={draft.expeditionDate ?? today} />
        <Field label="Nro. de orden de cargue" name="orderNumberPreview" placeholder="Automático" readOnly value={draft.orderNumber} />
        <Field label="Agencia" name="agencyCode" value={draft.agencyCode} />
        <Field className="span-2" label="Referencia del cliente" name="customerReference" value={draft.customerReference} />
        <label className="form-field checkbox-field"><span>Genera remesa</span><span className="checkbox-control"><input defaultChecked={draft.generatesConsignment ?? true} name="generatesConsignment" type="checkbox" /><em>Crear la remesa a partir de esta orden</em></span></label>

        <div className="field-group-note"><strong>Remitente y cargue</strong></div>
        <PartyBlock label="Remitente" onChange={setSender} onSite={(site) => setLoading((current) => ({ siteName: site.siteName, address: site.address ?? current.address, cityName: site.city ?? current.cityName, municipalityCode: site.cityCode ?? current.municipalityCode }))} role="sender" siteLabel="Sede RNDC remitente" state={sender} />
        <Field label="Teléfono remitente" name="senderPhone" required type="tel" value={draft.sender?.phone} />
        <Field label="Celular remitente" name="senderCellphone" type="tel" value={draft.sender?.cellphone} />
        <Field label="Lugar de cargue" name="loadingName" onChange={(event) => setLoading({ ...loading, siteName: event.target.value })} required value={loading.siteName} />
        <MunicipalityField code={loading.municipalityCode || undefined} label="Municipio de cargue" name="loadingMunicipality" onClear={() => setLoading({ ...loading, municipalityCode: "" })} onSelect={(division) => setLoading({ ...loading, municipalityCode: division.code, cityName: division.isMunicipality ? division.name : division.municipalityName })} required />
        <DateField label="Cita de cargue" name="loadingAppointment" required value={dateTimeValue(draft.loading?.appointmentAt)} withTime />
        <Field className="span-2" label="Dirección de cargue" name="loadingAddress" onChange={(event) => setLoading({ ...loading, address: event.target.value })} required value={loading.address} />
        <Field label="Ciudad de cargue" name="loadingCity" onChange={(event) => setLoading({ ...loading, cityName: event.target.value })} required value={loading.cityName} />

        <div className="field-group-note"><strong>Destinatario y descargue</strong></div>
        <PartyBlock label="Destinatario" onChange={setRecipient} onSite={(site) => setUnloading((current) => ({ siteName: current.siteName || site.siteName, address: current.address || (site.address ?? ""), cityName: current.cityName || (site.city ?? ""), municipalityCode: current.municipalityCode || (site.cityCode ?? "") }))} role="recipient" siteLabel="Sede RNDC destinatario" state={recipient} />
        <Field label="Teléfono destinatario" name="recipientPhone" required type="tel" value={draft.recipient?.phone} />
        <Field label="Celular destinatario" name="recipientCellphone" type="tel" value={draft.recipient?.cellphone} />
        <Field label="Lugar de descargue" name="unloadingName" onChange={(event) => setUnloading({ ...unloading, siteName: event.target.value })} required value={unloading.siteName} />
        <MunicipalityField code={unloading.municipalityCode || undefined} label="Municipio de descargue" name="unloadingMunicipality" onClear={() => setUnloading({ ...unloading, municipalityCode: "" })} onSelect={(division) => setUnloading({ ...unloading, municipalityCode: division.code, cityName: division.isMunicipality ? division.name : division.municipalityName })} required />
        <DateField label="Cita de descargue" name="unloadingAppointment" required value={dateTimeValue(draft.unloading?.appointmentAt)} withTime />
        <Field className="span-2" label="Dirección de descargue" name="unloadingAddress" onChange={(event) => setUnloading({ ...unloading, address: event.target.value })} required value={unloading.address} />
        <Field label="Ciudad de descargue" name="unloadingCity" onChange={(event) => setUnloading({ ...unloading, cityName: event.target.value })} required value={unloading.cityName} />

        <div className="field-group-note"><strong>Datos del vehículo</strong></div>
        <MoneyField label="Flete conductor" name="driverFreight" value={draft.driverFreight} />

        <div className="field-group-note"><strong>Mercancía</strong></div>
        <Field className="span-2" label="Mercancía" name="cargoDescription" required value={draft.cargoDescription} />
        <Field label="Código de mercancía" name="merchandiseCode" value={draft.merchandiseCode} />
        <Field label="Cantidad" name="cargoQuantity" value={draft.cargoQuantity} />
        <Field label="Unidad" name="cargoUnit" value={draft.cargoUnit} />
        <Field label="Peso (TN)" min="0" name="weightTons" required step="0.001" type="number" value={draft.weightTons} />
        <Field label="Volumen m³" min="0" name="volumeM3" step="0.01" type="number" value={draft.volumeM3} />
        <PackagingField code={packaging.code || undefined} description={packaging.description || undefined} label="Empaque" name="packagingCode" onClear={() => setPackaging({ code: "", description: "" })} onSelect={(option) => setPackaging({ code: option.code, description: option.description })} required />
        <CargoNatureField name="natureOfCargo" required value={draft.natureOfCargo} />

        <div className="field-group-note"><strong>Observaciones especiales</strong></div>
        <label className="form-field"><span>Sellos y/o precintos</span><textarea defaultValue={draft.sealNumbers} name="sealNumbers" rows={3} /></label>
        <label className="form-field"><span>Condiciones de cargue</span><textarea defaultValue={draft.loadingConditions} name="loadingConditions" rows={3} /></label>
        <label className="form-field"><span>Embalaje especial</span><textarea defaultValue={draft.specialPackaging} name="specialPackaging" rows={3} /></label>
        <label className="form-field span-2"><span>Observaciones</span><textarea defaultValue={draft.observations} name="observations" rows={3} /></label>

        <div className="field-group-note"><strong>Fechas de cargue</strong></div>
        <DateField label="Fecha mínima" name="minLoadingDate" required value={draft.minLoadingDate ?? today} />
        <DateField label="Fecha máxima" name="maxLoadingDate" required value={draft.maxLoadingDate ?? today} />
      </fieldset>
    </form>
  );
}

function inherited(value: string | undefined): string {
  return value ?? "—";
}

function RemesaCard({ order, readOnly, remesa }: { order: LoadingOrder; readOnly: boolean; remesa: Remesa }) {
  const key = remesa._id;
  const draft = remesa.draft ?? {};
  const [insurer, setInsurer] = useState({ nit: draft.insurerNit ?? "", name: "" });
  const [packaging, setPackaging] = useState({ code: draft.packagingCode ?? "", description: "" });
  const [remissions, setRemissions] = useState<Array<Remission & { rowId: number }>>(() => (draft.remissions?.length ? draft.remissions : [{}]).map((line, index) => ({ ...line, rowId: index })));
  const resolved = useQuery(api.lookups.insurersSearch, insurer.nit && !insurer.name ? { term: insurer.nit } : "skip");
  const insurerName = insurer.name || resolved?.find((row) => row.insurerNit === insurer.nit)?.name;
  const today = new Date().toISOString().slice(0, 10);
  const locked = readOnly || remesa.officialState !== "draft";

  return (
    <fieldset className="stage-remesa-card" disabled={locked}>
      <legend>Remesa {remesa.number ?? remesa.sequence}</legend>
      <input name="remesaId" type="hidden" value={remesa._id} />

      <div className="field-group-note"><strong>Datos básicos</strong></div>
      <label className="form-field"><span>Tipo de remesa</span><select defaultValue={draft.consignmentClass ?? "terrestre_carga"} name={`${key}_class`}><option value="terrestre_carga">Terrestre de carga</option><option value="municipal">Municipal</option></select></label>
      <DateField label="Fecha" name={`${key}_expeditionDate`} value={draft.expeditionDate ?? order.expeditionDate ?? today} />
      <Field label="Nro. de remesa" name={`${key}_numberPreview`} placeholder="Automático" readOnly value={remesa.number} />
      <Field label="Agencia" name={`${key}_agencyCode`} placeholder={inherited(order.agencyCode)} value={draft.agencyCode} />

      <div className="field-group-note"><strong>Sitio de cargue</strong></div>
      <Field className="span-2" label="Remitente" name={`${key}_senderName`} placeholder={inherited(order.sender?.name)} value={draft.sender?.name} />
      <Field label="Identificación remitente" name={`${key}_senderId`} placeholder={inherited(order.sender?.identificationNumber)} value={draft.sender?.identificationNumber} />
      <Field label="Dirección de cargue" name={`${key}_loadingAddress`} placeholder={inherited(order.loading?.address)} value={draft.loading?.address ?? draft.sender?.address} />
      <Field label="Teléfono remitente" name={`${key}_senderPhone`} placeholder={inherited(order.sender?.phone)} type="tel" value={draft.sender?.phone} />
      <Field label="Celular remitente" name={`${key}_senderCellphone`} placeholder={inherited(order.sender?.cellphone)} type="tel" value={draft.sender?.cellphone} />
      <Field label="Latitud (georreferencia)" name={`${key}_loadingLatitude`} placeholder="Opcional" value={draft.loading?.latitude} />
      <Field label="Longitud (georreferencia)" name={`${key}_loadingLongitude`} placeholder="Opcional" value={draft.loading?.longitude} />
      <Field label="Horas pactadas de cargue" min="0" name={`${key}_loadingHours`} placeholder="Opcional" step="0.5" type="number" value={draft.loading?.agreedHours} />
      <DateField label="Cita de cargue" name={`${key}_loadingAppointment`} value={dateTimeValue(draft.loading?.appointmentAt)} withTime />
      <span className="field-hint span-2">Vacía: usa la cita de la orden · {formatAppointment(order.loading?.appointmentAt)}</span>

      <div className="field-group-note"><strong>Sitio de descargue</strong></div>
      <Field className="span-2" label="Destinatario" name={`${key}_recipientName`} placeholder={inherited(order.recipient?.name)} value={draft.recipient?.name} />
      <Field label="Identificación destinatario" name={`${key}_recipientId`} placeholder={inherited(order.recipient?.identificationNumber)} value={draft.recipient?.identificationNumber} />
      <Field label="Dirección de descargue" name={`${key}_unloadingAddress`} placeholder={inherited(order.unloading?.address)} value={draft.unloading?.address ?? draft.recipient?.address} />
      <Field label="Teléfono destinatario" name={`${key}_recipientPhone`} placeholder={inherited(order.recipient?.phone)} type="tel" value={draft.recipient?.phone} />
      <Field label="Celular destinatario" name={`${key}_recipientCellphone`} placeholder={inherited(order.recipient?.cellphone)} type="tel" value={draft.recipient?.cellphone} />
      <Field label="Latitud (georreferencia)" name={`${key}_unloadingLatitude`} placeholder="Opcional" value={draft.unloading?.latitude} />
      <Field label="Longitud (georreferencia)" name={`${key}_unloadingLongitude`} placeholder="Opcional" value={draft.unloading?.longitude} />
      <Field label="Horas pactadas de descargue" min="0" name={`${key}_unloadingHours`} placeholder="Opcional" step="0.5" type="number" value={draft.unloading?.agreedHours} />
      <DateField label="Cita de descargue" name={`${key}_unloadingAppointment`} value={dateTimeValue(draft.unloading?.appointmentAt)} withTime />
      <span className="field-hint span-2">Vacía: usa la cita de la orden · {formatAppointment(order.unloading?.appointmentAt)}</span>

      <div className="field-group-note"><strong>Datos del despacho</strong></div>
      <MoneyField label="Valor declarado" name={`${key}_declaredValue`} required value={draft.declaredValue} />
      <MoneyField label="Valor remesa" name={`${key}_consignmentValue`} value={draft.consignmentValue} />
      <Field label="% seguro" max="100" min="0" name={`${key}_insurancePercent`} step="0.01" type="number" value={draft.insurancePercent} />

      <div className="field-group-note"><strong>Datos de la póliza</strong></div>
      <InsurerField className="span-2" insurerName={insurerName} label="Aseguradora" name={`${key}_insurerNit`} nit={insurer.nit || undefined} onClear={() => setInsurer({ nit: "", name: "" })} onSelect={(option) => setInsurer({ nit: option.insurerNit, name: option.name })} required />
      <Field label="Tomador del seguro" name={`${key}_policyHolderPreview`} readOnly value="Empresa de transporte" />
      <Field label="Número de póliza" name={`${key}_policyNumber`} required value={draft.policyNumber} />
      <DateField label="Vencimiento de póliza" name={`${key}_policyExpiresOn`} required value={draft.policyExpiresOn} />

      <div className="field-group-note"><strong>Remisiones</strong></div>
      <div className="remission-table">
        <div className="remission-row remission-head" aria-hidden="true"><span>Remisión Nro.</span><span>Cantidad</span><span>Clase de bultos</span><span>Descripción</span><span>Peso (TN)</span><span>Volumen m³</span><span /></div>
        {remissions.map((line, index) => (
          <div className="remission-row" key={line.rowId}>
            <input aria-label={`Remisión ${index + 1} número`} defaultValue={line.remissionNumber} name={`${key}_rem${index}_number`} placeholder="Opcional" />
            <input aria-label={`Remisión ${index + 1} cantidad`} defaultValue={line.quantity} name={`${key}_rem${index}_quantity`} placeholder={inherited(order.cargoQuantity)} />
            <input aria-label={`Remisión ${index + 1} clase de bultos`} defaultValue={line.packagingClass} name={`${key}_rem${index}_packagingClass`} placeholder={inherited(order.packagingCode)} />
            <input aria-label={`Remisión ${index + 1} descripción`} defaultValue={line.description} name={`${key}_rem${index}_description`} placeholder={inherited(order.cargoDescription)} />
            <input aria-label={`Remisión ${index + 1} peso`} defaultValue={line.weightTons} min="0" name={`${key}_rem${index}_weightTons`} placeholder={inherited(order.weightTons)} step="0.001" type="number" />
            <input aria-label={`Remisión ${index + 1} volumen`} defaultValue={line.volumeM3} min="0" name={`${key}_rem${index}_volumeM3`} placeholder={inherited(order.volumeM3)} step="0.01" type="number" />
            <button aria-label={`Quitar remisión ${index + 1}`} className="ghost-button" disabled={remissions.length === 1} onClick={() => setRemissions(remissions.filter((row) => row.rowId !== line.rowId))} type="button">×</button>
          </div>
        ))}
        <input name={`${key}_remCount`} type="hidden" value={remissions.length} />
        <button className="ghost-button add-remission" onClick={() => setRemissions([...remissions, { rowId: Date.now() }])} type="button">Agregar remisión</button>
      </div>

      <div className="field-group-note"><strong>Resumen que pasa al manifiesto</strong></div>
      <Field label="Unidad de medida" name={`${key}_unitOfMeasure`} placeholder={inherited(order.cargoUnit)} value={draft.unitOfMeasure} />
      <Field label="Código de mercancía" name={`${key}_merchandiseCode`} placeholder={inherited(order.merchandiseCode)} value={draft.merchandiseCode} />
      <PackagingField code={packaging.code || undefined} description={packaging.description || undefined} label="Código de empaque" name={`${key}_packagingCode`} onClear={() => setPackaging({ code: "", description: "" })} onSelect={(option) => setPackaging({ code: option.code, description: option.description })} />
      <CargoNatureField name={`${key}_natureOfCargo`} value={draft.natureOfCargo ?? order.natureOfCargo} />
      <Field className="span-2" label="Orden de servicio transportador" name={`${key}_serviceOrderPreview`} placeholder="—" readOnly value={order.customerReference} />
      <label className="form-field"><span>Observaciones del transportador</span><textarea defaultValue={draft.transporterObservations} name={`${key}_transporterObservations`} rows={3} /></label>
      <label className="form-field span-2"><span>Observaciones generales</span><textarea defaultValue={draft.generalObservations} name={`${key}_observations`} rows={3} /></label>
      {remesa.officialState !== "draft" ? <span className="official-lock">Documento oficial · Sólo lectura</span> : null}
    </fieldset>
  );
}

function formatAppointment(value: number | undefined): string {
  if (!value) return "sin cita";
  return new Date(value).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
}

export function ConsignmentsForm({ onSubmit, order, readOnly, remesas }: { onSubmit: (data: FormData) => void; order: LoadingOrder; readOnly: boolean; remesas: Remesa[] }) {
  const rows = remesas.length > 0 ? remesas : [{ _id: "new", sequence: 1, officialState: "draft" }];
  return (
    <form className="form-compact" id="stage-primary-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
      <StageHeading number="02" title="Remesas" text="La orden ya aporta remitente, ruta, citas y carga. Completa únicamente las diferencias." readOnly={readOnly} />
      <div className="inheritance-note"><span>✓</span><div><strong>Hereda de la orden de cargue</strong><p>Deja vacío lo que no cambie; el gris muestra lo que se tomará.</p></div></div>
      <div className="stage-remesa-list">
        {rows.map((remesa) => <RemesaCard key={remesa._id} order={order} readOnly={readOnly} remesa={remesa} />)}
      </div>
    </form>
  );
}

type VehiclePick = { _id: Id<"vehicles">; plate: string; make?: string; line?: string; configuration?: string; capacityTn?: string; status?: string; soatExpiresAt?: string; drivers: Array<{ _id: Id<"drivers">; document: string; name?: string; licenseCategory?: string; licenseExpiresAt?: string }> };
type DriverPick = { _id: Id<"drivers">; document: string; name?: string; licenseCategory?: string; licenseExpiresAt?: string };

function expired(date: string | undefined): boolean {
  return Boolean(date && date < new Date().toISOString().slice(0, 10));
}

export function AssignmentForm({ currentDriverDocument, currentVehiclePlate, onSubmit, readOnly }: { currentDriverDocument?: string; currentVehiclePlate?: string; onSubmit: (values: { driverId?: string; vehicleId?: string }) => void; readOnly: boolean }) {
  const [plateTerm, setPlateTerm] = useState("");
  const [driverTerm, setDriverTerm] = useState("");
  const [vehicle, setVehicle] = useState<VehiclePick | null>(null);
  const [driver, setDriver] = useState<DriverPick | null>(null);
  const vehicles = useQuery(api.lookups.vehiclesWithDriversSearch, plateTerm.trim() ? { term: plateTerm } : "skip");
  const initialVehicles = useQuery(api.lookups.vehiclesWithDriversSearch, currentVehiclePlate && !vehicle ? { term: currentVehiclePlate } : "skip");
  const drivers = useQuery(api.lookups.driversLookup, driverTerm.trim().length >= 2 ? { term: driverTerm } : "skip");
  const initialDrivers = useQuery(api.lookups.driversLookup, currentDriverDocument && !driver ? { term: currentDriverDocument } : "skip");

  useEffect(() => {
    if (!vehicle && initialVehicles) {
      const match = initialVehicles.find((row) => row.plate === currentVehiclePlate);
      if (match) setVehicle(match);
    }
  }, [initialVehicles, vehicle, currentVehiclePlate]);

  useEffect(() => {
    if (!driver && initialDrivers) {
      const match = initialDrivers.find((row) => row.document === currentDriverDocument);
      if (match) setDriver(match);
    }
  }, [initialDrivers, driver, currentDriverDocument]);

  function pickVehicle(next: VehiclePick) {
    setVehicle(next);
    if (next.drivers.length === 1) setDriver(next.drivers[0]);
    else if (driver && !next.drivers.some((row) => row._id === driver._id)) setDriver(null);
  }

  const linkedDrivers = vehicle?.drivers ?? [];
  const driverIsLinked = driver ? linkedDrivers.some((row) => row._id === driver._id) : false;

  return (
    <form className="form-compact" id="stage-primary-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ driverId: driver?._id, vehicleId: vehicle?._id }); }}>
      <StageHeading number="03" title="Vehículo y conductor" text="Empieza por la placa: el sistema propone los conductores vinculados a ese vehículo en el RNDC." readOnly={readOnly} />
      <fieldset className="stage-form-fields" disabled={readOnly}>
        <SearchSelect
          emptyText="No hay vehículos con esa placa"
          hint={vehicle ? `${vehicle.drivers.length} conductor${vehicle.drivers.length === 1 ? "" : "es"} vinculado${vehicle.drivers.length === 1 ? "" : "s"}` : undefined}
          label="Placa del vehículo"
          minLength={2}
          mono
          onClear={() => { setVehicle(null); setDriver(null); }}
          onSearch={setPlateTerm}
          onSelect={(key) => {
            const next = vehicles?.find((row) => row._id === key);
            if (next) pickVehicle(next);
          }}
          options={vehicles?.map((row) => ({ key: row._id, title: row.plate, badge: row.status, subtitle: [row.make, row.line, row.configuration].filter(Boolean).join(" · ") }))}
          placeholder="ABC123"
          required
          selectedLabel={vehicle?.plate}
        />
        {vehicle ? (
          <div className="vehicle-pick-card">
            <div><small>Vehículo</small><strong>{[vehicle.make, vehicle.line].filter(Boolean).join(" ") || "—"}</strong></div>
            <div><small>Configuración</small><strong>{vehicle.configuration ?? "—"}</strong></div>
            <div><small>Capacidad</small><strong>{vehicle.capacityTn ? `${vehicle.capacityTn} TN` : "—"}</strong></div>
            <div><small>SOAT</small><strong className={expired(vehicle.soatExpiresAt) ? "warn" : undefined}>{vehicle.soatExpiresAt ? `${expired(vehicle.soatExpiresAt) ? "Vencido " : "Vence "}${vehicle.soatExpiresAt}` : "—"}</strong></div>
          </div>
        ) : null}
        {vehicle && linkedDrivers.length > 0 ? (
          <div className="form-field span-2">
            <span>Conductores vinculados a {vehicle.plate}</span>
            <div className="driver-choice-list">
              {linkedDrivers.map((row) => (
                <button className={`driver-choice ${driver?._id === row._id ? "selected" : ""}`} key={row._id} onClick={() => setDriver(row)} type="button">
                  <span>{row.name ?? "Sin nombre"}<br /><small>CC {formatDocument(row.document)}{row.licenseCategory ? ` · Licencia ${row.licenseCategory}` : ""}{expired(row.licenseExpiresAt) ? " · Licencia vencida" : ""}</small></span>
                  {driver?._id === row._id ? <b>✓ Asignado</b> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <SearchSelect
          className={linkedDrivers.length > 0 ? undefined : "span-2"}
          emptyText="No hay conductores con ese nombre o documento"
          hint={driver && !driverIsLinked ? `CC ${formatDocument(driver.document)}${driver.licenseCategory ? ` · Licencia ${driver.licenseCategory}` : ""}${expired(driver.licenseExpiresAt) ? " · Licencia vencida" : ""}${vehicle ? " · No está vinculado a esta placa en el RNDC" : ""}` : linkedDrivers.length > 0 ? "Sólo si el conductor no está en la lista de arriba" : undefined}
          label={linkedDrivers.length > 0 ? "Otro conductor" : "Conductor"}
          onClear={() => setDriver(null)}
          onSearch={setDriverTerm}
          onSelect={(key) => {
            const next = drivers?.find((row) => row._id === key);
            if (next) setDriver(next);
          }}
          options={drivers?.map((row) => ({ key: row._id, title: row.name ?? row.document, badge: `CC ${formatDocument(row.document)}`, subtitle: row.licenseCategory ? `Licencia ${row.licenseCategory}` : undefined }))}
          placeholder="Nombre o cédula"
          required={linkedDrivers.length === 0}
          selectedLabel={driver && !driverIsLinked ? (driver.name ?? driver.document) : undefined}
        />
      </fieldset>
    </form>
  );
}

function paidByOptions(current: string | undefined) {
  return current && !PAID_BY_OPTIONS.some((option) => option.value === current) ? [...PAID_BY_OPTIONS, { value: current, label: current }] : PAID_BY_OPTIONS;
}

const MONEY_KEYS = ["freightTotal", "advance", "withholdingSource", "withholdingIca", "fopatContribution", "adjustments"] as const;

export function ManifestForm({ context, draft, onSubmit, readOnly }: { context: ManifestContext; draft: Manifest; onSubmit: (data: FormData) => void; readOnly: boolean }) {
  const [money, setMoney] = useState<Record<(typeof MONEY_KEYS)[number], string>>({ freightTotal: draft.freightTotal ?? "", advance: draft.advance ?? "0", withholdingSource: draft.withholdingSource ?? "0", withholdingIca: draft.withholdingIca ?? "0", fopatContribution: draft.fopatContribution ?? "0", adjustments: draft.adjustments ?? "0" });
  const suggested = String(Math.max(0, Number(money.freightTotal || 0) - Number(money.advance || 0) - Number(money.withholdingSource || 0) - Number(money.withholdingIca || 0) - Number(money.fopatContribution || 0) + Number(money.adjustments || 0)));
  const [net, setNet] = useState<{ value: string; manual: boolean }>({ value: draft.netPayable ?? "", manual: Boolean(draft.netPayable) });
  const netValue = net.manual ? net.value : suggested;
  return (
    <form className="form-compact" id="stage-primary-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
      <StageHeading number="04" title="Manifiesto" text="La ruta, flota y remesas ya están vinculadas. Revisa la operación y la liquidación." readOnly={readOnly} />
      <fieldset className="stage-form-fields" disabled={readOnly}>
        <div className="field-group-note"><strong>Datos básicos</strong></div>
        <DateField label="Fecha de expedición" name="issueDate" required value={draft.issueDate ?? new Date().toISOString().slice(0, 10)} />
        <DateField label="Fecha estimada de entrega" name="estimatedDeliveryDate" required value={draft.estimatedDeliveryDate} />
        <Field label="Nro. de manifiesto" name="manifestNumberPreview" placeholder="Automático" readOnly value={draft.manifestNumber} />
        <Field label="Agencia" name="agencyPreview" placeholder="—" readOnly value={context.agencyCode} />
        <Field label="Tipo de manifiesto" name="manifestType" required value={draft.manifestType} />
        <Field label="Nro. de contrato" name="contractNumber" placeholder="Opcional" value={draft.contractNumber} />
        <Field label="Origen" name="originPreview" placeholder="—" readOnly value={context.originCity} />
        <Field label="Destino" name="destinationPreview" placeholder="—" readOnly value={context.destinationCity} />
        <label className="form-field"><span>Alcance</span><select defaultValue={draft.operationScope ?? "intermunicipal"} name="operationScope"><option value="intermunicipal">Intermunicipal</option><option value="municipal">Municipal</option></select></label>
        <label className="form-field checkbox-field"><span>Requiere seguimiento</span><span className="checkbox-control"><input defaultChecked={draft.requiresTracking ?? false} name="requiresTracking" type="checkbox" /><em>Marcar el viaje para control de tráfico</em></span></label>

        <div className="field-group-note"><strong>Datos del vehículo</strong></div>
        {context.vehicle ? (
          <>
            <Field label="Placa" name="vehiclePlatePreview" readOnly value={context.vehicle.plate} />
            <Field label="Marca" name="vehicleMakePreview" readOnly value={context.vehicle.make} />
            <Field label="Línea" name="vehicleLinePreview" readOnly value={context.vehicle.lineName ?? context.vehicle.line} />
            <Field label="Modelo" name="vehicleModelPreview" readOnly value={context.vehicle.modelYear} />
            <Field label="Configuración" name="vehicleConfigurationPreview" readOnly value={context.vehicle.configurationLabel ?? context.vehicle.configuration} />
            <Field label="Peso máximo (TN)" name="vehicleCapacityPreview" readOnly value={context.vehicle.capacityTn} />
            <Field label="Remolque" name="trailerPreview" placeholder="Sin remolque" readOnly value={context.trailer ? [context.trailer.plate, context.trailer.trailerType].filter(Boolean).join(" · ") : ""} />
            <Field className="span-2" label="Propietario" name="ownerPreview" readOnly value={namedParty(context.vehicle.ownerName, context.vehicle.ownerDocument)} />
            <Field className="span-2" label="Poseedor" name="possessorPreview" readOnly value={namedParty(context.vehicle.possessorName, context.vehicle.possessorDocument)} />
            <Field className="span-2" label="Conductor" name="driverPreview" placeholder="Sin asignar" readOnly value={personLabel(context.driver)} />
            <Field className="span-2" label="Segundo conductor" name="secondDriverPreview" placeholder="Sin segundo conductor" readOnly value={personLabel(context.secondDriver)} />
          </>
        ) : (
          <div className="field-hint span-2">El vehículo y el conductor se asignan en la etapa «Vehículo y conductor»; aquí se muestran para revisión.</div>
        )}

        <div className="field-group-note"><strong>Datos del servicio</strong></div>
        <MoneyField label="Valor flete" name="freightTotal" onChange={(value) => setMoney({ ...money, freightTotal: value })} required value={money.freightTotal} />
        <MoneyField label="Retención en la fuente" name="withholdingSource" onChange={(value) => setMoney({ ...money, withholdingSource: value })} value={money.withholdingSource} />
        <MoneyField label="ICA" name="withholdingIca" onChange={(value) => setMoney({ ...money, withholdingIca: value })} value={money.withholdingIca} />
        <MoneyField label="Anticipo" name="advance" onChange={(value) => setMoney({ ...money, advance: value })} value={money.advance} />
        <MoneyField label="FOPAT" name="fopatContribution" onChange={(value) => setMoney({ ...money, fopatContribution: value })} value={money.fopatContribution} />
        <MoneyField label="Ajustes" name="adjustments" onChange={(value) => setMoney({ ...money, adjustments: value })} value={money.adjustments} />
        <MoneyField hint={net.manual && net.value !== suggested ? `Calculado: $${formatThousands(suggested)}` : "Flete − anticipo − retenciones + ajustes"} label="Neto a pagar" name="netPayable" onChange={(value) => setNet({ value, manual: true })} required value={netValue} />
        <Field label="Agencia de pago" name="paymentAgencyCode" placeholder={context.agencyCode ?? "—"} value={draft.paymentAgencyCode} />
        <Field label="Responsable de pago" name="paymentResponsible" required value={draft.paymentResponsible} />
        <label className="form-field"><span>Cargue pagado por</span><select defaultValue={draft.loadingResponsible ?? ""} name="loadingResponsible">{paidByOptions(draft.loadingResponsible).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="form-field"><span>Descargue pagado por</span><select defaultValue={draft.unloadingResponsible ?? ""} name="unloadingResponsible">{paidByOptions(draft.unloadingResponsible).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <DateField label="Fecha de pago" name="paymentDate" value={draft.paymentDate} />

        <div className="field-group-note"><strong>Observaciones especiales</strong></div>
        <label className="form-field span-2"><span>Observaciones</span><textarea defaultValue={draft.observations} name="observations" rows={4} /></label>
      </fieldset>
    </form>
  );
}

export function ReviewStage({ mode, summary }: { mode: string; summary: Array<{ label: string; value: string; warning?: boolean }> }) {
  return <div><StageHeading number="05" title="Revisión y envío RNDC" text="Confirma la información persistida y revisa los bloqueos antes de iniciar la secuencia." readOnly={false} /><div className="review-mode-banner"><span>{mode}</span><div><strong>Modo de ejecución</strong><p>Los datos provienen del despacho guardado y no se completarán con valores de referencia.</p></div></div><div className="creation-review-grid">{summary.map((item) => <div className={item.warning ? "review-item warning" : "review-item"} key={item.label}><span>{item.warning ? "!" : "✓"}</span><div><small>{item.label}</small><strong>{item.value}</strong></div></div>)}</div></div>;
}

function StageHeading({ number, readOnly, text, title }: { number: string; readOnly: boolean; text: string; title: string }) {
  return <div className="stage-form-heading"><span>{number}</span><div><h3 id="active-stage-title" tabIndex={-1}>{title}</h3><p>{text}</p></div>{readOnly ? <span className="read-only-chip">Sólo lectura</span> : null}</div>;
}

function Field({ className = "", label, name, value, onChange, required, ...props }: { className?: string; label: string; name: string; value?: string; onChange?: React.ChangeEventHandler<HTMLInputElement> } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "defaultValue" | "value" | "onChange">) {
  return (
    <label className={`form-field ${className}`}>
      <span>{label}{required ? <em aria-hidden="true"> *</em> : null}</span>
      {onChange ? <input name={name} onChange={onChange} required={required} value={value ?? ""} {...props} /> : <input defaultValue={value} name={name} required={required} {...props} />}
    </label>
  );
}

function dateTimeValue(value: number | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DateField } from "../../components/fields/date-field";
import { CargoNatureField, IdTypeField, InsurerField, MunicipalityField, PackagingField, PartyField, SiteField, formatDocument, type PartyPick } from "../../components/fields/lookup-fields";
import { MoneyField, formatThousands } from "../../components/fields/money-field";
import { VehicleAssignmentPicker, type VehicleAssignmentValue } from "./vehicle-assignment-picker";
import { effectiveConsignment } from "../../../convex/model/dispatchWorkflow";

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
    operationType?: "general";
    consolidatedType?: string;
    gpsOperator?: string;
    agencyCode?: string;
    sender?: RemesaParty;
    recipient?: RemesaParty;
    loading?: RemesaSite;
    unloading?: RemesaSite;
    cashConsignment?: boolean;
    cashOnDelivery?: boolean;
    declaredValue?: string;
    consignmentValue?: string;
    insurancePercent?: string;
    policyHolder?: "transport_company";
    policyNumber?: string;
    policyExpiresOn?: string;
    insurerNit?: string;
    remissions?: Remission[];
    unitOfMeasure?: string;
    packagingCode?: string;
    natureOfCargo?: string;
    merchandiseCode?: string;
    packagingGroup?: string;
    serviceOrderTransporter?: string;
    transporterObservations?: string;
    generalObservations?: string;
  };
};

type RemesaContext = {
  customerName: string;
  loadingOrderNumber?: string;
  manifestNumber?: string;
  serviceOrderCode: string;
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

type RemesaPartyEditorState = RemesaParty & { selected: PartyPick | null };

function remesaPartyState(source: RemesaParty | undefined): RemesaPartyEditorState {
  return { ...source, selected: null, identificationType: source?.identificationType ?? "N" };
}

function RemesaCard({ context, order, readOnly, remesa }: { context: RemesaContext; order: LoadingOrder; readOnly: boolean; remesa: Remesa }) {
  const key = remesa._id;
  const draft = remesa.draft ?? {};
  const effective = effectiveConsignment(draft, order);
  const [consignmentClass, setConsignmentClass] = useState(effective.consignmentClass ?? "terrestre_carga");
  const [sender, setSender] = useState<RemesaPartyEditorState>(() => remesaPartyState(effective.sender));
  const [recipient, setRecipient] = useState<RemesaPartyEditorState>(() => remesaPartyState(effective.recipient));
  const [loading, setLoading] = useState(() => ({
    ...effective.loading,
    address: effective.loading?.address ?? effective.sender?.address ?? "",
    cityName: effective.loading?.cityName ?? effective.sender?.cityName ?? "",
    municipalityCode: effective.loading?.municipalityCode ?? effective.sender?.municipalityCode ?? ""
  }));
  const [unloading, setUnloading] = useState(() => ({
    ...effective.unloading,
    address: effective.unloading?.address ?? effective.recipient?.address ?? "",
    cityName: effective.unloading?.cityName ?? effective.recipient?.cityName ?? "",
    municipalityCode: effective.unloading?.municipalityCode ?? effective.recipient?.municipalityCode ?? ""
  }));
  const [insurer, setInsurer] = useState({ nit: draft.insurerNit ?? "", name: "" });
  const [packaging, setPackaging] = useState({ code: effective.packagingCode ?? "", description: "" });
  const [remissions, setRemissions] = useState<Array<Remission & { rowId: number }>>(() => (effective.remissions?.length ? effective.remissions : [{}]).map((line, index) => ({ ...line, rowId: index })));
  const resolved = useQuery(api.lookups.insurersSearch, insurer.nit && !insurer.name ? { term: insurer.nit } : "skip");
  const packagingDetail = useQuery(api.rndcReferenceCatalogs.packagingByCode, packaging.code ? { code: packaging.code } : "skip");
  const insurerName = insurer.name || resolved?.find((row) => row.insurerNit === insurer.nit)?.name;
  const packagingGroup = draft.packagingGroup ?? [packagingDetail?.packageTypeCode, packagingDetail?.packageTypeName].filter(Boolean).join(" · ");
  const today = new Date().toISOString().slice(0, 10);
  const locked = readOnly || remesa.officialState !== "draft";

  return (
    <fieldset className="stage-remesa-card" disabled={locked}>
      <legend>Remesa {remesa.number ?? remesa.sequence}</legend>
      <input name="remesaId" type="hidden" value={remesa._id} />

      <div className="field-group-note"><strong>Tipo de remesa</strong></div>
      <div className="remesa-choice-group span-2">
        <label><input aria-label="Remesa municipal" checked={consignmentClass === "municipal"} name={`${key}_class`} onChange={() => setConsignmentClass("municipal")} type="radio" value="municipal" /><span>Remesa municipal</span></label>
        <label><input aria-label="Remesa terrestre de carga" checked={consignmentClass === "terrestre_carga"} name={`${key}_class`} onChange={() => setConsignmentClass("terrestre_carga")} type="radio" value="terrestre_carga" /><span>Remesa terrestre de carga</span></label>
      </div>

      <div className="field-group-note"><strong>Información del cliente</strong></div>
      <label className="form-field checkbox-field"><span>De orden de cargue</span><span className="checkbox-control"><input aria-label="De orden de cargue" checked disabled readOnly type="checkbox" /><em>Sí</em></span></label>
      <Field className="span-2" label="Cliente" name={`${key}_customerPreview`} readOnly value={context.customerName} />
      <Field label="Nro. de orden de cargue" name={`${key}_orderPreview`} readOnly value={context.loadingOrderNumber} />

      <div className="field-group-note"><strong>Datos básicos</strong></div>
      <DateField label="Fecha" name={`${key}_expeditionDate`} required value={effective.expeditionDate ?? today} />
      <Field label="Agencia" name={`${key}_agencyCode`} required value={effective.agencyCode ?? "Principal"} />
      <MunicipalityField code={loading.municipalityCode || undefined} label="Origen" name={`${key}_loadingMunicipality`} onClear={() => setLoading({ ...loading, municipalityCode: "", cityName: "" })} onSelect={(division) => setLoading({ ...loading, municipalityCode: division.code, cityName: division.isMunicipality ? division.name : division.municipalityName })} required />
      <MunicipalityField code={unloading.municipalityCode || undefined} label="Destino" name={`${key}_unloadingMunicipality`} onClear={() => setUnloading({ ...unloading, municipalityCode: "", cityName: "" })} onSelect={(division) => setUnloading({ ...unloading, municipalityCode: division.code, cityName: division.isMunicipality ? division.name : division.municipalityName })} required />
      <Field label="Nro. de remesa" name={`${key}_numberPreview`} placeholder="Automático" readOnly value={remesa.number} />
      <Field label="Tipo de remesa" name={`${key}_operationTypePreview`} readOnly value="General" />
      <Field label="Tipo consolidado" name={`${key}_consolidatedType`} value={draft.consolidatedType} />
      <Field label="Operador GPS RNDC" name={`${key}_gpsOperator`} value={draft.gpsOperator} />
      <input name={`${key}_operationType`} type="hidden" value="general" />
      <input name={`${key}_loadingCity`} type="hidden" value={loading.cityName ?? ""} />
      <input name={`${key}_unloadingCity`} type="hidden" value={unloading.cityName ?? ""} />

      <div className="field-group-note"><strong>Sitio de cargue</strong></div>
      <PartyField className="span-2" label="Remitente" onClear={() => setSender(remesaPartyState(undefined))} onSelect={(party) => { setSender({ ...sender, selected: party, name: party.name, identificationType: party.documentType, identificationNumber: party.document, address: party.address ?? sender.address, cityName: party.city ?? sender.cityName, municipalityCode: party.cityCode ?? sender.municipalityCode, phone: party.phone ?? sender.phone }); setLoading({ ...loading, address: party.address ?? loading.address, cityName: party.city ?? loading.cityName, municipalityCode: party.cityCode ?? loading.municipalityCode }); }} onType={(name) => setSender({ ...sender, selected: null, name })} required role="sender" selected={sender.selected ?? (sender.name ? { name: sender.name, document: sender.identificationNumber, documentType: sender.identificationType } : null)} typedName={sender.selected ? undefined : sender.name} />
      <input name={`${key}_senderName`} type="hidden" value={sender.name ?? ""} />
      <IdTypeField label="Tipo de identificación remitente" name={`${key}_senderIdType`} onChange={(identificationType) => setSender({ ...sender, identificationType })} required value={sender.identificationType ?? "N"} />
      <Field label="Número de identificación remitente" name={`${key}_senderId`} onChange={(event) => setSender({ ...sender, identificationNumber: event.target.value })} required value={sender.identificationNumber} />
      <Field className="span-2" label="Dirección remitente" name={`${key}_loadingAddress`} onChange={(event) => setLoading({ ...loading, address: event.target.value })} required value={loading.address} />
      <Field label="Teléfono remitente" name={`${key}_senderPhone`} onChange={(event) => setSender({ ...sender, phone: event.target.value })} required type="tel" value={sender.phone} />
      <Field label="Celular remitente" name={`${key}_senderCellphone`} onChange={(event) => setSender({ ...sender, cellphone: event.target.value })} type="tel" value={sender.cellphone} />
      <Field label="Latitud cargue" name={`${key}_loadingLatitude`} placeholder="Opcional" value={loading.latitude} />
      <Field label="Longitud cargue" name={`${key}_loadingLongitude`} placeholder="Opcional" value={loading.longitude} />
      <DateField label="Cita de cargue" name={`${key}_loadingAppointment`} required value={dateTimeValue(loading.appointmentAt)} withTime />
      <Field label="Horas pactadas cargue" min="0" name={`${key}_loadingHours`} required step="0.5" type="number" value={loading.agreedHours ?? "1"} />
      <input name={`${key}_senderSiteCode`} type="hidden" value={sender.siteCode ?? ""} />
      <input name={`${key}_loadingSiteName`} type="hidden" value={loading.siteName ?? ""} />

      <div className="field-group-note"><strong>Sitio de descargue</strong></div>
      <PartyField className="span-2" label="Destinatario" onClear={() => setRecipient(remesaPartyState(undefined))} onSelect={(party) => { setRecipient({ ...recipient, selected: party, name: party.name, identificationType: party.documentType, identificationNumber: party.document, address: party.address ?? recipient.address, cityName: party.city ?? recipient.cityName, municipalityCode: party.cityCode ?? recipient.municipalityCode, phone: party.phone ?? recipient.phone }); setUnloading({ ...unloading, address: party.address ?? unloading.address, cityName: party.city ?? unloading.cityName, municipalityCode: party.cityCode ?? unloading.municipalityCode }); }} onType={(name) => setRecipient({ ...recipient, selected: null, name })} required role="recipient" selected={recipient.selected ?? (recipient.name ? { name: recipient.name, document: recipient.identificationNumber, documentType: recipient.identificationType } : null)} typedName={recipient.selected ? undefined : recipient.name} />
      <input name={`${key}_recipientName`} type="hidden" value={recipient.name ?? ""} />
      <IdTypeField label="Tipo de identificación destinatario" name={`${key}_recipientIdType`} onChange={(identificationType) => setRecipient({ ...recipient, identificationType })} required value={recipient.identificationType ?? "N"} />
      <Field label="Número de identificación destinatario" name={`${key}_recipientId`} onChange={(event) => setRecipient({ ...recipient, identificationNumber: event.target.value })} required value={recipient.identificationNumber} />
      <Field className="span-2" label="Dirección destinatario" name={`${key}_unloadingAddress`} onChange={(event) => setUnloading({ ...unloading, address: event.target.value })} required value={unloading.address} />
      <Field label="Teléfono destinatario" name={`${key}_recipientPhone`} onChange={(event) => setRecipient({ ...recipient, phone: event.target.value })} required type="tel" value={recipient.phone} />
      <Field label="Celular destinatario" name={`${key}_recipientCellphone`} onChange={(event) => setRecipient({ ...recipient, cellphone: event.target.value })} type="tel" value={recipient.cellphone} />
      <Field label="Latitud descargue" name={`${key}_unloadingLatitude`} placeholder="Opcional" value={unloading.latitude} />
      <Field label="Longitud descargue" name={`${key}_unloadingLongitude`} placeholder="Opcional" value={unloading.longitude} />
      <DateField label="Cita de descargue" name={`${key}_unloadingAppointment`} required value={dateTimeValue(unloading.appointmentAt)} withTime />
      <Field label="Horas pactadas descargue" min="0" name={`${key}_unloadingHours`} required step="0.5" type="number" value={unloading.agreedHours ?? "2"} />
      <input name={`${key}_recipientSiteCode`} type="hidden" value={recipient.siteCode ?? ""} />
      <input name={`${key}_unloadingSiteName`} type="hidden" value={unloading.siteName ?? ""} />

      <div className="field-group-note"><strong>Datos del despacho</strong></div>
      <label className="form-field checkbox-field"><span>Remesa contado</span><span className="checkbox-control"><input aria-label="Remesa contado" defaultChecked={draft.cashConsignment} name={`${key}_cashConsignment`} type="checkbox" /><em>Sí / No</em></span></label>
      <label className="form-field checkbox-field"><span>Remesa contraentrega</span><span className="checkbox-control"><input aria-label="Remesa contraentrega" defaultChecked={draft.cashOnDelivery} name={`${key}_cashOnDelivery`} type="checkbox" /><em>Sí / No</em></span></label>
      <MoneyField label="Valor declarado mercancía" name={`${key}_declaredValue`} required value={draft.declaredValue} />
      <MoneyField label="Valor remesa" name={`${key}_consignmentValue`} required value={draft.consignmentValue} />
      <Field label="Nro. manifiesto" name={`${key}_manifestPreview`} placeholder="Pendiente" readOnly value={context.manifestNumber} />
      <Field label="% seguro" max="100" min="0" name={`${key}_insurancePercent`} step="0.01" type="number" value={draft.insurancePercent} />

      <div className="field-group-note"><strong>Datos de la póliza</strong></div>
      <Field label="Tomador del seguro" name={`${key}_policyHolderPreview`} readOnly value="Empresa de transporte" />
      <InsurerField className="span-2" insurerName={insurerName} label="Aseguradora" name={`${key}_insurerNit`} nit={insurer.nit || undefined} onClear={() => setInsurer({ nit: "", name: "" })} onSelect={(option) => setInsurer({ nit: option.insurerNit, name: option.name })} required />
      <Field label="Nro. póliza" name={`${key}_policyNumber`} required value={draft.policyNumber} />
      <DateField label="Vigencia final" name={`${key}_policyExpiresOn`} required value={draft.policyExpiresOn} />
      <input name={`${key}_policyHolder`} type="hidden" value="transport_company" />

      <div className="field-group-note"><strong>Remisiones</strong></div>
      <div className="remission-table">
        <div className="remission-row remission-head" aria-hidden="true"><span>Remisión Nro.</span><span>Cantidad</span><span>Clase de bultos</span><span>Descripción</span><span>Peso (TN)</span><span>Volumen m³</span><span /></div>
        {remissions.map((line, index) => (
          <div className="remission-row" key={line.rowId}>
            <input aria-label={`Remisión ${index + 1} número`} defaultValue={line.remissionNumber} name={`${key}_rem${index}_number`} required />
            <input aria-label={`Remisión ${index + 1} cantidad`} defaultValue={line.quantity} name={`${key}_rem${index}_quantity`} placeholder={inherited(order.cargoQuantity)} required />
            <input aria-label={`Remisión ${index + 1} clase de bultos`} defaultValue={line.packagingClass} name={`${key}_rem${index}_packagingClass`} placeholder={inherited(order.packagingCode)} required />
            <input aria-label={`Remisión ${index + 1} descripción`} defaultValue={line.description} name={`${key}_rem${index}_description`} placeholder={inherited(order.cargoDescription)} required />
            <input aria-label={`Remisión ${index + 1} peso`} defaultValue={line.weightTons} min="0" name={`${key}_rem${index}_weightTons`} placeholder={inherited(order.weightTons)} required step="0.001" type="number" />
            <input aria-label={`Remisión ${index + 1} volumen`} defaultValue={line.volumeM3} min="0" name={`${key}_rem${index}_volumeM3`} placeholder={inherited(order.volumeM3)} step="0.01" type="number" />
            <button aria-label={`Quitar remisión ${index + 1}`} className="ghost-button" disabled={remissions.length === 1} onClick={() => setRemissions(remissions.filter((row) => row.rowId !== line.rowId))} type="button">×</button>
          </div>
        ))}
        <input name={`${key}_remCount`} type="hidden" value={remissions.length} />
        <button className="ghost-button add-remission" onClick={() => setRemissions([...remissions, { rowId: Date.now() }])} type="button">Agregar remisión</button>
      </div>

      <div className="field-group-note"><strong>Resumen que pasa al manifiesto</strong></div>
      <Field label="Unidad de medida" name={`${key}_unitOfMeasure`} required value={effective.unitOfMeasure} />
      <Field label="Mercancía" name={`${key}_merchandiseCode`} required value={effective.merchandiseCode} />
      <PackagingField code={packaging.code || undefined} description={packaging.description || undefined} label="Código de empaque" name={`${key}_packagingCode`} onClear={() => setPackaging({ code: "", description: "" })} onSelect={(option) => setPackaging({ code: option.code, description: option.description })} />
      <CargoNatureField name={`${key}_natureOfCargo`} required value={effective.natureOfCargo} />
      <Field label="Grupo embalaje envase" name={`${key}_packagingGroup`} placeholder="Sin relación en catálogo" readOnly value={packagingGroup} />
      <Field className="span-2" label="Orden de servicio transportador" name={`${key}_serviceOrderTransporter`} value={draft.serviceOrderTransporter ?? context.serviceOrderCode} />
      <label className="form-field"><span>Observaciones del transportador</span><textarea defaultValue={draft.transporterObservations} name={`${key}_transporterObservations`} rows={3} /></label>
      <label className="form-field span-2"><span>Observaciones generales</span><textarea defaultValue={draft.generalObservations} name={`${key}_observations`} rows={3} /></label>
      {remesa.officialState !== "draft" ? <span className="official-lock">Documento oficial · Sólo lectura</span> : null}
    </fieldset>
  );
}

export function ConsignmentsForm({ context, onSubmit, order, readOnly, remesas }: { context: RemesaContext; onSubmit: (data: FormData) => void; order: LoadingOrder; readOnly: boolean; remesas: Remesa[] }) {
  const rows = remesas.length > 0 ? remesas : [{ _id: "new", sequence: 1, officialState: "draft" }];
  return (
    <form className="form-compact" id="stage-primary-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
      <StageHeading number="02" title="Remesas" text="Revisa los datos heredados de la orden y completa la información propia de la remesa." readOnly={readOnly} />
      <div className="inheritance-note"><span>✓</span><div><strong>Datos precargados desde la orden</strong><p>Puedes corregirlos antes de emitir; el sistema conserva únicamente las diferencias.</p></div></div>
      <div className="stage-remesa-list">
        {rows.map((remesa) => <RemesaCard context={context} key={remesa._id} order={order} readOnly={readOnly} remesa={remesa} />)}
      </div>
    </form>
  );
}

export function AssignmentForm({ currentDriverDocument, currentVehiclePlate, onSubmit, readOnly }: { currentDriverDocument?: string; currentVehiclePlate?: string; onSubmit: (values: { driverId?: string; vehicleId?: string }) => void; readOnly: boolean }) {
  const [assignment, setAssignment] = useState<VehicleAssignmentValue>({ vehicle: null, driver: null });

  return (
    <form className="form-compact" id="stage-primary-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ driverId: assignment.driver?._id, vehicleId: assignment.vehicle?._id }); }}>
      <StageHeading number="03" title="Vehículo y conductor" text="Empieza por la placa: el sistema propone los conductores vinculados a ese vehículo en el RNDC." readOnly={readOnly} />
      <fieldset className="stage-form-fields" disabled={readOnly}>
        <VehicleAssignmentPicker currentDriverDocument={currentDriverDocument} currentVehiclePlate={currentVehiclePlate} disabled={readOnly} onChange={setAssignment} value={assignment} />
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
      {onChange || props.readOnly ? <input name={name} onChange={onChange} required={required} value={value ?? ""} {...props} /> : <input defaultValue={value} name={name} required={required} {...props} />}
    </label>
  );
}

function dateTimeValue(value: number | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

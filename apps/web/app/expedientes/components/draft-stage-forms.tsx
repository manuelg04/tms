"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

type LoadingOrder = {
  agencyCode?: string;
  customerReference?: string;
  sender?: { name?: string; identificationType?: string; identificationNumber?: string; siteCode?: string; municipalityCode?: string; phone?: string };
  recipient?: { name?: string; identificationType?: string; identificationNumber?: string; siteCode?: string; municipalityCode?: string };
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
  observations?: string;
};

type Remesa = {
  _id: string;
  sequence: number;
  number?: string;
  officialState: string;
  draft?: {
    consignmentClass?: "municipal" | "terrestre_carga";
    declaredValue?: string;
    policyNumber?: string;
    policyExpiresOn?: string;
    insurerNit?: string;
    recipient?: { name?: string; identificationNumber?: string };
    remissions?: Array<{ description?: string; weightTons?: string }>;
    generalObservations?: string;
  };
};

type Manifest = {
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
  observations?: string;
};

export function LoadingOrderForm({ draft, onSubmit, readOnly }: { draft: LoadingOrder; onSubmit: (data: FormData) => void; readOnly: boolean }) {
  return (
    <form id="stage-primary-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
      <StageHeading number="01" title="Orden de cargue" text="Cliente, partes, sitios, citas y mercancía alimentan las siguientes etapas." readOnly={readOnly} />
      <fieldset className="stage-form-fields" disabled={readOnly}>
        <Field label="Agencia" name="agencyCode" value={draft.agencyCode} />
        <Field label="Referencia del cliente" name="customerReference" value={draft.customerReference} />
        <Field label="Remitente" name="senderName" required value={draft.sender?.name} />
        <Field label="Tipo identificación remitente" name="senderIdType" required value={draft.sender?.identificationType} />
        <Field label="Identificación remitente" name="senderId" required value={draft.sender?.identificationNumber} />
        <Field label="Sede RNDC remitente" name="senderSiteCode" required value={draft.sender?.siteCode} />
        <Field label="Destinatario" name="recipientName" required value={draft.recipient?.name} />
        <Field label="Tipo identificación destinatario" name="recipientIdType" required value={draft.recipient?.identificationType} />
        <Field label="Identificación destinatario" name="recipientId" required value={draft.recipient?.identificationNumber} />
        <Field label="Sede RNDC destinatario" name="recipientSiteCode" required value={draft.recipient?.siteCode} />
        <Field label="Lugar de cargue" name="loadingName" required value={draft.loading?.siteName} />
        <Field label="Ciudad de cargue" name="loadingCity" required value={draft.loading?.cityName} />
        <Field className="span-2" label="Dirección de cargue" name="loadingAddress" required value={draft.loading?.address} />
        <Field label="Cita de cargue" name="loadingAppointment" required type="datetime-local" value={dateTimeValue(draft.loading?.appointmentAt)} />
        <Field label="Municipio RNDC cargue" name="loadingMunicipality" required value={draft.loading?.municipalityCode} />
        <Field label="Lugar de descargue" name="unloadingName" required value={draft.unloading?.siteName} />
        <Field label="Ciudad de descargue" name="unloadingCity" required value={draft.unloading?.cityName} />
        <Field className="span-2" label="Dirección de descargue" name="unloadingAddress" required value={draft.unloading?.address} />
        <Field label="Cita de descargue" name="unloadingAppointment" required type="datetime-local" value={dateTimeValue(draft.unloading?.appointmentAt)} />
        <Field label="Municipio RNDC descargue" name="unloadingMunicipality" required value={draft.unloading?.municipalityCode} />
        <Field className="span-2" label="Mercancía" name="cargoDescription" required value={draft.cargoDescription} />
        <Field label="Cantidad" name="cargoQuantity" value={draft.cargoQuantity} />
        <Field label="Unidad" name="cargoUnit" value={draft.cargoUnit} />
        <Field label="Peso (TN)" name="weightTons" required type="number" value={draft.weightTons} />
        <Field label="Volumen m³" name="volumeM3" type="number" value={draft.volumeM3} />
        <Field label="Empaque" name="packagingCode" required value={draft.packagingCode} />
        <Field label="Código de mercancía" name="merchandiseCode" required value={draft.merchandiseCode} />
        <Field label="Naturaleza de la carga" name="natureOfCargo" required value={draft.natureOfCargo} />
        <label className="form-field span-2"><span>Observaciones</span><textarea defaultValue={draft.observations} name="observations" rows={3} /></label>
      </fieldset>
    </form>
  );
}

export function ConsignmentsForm({ onSubmit, readOnly, remesas }: { onSubmit: (data: FormData) => void; readOnly: boolean; remesas: Remesa[] }) {
  const rows = remesas.length > 0 ? remesas : [{ _id: "new", sequence: 1, officialState: "draft" }];
  return (
    <form id="stage-primary-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
      <StageHeading number="02" title="Remesas" text="La orden ya aporta remitente, ruta, citas y carga. Completa únicamente las diferencias." readOnly={readOnly} />
      <div className="inheritance-note"><span>✓</span><div><strong>Información heredada</strong><p>Los campos vacíos usan los datos confirmados en la orden de cargue.</p></div></div>
      <div className="stage-remesa-list">
        {rows.map((remesa) => (
          <fieldset className="stage-remesa-card" disabled={readOnly || remesa.officialState !== "draft"} key={remesa._id}>
            <legend>Remesa {remesa.number ?? remesa.sequence}</legend>
            <input name="remesaId" type="hidden" value={remesa._id} />
            <label className="form-field"><span>Clase</span><select defaultValue={remesa.draft?.consignmentClass ?? "terrestre_carga"} name={`${remesa._id}_class`}><option value="terrestre_carga">Terrestre de carga</option><option value="municipal">Municipal</option></select></label>
            <Field label="Valor declarado" name={`${remesa._id}_declaredValue`} required type="number" value={remesa.draft?.declaredValue} />
            <Field className="span-2" label="Mercancía diferente" name={`${remesa._id}_description`} value={remesa.draft?.remissions?.[0]?.description} />
            <Field label="Peso diferente (TN)" name={`${remesa._id}_weightTons`} type="number" value={remesa.draft?.remissions?.[0]?.weightTons} />
            <Field label="Destinatario diferente" name={`${remesa._id}_recipientName`} value={remesa.draft?.recipient?.name} />
            <Field label="Identificación diferente" name={`${remesa._id}_recipientId`} value={remesa.draft?.recipient?.identificationNumber} />
            <Field label="Número de póliza" name={`${remesa._id}_policyNumber`} required value={remesa.draft?.policyNumber} />
            <Field label="Vencimiento de póliza" name={`${remesa._id}_policyExpiresOn`} required type="date" value={remesa.draft?.policyExpiresOn} />
            <Field label="NIT de la aseguradora" name={`${remesa._id}_insurerNit`} required value={remesa.draft?.insurerNit} />
            <Field className="span-2" label="Observaciones" name={`${remesa._id}_observations`} value={remesa.draft?.generalObservations} />
            {remesa.officialState !== "draft" ? <span className="official-lock">Documento oficial · Sólo lectura</span> : null}
          </fieldset>
        ))}
      </div>
    </form>
  );
}

export function AssignmentForm({ currentDriverDocument, currentVehiclePlate, onSubmit, readOnly }: { currentDriverDocument?: string; currentVehiclePlate?: string; onSubmit: (values: { driverId?: string; vehicleId?: string }) => void; readOnly: boolean }) {
  const [driverDocument, setDriverDocument] = useState(currentDriverDocument ?? "");
  const [vehiclePlate, setVehiclePlate] = useState(currentVehiclePlate ?? "");
  const driver = useQuery(api.fleet.driverDetail, driverDocument.trim() ? { document: driverDocument.trim() } : "skip");
  const vehicle = useQuery(api.fleet.vehicleDetail, vehiclePlate.trim() ? { plate: vehiclePlate.trim().toUpperCase() } : "skip");
  return (
    <form id="stage-primary-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ driverId: driver?._id, vehicleId: vehicle?._id }); }}>
      <StageHeading number="03" title="Vehículo y conductor" text="Selecciona recursos del maestro y revisa sus datos antes del envío." readOnly={readOnly} />
      <fieldset className="assignment-stage-grid" disabled={readOnly}>
        <Lookup label="Documento del conductor" result={driver?.name ?? (driverDocument ? "No encontrado" : "Escribe el documento")} valid={Boolean(driver)} value={driverDocument} onChange={setDriverDocument} />
        <Lookup label="Placa del vehículo" result={vehicle ? [vehicle.make, vehicle.line].filter(Boolean).join(" ") || vehicle.plate : vehiclePlate ? "No encontrado" : "Escribe la placa"} valid={Boolean(vehicle)} value={vehiclePlate} onChange={(value) => setVehiclePlate(value.toUpperCase())} />
      </fieldset>
    </form>
  );
}

export function ManifestForm({ draft, onSubmit, readOnly }: { draft: Manifest; onSubmit: (data: FormData) => void; readOnly: boolean }) {
  return (
    <form id="stage-primary-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
      <StageHeading number="04" title="Manifiesto" text="La ruta, flota y remesas ya están vinculadas. Revisa la operación y la liquidación." readOnly={readOnly} />
      <fieldset className="stage-form-fields" disabled={readOnly}>
        <Field label="Fecha de expedición" name="issueDate" required type="date" value={draft.issueDate} />
        <Field label="Entrega estimada" name="estimatedDeliveryDate" required type="date" value={draft.estimatedDeliveryDate} />
        <label className="form-field"><span>Alcance</span><select defaultValue={draft.operationScope ?? "intermunicipal"} name="operationScope"><option value="intermunicipal">Intermunicipal</option><option value="municipal">Municipal</option></select></label>
        <Field label="Tipo de manifiesto" name="manifestType" required value={draft.manifestType} />
        <Field label="Flete total" name="freightTotal" required type="number" value={draft.freightTotal} />
        <Field label="Anticipo" name="advance" type="number" value={draft.advance ?? "0"} />
        <Field label="Retención fuente" name="withholdingSource" type="number" value={draft.withholdingSource ?? "0"} />
        <Field label="ICA" name="withholdingIca" type="number" value={draft.withholdingIca ?? "0"} />
        <Field label="FOPAT" name="fopatContribution" type="number" value={draft.fopatContribution ?? "0"} />
        <Field label="Ajustes" name="adjustments" type="number" value={draft.adjustments ?? "0"} />
        <Field label="Neto a pagar" name="netPayable" required type="number" value={draft.netPayable} />
        <Field label="Responsable de pago" name="paymentResponsible" required value={draft.paymentResponsible} />
        <Field label="Responsable del cargue" name="loadingResponsible" value={draft.loadingResponsible} />
        <Field label="Responsable del descargue" name="unloadingResponsible" value={draft.unloadingResponsible} />
        <Field label="Fecha de pago" name="paymentDate" type="date" value={draft.paymentDate} />
        <label className="form-field span-2"><span>Observaciones</span><textarea defaultValue={draft.observations} name="observations" rows={3} /></label>
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

function Field({ className = "", label, name, value, ...props }: { className?: string; label: string; name: string; value?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "defaultValue">) {
  return <label className={`form-field ${className}`}><span>{label}</span><input defaultValue={value} name={name} {...props} /></label>;
}

function Lookup({ label, onChange, result, valid, value }: { label: string; onChange: (value: string) => void; result: string; valid: boolean; value: string }) {
  return <label className="lookup-card"><span>{label}</span><input onChange={(event) => onChange(event.target.value)} value={value} /><small className={valid ? "ok" : ""}>{valid ? "✓ " : ""}{result}</small></label>;
}

function dateTimeValue(value: number | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

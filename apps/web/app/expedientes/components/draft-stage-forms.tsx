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

  return (
    <form id="stage-primary-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
      <StageHeading number="01" title="Orden de cargue" text="Cliente, partes, sitios, citas y mercancía alimentan las siguientes etapas." readOnly={readOnly} />
      <fieldset className="stage-form-fields" disabled={readOnly}>
        <Field label="Agencia" name="agencyCode" value={draft.agencyCode} />
        <Field className="span-2" label="Referencia del cliente" name="customerReference" value={draft.customerReference} />

        <div className="field-group-note"><strong>Remitente y cargue</strong></div>
        <PartyBlock label="Remitente" onChange={setSender} onSite={(site) => setLoading((current) => ({ siteName: site.siteName, address: site.address ?? current.address, cityName: site.city ?? current.cityName, municipalityCode: site.cityCode ?? current.municipalityCode }))} role="sender" siteLabel="Sede RNDC remitente" state={sender} />
        <Field label="Lugar de cargue" name="loadingName" onChange={(event) => setLoading({ ...loading, siteName: event.target.value })} required value={loading.siteName} />
        <MunicipalityField code={loading.municipalityCode || undefined} label="Municipio de cargue" name="loadingMunicipality" onClear={() => setLoading({ ...loading, municipalityCode: "" })} onSelect={(division) => setLoading({ ...loading, municipalityCode: division.code, cityName: division.isMunicipality ? division.name : division.municipalityName })} required />
        <DateField label="Cita de cargue" name="loadingAppointment" required value={dateTimeValue(draft.loading?.appointmentAt)} withTime />
        <Field className="span-2" label="Dirección de cargue" name="loadingAddress" onChange={(event) => setLoading({ ...loading, address: event.target.value })} required value={loading.address} />
        <Field label="Ciudad de cargue" name="loadingCity" onChange={(event) => setLoading({ ...loading, cityName: event.target.value })} required value={loading.cityName} />

        <div className="field-group-note"><strong>Destinatario y descargue</strong></div>
        <PartyBlock label="Destinatario" onChange={setRecipient} onSite={(site) => setUnloading((current) => ({ siteName: current.siteName || site.siteName, address: current.address || (site.address ?? ""), cityName: current.cityName || (site.city ?? ""), municipalityCode: current.municipalityCode || (site.cityCode ?? "") }))} role="recipient" siteLabel="Sede RNDC destinatario" state={recipient} />
        <Field label="Lugar de descargue" name="unloadingName" onChange={(event) => setUnloading({ ...unloading, siteName: event.target.value })} required value={unloading.siteName} />
        <MunicipalityField code={unloading.municipalityCode || undefined} label="Municipio de descargue" name="unloadingMunicipality" onClear={() => setUnloading({ ...unloading, municipalityCode: "" })} onSelect={(division) => setUnloading({ ...unloading, municipalityCode: division.code, cityName: division.isMunicipality ? division.name : division.municipalityName })} required />
        <DateField label="Cita de descargue" name="unloadingAppointment" required value={dateTimeValue(draft.unloading?.appointmentAt)} withTime />
        <Field className="span-2" label="Dirección de descargue" name="unloadingAddress" onChange={(event) => setUnloading({ ...unloading, address: event.target.value })} required value={unloading.address} />
        <Field label="Ciudad de descargue" name="unloadingCity" onChange={(event) => setUnloading({ ...unloading, cityName: event.target.value })} required value={unloading.cityName} />

        <div className="field-group-note"><strong>Mercancía</strong></div>
        <Field className="span-2" label="Mercancía" name="cargoDescription" required value={draft.cargoDescription} />
        <Field label="Código de mercancía" name="merchandiseCode" value={draft.merchandiseCode} />
        <Field label="Cantidad" name="cargoQuantity" value={draft.cargoQuantity} />
        <Field label="Unidad" name="cargoUnit" value={draft.cargoUnit} />
        <Field label="Peso (TN)" min="0" name="weightTons" required step="0.001" type="number" value={draft.weightTons} />
        <Field label="Volumen m³" min="0" name="volumeM3" step="0.01" type="number" value={draft.volumeM3} />
        <PackagingField code={packaging.code || undefined} description={packaging.description || undefined} label="Empaque" name="packagingCode" onClear={() => setPackaging({ code: "", description: "" })} onSelect={(option) => setPackaging({ code: option.code, description: option.description })} required />
        <CargoNatureField name="natureOfCargo" required value={draft.natureOfCargo} />
        <label className="form-field span-2"><span>Observaciones</span><textarea defaultValue={draft.observations} name="observations" rows={3} /></label>
      </fieldset>
    </form>
  );
}

function RemesaCard({ readOnly, remesa }: { readOnly: boolean; remesa: Remesa }) {
  const [insurer, setInsurer] = useState({ nit: remesa.draft?.insurerNit ?? "", name: "" });
  const resolved = useQuery(api.lookups.insurersSearch, insurer.nit && !insurer.name ? { term: insurer.nit } : "skip");
  const insurerName = insurer.name || resolved?.find((row) => row.insurerNit === insurer.nit)?.name;
  return (
    <fieldset className="stage-remesa-card" disabled={readOnly || remesa.officialState !== "draft"}>
      <legend>Remesa {remesa.number ?? remesa.sequence}</legend>
      <input name="remesaId" type="hidden" value={remesa._id} />
      <label className="form-field"><span>Clase</span><select defaultValue={remesa.draft?.consignmentClass ?? "terrestre_carga"} name={`${remesa._id}_class`}><option value="terrestre_carga">Terrestre de carga</option><option value="municipal">Municipal</option></select></label>
      <MoneyField label="Valor declarado" name={`${remesa._id}_declaredValue`} required value={remesa.draft?.declaredValue} />
      <Field className="span-2" label="Mercancía diferente" name={`${remesa._id}_description`} value={remesa.draft?.remissions?.[0]?.description} />
      <Field label="Peso diferente (TN)" min="0" name={`${remesa._id}_weightTons`} step="0.001" type="number" value={remesa.draft?.remissions?.[0]?.weightTons} />
      <Field label="Destinatario diferente" name={`${remesa._id}_recipientName`} value={remesa.draft?.recipient?.name} />
      <Field label="Identificación diferente" name={`${remesa._id}_recipientId`} value={remesa.draft?.recipient?.identificationNumber} />
      <InsurerField className="span-2" insurerName={insurerName} label="Aseguradora" name={`${remesa._id}_insurerNit`} nit={insurer.nit || undefined} onClear={() => setInsurer({ nit: "", name: "" })} onSelect={(option) => setInsurer({ nit: option.insurerNit, name: option.name })} required />
      <Field label="Número de póliza" name={`${remesa._id}_policyNumber`} required value={remesa.draft?.policyNumber} />
      <DateField label="Vencimiento de póliza" name={`${remesa._id}_policyExpiresOn`} required value={remesa.draft?.policyExpiresOn} />
      <Field className="span-2" label="Observaciones" name={`${remesa._id}_observations`} value={remesa.draft?.generalObservations} />
      {remesa.officialState !== "draft" ? <span className="official-lock">Documento oficial · Sólo lectura</span> : null}
    </fieldset>
  );
}

export function ConsignmentsForm({ onSubmit, readOnly, remesas }: { onSubmit: (data: FormData) => void; readOnly: boolean; remesas: Remesa[] }) {
  const rows = remesas.length > 0 ? remesas : [{ _id: "new", sequence: 1, officialState: "draft" }];
  return (
    <form id="stage-primary-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
      <StageHeading number="02" title="Remesas" text="La orden ya aporta remitente, ruta, citas y carga. Completa únicamente las diferencias." readOnly={readOnly} />
      <div className="inheritance-note"><span>✓</span><div><strong>Información heredada</strong><p>Los campos vacíos usan los datos confirmados en la orden de cargue.</p></div></div>
      <div className="stage-remesa-list">
        {rows.map((remesa) => <RemesaCard key={remesa._id} readOnly={readOnly} remesa={remesa} />)}
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
    <form id="stage-primary-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ driverId: driver?._id, vehicleId: vehicle?._id }); }}>
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

const MONEY_KEYS = ["freightTotal", "advance", "withholdingSource", "withholdingIca", "fopatContribution", "adjustments"] as const;

export function ManifestForm({ draft, onSubmit, readOnly }: { draft: Manifest; onSubmit: (data: FormData) => void; readOnly: boolean }) {
  const [money, setMoney] = useState<Record<(typeof MONEY_KEYS)[number], string>>({ freightTotal: draft.freightTotal ?? "", advance: draft.advance ?? "0", withholdingSource: draft.withholdingSource ?? "0", withholdingIca: draft.withholdingIca ?? "0", fopatContribution: draft.fopatContribution ?? "0", adjustments: draft.adjustments ?? "0" });
  const suggested = String(Math.max(0, Number(money.freightTotal || 0) - Number(money.advance || 0) - Number(money.withholdingSource || 0) - Number(money.withholdingIca || 0) - Number(money.fopatContribution || 0) + Number(money.adjustments || 0)));
  const [net, setNet] = useState<{ value: string; manual: boolean }>({ value: draft.netPayable ?? "", manual: Boolean(draft.netPayable) });
  const netValue = net.manual ? net.value : suggested;
  return (
    <form id="stage-primary-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
      <StageHeading number="04" title="Manifiesto" text="La ruta, flota y remesas ya están vinculadas. Revisa la operación y la liquidación." readOnly={readOnly} />
      <fieldset className="stage-form-fields" disabled={readOnly}>
        <DateField label="Fecha de expedición" name="issueDate" required value={draft.issueDate ?? new Date().toISOString().slice(0, 10)} />
        <DateField label="Entrega estimada" name="estimatedDeliveryDate" required value={draft.estimatedDeliveryDate} />
        <label className="form-field"><span>Alcance</span><select defaultValue={draft.operationScope ?? "intermunicipal"} name="operationScope"><option value="intermunicipal">Intermunicipal</option><option value="municipal">Municipal</option></select></label>
        <Field label="Tipo de manifiesto" name="manifestType" required value={draft.manifestType} />
        <Field label="Responsable de pago" name="paymentResponsible" required value={draft.paymentResponsible} />
        <DateField label="Fecha de pago" name="paymentDate" value={draft.paymentDate} />
        <div className="field-group-note"><strong>Liquidación</strong></div>
        <MoneyField label="Flete total" name="freightTotal" onChange={(value) => setMoney({ ...money, freightTotal: value })} required value={money.freightTotal} />
        <MoneyField label="Anticipo" name="advance" onChange={(value) => setMoney({ ...money, advance: value })} value={money.advance} />
        <MoneyField label="Retención en la fuente" name="withholdingSource" onChange={(value) => setMoney({ ...money, withholdingSource: value })} value={money.withholdingSource} />
        <MoneyField label="ICA" name="withholdingIca" onChange={(value) => setMoney({ ...money, withholdingIca: value })} value={money.withholdingIca} />
        <MoneyField label="FOPAT" name="fopatContribution" onChange={(value) => setMoney({ ...money, fopatContribution: value })} value={money.fopatContribution} />
        <MoneyField label="Ajustes" name="adjustments" onChange={(value) => setMoney({ ...money, adjustments: value })} value={money.adjustments} />
        <MoneyField hint={net.manual && net.value !== suggested ? `Calculado: $${formatThousands(suggested)}` : "Flete − anticipo − retenciones + ajustes"} label="Neto a pagar" name="netPayable" onChange={(value) => setNet({ value, manual: true })} required value={netValue} />
        <Field label="Responsable del cargue" name="loadingResponsible" value={draft.loadingResponsible} />
        <Field label="Responsable del descargue" name="unloadingResponsible" value={draft.unloadingResponsible} />
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

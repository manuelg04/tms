"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

type RemesaDraft = {
  consignmentClass: "municipal" | "terrestre_carga";
  description: string;
  weightTons: string;
  declaredValue: string;
  recipientName: string;
  recipientDocument: string;
};

const steps = [
  { label: "Orden de cargue", helper: "Cliente, ruta y mercancía" },
  { label: "Remesas", helper: "Sólo las diferencias" },
  { label: "Vehículo y conductor", helper: "Recursos del maestro" },
  { label: "Manifiesto", helper: "Operación y liquidación" },
  { label: "Revisión RNDC", helper: "Resumen antes de guardar" }
];

const emptyRemesa = (): RemesaDraft => ({
  consignmentClass: "terrestre_carga",
  description: "",
  weightTons: "",
  declaredValue: "",
  recipientName: "",
  recipientDocument: ""
});

export default function NuevoDespachoPage() {
  const router = useRouter();
  const me = useQuery(api.access.me, {});
  const [step, setStep] = useState(0);
  const [driverDocument, setDriverDocument] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [trailerPlate, setTrailerPlate] = useState("");
  const [remesas, setRemesas] = useState<RemesaDraft[]>([emptyRemesa()]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [freightTotal, setFreightTotal] = useState("");
  const [advance, setAdvance] = useState("0");
  const [withholdingSource, setWithholdingSource] = useState("0");
  const [withholdingIca, setWithholdingIca] = useState("0");
  const [fopat, setFopat] = useState("0");
  const [adjustments, setAdjustments] = useState("0");
  const driver = useQuery(api.fleet.driverDetail, driverDocument.trim() ? { document: driverDocument.trim() } : "skip");
  const vehicle = useQuery(api.fleet.vehicleDetail, vehiclePlate.trim() ? { plate: vehiclePlate.trim().toUpperCase() } : "skip");
  const upsertCustomer = useMutation(api.masterData.upsertCustomer);
  const upsertLocation = useMutation(api.masterData.upsertCustomerLocation);
  const upsertOrder = useMutation(api.masterData.upsertServiceOrder);
  const upsertTrailer = useMutation(api.masterData.upsertTrailer);
  const createDraft = useMutation(api.dispatches.createDraft);
  const saveLoadingOrder = useMutation(api.dispatches.saveLoadingOrderDraft);
  const saveConsignments = useMutation(api.dispatches.saveConsignmentsDraft);
  const saveAssignment = useMutation(api.dispatches.saveAssignmentDraft);
  const saveManifest = useMutation(api.dispatches.saveManifestDraft);
  const netPayable = useMemo(() => money(freightTotal) - money(advance) - money(withholdingSource) - money(withholdingIca) - money(fopat) + money(adjustments), [freightTotal, advance, withholdingSource, withholdingIca, fopat, adjustments]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (step < steps.length - 1) {
      setStep((current) => Math.min(current + 1, steps.length - 1));
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (!me) {
      setError("La sesión todavía no está conectada al espacio de trabajo.");
      return;
    }

    setSaving(true);
    setError("");
    const data = new FormData(event.currentTarget);

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
        agreedRate: money(requiredText(data, "freightTotal")),
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
        draft: {
          agencyCode: optionalText(data, "agencyCode"),
          customerId,
          customerReference: optionalText(data, "customerReference"),
          sender: {
            name: requiredText(data, "customerName"),
            identificationType: optionalText(data, "customerIdType"),
            identificationNumber: requiredText(data, "customerId"),
            phone: optionalText(data, "customerPhone")
          },
          recipient: {
            name: requiredText(data, "recipientName"),
            identificationType: optionalText(data, "recipientIdType"),
            identificationNumber: requiredText(data, "recipientId")
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
        }
      });
      await saveConsignments({
        expedienteId: created.expedienteId,
        upserts: remesas.map((remesa, index) => ({
          sequence: index + 1,
          draft: {
            consignmentClass: remesa.consignmentClass,
            recipient: remesa.recipientName.trim() ? {
              name: remesa.recipientName,
              identificationNumber: remesa.recipientDocument
            } : undefined,
            declaredValue: remesa.declaredValue,
            remissions: [{
              quantity: optionalText(data, "cargoQuantity"),
              description: remesa.description.trim() || requiredText(data, "cargoDescription"),
              weightTons: remesa.weightTons.trim() || requiredText(data, "weightTons")
            }],
            unitOfMeasure: optionalText(data, "cargoUnit"),
            packagingCode: requiredText(data, "packagingCode"),
            natureOfCargo: optionalText(data, "natureOfCargo"),
            merchandiseCode: optionalText(data, "merchandiseCode"),
            generalObservations: optionalText(data, "remesaObservations")
          }
        }))
      });
      let trailerId;

      if (trailerPlate.trim()) {
        trailerId = await upsertTrailer({
          organizationId: me.organizationId,
          plate: trailerPlate.trim().toUpperCase(),
          status: "available"
        });
      }

      await saveAssignment({
        expedienteId: created.expedienteId,
        driverId: driver?._id,
        vehicleId: vehicle?._id,
        trailerId
      });
      await saveManifest({
        expedienteId: created.expedienteId,
        draft: {
          issueDate: requiredText(data, "issueDate"),
          estimatedDeliveryDate: requiredText(data, "estimatedDeliveryDate"),
          operationScope: requiredText(data, "operationScope") as "municipal" | "intermunicipal",
          manifestType: requiredText(data, "manifestType"),
          agencyCode: optionalText(data, "agencyCode"),
          originCityName: requiredText(data, "originCity"),
          originMunicipalityCode: optionalText(data, "originMunicipality"),
          destinationCityName: requiredText(data, "destinationCity"),
          destinationMunicipalityCode: optionalText(data, "destinationMunicipality"),
          freightTotal: requiredText(data, "freightTotal"),
          advance,
          withholdingSource,
          withholdingIca,
          fopatContribution: fopat,
          adjustments,
          netPayable: String(netPayable),
          paymentResponsible: requiredText(data, "paymentResponsible"),
          loadingResponsible: optionalText(data, "loadingResponsible"),
          unloadingResponsible: optionalText(data, "unloadingResponsible"),
          paymentDate: optionalText(data, "paymentDate"),
          observations: optionalText(data, "manifestObservations")
        }
      });
      router.push(`/expedientes/${created.expedienteId}`);
    } catch (cause) {
      setError(readError(cause));
      setSaving(false);
    }
  }

  function updateRemesa(index: number, key: keyof RemesaDraft, value: string) {
    setRemesas((current) => current.map((remesa, position) => position === index ? { ...remesa, [key]: value } : remesa));
  }

  return (
    <form className="guided-dispatch-form" onSubmit={submit}>
      <div className="guided-form-heading">
        <div>
          <span className="eyebrow">Nuevo despacho</span>
          <h2>{steps[step].label}</h2>
          <p>{step === 0 ? "El número de expediente y los consecutivos documentales se asignarán automáticamente." : steps[step].helper}</p>
        </div>
        <Link className="ghost-button action-link" href="/expedientes">Guardar después</Link>
      </div>

      <nav className="creation-stepper" aria-label="Etapas para crear el despacho">
        {steps.map((item, index) => (
          <button
            aria-current={index === step ? "step" : undefined}
            className={index === step ? "current" : index < step ? "complete" : "pending"}
            key={item.label}
            onClick={() => index <= step && setStep(index)}
            type="button"
          >
            <span>{index < step ? "✓" : index + 1}</span>
            <div><strong>{item.label}</strong><small>{item.helper}</small></div>
          </button>
        ))}
      </nav>

      <div className="guided-form-stage">
        <section aria-labelledby="loading-order-title" hidden={step !== 0}>
          <StageHeading id="loading-order-title" number="01" title="Orden de cargue" text="Registra la solicitud comercial, las partes, la ruta y la carga una sola vez." />
          <div className="guided-section-grid">
            <Field label="Orden de servicio" name="serviceOrderCode" placeholder="OS-2026-001" required />
            <Field label="Referencia del cliente" name="customerReference" placeholder="Pedido o contrato" />
            <Field label="Agencia responsable" name="agencyCode" placeholder="Principal" />
            <Field label="Código del cliente" name="customerCode" placeholder="CLI-001" required />
            <Field className="span-2" label="Cliente o razón social" name="customerName" required />
            <Field label="Tipo de identificación" name="customerIdType" placeholder="NIT" />
            <Field label="Identificación del cliente" name="customerId" required />
            <Field label="Teléfono" name="customerPhone" type="tel" />
          </div>
          <div className="route-guided-grid">
            <fieldset>
              <legend>Cargue</legend>
              <Field label="Lugar" name="originName" required />
              <Field label="Ciudad" name="originCity" required />
              <Field label="Dirección" name="originAddress" required />
              <Field label="Código municipio RNDC" name="originMunicipality" />
              <Field label="Cita de cargue" name="loadingAppointment" required type="datetime-local" />
            </fieldset>
            <span className="route-connector" aria-hidden>→</span>
            <fieldset>
              <legend>Descargue</legend>
              <Field label="Lugar" name="destinationName" required />
              <Field label="Ciudad" name="destinationCity" required />
              <Field label="Dirección" name="destinationAddress" required />
              <Field label="Código municipio RNDC" name="destinationMunicipality" />
              <Field label="Cita de descargue" name="unloadingAppointment" required type="datetime-local" />
            </fieldset>
          </div>
          <div className="guided-section-grid section-divider">
            <Field label="Destinatario" name="recipientName" required />
            <Field label="Tipo de identificación" name="recipientIdType" placeholder="NIT o CC" />
            <Field label="Identificación destinatario" name="recipientId" required />
            <Field className="span-2" label="Mercancía" name="cargoDescription" required />
            <Field label="Cantidad" name="cargoQuantity" type="number" />
            <Field label="Unidad" name="cargoUnit" placeholder="kg, unidades, galones" />
            <Field label="Peso total (TN)" min="0" name="weightTons" required step="0.001" type="number" />
            <Field label="Volumen m³" min="0" name="volumeM3" step="0.01" type="number" />
            <Field label="Tipo de empaque" name="packagingCode" required />
            <Field label="Código de mercancía" name="merchandiseCode" />
            <Field label="Naturaleza de la carga" name="natureOfCargo" />
            <label className="form-field span-2"><span>Observaciones</span><textarea name="orderObservations" rows={3} /></label>
          </div>
        </section>

        <section aria-labelledby="consignments-title" hidden={step !== 1}>
          <StageHeading id="consignments-title" number="02" title="Remesas" text="La ruta, remitente, destinatario y carga vienen de la orden. Cambia únicamente lo que sea diferente." />
          <div className="inheritance-note"><span>✓</span><div><strong>Datos reutilizados</strong><p>Remitente, sitios, citas, empaque, unidad y códigos de carga se copiarán desde la orden.</p></div></div>
          <div className="guided-remesas">
            {remesas.map((remesa, index) => (
              <fieldset className="guided-remesa-card" key={index}>
                <legend>Remesa {index + 1}</legend>
                <label className="form-field"><span>Clase de remesa</span><select onChange={(event) => updateRemesa(index, "consignmentClass", event.target.value)} value={remesa.consignmentClass}><option value="terrestre_carga">Terrestre de carga</option><option value="municipal">Municipal</option></select></label>
                <label className="form-field"><span>Valor declarado</span><input min="0" onChange={(event) => updateRemesa(index, "declaredValue", event.target.value)} required type="number" value={remesa.declaredValue} /></label>
                <label className="form-field span-2"><span>Mercancía diferente <small>opcional</small></span><input onChange={(event) => updateRemesa(index, "description", event.target.value)} placeholder="Se usará la mercancía de la orden" value={remesa.description} /></label>
                <label className="form-field"><span>Peso diferente (TN) <small>opcional</small></span><input min="0" onChange={(event) => updateRemesa(index, "weightTons", event.target.value)} step="0.001" type="number" value={remesa.weightTons} /></label>
                <label className="form-field"><span>Destinatario diferente <small>opcional</small></span><input onChange={(event) => updateRemesa(index, "recipientName", event.target.value)} value={remesa.recipientName} /></label>
                <label className="form-field"><span>Identificación diferente</span><input onChange={(event) => updateRemesa(index, "recipientDocument", event.target.value)} value={remesa.recipientDocument} /></label>
                {remesas.length > 1 ? <button className="remove-remesa" onClick={() => setRemesas((current) => current.filter((_, position) => position !== index))} type="button">Quitar remesa</button> : null}
              </fieldset>
            ))}
          </div>
          <button className="ghost-button add-guided-remesa" onClick={() => setRemesas((current) => [...current, emptyRemesa()])} type="button">+ Agregar otra remesa</button>
          <label className="form-field section-divider"><span>Observaciones para las remesas</span><textarea name="remesaObservations" rows={3} /></label>
        </section>

        <section aria-labelledby="assignment-title" hidden={step !== 2}>
          <StageHeading id="assignment-title" number="03" title="Vehículo y conductor" text="Busca la flota en maestros. Las vigencias y datos conocidos se reutilizan automáticamente." />
          <div className="assignment-lookup-grid">
            <LookupField label="Documento del conductor" onChange={setDriverDocument} value={driverDocument} result={driver === undefined ? "Buscando…" : driver ? driver.name ?? driver.document : driverDocument ? "No encontrado en maestros" : "Escribe el documento"} valid={Boolean(driver)} />
            <LookupField label="Placa del vehículo" onChange={(value) => setVehiclePlate(value.toUpperCase())} value={vehiclePlate} result={vehicle === undefined ? "Buscando…" : vehicle ? [vehicle.make, vehicle.line].filter(Boolean).join(" ") || vehicle.plate : vehiclePlate ? "No encontrado en maestros" : "Escribe la placa"} valid={Boolean(vehicle)} />
            <LookupField label="Placa del remolque" onChange={(value) => setTrailerPlate(value.toUpperCase())} value={trailerPlate} result={trailerPlate ? "Se vinculará al despacho" : "Opcional según configuración"} valid={Boolean(trailerPlate)} />
          </div>
          <div className="assignment-rule"><strong>Antes del envío</strong><p>El conductor y el vehículo deben existir en maestros. Si falta alguno, podrás guardar el despacho, pero RNDC permanecerá bloqueado.</p></div>
        </section>

        <section aria-labelledby="manifest-title" hidden={step !== 3}>
          <StageHeading id="manifest-title" number="04" title="Manifiesto" text="Las remesas, la ruta y la flota ya están vinculadas. Completa la operación y sus valores." />
          <div className="guided-section-grid">
            <Field label="Fecha de expedición" name="issueDate" required type="date" />
            <Field label="Entrega estimada" name="estimatedDeliveryDate" required type="date" />
            <label className="form-field"><span>Alcance de la operación</span><select name="operationScope" required><option value="intermunicipal">Intermunicipal</option><option value="municipal">Municipal</option></select></label>
            <label className="form-field"><span>Tipo de manifiesto</span><select name="manifestType" required><option value="general">General</option><option value="especial">Especial</option></select></label>
            <MoneyField label="Flete total" name="freightTotal" onChange={setFreightTotal} required value={freightTotal} />
            <MoneyField label="Anticipo" name="advance" onChange={setAdvance} value={advance} />
            <MoneyField label="Retención en la fuente" name="withholdingSource" onChange={setWithholdingSource} value={withholdingSource} />
            <MoneyField label="ICA" name="withholdingIca" onChange={setWithholdingIca} value={withholdingIca} />
            <MoneyField label="FOPAT" name="fopat" onChange={setFopat} value={fopat} />
            <MoneyField label="Ajustes" name="adjustments" onChange={setAdjustments} value={adjustments} />
            <div className="net-payable"><span>Neto a pagar</span><strong>{new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(netPayable)}</strong></div>
            <Field label="Responsable de pago" name="paymentResponsible" required />
            <Field label="Responsable del cargue" name="loadingResponsible" />
            <Field label="Responsable del descargue" name="unloadingResponsible" />
            <Field label="Fecha de pago" name="paymentDate" type="date" />
            <label className="form-field span-2"><span>Observaciones del manifiesto</span><textarea name="manifestObservations" rows={3} /></label>
          </div>
        </section>

        <section aria-labelledby="review-title" hidden={step !== 4}>
          <StageHeading id="review-title" number="05" title="Revisión RNDC" text="Guardar no transmite documentos. El despacho quedará en borrador para revisar bloqueos antes del envío." />
          <div className="review-mode-banner"><span>PRUEBA</span><div><strong>Modo de ejecución protegido</strong><p>Ninguna acción de este recorrido puede enviar tráfico RNDC real.</p></div></div>
          <div className="creation-review-grid">
            <ReviewItem label="Orden de cargue" value="Cliente, ruta, citas y mercancía registrados" />
            <ReviewItem label="Remesas" value={`${remesas.length} ${remesas.length === 1 ? "remesa preparada" : "remesas preparadas"}`} />
            <ReviewItem label="Vehículo" value={vehicle ? `${vehicle.plate} · ${vehicle.make ?? "Maestro verificado"}` : "Pendiente de completar"} warning={!vehicle} />
            <ReviewItem label="Conductor" value={driver ? `${driver.name ?? driver.document} · Maestro verificado` : "Pendiente de completar"} warning={!driver} />
            <ReviewItem label="Manifiesto" value={`${remesas.length} remesas · Neto ${new Intl.NumberFormat("es-CO").format(netPayable)} COP`} />
            <ReviewItem label="Consecutivos" value="Expediente, orden, remesas y manifiesto se asignarán automáticamente" />
          </div>
        </section>
      </div>

      {error ? <div className="form-error" role="alert" tabIndex={-1}>{error}</div> : null}
      <div className="guided-action-bar">
        <button className="ghost-button" disabled={step === 0 || saving} onClick={() => setStep((current) => Math.max(0, current - 1))} type="button">Anterior</button>
        <span>Paso {step + 1} de {steps.length}</span>
        <button
          className="primary-action"
          disabled={saving || !me}
          onClick={step < steps.length - 1 ? () => { setStep((current) => current + 1); window.scrollTo({ top: 0, behavior: "smooth" }); } : undefined}
          type={step === steps.length - 1 ? "submit" : "button"}
        >
          {saving ? "Guardando despacho…" : step === steps.length - 1 ? "Guardar despacho" : "Continuar"}
        </button>
      </div>
    </form>
  );
}

function StageHeading({ id, number, text, title }: { id: string; number: string; text: string; title: string }) {
  return <div className="guided-stage-heading"><span>{number}</span><div><h3 id={id}>{title}</h3><p>{text}</p></div></div>;
}

function Field({ className = "", label, name, ...props }: { className?: string; label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <label className={`form-field ${className}`}><span>{label}</span><input name={name} {...props} /></label>;
}

function MoneyField({ label, name, onChange, required = false, value }: { label: string; name: string; onChange: (value: string) => void; required?: boolean; value: string }) {
  return <label className="form-field"><span>{label}</span><div className="money-input"><span>$</span><input min="0" name={name} onChange={(event) => onChange(event.target.value)} required={required} type="number" value={value} /></div></label>;
}

function LookupField({ label, onChange, result, valid, value }: { label: string; onChange: (value: string) => void; result: string; valid: boolean; value: string }) {
  return <label className="lookup-card"><span>{label}</span><input onChange={(event) => onChange(event.target.value)} value={value} /><small className={valid ? "ok" : ""}>{valid ? "✓ " : ""}{result}</small></label>;
}

function ReviewItem({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return <div className={warning ? "review-item warning" : "review-item"}><span>{warning ? "!" : "✓"}</span><div><small>{label}</small><strong>{value}</strong></div></div>;
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

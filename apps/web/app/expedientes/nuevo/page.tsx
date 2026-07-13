"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export default function NuevoDespachoPage() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const me = useQuery(api.access.me, {});
  const [error, setError] = useState("");
  const [savingAction, setSavingAction] = useState<"draft" | "open" | null>(null);
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
          <p>Crea la orden de cargue con la información que ya tienes. Después podrás completar remesas, asignación, manifiesto y cumplidos por separado.</p>
        </div>
        <div className="base-dispatch-outcome"><strong>Al guardar</strong><span>Se abre el centro documental del despacho</span></div>
      </section>

      <div className="base-document-path" aria-label="Documentos que se completan después"><span className="active">1. Datos base</span><span>Orden de cargue</span><span>Remesas</span><span>Vehículo y conductor</span><span>Manifiesto</span><span>Cumplidos</span></div>

      <div className="guided-form-stage">
        <section aria-labelledby="loading-order-title">
          <StageHeading id="loading-order-title" title="Orden de cargue" text="Registra la solicitud comercial, las partes, la ruta y la carga una sola vez." />
          <div className="base-form-section-heading"><strong>Solicitud y cliente</strong><span>Identifica quién solicita el servicio.</span></div>
          <div className="guided-section-grid">
            <Field label="Orden de servicio" name="serviceOrderCode" placeholder="OS-2026-001" required />
            <Field label="Referencia del cliente" name="customerReference" placeholder="Pedido o contrato" />
            <Field label="Agencia responsable" name="agencyCode" placeholder="Principal" />
            <Field label="Código del cliente" name="customerCode" placeholder="CLI-001" required />
            <Field className="span-2" label="Cliente o razón social" name="customerName" required />
            <Field label="Tipo de identificación" name="customerIdType" placeholder="NIT" required />
            <Field label="Identificación del cliente" name="customerId" required />
            <Field label="Código sede RNDC remitente" name="senderSiteCode" required />
            <Field label="Teléfono" name="customerPhone" type="tel" />
          </div>

          <div className="base-form-section-heading section-divider"><strong>Ruta y citas</strong><span>Define dónde comienza y termina el servicio.</span></div>
          <div className="route-guided-grid">
            <fieldset>
              <legend>Cargue</legend>
              <Field label="Lugar" name="originName" required />
              <Field label="Ciudad" name="originCity" required />
              <Field label="Dirección" name="originAddress" required />
              <Field label="Código municipio RNDC" name="originMunicipality" required />
              <Field label="Cita de cargue" name="loadingAppointment" required type="datetime-local" />
            </fieldset>
            <span className="route-connector" aria-hidden>→</span>
            <fieldset>
              <legend>Descargue</legend>
              <Field label="Lugar" name="destinationName" required />
              <Field label="Ciudad" name="destinationCity" required />
              <Field label="Dirección" name="destinationAddress" required />
              <Field label="Código municipio RNDC" name="destinationMunicipality" required />
              <Field label="Cita de descargue" name="unloadingAppointment" required type="datetime-local" />
            </fieldset>
          </div>

          <div className="base-form-section-heading section-divider"><strong>Destinatario y mercancía</strong><span>Completa la carga que da origen a los documentos posteriores.</span></div>
          <div className="guided-section-grid">
            <Field label="Destinatario" name="recipientName" required />
            <Field label="Tipo de identificación" name="recipientIdType" placeholder="NIT o CC" required />
            <Field label="Identificación destinatario" name="recipientId" required />
            <Field label="Código sede RNDC destinatario" name="recipientSiteCode" required />
            <Field className="span-2" label="Mercancía" name="cargoDescription" required />
            <Field label="Cantidad" name="cargoQuantity" type="number" />
            <Field label="Unidad" name="cargoUnit" placeholder="kg, unidades, galones" />
            <Field label="Peso total (TN)" min="0" name="weightTons" required step="0.001" type="number" />
            <Field label="Volumen m³" min="0" name="volumeM3" step="0.01" type="number" />
            <Field label="Tipo de empaque" name="packagingCode" required />
            <Field label="Código de mercancía" name="merchandiseCode" required />
            <Field label="Naturaleza de la carga" name="natureOfCargo" required />
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

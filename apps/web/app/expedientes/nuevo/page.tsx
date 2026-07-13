"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type RemesaDraft = {
  remesaId?: Id<"expedienteRemesas">;
  consignmentClass: "municipal" | "terrestre_carga";
  description: string;
  weightTons: string;
  declaredValue: string;
  policyNumber: string;
  policyExpiresOn: string;
  insurerNit: string;
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
  policyNumber: "",
  policyExpiresOn: "",
  insurerNit: "",
  recipientName: "",
  recipientDocument: ""
});

export default function NuevoDespachoPage() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const me = useQuery(api.access.me, {});
  const [step, setStep] = useState(0);
  const [expedienteId, setExpedienteId] = useState<Id<"expedientes"> | null>(null);
  const [expedienteCode, setExpedienteCode] = useState("");
  const [driverDocument, setDriverDocument] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [trailerPlate, setTrailerPlate] = useState("");
  const [remesas, setRemesas] = useState<RemesaDraft[]>([emptyRemesa()]);
  const [removedRemesaIds, setRemovedRemesaIds] = useState<Id<"expedienteRemesas">[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [emitting, setEmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [remesasSaved, setRemesasSaved] = useState(false);
  const [assignmentSaved, setAssignmentSaved] = useState(false);
  const [manifestSaved, setManifestSaved] = useState(false);
  const [issueDate, setIssueDate] = useState("");
  const [estimatedDeliveryDate, setEstimatedDeliveryDate] = useState("");
  const [paymentResponsible, setPaymentResponsible] = useState("");
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

  async function saveCurrent(action: "continue" | "exit" | "open") {
    if (!me || !formRef.current) {
      setError("La sesión todavía no está conectada al espacio de trabajo.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    const data = new FormData(formRef.current);

    try {
      let currentId = expedienteId;

      if (step === 0) {
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
          agreedRate: money(freightTotal),
          currency: "COP",
          scheduledLoadingAt: dateTime(data, "loadingAppointment"),
          scheduledUnloadingAt: dateTime(data, "unloadingAppointment"),
          notes: optionalText(data, "orderObservations")
        });
        let currentCode = expedienteCode;

        if (!currentId) {
          const created = await createDraft({
            serviceOrderId,
            agencyCode: optionalText(data, "agencyCode"),
            notes: optionalText(data, "orderObservations")
          });
          currentId = created.expedienteId;
          currentCode = created.code;
          setExpedienteId(created.expedienteId);
          setExpedienteCode(created.code);
          router.replace(`/expedientes/nuevo?expedienteId=${created.expedienteId}`, { scroll: false });
        }

        await saveLoadingOrder({
          expedienteId: currentId,
          draft: loadingOrderDraft(data, customerId)
        });
        setNotice(`Despacho ${currentCode} guardado. Puedes salir y continuar más tarde.`);
      } else {
        if (!currentId) throw new Error("Guarda primero la orden de cargue.");

        if (step === 1) {
          const selected = remesas
            .map((remesa, index) => ({ remesa, index }))
            .filter(({ remesa }) => hasConsignmentInput(remesa));
          const savedIds = await saveConsignments({
            expedienteId: currentId,
            upserts: selected.map(({ remesa }, index) => ({
              remesaId: remesa.remesaId,
              sequence: index + 1,
              draft: consignmentDraft(data, remesa)
            })),
            removals: removedRemesaIds
          });
          setRemesas((current) => current.map((remesa, index) => {
            const savedIndex = selected.findIndex((entry) => entry.index === index);
            return savedIndex >= 0 ? { ...remesa, remesaId: savedIds[savedIndex] } : remesa;
          }));
          setRemovedRemesaIds([]);
          setRemesasSaved(savedIds.length > 0);
          setNotice(savedIds.length > 0 ? "Remesas guardadas." : "La etapa de remesas quedó pendiente.");
        }

        if (step === 2) {
          if (driverDocument.trim() && !driver) throw new Error("El conductor no existe en maestros.");
          if (vehiclePlate.trim() && !vehicle) throw new Error("El vehículo no existe en maestros.");
          let trailerId: Id<"trailers"> | null = null;

          if (trailerPlate.trim()) {
            trailerId = await upsertTrailer({
              organizationId: me.organizationId,
              plate: trailerPlate.trim().toUpperCase(),
              status: "available"
            });
          }

          await saveAssignment({
            expedienteId: currentId,
            driverId: driver?._id ?? null,
            vehicleId: vehicle?._id ?? null,
            trailerId
          });
          setAssignmentSaved(Boolean(driver && vehicle));
          setNotice(driver && vehicle ? "Vehículo y conductor guardados." : "La asignación quedó pendiente.");
        }

        if (step === 3) {
          await saveManifest({
            expedienteId: currentId,
            draft: manifestDraft(data, {
              issueDate,
              estimatedDeliveryDate,
              paymentResponsible,
              advance,
              withholdingSource,
              withholdingIca,
              fopat,
              adjustments,
              netPayable
            })
          });
          const complete = Boolean(issueDate && estimatedDeliveryDate && freightTotal && paymentResponsible);
          setManifestSaved(complete);
          setNotice(complete ? "Manifiesto guardado." : "El manifiesto quedó guardado como borrador incompleto.");
        }
      }

      if (!currentId) throw new Error("No fue posible identificar el despacho guardado.");

      if (action === "exit" || action === "open") {
        router.push(`/expedientes/${currentId}`);
        return;
      }

      setStep((current) => Math.min(current + 1, steps.length - 1));
      window.scrollTo({ top: 0, behavior: "smooth" });
      setSaving(false);
    } catch (cause) {
      setError(readError(cause));
      setSaving(false);
    }
  }

  async function emitLoadingOrder() {
    if (!expedienteId || !driver || !vehicle) return;
    setEmitting(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`/api/rndc/dispatches/${expedienteId}/emit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "orden" })
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "No fue posible emitir la orden de cargue.");
      setNotice("Orden de cargue emitida en modo protegido.");
    } catch (cause) {
      setError(readError(cause));
    } finally {
      setEmitting(false);
    }
  }

  function updateRemesa(index: number, key: keyof RemesaDraft, value: string) {
    setRemesas((current) => current.map((remesa, position) => position === index ? { ...remesa, [key]: value } : remesa));
  }

  function removeRemesa(index: number) {
    const removed = remesas[index];
    if (removed?.remesaId) setRemovedRemesaIds((current) => [...current, removed.remesaId!]);
    setRemesas((current) => current.filter((_, position) => position !== index));
  }

  return (
    <form className="guided-dispatch-form" onSubmit={(event) => event.preventDefault()} ref={formRef}>
      <div className="guided-form-heading">
        <div>
          <span className="eyebrow">Nuevo despacho</span>
          <h2>{steps[step].label}</h2>
          <p>{step === 0 ? "Al continuar, la orden queda guardada y las demás etapas pueden completarse después." : steps[step].helper}</p>
        </div>
        <button className="ghost-button action-link" disabled={saving || !me} onClick={() => void saveCurrent("exit")} type="button">Guardar y salir</button>
      </div>

      {expedienteId ? <div className="inheritance-note" role="status"><span>✓</span><div><strong>Despacho {expedienteCode} guardado</strong><p>La orden ya existe. Puedes salir y continuar las otras etapas en cualquier momento.</p></div></div> : null}

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
            <Field label="Tipo de identificación" name="customerIdType" placeholder="NIT" required />
            <Field label="Identificación del cliente" name="customerId" required />
            <Field label="Código sede RNDC remitente" name="senderSiteCode" required />
            <Field label="Teléfono" name="customerPhone" type="tel" />
          </div>
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
          <div className="guided-section-grid section-divider">
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

        <section aria-labelledby="consignments-title" hidden={step !== 1}>
          <StageHeading id="consignments-title" number="02" title="Remesas" text="La ruta, remitente, destinatario y carga vienen de la orden. Cambia únicamente lo que sea diferente." />
          <div className="inheritance-note"><span>✓</span><div><strong>Datos reutilizados</strong><p>Remitente, sitios, citas, empaque, unidad y códigos de carga se copiarán desde la orden.</p></div></div>
          <div className="guided-remesas">
            {remesas.map((remesa, index) => (
              <fieldset className="guided-remesa-card" key={index}>
                <legend>Remesa {index + 1}</legend>
                <label className="form-field"><span>Clase de remesa</span><select onChange={(event) => updateRemesa(index, "consignmentClass", event.target.value)} value={remesa.consignmentClass}><option value="terrestre_carga">Terrestre de carga</option><option value="municipal">Municipal</option></select></label>
                <label className="form-field"><span>Valor declarado</span><input min="0" onChange={(event) => updateRemesa(index, "declaredValue", event.target.value)} type="number" value={remesa.declaredValue} /></label>
                <label className="form-field span-2"><span>Mercancía diferente <small>opcional</small></span><input onChange={(event) => updateRemesa(index, "description", event.target.value)} placeholder="Se usará la mercancía de la orden" value={remesa.description} /></label>
                <label className="form-field"><span>Peso diferente (TN) <small>opcional</small></span><input min="0" onChange={(event) => updateRemesa(index, "weightTons", event.target.value)} step="0.001" type="number" value={remesa.weightTons} /></label>
                <label className="form-field"><span>Destinatario diferente <small>opcional</small></span><input onChange={(event) => updateRemesa(index, "recipientName", event.target.value)} value={remesa.recipientName} /></label>
                <label className="form-field"><span>Identificación diferente</span><input onChange={(event) => updateRemesa(index, "recipientDocument", event.target.value)} value={remesa.recipientDocument} /></label>
                <label className="form-field"><span>Número de póliza</span><input onChange={(event) => updateRemesa(index, "policyNumber", event.target.value)} value={remesa.policyNumber} /></label>
                <label className="form-field"><span>Vencimiento de póliza</span><input onChange={(event) => updateRemesa(index, "policyExpiresOn", event.target.value)} type="date" value={remesa.policyExpiresOn} /></label>
                <label className="form-field"><span>NIT de la aseguradora</span><input onChange={(event) => updateRemesa(index, "insurerNit", event.target.value)} value={remesa.insurerNit} /></label>
                {remesas.length > 1 ? <button className="remove-remesa" onClick={() => removeRemesa(index)} type="button">Quitar remesa</button> : null}
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
            <Field label="Fecha de expedición" name="issueDate" onChange={(event) => setIssueDate(event.target.value)} type="date" value={issueDate} />
            <Field label="Entrega estimada" name="estimatedDeliveryDate" onChange={(event) => setEstimatedDeliveryDate(event.target.value)} type="date" value={estimatedDeliveryDate} />
            <label className="form-field"><span>Alcance de la operación</span><select name="operationScope"><option value="intermunicipal">Intermunicipal</option><option value="municipal">Municipal</option></select></label>
            <label className="form-field"><span>Tipo de manifiesto</span><select name="manifestType"><option value="general">General</option><option value="especial">Especial</option></select></label>
            <MoneyField label="Flete total" name="freightTotal" onChange={setFreightTotal} value={freightTotal} />
            <MoneyField label="Anticipo" name="advance" onChange={setAdvance} value={advance} />
            <MoneyField label="Retención en la fuente" name="withholdingSource" onChange={setWithholdingSource} value={withholdingSource} />
            <MoneyField label="ICA" name="withholdingIca" onChange={setWithholdingIca} value={withholdingIca} />
            <MoneyField label="FOPAT" name="fopat" onChange={setFopat} value={fopat} />
            <MoneyField label="Ajustes" name="adjustments" onChange={setAdjustments} value={adjustments} />
            <div className="net-payable"><span>Neto a pagar</span><strong>{new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(netPayable)}</strong></div>
            <Field label="Responsable de pago" name="paymentResponsible" onChange={(event) => setPaymentResponsible(event.target.value)} value={paymentResponsible} />
            <Field label="Responsable del cargue" name="loadingResponsible" />
            <Field label="Responsable del descargue" name="unloadingResponsible" />
            <Field label="Fecha de pago" name="paymentDate" type="date" />
            <label className="form-field span-2"><span>Observaciones del manifiesto</span><textarea name="manifestObservations" rows={3} /></label>
          </div>
        </section>

        <section aria-labelledby="review-title" hidden={step !== 4}>
          <StageHeading id="review-title" number="05" title="Revisión RNDC" text="Cada documento se guarda por separado. Puedes salir ahora o emitir solamente lo que esté listo." />
          <div className="review-mode-banner"><span>PRUEBA</span><div><strong>Modo de ejecución protegido</strong><p>Ninguna acción de este recorrido puede enviar tráfico RNDC real.</p></div></div>
          <div className="creation-review-grid">
            <ReviewItem label="Orden de cargue" value={expedienteId ? `Guardada en ${expedienteCode}` : "Pendiente de guardar"} warning={!expedienteId} />
            <ReviewItem label="Remesas" value={remesasSaved ? "Guardadas" : "Pendientes de completar"} warning={!remesasSaved} />
            <ReviewItem label="Vehículo" value={vehicle ? `${vehicle.plate} · ${vehicle.make ?? "Maestro verificado"}` : "Pendiente de completar"} warning={!vehicle} />
            <ReviewItem label="Conductor" value={driver ? `${driver.name ?? driver.document} · Maestro verificado` : "Pendiente de completar"} warning={!driver} />
            <ReviewItem label="Manifiesto" value={manifestSaved ? `Completo · Neto ${new Intl.NumberFormat("es-CO").format(netPayable)} COP` : "Pendiente de completar"} warning={!manifestSaved} />
            <ReviewItem label="Consecutivos" value="Cada número se asignará cuando se prepare ese documento" />
          </div>
          <div className="assignment-rule">
            <strong>Orden de cargue</strong>
            <p>{assignmentSaved ? "La orden y la asignación están listas para preparar y emitir." : "Para emitirla, completa primero el vehículo y el conductor."}</p>
            <button className="primary-action" disabled={!expedienteId || !driver || !vehicle || emitting} onClick={() => void emitLoadingOrder()} type="button">{emitting ? "Emitiendo orden…" : "Emitir orden de cargue"}</button>
          </div>
        </section>
      </div>

      {notice ? <div className="inheritance-note" role="status"><span>✓</span><div><strong>{notice}</strong></div></div> : null}
      {error ? <div className="form-error" role="alert" tabIndex={-1}>{error}</div> : null}
      <div className="guided-action-bar">
        <button className="ghost-button" disabled={step === 0 || saving} onClick={() => setStep((current) => Math.max(0, current - 1))} type="button">Anterior</button>
        <span>Paso {step + 1} de {steps.length}</span>
        <button
          className="primary-action"
          disabled={saving || !me}
          onClick={() => void saveCurrent(step === steps.length - 1 ? "open" : "continue")}
          type="button"
        >
          {saving ? "Guardando…" : step === steps.length - 1 ? "Abrir despacho" : "Continuar"}
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

function hasConsignmentInput(remesa: RemesaDraft): boolean {
  return Boolean(remesa.declaredValue.trim() || remesa.description.trim() || remesa.weightTons.trim() || remesa.recipientName.trim() || remesa.recipientDocument.trim() || remesa.policyNumber.trim() || remesa.policyExpiresOn.trim() || remesa.insurerNit.trim() || remesa.remesaId);
}

function consignmentDraft(data: FormData, remesa: RemesaDraft) {
  return {
    consignmentClass: remesa.consignmentClass,
    recipient: remesa.recipientName.trim() ? {
      name: remesa.recipientName.trim(),
      identificationNumber: remesa.recipientDocument.trim() || undefined
    } : undefined,
    declaredValue: remesa.declaredValue.trim() || undefined,
    policyNumber: remesa.policyNumber.trim() || undefined,
    policyExpiresOn: remesa.policyExpiresOn.trim() || undefined,
    insurerNit: remesa.insurerNit.trim() || undefined,
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
  };
}

function manifestDraft(data: FormData, values: {
  issueDate: string;
  estimatedDeliveryDate: string;
  paymentResponsible: string;
  advance: string;
  withholdingSource: string;
  withholdingIca: string;
  fopat: string;
  adjustments: string;
  netPayable: number;
}) {
  return {
    issueDate: values.issueDate || undefined,
    estimatedDeliveryDate: values.estimatedDeliveryDate || undefined,
    operationScope: (optionalText(data, "operationScope") ?? "intermunicipal") as "municipal" | "intermunicipal",
    manifestType: optionalText(data, "manifestType"),
    agencyCode: optionalText(data, "agencyCode"),
    originCityName: requiredText(data, "originCity"),
    originMunicipalityCode: optionalText(data, "originMunicipality"),
    destinationCityName: requiredText(data, "destinationCity"),
    destinationMunicipalityCode: optionalText(data, "destinationMunicipality"),
    freightTotal: optionalText(data, "freightTotal"),
    advance: values.advance,
    withholdingSource: values.withholdingSource,
    withholdingIca: values.withholdingIca,
    fopatContribution: values.fopat,
    adjustments: values.adjustments,
    netPayable: String(values.netPayable),
    paymentResponsible: values.paymentResponsible || undefined,
    loadingResponsible: optionalText(data, "loadingResponsible"),
    unloadingResponsible: optionalText(data, "unloadingResponsible"),
    paymentDate: optionalText(data, "paymentDate"),
    observations: optionalText(data, "manifestObservations")
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

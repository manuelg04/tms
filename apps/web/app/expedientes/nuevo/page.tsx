"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

type RemesaDraft = {
  number: string;
  description: string;
  weightKg: string;
  consigneeName: string;
  consigneeDocument: string;
};

const initialRemesa = (): RemesaDraft => ({
  number: "",
  description: "",
  weightKg: "",
  consigneeName: "",
  consigneeDocument: ""
});

export default function NuevoExpedientePage() {
  const router = useRouter();
  const me = useQuery(api.access.me, {});
  const [driverDocument, setDriverDocument] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [trailerPlate, setTrailerPlate] = useState("");
  const [remesas, setRemesas] = useState<RemesaDraft[]>([initialRemesa(), initialRemesa()]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const driver = useQuery(api.fleet.driverDetail, driverDocument.trim() ? { document: driverDocument.trim() } : "skip");
  const vehicle = useQuery(api.fleet.vehicleDetail, vehiclePlate.trim() ? { plate: vehiclePlate.trim().toUpperCase() } : "skip");
  const upsertCustomer = useMutation(api.masterData.upsertCustomer);
  const upsertLocation = useMutation(api.masterData.upsertCustomerLocation);
  const upsertOrder = useMutation(api.masterData.upsertServiceOrder);
  const upsertTrailer = useMutation(api.masterData.upsertTrailer);
  const createExpediente = useMutation(api.expedientes.create);
  const updateExpediente = useMutation(api.expedientes.update);
  const upsertRemesa = useMutation(api.expedientes.upsertRemesa);
  const recordCompliance = useMutation(api.expedientes.recordComplianceCheck);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!me) {
      setError("El usuario todavia no esta conectado al espacio de trabajo");
      return;
    }

    setSaving(true);
    setError("");
    const data = new FormData(event.currentTarget);

    try {
      const organizationId = me.organizationId;
      const customerId = await upsertCustomer({
        organizationId,
        code: requiredText(data, "customerCode"),
        name: requiredText(data, "customerName"),
        identificationType: optionalText(data, "customerIdType"),
        identificationNumber: optionalText(data, "customerId"),
        phone: optionalText(data, "customerPhone"),
        status: "active"
      });
      const loadingLocationId = await upsertLocation({
        customerId,
        code: `${requiredText(data, "customerCode")}-ORI`,
        name: requiredText(data, "originName"),
        kind: "loading",
        address: requiredText(data, "originAddress"),
        city: requiredText(data, "originCity"),
        municipalityCode: optionalText(data, "originMunicipality"),
        status: "active"
      });
      const unloadingLocationId = await upsertLocation({
        customerId,
        code: `${requiredText(data, "customerCode")}-DES`,
        name: requiredText(data, "destinationName"),
        kind: "unloading",
        address: requiredText(data, "destinationAddress"),
        city: requiredText(data, "destinationCity"),
        municipalityCode: optionalText(data, "destinationMunicipality"),
        status: "active"
      });
      const serviceOrderId = await upsertOrder({
        organizationId,
        code: requiredText(data, "orderCode"),
        customerId,
        loadingLocationId,
        unloadingLocationId,
        status: "confirmed",
        customerReference: optionalText(data, "customerReference"),
        cargoDescription: requiredText(data, "cargoDescription"),
        cargoQuantity: optionalNumber(data, "cargoQuantity"),
        cargoUnit: optionalText(data, "cargoUnit"),
        cargoWeightKg: optionalNumber(data, "cargoWeightKg"),
        agreedRate: requiredNumber(data, "agreedRate"),
        currency: "COP",
        scheduledLoadingAt: optionalDate(data, "scheduledLoadingAt"),
        scheduledUnloadingAt: optionalDate(data, "scheduledUnloadingAt"),
        notes: optionalText(data, "notes")
      });
      const expedienteId = await createExpediente({
        organizationId,
        serviceOrderId,
        code: requiredText(data, "expedienteCode"),
        notes: optionalText(data, "notes")
      });
      let trailerId;

      if (trailerPlate.trim()) {
        trailerId = await upsertTrailer({
          organizationId,
          plate: trailerPlate,
          trailerType: optionalText(data, "trailerType"),
          configuration: optionalText(data, "trailerConfiguration"),
          capacityKg: optionalNumber(data, "trailerCapacityKg"),
          status: "available"
        });
      }

      const assignmentReady = Boolean(driver && vehicle);
      await updateExpediente({
        expedienteId,
        status: assignmentReady ? "ready" : "draft",
        driverId: driver?._id,
        vehicleId: vehicle?._id,
        trailerId,
        manifestNumber: optionalText(data, "manifestNumber"),
        cargoNumber: optionalText(data, "cargoNumber"),
        tripNumber: optionalText(data, "tripNumber"),
        reason: assignmentReady ? "Asignacion inicial del expediente" : undefined
      });

      for (const [index, remesa] of remesas.entries()) {
        if (!remesa.description.trim()) {
          continue;
        }

        await upsertRemesa({
          expedienteId,
          sequence: index + 1,
          number: remesa.number.trim() || undefined,
          cargoDescription: remesa.description,
          cargoWeightKg: parseOptionalNumber(remesa.weightKg),
          cargoUnit: "kg",
          consigneeName: remesa.consigneeName.trim() || undefined,
          consigneeDocument: remesa.consigneeDocument.trim() || undefined
        });
      }

      const checks: Promise<unknown>[] = [];
      if (driver) {
        checks.push(recordCompliance({ expedienteId, subjectType: "driver", subjectId: driver._id, checkType: "registro_flota", status: "passed", details: "Conductor encontrado en el maestro local" }));
      }
      if (vehicle) {
        checks.push(recordCompliance({ expedienteId, subjectType: "vehicle", subjectId: vehicle._id, checkType: "registro_flota", status: "passed", details: "Vehiculo encontrado en el maestro local" }));
      }
      if (trailerId) {
        checks.push(recordCompliance({ expedienteId, subjectType: "trailer", subjectId: trailerId, checkType: "asignacion", status: "passed", details: "Remolque disponible al crear el expediente" }));
      }
      await Promise.all(checks);
      router.push(`/expedientes/${expedienteId}`);
    } catch (cause) {
      setError(readError(cause));
      setSaving(false);
    }
  }

  function updateRemesa(index: number, key: keyof RemesaDraft, value: string) {
    setRemesas((current) => current.map((remesa, position) => position === index ? { ...remesa, [key]: value } : remesa));
  }

  return (
    <form className="expediente-form" onSubmit={submit}>
      <div className="form-intro">
        <div>
          <span className="eyebrow">Fase operativa</span>
          <h2>Datos base del viaje</h2>
          <p>La informacion guardada aqui alimenta el expediente y evita volver a digitarla en cada documento.</p>
        </div>
        <Link className="ghost-button action-link" href="/expedientes">Cancelar</Link>
      </div>

      <section className="form-card">
        <div className="form-card-head"><span>01</span><div><h3>Orden y cliente</h3><p>Identificacion interna y acuerdo comercial.</p></div></div>
        <div className="expediente-form-grid">
          <FormField label="Codigo del expediente" name="expedienteCode" placeholder="EXP-2026-001" required />
          <FormField label="Orden de servicio" name="orderCode" placeholder="OS-2026-001" required />
          <FormField label="Referencia del cliente" name="customerReference" placeholder="Pedido o contrato" />
          <FormField label="Codigo del cliente" name="customerCode" placeholder="CLI-001" required />
          <FormField className="span-2" label="Nombre o razon social" name="customerName" required />
          <FormField label="Tipo de identificacion" name="customerIdType" placeholder="NIT" />
          <FormField label="Identificacion" name="customerId" />
          <FormField label="Telefono" name="customerPhone" type="tel" />
        </div>
      </section>

      <section className="form-card">
        <div className="form-card-head"><span>02</span><div><h3>Ruta y programacion</h3><p>Puntos pactados de cargue y descargue.</p></div></div>
        <div className="route-form-grid">
          <fieldset>
            <legend>Origen</legend>
            <FormField label="Nombre del punto" name="originName" required />
            <FormField label="Ciudad" name="originCity" required />
            <FormField label="Direccion" name="originAddress" required />
            <FormField label="Codigo municipio RNDC" name="originMunicipality" />
            <FormField label="Cita de cargue" name="scheduledLoadingAt" type="datetime-local" />
          </fieldset>
          <span className="route-connector" aria-hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 12h15M14 7l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          <fieldset>
            <legend>Destino</legend>
            <FormField label="Nombre del punto" name="destinationName" required />
            <FormField label="Ciudad" name="destinationCity" required />
            <FormField label="Direccion" name="destinationAddress" required />
            <FormField label="Codigo municipio RNDC" name="destinationMunicipality" />
            <FormField label="Cita de descargue" name="scheduledUnloadingAt" type="datetime-local" />
          </fieldset>
        </div>
      </section>

      <section className="form-card">
        <div className="form-card-head"><span>03</span><div><h3>Carga y tarifa</h3><p>Condiciones que dan origen a las remesas y al manifiesto.</p></div></div>
        <div className="expediente-form-grid">
          <FormField className="span-2" label="Descripcion de la carga" name="cargoDescription" required />
          <FormField label="Cantidad" name="cargoQuantity" type="number" />
          <FormField label="Unidad" name="cargoUnit" placeholder="kg, unidades, galones" />
          <FormField label="Peso total kg" name="cargoWeightKg" type="number" />
          <FormField label="Tarifa acordada COP" name="agreedRate" min="0" required type="number" />
          <FormField label="Orden de cargue RNDC" name="cargoNumber" />
          <FormField label="Numero de viaje RNDC" name="tripNumber" />
          <FormField label="Numero de manifiesto RNDC" name="manifestNumber" />
          <label className="form-field span-2"><span>Notas operativas</span><textarea name="notes" rows={3} /></label>
        </div>
      </section>

      <section className="form-card">
        <div className="form-card-head"><span>04</span><div><h3>Asignacion de flota</h3><p>La asignacion queda validada contra los maestros disponibles.</p></div></div>
        <div className="expediente-form-grid">
          <label className="form-field">
            <span>Documento del conductor</span>
            <input onChange={(event) => setDriverDocument(event.target.value)} value={driverDocument} />
            {driverDocument ? <small className={driver ? "lookup-hint ok" : "lookup-hint"}>{driver === undefined ? "Buscando…" : driver ? driver.name ?? driver.document : "No encontrado en maestros"}</small> : null}
          </label>
          <label className="form-field">
            <span>Placa del vehiculo</span>
            <input onChange={(event) => setVehiclePlate(event.target.value.toUpperCase())} value={vehiclePlate} />
            {vehiclePlate ? <small className={vehicle ? "lookup-hint ok" : "lookup-hint"}>{vehicle === undefined ? "Buscando…" : vehicle ? [vehicle.make, vehicle.line].filter(Boolean).join(" ") || vehicle.plate : "No encontrado en maestros"}</small> : null}
          </label>
          <label className="form-field"><span>Placa del remolque</span><input onChange={(event) => setTrailerPlate(event.target.value.toUpperCase())} value={trailerPlate} /></label>
          <FormField label="Tipo de remolque" name="trailerType" />
          <FormField label="Configuracion" name="trailerConfiguration" />
          <FormField label="Capacidad kg" name="trailerCapacityKg" type="number" />
        </div>
      </section>

      <section className="form-card">
        <div className="form-card-head remesa-card-head"><span>05</span><div><h3>Remesas</h3><p>Puedes preparar varias remesas bajo el mismo manifiesto.</p></div><button className="ghost-button" onClick={() => setRemesas((current) => [...current, initialRemesa()])} type="button">Agregar remesa</button></div>
        <div className="remesa-drafts">
          {remesas.map((remesa, index) => (
            <fieldset className="remesa-draft" key={index}>
              <legend>Remesa {index + 1}</legend>
              <label className="form-field"><span>Numero</span><input onChange={(event) => updateRemesa(index, "number", event.target.value)} value={remesa.number} /></label>
              <label className="form-field span-2"><span>Descripcion de carga</span><input onChange={(event) => updateRemesa(index, "description", event.target.value)} value={remesa.description} /></label>
              <label className="form-field"><span>Peso kg</span><input min="0" onChange={(event) => updateRemesa(index, "weightKg", event.target.value)} type="number" value={remesa.weightKg} /></label>
              <label className="form-field"><span>Destinatario</span><input onChange={(event) => updateRemesa(index, "consigneeName", event.target.value)} value={remesa.consigneeName} /></label>
              <label className="form-field"><span>Identificacion destinatario</span><input onChange={(event) => updateRemesa(index, "consigneeDocument", event.target.value)} value={remesa.consigneeDocument} /></label>
              {remesas.length > 1 ? <button className="remove-remesa" aria-label={`Eliminar remesa ${index + 1}`} onClick={() => setRemesas((current) => current.filter((_, position) => position !== index))} type="button">Eliminar</button> : null}
            </fieldset>
          ))}
        </div>
      </section>

      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <div className="form-submit-bar">
        <span>{driver && vehicle ? "La flota esta lista para asignarse." : "Puedes guardar el borrador y completar la flota despues."}</span>
        <button className="primary-action" disabled={saving || !me} type="submit">{saving ? "Guardando expediente…" : "Guardar expediente"}</button>
      </div>
    </form>
  );
}

function FormField({ className = "", label, name, ...props }: { className?: string; label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <label className={`form-field ${className}`}><span>{label}</span><input name={name} {...props} /></label>;
}

function requiredText(data: FormData, key: string): string {
  const value = String(data.get(key) ?? "").trim();
  if (!value) {
    throw new Error(`Falta completar ${key}`);
  }
  return value;
}

function optionalText(data: FormData, key: string): string | undefined {
  const value = String(data.get(key) ?? "").trim();
  return value || undefined;
}

function requiredNumber(data: FormData, key: string): number {
  const value = Number(requiredText(data, key));
  if (!Number.isFinite(value)) {
    throw new Error(`El valor de ${key} no es valido`);
  }
  return value;
}

function optionalNumber(data: FormData, key: string): number | undefined {
  return parseOptionalNumber(String(data.get(key) ?? ""));
}

function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalDate(data: FormData, key: string): number | undefined {
  const value = optionalText(data, key);
  if (!value) {
    return undefined;
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function readError(cause: unknown): string {
  return cause instanceof Error ? cause.message.replace(/^.*?: /, "") : "No fue posible guardar el expediente";
}

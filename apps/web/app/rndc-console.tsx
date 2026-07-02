"use client";

import { useState } from "react";

type Operation = "loading-order" | "remesa" | "manifest" | "driver-vehicle";

type Field = {
  path: string;
  label: string;
  code?: string;
  type?: "text" | "number" | "select" | "textarea";
  options?: { value: string; label: string }[];
};

type FieldSection = {
  title: string;
  fields: Field[];
};

type OperationConfig = {
  id: Operation;
  label: string;
  title: string;
  action: string;
  processIds: string;
  sections: FieldSection[];
};

type FormResult = {
  ok: boolean;
  operation: Operation;
  mode: string;
  runDirectory: string;
  evidencePath: string;
  numbers: {
    loadingOrder: string;
    trip: string;
    remesa: string;
    manifest: string;
    plate: string;
    driverId: string;
    ownerId: string;
    holderId: string;
  };
  documents: { kind: string; number: string; urlPath: string; path: string }[];
  steps: {
    name: string;
    title: string;
    procesoId: number;
    accepted: boolean;
    status: number;
    radicado?: string;
    errorText?: string;
    requestPath: string;
    responsePath: string;
  }[];
  convexSync?: { synced: boolean; reason?: string };
};

const idTypeOptions = [
  { value: "C", label: "Cedula" },
  { value: "N", label: "NIT" },
  { value: "E", label: "Extranjeria" },
  { value: "P", label: "Pasaporte" }
];

const apiBase = process.env.NEXT_PUBLIC_RNDC_API_URL ?? "http://localhost:3017";

const initialForm = {
  seed: "421960041464",
  cargoNumber: "000044579",
  tripNumber: "IV42196",
  remesaNumber: "42196",
  manifestNumber: "0041464",
  expeditionDate: "22/06/2026",
  loadingAppointmentDate: "22/06/2026",
  loadingAppointmentTime: "11:02",
  unloadingAppointmentDate: "25/06/2026",
  unloadingAppointmentTime: "12:06",
  balancePaymentDate: "30/06/2026",
  observations: "CARGAMENTO ENTREGADO EN BUEN ESTADO Y COMPLETO",
  driver: {
    idType: "C",
    id: "80756632",
    firstName: "LUIS GERMAN",
    firstLastName: "FONSECA",
    secondLastName: "GUTIERREZ",
    fullName: "FONSECA GUTIERREZ LUIS GERMAN",
    phone: "3118980752",
    address: "CALLE 19 22 - 26",
    cityName: "PAIPA - Boyaca",
    cityCode: "15516000",
    licenseCategory: "C3",
    licenseNumber: "80756632",
    licenseExpirationDate: "23/06/2028"
  },
  vehicleOwner: {
    idType: "C",
    id: "74322799",
    firstName: "GONZALO",
    firstLastName: "FONSECA",
    secondLastName: "",
    fullName: "FONSECA GONZALO",
    phone: "7852586",
    address: "CL 19 22 - 26",
    cityName: "PAIPA - Boyaca",
    cityCode: "15516000"
  },
  vehicleHolder: {
    idType: "C",
    id: "74322799",
    firstName: "GONZALO",
    firstLastName: "FONSECA",
    secondLastName: "",
    fullName: "FONSECA GONZALO",
    phone: "7852586",
    address: "CL 19 22 - 26",
    cityName: "PAIPA - Boyaca",
    cityCode: "15516000"
  },
  sender: {
    idType: "N",
    id: "9002266843",
    siteCode: "0",
    siteName: "LANDAZURI",
    name: "C.I BULKTRADIN - LANDAZURI",
    address: "LANDAZURI",
    cityName: "LANDAZURI",
    cityCode: "68385000",
    latitude: "6.316071",
    longitude: "-73.949992"
  },
  recipient: {
    idType: "N",
    id: "9002266843",
    siteCode: "1",
    siteName: "MINGUEO",
    name: "C.I BULKTRADIN-MINGUEO",
    address: "MINGUEO",
    cityName: "MINGUEO",
    cityCode: "44090003",
    latitude: "11.2171951",
    longitude: "-73.3983323"
  },
  vehicle: {
    plate: "JVK276",
    trailerPlate: "R41537",
    brand: "FREIGHTLINER",
    configuration: "3S2",
    rndcConfigurationCode: "55",
    lineCode: "373",
    colorCode: "1",
    modelYear: "2020",
    emptyWeightKg: 7000,
    capacityKg: 34000,
    soatNumber: "4356454300",
    soatExpirationDate: "23/03/2027",
    insurerNit: "8110191907"
  },
  cargo: {
    productName: "CARBON",
    shortDescription: "CARBON",
    merchandiseCode: "002803",
    packageName: "Granel Solido",
    packageCode: "10",
    nature: "Carga Normal",
    natureCode: "1",
    quantityKg: 34000,
    declaredValue: 40000000
  },
  money: {
    freightValue: 4760000,
    advanceValue: 3808000,
    sourceRetention: 0,
    icaRetention: 0,
    icaRetentionPerMille: 3,
    fopatRetention: 4760
  }
};

type FormState = typeof initialForm;

const numberFields: Field[] = [
  { path: "cargoNumber", label: "Orden de cargue", code: "CONSECUTIVOINFORMACIONCARGA" },
  { path: "remesaNumber", label: "Remesa", code: "CONSECUTIVOREMESA" },
  { path: "tripNumber", label: "Viaje", code: "CONSECUTIVOINFORMACIONVIAJE" },
  { path: "manifestNumber", label: "Manifiesto", code: "NUMMANIFIESTOCARGA" }
];

const dateFields: Field[] = [
  { path: "expeditionDate", label: "Fecha expedicion", code: "FECHAEXPEDICIONMANIFIESTO" },
  { path: "loadingAppointmentDate", label: "Fecha cita cargue", code: "FECHACITAPACTADACARGUE" },
  { path: "loadingAppointmentTime", label: "Hora cita cargue", code: "HORACITAPACTADACARGUE" },
  { path: "unloadingAppointmentDate", label: "Fecha cita descargue", code: "FECHACITAPACTADADESCARGUE" },
  { path: "unloadingAppointmentTime", label: "Hora cita descargue", code: "HORACITAPACTADADESCARGUEREMESA" }
];

const routeFields: Field[] = [
  { path: "sender.name", label: "Remitente", code: "NUMIDREMITENTE" },
  { path: "sender.id", label: "Identificacion remitente" },
  { path: "sender.siteCode", label: "Sede remitente", code: "CODSEDEREMITENTE" },
  { path: "sender.cityName", label: "Municipio cargue" },
  { path: "sender.cityCode", label: "Codigo municipio cargue", code: "CODMUNICIPIOORIGENINFOVIAJE" },
  { path: "recipient.name", label: "Destinatario", code: "NUMIDDESTINATARIO" },
  { path: "recipient.id", label: "Identificacion destinatario" },
  { path: "recipient.siteCode", label: "Sede destinatario", code: "CODSEDEDESTINATARIO" },
  { path: "recipient.cityName", label: "Municipio descargue" },
  { path: "recipient.cityCode", label: "Codigo municipio descargue", code: "CODMUNICIPIODESTINOINFOVIAJE" }
];

const cargoFields: Field[] = [
  { path: "cargo.productName", label: "Producto" },
  { path: "cargo.shortDescription", label: "Descripcion corta", code: "DESCRIPCIONCORTAPRODUCTO" },
  { path: "cargo.merchandiseCode", label: "Codigo mercancia", code: "MERCANCIAINFORMACIONCARGA" },
  { path: "cargo.packageName", label: "Empaque" },
  { path: "cargo.packageCode", label: "Codigo empaque", code: "CODTIPOEMPAQUE" },
  { path: "cargo.natureCode", label: "Codigo naturaleza", code: "CODNATURALEZACARGA" },
  { path: "cargo.quantityKg", label: "Cantidad kg", code: "CANTIDADINFORMACIONCARGA", type: "number" },
  { path: "cargo.declaredValue", label: "Valor declarado", type: "number" }
];

const vehicleFields: Field[] = [
  { path: "vehicle.plate", label: "Placa", code: "NUMPLACA" },
  { path: "vehicle.trailerPlate", label: "Remolque", code: "NUMPLACAREMOLQUE" },
  { path: "vehicle.brand", label: "Marca" },
  { path: "vehicle.configuration", label: "Configuracion" },
  { path: "vehicle.rndcConfigurationCode", label: "Codigo configuracion", code: "CODCONFIGURACIONUNIDADCARGA" },
  { path: "vehicle.modelYear", label: "Modelo" },
  { path: "vehicle.capacityKg", label: "Capacidad kg", code: "CAPACIDADUNIDADCARGA", type: "number" },
  { path: "vehicle.emptyWeightKg", label: "Peso vacio kg", code: "PESOVEHICULOVACIO", type: "number" },
  { path: "vehicle.soatNumber", label: "SOAT", code: "NUMSEGUROSOAT" },
  { path: "vehicle.soatExpirationDate", label: "Vence SOAT", code: "FECHAVENCIMIENTOSOAT" },
  { path: "vehicle.insurerNit", label: "NIT aseguradora", code: "NUMNITASEGURADORASOAT" }
];

const driverFields: Field[] = [
  { path: "driver.idType", label: "Tipo ID conductor", code: "CODIDCONDUCTOR", type: "select", options: idTypeOptions },
  { path: "driver.id", label: "ID conductor", code: "NUMIDCONDUCTOR" },
  { path: "driver.firstName", label: "Nombres", code: "NOMIDTERCERO" },
  { path: "driver.firstLastName", label: "Primer apellido", code: "PRIMERAPELLIDOIDTERCERO" },
  { path: "driver.secondLastName", label: "Segundo apellido" },
  { path: "driver.fullName", label: "Nombre impreso" },
  { path: "driver.phone", label: "Telefono" },
  { path: "driver.cityCode", label: "Codigo municipio" },
  { path: "driver.licenseCategory", label: "Categoria licencia", code: "CODCATEGORIALICENCIACONDUCCION" },
  { path: "driver.licenseNumber", label: "Numero licencia", code: "NUMLICENCIACONDUCCION" },
  { path: "driver.licenseExpirationDate", label: "Vence licencia", code: "FECHAVENCIMIENTOLICENCIA" }
];

const ownerFields: Field[] = [
  { path: "vehicleOwner.idType", label: "Tipo ID propietario", code: "CODTIPOIDPROPIETARIO", type: "select", options: idTypeOptions },
  { path: "vehicleOwner.id", label: "ID propietario", code: "NUMIDPROPIETARIO" },
  { path: "vehicleOwner.firstName", label: "Nombres" },
  { path: "vehicleOwner.firstLastName", label: "Primer apellido" },
  { path: "vehicleOwner.fullName", label: "Nombre impreso" },
  { path: "vehicleOwner.phone", label: "Telefono" },
  { path: "vehicleOwner.cityCode", label: "Codigo municipio" }
];

const holderFields: Field[] = [
  { path: "vehicleHolder.idType", label: "Tipo ID tenedor", code: "CODTIPOIDTENEDOR", type: "select", options: idTypeOptions },
  { path: "vehicleHolder.id", label: "ID tenedor", code: "NUMIDTENEDOR" },
  { path: "vehicleHolder.firstName", label: "Nombres" },
  { path: "vehicleHolder.firstLastName", label: "Primer apellido" },
  { path: "vehicleHolder.fullName", label: "Titular manifiesto", code: "NUMIDTITULARMANIFIESTO" },
  { path: "vehicleHolder.phone", label: "Telefono" },
  { path: "vehicleHolder.cityCode", label: "Codigo municipio" }
];

const moneyFields: Field[] = [
  { path: "money.freightValue", label: "Flete pactado", code: "VALORFLETEPACTADOVIAJE", type: "number" },
  { path: "money.advanceValue", label: "Anticipo", code: "VALORANTICIPOMANIFIESTO", type: "number" },
  { path: "money.sourceRetention", label: "Retencion fuente ($)", type: "number" },
  { path: "money.icaRetention", label: "Retencion ICA ($)", type: "number" },
  { path: "money.icaRetentionPerMille", label: "Retencion ICA (por mil)", code: "RETENCIONICAMANIFIESTOCARGA", type: "number" },
  { path: "money.fopatRetention", label: "Retencion FOPAT", code: "RETENCIONFOPAT", type: "number" },
  { path: "balancePaymentDate", label: "Fecha pago saldo", code: "FECHAPAGOSALDOMANIFIESTO" }
];

const allFields: Field[] = [
  ...numberFields,
  ...dateFields,
  ...routeFields,
  ...cargoFields,
  ...vehicleFields,
  ...driverFields,
  ...ownerFields,
  ...holderFields,
  ...moneyFields
];

function field(path: string): Field {
  const found = allFields.find((item) => item.path === path);

  if (!found) {
    throw new Error(`Unknown form field: ${path}`);
  }

  return found;
}

const observationsField: Field = { path: "observations", label: "Observaciones", code: "OBSERVACIONES", type: "textarea" };

const operations: OperationConfig[] = [
  {
    id: "loading-order",
    label: "Orden",
    title: "Orden de cargue",
    action: "Registrar orden",
    processIds: "Proceso 1",
    sections: [
      { title: "Documento", fields: [field("cargoNumber"), ...dateFields] },
      { title: "Carga", fields: cargoFields },
      { title: "Ruta", fields: routeFields },
      { title: "Vehiculo y conductor", fields: [field("vehicle.plate"), field("vehicle.trailerPlate"), field("vehicle.brand"), field("vehicle.modelYear"), field("driver.id"), field("driver.fullName"), field("driver.phone")] },
      { title: "Observaciones", fields: [observationsField] }
    ]
  },
  {
    id: "remesa",
    label: "Remesa",
    title: "Remesa terrestre de carga",
    action: "Expedir remesa",
    processIds: "Proceso 3",
    sections: [
      { title: "Documento", fields: [field("remesaNumber"), field("cargoNumber"), field("loadingAppointmentDate"), field("loadingAppointmentTime"), field("unloadingAppointmentDate"), field("unloadingAppointmentTime")] },
      { title: "Carga y seguro", fields: [...cargoFields, field("vehicle.soatNumber"), field("vehicle.soatExpirationDate"), field("vehicle.insurerNit")] },
      { title: "Remitente y destinatario", fields: routeFields },
      { title: "Observaciones", fields: [observationsField] }
    ]
  },
  {
    id: "manifest",
    label: "Manifiesto",
    title: "Manifiesto de carga",
    action: "Expedir manifiesto",
    processIds: "Procesos 2 y 4",
    sections: [
      { title: "Documento", fields: [field("manifestNumber"), field("tripNumber"), field("remesaNumber"), field("cargoNumber"), field("expeditionDate"), field("balancePaymentDate")] },
      { title: "Vehiculo y conductor", fields: [field("vehicle.plate"), field("vehicle.trailerPlate"), field("vehicle.brand"), field("vehicle.configuration"), field("vehicle.rndcConfigurationCode"), field("driver.idType"), field("driver.id"), field("driver.fullName"), field("vehicleHolder.idType"), field("vehicleHolder.id"), field("vehicleHolder.fullName")] },
      { title: "Ruta y valores", fields: [field("sender.cityName"), field("sender.cityCode"), field("recipient.cityName"), field("recipient.cityCode"), field("money.freightValue"), field("money.advanceValue"), field("money.sourceRetention"), field("money.icaRetention"), field("money.icaRetentionPerMille"), field("money.fopatRetention")] },
      { title: "Observaciones", fields: [observationsField] }
    ]
  },
  {
    id: "driver-vehicle",
    label: "Conductor",
    title: "Conductor y vehiculo",
    action: "Registrar conductor y vehiculo",
    processIds: "Procesos 11 y 12",
    sections: [
      { title: "Conductor", fields: driverFields },
      { title: "Propietario", fields: ownerFields },
      { title: "Tenedor", fields: holderFields },
      { title: "Vehiculo", fields: vehicleFields }
    ]
  }
];

export function RndcConsole() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [active, setActive] = useState<Operation>("loading-order");
  const [result, setResult] = useState<FormResult | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const activeOperation = operations.find((operation) => operation.id === active) ?? operations[0];
  const documentLinks = result?.documents ?? [];

  async function submitForm() {
    setPending(true);
    setError("");

    try {
      const response = await fetch(`${apiBase}/rndc/forms/${activeOperation.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const body = await response.json() as FormResult | { error?: string; missingFields?: string[] };

      if (!("steps" in body)) {
        setResult(null);
        const missing = "missingFields" in body && body.missingFields?.length ? ` Campos faltantes: ${body.missingFields.join(", ")}` : "";
        setError((body.error ?? "No se pudo completar la operacion RNDC.") + missing);
        return;
      }

      setResult(body);

      if (!body.ok) {
        setError(body.steps.find((step) => step.errorText)?.errorText ?? "RNDC rechazo la operacion.");
      }
    } catch {
      setResult(null);
      setError("No hay conexion con el servicio RNDC local.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="panel-head" style={{ border: "none", padding: 0 }}>
        <div className="ops-tabs" role="tablist" aria-label="Tipo de operacion">
          {operations.map((operation) => (
            <button
              aria-selected={active === operation.id}
              className={active === operation.id ? "ops-tab active" : "ops-tab"}
              key={operation.id}
              onClick={() => setActive(operation.id)}
              role="tab"
              type="button"
            >
              {operation.label}
            </button>
          ))}
        </div>
        <button className="primary-action" disabled={pending} onClick={submitForm} type="button">
          {pending ? "Enviando…" : activeOperation.action}
        </button>
      </div>

      <div className="ops-layout">
        <form className="form-panel" onSubmit={(event) => { event.preventDefault(); void submitForm(); }}>
          {activeOperation.sections.map((section) => (
            <fieldset className="field-section" key={section.title}>
              <legend>{section.title}</legend>
              <div className="field-grid">
                {section.fields.map((field) => (
                  <FieldControl
                    field={field}
                    key={field.path}
                    onChange={(value) => setForm((current) => setPath(current, field.path, value))}
                    value={readPath(form, field.path)}
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </form>

        <aside className="result-panel" aria-live="polite">
          <div className={result?.ok ? "status-card success" : error ? "status-card danger" : "status-card"}>
            <span className="eyebrow">Estado del envio</span>
            <br />
            <strong className="status-word">
              {result?.ok ? "Aceptado por RNDC" : error ? "Revisar" : "Sin envio"}
            </strong>
            {!result && !error ? (
              <p className="error-text" style={{ color: "var(--ink-soft)" }}>
                {activeOperation.processIds} · {form.sender.cityName} → {form.recipient.cityName}
              </p>
            ) : null}
            {error ? <p className="error-text">{error}</p> : null}
          </div>

          {result ? (
            <div className="panel">
              <div className="panel-head">
                <h2>Pasos RNDC</h2>
                <span className="plate-chip">{form.vehicle.plate}</span>
              </div>
              <div className="step-list">
                {result.steps.map((step) => (
                  <div className={step.accepted ? "step-row ok" : "step-row fail"} key={`${step.name}-${step.procesoId}`}>
                    <div className="step-name">
                      <strong>{step.title}</strong>
                      <span>proceso {step.procesoId}</span>
                    </div>
                    <em>{step.radicado ?? step.errorText ?? "sin radicado"}</em>
                  </div>
                ))}
              </div>

              {documentLinks.length > 0 ? (
                <div className="documents-row">
                  {documentLinks.map((document) => (
                    <a
                      className="pdf-link"
                      href={`${apiBase}${document.urlPath}`}
                      key={`${document.kind}-${document.number}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      PDF {document.number}
                    </a>
                  ))}
                </div>
              ) : null}

              <p className={result.convexSync?.synced ? "sync-note ok" : "sync-note"}>
                {result.convexSync?.synced
                  ? "Registrado en el panel."
                  : `No quedo registrado en el panel: ${result.convexSync?.reason ?? "sin conexion con Convex"}`}
              </p>

              <code className="evidence">{result.evidencePath}</code>
            </div>
          ) : null}
        </aside>
      </div>
    </>
  );
}

function FieldControl({ field, value, onChange }: { field: Field; value: string; onChange: (value: string) => void }) {
  return (
    <label className={field.type === "textarea" ? "field wide" : "field"}>
      <span>
        {field.label}
        {field.code ? <small title={field.code}>{field.code}</small> : null}
      </span>
      {field.type === "select" ? (
        <select onChange={(event) => onChange(event.target.value)} value={value}>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      ) : field.type === "textarea" ? (
        <textarea onChange={(event) => onChange(event.target.value)} rows={4} value={value} />
      ) : (
        <input inputMode={field.type === "number" ? "decimal" : "text"} onChange={(event) => onChange(event.target.value)} type={field.type ?? "text"} value={value} />
      )}
    </label>
  );
}

function readPath(source: Record<string, unknown>, path: string): string {
  let current: unknown = source;

  for (const part of path.split(".")) {
    if (!isRecord(current)) {
      return "";
    }

    current = current[part];
  }

  return current === undefined || current === null ? "" : String(current);
}

function setPath(source: FormState, path: string, value: string): FormState {
  const next = structuredClone(source) as FormState;
  const parts = path.split(".");
  let current: Record<string, unknown> = next;

  for (const part of parts.slice(0, -1)) {
    const child = current[part];

    if (!isRecord(child)) {
      current[part] = {};
    }

    current = current[part] as Record<string, unknown>;
  }

  current[parts.at(-1) ?? path] = value;
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

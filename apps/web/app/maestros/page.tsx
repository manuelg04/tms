"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { formatTimestamp } from "../lib/labels";

type Tab = "conductores" | "vehiculos" | "terceros";
type Creator = "conductor" | "vehiculo" | "tercero";

type DriverRow = {
  _id: string;
  document: string;
  name?: string;
  phone?: string;
  vehicleCount: number;
  updatedAt: number;
};

type VehicleRow = {
  _id: string;
  plate: string;
  ownerDocument?: string;
  ownerName?: string;
  possessorDocument?: string;
  possessorName?: string;
  driverCount: number;
  updatedAt: number;
};

type ThirdPartyRow = {
  _id: string;
  document: string;
  documentType: string;
  name: string;
  phone?: string;
  roles: Array<"owner" | "possessor" | "holder" | "sender" | "recipient" | "other">;
  updatedAt: number;
};

type DriverDetail = {
  _id: string;
  document: string;
  documentType?: string;
  name?: string;
  status?: string;
  birthDate?: string;
  sex?: string;
  bloodType?: string;
  address?: string;
  city?: string;
  phone1?: string;
  phone2?: string;
  cellphone?: string;
  licenseNumber?: string;
  licenseCategory?: string;
  licenseExpiresAt?: string;
  eps?: string;
  arp?: string;
  pensionFund?: string;
  hazmatCourse?: string;
  hazmatCourseExpiresAt?: string;
  observations?: string;
  updatedAt: number;
  vehicles: {
    vehiclePlate: string;
    make?: string;
    line?: string;
    modelYear?: string;
    roles?: string[];
  }[];
};

type VehicleDetail = {
  _id: string;
  plate: string;
  make?: string;
  line?: string;
  modelYear?: string;
  color?: string;
  bodyType?: string;
  configuration?: string;
  trailer?: string;
  linkType?: string;
  capacityTn?: string;
  emptyWeightTn?: string;
  ownerDocument?: string;
  ownerName?: string;
  ownerCellphone?: string;
  ownerPhone?: string;
  possessorDocument?: string;
  possessorName?: string;
  possessorCellphone?: string;
  possessorPhone?: string;
  updatedAt: number;
  drivers: {
    driverDocument: string;
    name?: string;
    roles?: string[];
  }[];
};

export default function MaestrosPage() {
  const [tab, setTab] = useState<Tab>("conductores");
  const [selectedDocument, setSelectedDocument] = useState<string | null>(null);
  const [selectedPlate, setSelectedPlate] = useState<string | null>(null);
  const [documentFilter, setDocumentFilter] = useState("");
  const [plateFilter, setPlateFilter] = useState("");
  const [thirdPartyFilter, setThirdPartyFilter] = useState("");
  const [creator, setCreator] = useState<Creator | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad" | "wait"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const upsertDriver = useMutation(api.fleet.upsertDriver);
  const upsertVehicle = useMutation(api.fleet.upsertVehicle);
  const upsertThirdParty = useMutation(api.fleet.upsertThirdParty);
  const documentSearchPrefix = documentFilter.trim();
  const plateSearchPrefix = plateFilter.trim();
  const thirdPartySearch = thirdPartyFilter.trim().toLocaleLowerCase("es");
  const activeFilter = tab === "conductores" ? documentSearchPrefix : tab === "vehiculos" ? plateSearchPrefix : thirdPartySearch;
  const isFiltering = activeFilter !== "";
  const {
    results: drivers,
    status: driversStatus,
    loadMore: loadMoreDrivers
  } = usePaginatedQuery(
    api.fleet.driversPage,
    tab === "conductores" && documentSearchPrefix === "" ? {} : "skip",
    { initialNumItems: 25 }
  );
  const {
    results: vehicles,
    status: vehiclesStatus,
    loadMore: loadMoreVehicles
  } = usePaginatedQuery(
    api.fleet.vehiclesPage,
    tab === "vehiculos" && plateSearchPrefix === "" ? {} : "skip",
    { initialNumItems: 25 }
  );
  const driverSearchResults = useQuery(
    api.fleet.driversSearch,
    tab === "conductores" && documentSearchPrefix !== "" ? { prefix: documentSearchPrefix } : "skip"
  );
  const vehicleSearchResults = useQuery(
    api.fleet.vehiclesSearch,
    tab === "vehiculos" && plateSearchPrefix !== "" ? { prefix: plateSearchPrefix } : "skip"
  );
  const thirdParties = useQuery(api.fleet.listThirdParties, tab === "terceros" ? {} : "skip") as ThirdPartyRow[] | undefined;
  const visibleThirdParties = (thirdParties ?? []).filter((party) => thirdPartySearch === "" || party.document.toLocaleLowerCase("es").includes(thirdPartySearch) || party.name.toLocaleLowerCase("es").includes(thirdPartySearch));
  const pageStatus = tab === "conductores" ? driversStatus : tab === "vehiculos" ? vehiclesStatus : "Exhausted";
  const selectedDriver = useQuery(
    api.fleet.driverDetail,
    tab === "conductores" && selectedDocument ? { document: selectedDocument } : "skip"
  );
  const selectedVehicle = useQuery(
    api.fleet.vehicleDetail,
    tab === "vehiculos" && selectedPlate ? { plate: selectedPlate } : "skip"
  );

  function selectTab(nextTab: Tab) {
    setTab(nextTab);
    setSelectedDocument(null);
    setSelectedPlate(null);
    setDocumentFilter("");
    setPlateFilter("");
    setThirdPartyFilter("");
  }

  async function saveMaster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!creator) return;
    const form = event.currentTarget;
    setSaving(true);
    setNotice({ tone: "wait", text: "Guardando el maestro…" });
    const data = new FormData(form);
    try {
      if (creator === "conductor") {
        await upsertDriver({ input: {
          documentType: required(data, "documentType"),
          document: required(data, "document"),
          name: required(data, "name"),
          address: required(data, "address"),
          cityCode: required(data, "cityCode"),
          cellphone: required(data, "phone"),
          licenseCategory: required(data, "licenseCategory"),
          licenseNumber: required(data, "licenseNumber"),
          licenseExpiresAt: required(data, "licenseExpiresAt")
        } });
        setTab("conductores");
        setNotice({ tone: "ok", text: "Conductor guardado. Quedó disponible para asignarlo a un vehículo o despacho." });
      } else if (creator === "tercero") {
        await upsertThirdParty({ input: partyInput(data, required(data, "role") as "owner" | "possessor" | "holder" | "sender" | "recipient" | "other") });
        setTab("terceros");
        setNotice({ tone: "ok", text: "Tercero guardado y disponible para reutilizarlo como propietario, poseedor u otro rol." });
      } else {
        const owner = partyInput(data, "owner", "owner");
        const possessor = partyInput(data, "possessor", "possessor");
        await upsertThirdParty({ input: owner });
        await upsertThirdParty({ input: possessor });
        const driverDocument = required(data, "driverDocument");
        const plate = required(data, "plate").toUpperCase();
        await upsertVehicle({
          driverDocument,
          input: {
            plate,
            make: value(data, "make"),
            line: required(data, "line"),
            modelYear: required(data, "modelYear"),
            color: required(data, "color"),
            configuration: required(data, "configuration"),
            capacityTn: required(data, "capacityTn"),
            emptyWeightTn: required(data, "emptyWeightTn"),
            ownerDocument: owner.document,
            ownerName: owner.name,
            ownerCellphone: owner.phone,
            possessorDocument: possessor.document,
            possessorName: possessor.name,
            possessorCellphone: possessor.phone,
            insurerNit: required(data, "insurerNit"),
            soatExpiresAt: required(data, "soatExpiresAt"),
            soatNumber: required(data, "soatNumber")
          }
        });
        const response = await fetch("/api/rndc/masters/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ driverDocument, vehiclePlate: plate }) });
        const result = await response.json() as { error?: string; evidenceStored?: boolean };
        if (!response.ok || result.evidenceStored !== true) throw new Error(result.error ?? "El maestro quedó guardado, pero la simulación RNDC no terminó con evidencia.");
        setTab("vehiculos");
        setNotice({ tone: "ok", text: "Vehículo, conductor, propietario y poseedor quedaron guardados y la preparación RNDC terminó en modo de prueba." });
      }
      form.reset();
      setCreator(null);
    } catch (error) {
      setNotice({ tone: "bad", text: readable(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="master-create-panel">
        <div><span className="eyebrow">Administración operativa</span><h2>Crear y actualizar maestros</h2><p>Registra cada dato una sola vez. Los despachos lo reutilizan y el envío RNDC permanece protegido.</p></div>
        <div className="master-create-actions"><button className="ghost-button" onClick={() => setCreator("conductor")} type="button">Nuevo conductor</button><button className="ghost-button" onClick={() => setCreator("vehiculo")} type="button">Nuevo vehículo</button><button className="ghost-button" onClick={() => setCreator("tercero")} type="button">Nuevo tercero</button></div>
      </section>
      {notice ? <div className={`operation-notice ${notice.tone}`} role="status"><span />{notice.text}<button aria-label="Cerrar aviso" onClick={() => setNotice(null)} type="button">×</button></div> : null}
      {creator ? <MasterForm creator={creator} onCancel={() => setCreator(null)} onSubmit={saveMaster} saving={saving} /> : null}
      <div className="filters" role="group" aria-label="Maestros de flota">
        <button
          aria-pressed={tab === "conductores"}
          className={tab === "conductores" ? "ops-tab active" : "ops-tab"}
          onClick={() => selectTab("conductores")}
          type="button"
        >
          Conductores
        </button>
        <button
          aria-pressed={tab === "vehiculos"}
          className={tab === "vehiculos" ? "ops-tab active" : "ops-tab"}
          onClick={() => selectTab("vehiculos")}
          type="button"
        >
          Vehiculos
        </button>
        <button
          aria-pressed={tab === "terceros"}
          className={tab === "terceros" ? "ops-tab active" : "ops-tab"}
          onClick={() => selectTab("terceros")}
          type="button"
        >
          Terceros
        </button>
        {tab === "conductores" ? (
          <input
            aria-label="Filtrar conductores por documento"
            className="filter-input"
            onChange={(event) => setDocumentFilter(event.target.value)}
            placeholder="Filtrar por documento"
            type="search"
            value={documentFilter}
          />
        ) : tab === "vehiculos" ? (
          <input
            aria-label="Filtrar vehiculos por placa"
            className="filter-input"
            onChange={(event) => setPlateFilter(event.target.value)}
            placeholder="Filtrar por placa"
            type="search"
            value={plateFilter}
          />
        ) : (
          <input
            aria-label="Filtrar terceros por identificación o nombre"
            className="filter-input"
            onChange={(event) => setThirdPartyFilter(event.target.value)}
            placeholder="Filtrar por identificación o nombre"
            type="search"
            value={thirdPartyFilter}
          />
        )}
      </div>

      {tab === "conductores" && selectedDocument ? (
        <DriverDetailPanel
          detail={selectedDriver as DriverDetail | null | undefined}
          document={selectedDocument}
          onClose={() => setSelectedDocument(null)}
        />
      ) : null}

      {tab === "vehiculos" && selectedPlate ? (
        <VehicleDetailPanel
          detail={selectedVehicle as VehicleDetail | null | undefined}
          onClose={() => setSelectedPlate(null)}
          plate={selectedPlate}
        />
      ) : null}

      <section className="panel" aria-label={tab === "conductores" ? "Listado de conductores" : tab === "vehiculos" ? "Listado de vehiculos" : "Listado de terceros"}>
        {tab === "conductores" ? (
          isFiltering && driverSearchResults === undefined ? (
            <div className="skeleton">Cargando…</div>
          ) : !isFiltering && pageStatus === "LoadingFirstPage" ? (
            <div className="skeleton">Cargando…</div>
          ) : (
            <DriversTable
              onSelect={(document) => setSelectedDocument((current) => (current === document ? null : document))}
              rows={isFiltering ? ((driverSearchResults ?? []) as DriverRow[]) : drivers}
              selectedDocument={selectedDocument}
            />
          )
        ) : tab === "vehiculos" && isFiltering && vehicleSearchResults === undefined ? (
          <div className="skeleton">Cargando…</div>
        ) : tab === "vehiculos" && !isFiltering && pageStatus === "LoadingFirstPage" ? (
          <div className="skeleton">Cargando…</div>
        ) : tab === "vehiculos" ? (
          <VehiclesTable
            onSelect={(plate) => setSelectedPlate((current) => (current === plate ? null : plate))}
            rows={isFiltering ? ((vehicleSearchResults ?? []) as VehicleRow[]) : vehicles}
            selectedPlate={selectedPlate}
          />
        ) : thirdParties === undefined ? (
          <div className="skeleton">Cargando…</div>
        ) : (
          <ThirdPartiesTable rows={visibleThirdParties} />
        )}
      </section>

      {!isFiltering && (pageStatus === "CanLoadMore" || pageStatus === "LoadingMore") ? (
        <button
          className="load-more"
          disabled={pageStatus === "LoadingMore"}
          onClick={() => (tab === "conductores" ? loadMoreDrivers(25) : loadMoreVehicles(25))}
          type="button"
        >
          {pageStatus === "LoadingMore" ? "Cargando…" : "Cargar mas"}
        </button>
      ) : null}
    </>
  );
}

function MasterForm({ creator, onCancel, onSubmit, saving }: { creator: Creator; onCancel: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; saving: boolean }) {
  return <section className="panel master-form-panel" aria-labelledby="master-form-title"><div className="panel-head"><div><span className="eyebrow">Nuevo registro</span><h2 id="master-form-title">{creator === "conductor" ? "Conductor" : creator === "vehiculo" ? "Vehículo y responsables" : "Tercero"}</h2></div><button className="text-button" onClick={onCancel} type="button">Cerrar</button></div><form className="modal-form master-form" onSubmit={onSubmit}>
    {creator === "conductor" ? <DriverFields /> : creator === "vehiculo" ? <VehicleFields /> : <ThirdPartyFields />}
    <div className="modal-actions wide"><button className="ghost-button" onClick={onCancel} type="button">Cancelar</button><button className="primary-action" disabled={saving} type="submit">{saving ? "Guardando…" : creator === "vehiculo" ? "Guardar y simular RNDC" : "Guardar maestro"}</button></div>
  </form></section>;
}

function DriverFields() {
  return <><label><span>Tipo de identificación</span><select defaultValue="C" name="documentType"><option value="C">Cédula</option><option value="E">Cédula de extranjería</option><option value="P">Pasaporte</option></select></label><label><span>Documento</span><input name="document" required /></label><label className="wide"><span>Nombre completo</span><input name="name" required /></label><label><span>Teléfono</span><input name="phone" required /></label><label><span>Código DANE del municipio</span><input name="cityCode" required /></label><label className="wide"><span>Dirección</span><input name="address" required /></label><label><span>Categoría de licencia</span><input name="licenseCategory" placeholder="C2" required /></label><label><span>Número de licencia</span><input name="licenseNumber" required /></label><label><span>Vencimiento de licencia</span><input name="licenseExpiresAt" required type="date" /></label></>;
}

function ThirdPartyFields() {
  return <><label><span>Rol principal</span><select defaultValue="owner" name="role"><option value="owner">Propietario</option><option value="possessor">Poseedor</option><option value="holder">Tenedor</option><option value="sender">Remitente</option><option value="recipient">Destinatario</option><option value="other">Otro tercero</option></select></label><PartyFields /></>;
}

function VehicleFields() {
  return <><div className="master-form-section wide"><strong>Vehículo</strong><p>Datos técnicos y de seguro que usará el RNDC.</p></div><label><span>Placa</span><input name="plate" required /></label><label><span>Marca</span><input name="make" /></label><label><span>Código de línea RNDC</span><input name="line" required /></label><label><span>Modelo</span><input inputMode="numeric" name="modelYear" required /></label><label><span>Configuración RNDC</span><input name="configuration" placeholder="2" required /></label><label><span>Código de color RNDC</span><input name="color" placeholder="1" required /></label><label><span>Peso vacío (TN)</span><input inputMode="decimal" name="emptyWeightTn" required /></label><label><span>Capacidad (TN)</span><input inputMode="decimal" name="capacityTn" required /></label><label><span>NIT aseguradora SOAT</span><input name="insurerNit" required /></label><label><span>Número SOAT</span><input name="soatNumber" required /></label><label><span>Vencimiento SOAT</span><input name="soatExpiresAt" required type="date" /></label><label><span>Documento conductor</span><input name="driverDocument" required /></label><div className="master-form-section wide"><strong>Propietario</strong><p>Puede ser la misma persona que el poseedor.</p></div><PartyFields prefix="owner" /><div className="master-form-section wide"><strong>Poseedor o tenedor</strong><p>Titular operativo que aparecerá en el manifiesto.</p></div><PartyFields prefix="possessor" /></>;
}

function PartyFields({ prefix }: { prefix?: string }) {
  const key = (name: string) => prefix ? `${prefix}_${name}` : name;
  return <><label><span>Tipo de identificación</span><select defaultValue="C" name={key("documentType")}><option value="C">Cédula</option><option value="N">NIT</option><option value="E">Cédula de extranjería</option><option value="P">Pasaporte</option></select></label><label><span>Identificación</span><input name={key("document")} required /></label><label className="wide"><span>Nombre o razón social</span><input name={key("name")} required /></label><label><span>Teléfono</span><input name={key("phone")} required /></label><label><span>Código DANE del municipio</span><input name={key("cityCode")} required /></label><label className="wide"><span>Dirección</span><input name={key("address")} required /></label></>;
}

function partyInput(data: FormData, role: "owner" | "possessor" | "holder" | "sender" | "recipient" | "other", prefix?: string) {
  const key = (name: string) => prefix ? `${prefix}_${name}` : name;
  return { documentType: required(data, key("documentType")), document: required(data, key("document")), name: required(data, key("name")), phone: required(data, key("phone")), address: required(data, key("address")), cityCode: required(data, key("cityCode")), roles: [role] };
}

function required(data: FormData, key: string): string {
  const result = data.get(key)?.toString().trim();
  if (!result) throw new Error(`Completa ${key.replaceAll("_", " ")}.`);
  return result;
}

function value(data: FormData, key: string): string | undefined {
  return data.get(key)?.toString().trim() || undefined;
}

function readable(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const match = /message:\s*"([^"]+)"/.exec(message);
  return match?.[1] ?? message.replace(/^.*?: /, "");
}

function DriverDetailPanel({
  detail,
  document,
  onClose
}: {
  detail: DriverDetail | null | undefined;
  document: string;
  onClose: () => void;
}) {
  const title = detail && detail.name && detail.name.trim() !== "" ? detail.name : document;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <button className="text-button" onClick={onClose} type="button">
          Cerrar
        </button>
      </div>
      {detail === undefined ? (
        <div className="skeleton">Cargando detalle…</div>
      ) : detail === null ? (
        <div className="empty-state">No encontrado</div>
      ) : (
        <div className="detail-body">
          <div className="field-grid">
            <ReadOnlyField label="Documento">{documentLabel(detail.document, detail.documentType)}</ReadOnlyField>
            <ReadOnlyField label="Nombre">{valueOrDash(detail.name)}</ReadOnlyField>
            <ReadOnlyField label="Estado">{valueOrDash(detail.status)}</ReadOnlyField>
            <ReadOnlyField label="Ciudad">{valueOrDash(detail.city)}</ReadOnlyField>
            <ReadOnlyField label="Dirección" wide>
              {valueOrDash(detail.address)}
            </ReadOnlyField>
            <ReadOnlyField label="Teléfonos">{valuesLabel([detail.phone1, detail.phone2, detail.cellphone])}</ReadOnlyField>
            <ReadOnlyField label="Licencia">{valuesLabel([detail.licenseNumber, detail.licenseCategory])}</ReadOnlyField>
            <ReadOnlyField label="Vence licencia">{valueOrDash(detail.licenseExpiresAt)}</ReadOnlyField>
            <ReadOnlyField label="EPS">{valueOrDash(detail.eps)}</ReadOnlyField>
            <ReadOnlyField label="ARP">{valueOrDash(detail.arp)}</ReadOnlyField>
            <ReadOnlyField label="Fondo pensión">{valueOrDash(detail.pensionFund)}</ReadOnlyField>
            <ReadOnlyField label="Tipo sangre">{valueOrDash(detail.bloodType)}</ReadOnlyField>
            <ReadOnlyField label="Curso mercancías peligrosas">
              {valuesLabel([detail.hazmatCourse, detail.hazmatCourseExpiresAt])}
            </ReadOnlyField>
            {detail.observations && detail.observations.trim() !== "" ? (
              <ReadOnlyField label="Observaciones" wide>
                {detail.observations}
              </ReadOnlyField>
            ) : null}
            <ReadOnlyField label="Actualizado">{formatTimestamp(detail.updatedAt)}</ReadOnlyField>
            <ReadOnlyField label="Vehículos asociados" wide>
              <RelatedVehicles vehicles={detail.vehicles} />
            </ReadOnlyField>
          </div>
        </div>
      )}
    </section>
  );
}

function VehicleDetailPanel({
  detail,
  onClose,
  plate
}: {
  detail: VehicleDetail | null | undefined;
  onClose: () => void;
  plate: string;
}) {
  const title = detail ? detail.plate : plate;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <button className="text-button" onClick={onClose} type="button">
          Cerrar
        </button>
      </div>
      {detail === undefined ? (
        <div className="skeleton">Cargando detalle…</div>
      ) : detail === null ? (
        <div className="empty-state">No encontrado</div>
      ) : (
        <div className="detail-body">
          <div className="field-grid">
            <ReadOnlyField label="Placa">{detail.plate}</ReadOnlyField>
            <ReadOnlyField label="Marca/Línea">{valuesLabel([detail.make, detail.line])}</ReadOnlyField>
            <ReadOnlyField label="Modelo">{valueOrDash(detail.modelYear)}</ReadOnlyField>
            <ReadOnlyField label="Color">{valueOrDash(detail.color)}</ReadOnlyField>
            <ReadOnlyField label="Carrocería">{valueOrDash(detail.bodyType)}</ReadOnlyField>
            <ReadOnlyField label="Configuración">{valueOrDash(detail.configuration)}</ReadOnlyField>
            <ReadOnlyField label="Remolque">{valueOrDash(detail.trailer)}</ReadOnlyField>
            <ReadOnlyField label="Tipo vínculo">{valueOrDash(detail.linkType)}</ReadOnlyField>
            <ReadOnlyField label="Capacidad (tn)">{valueOrDash(detail.capacityTn)}</ReadOnlyField>
            <ReadOnlyField label="Peso vacío (tn)">{valueOrDash(detail.emptyWeightTn)}</ReadOnlyField>
            <ReadOnlyField label="Propietario">
              {partyDetail(detail.ownerName, detail.ownerDocument, [detail.ownerCellphone, detail.ownerPhone])}
            </ReadOnlyField>
            <ReadOnlyField label="Poseedor">
              {partyDetail(detail.possessorName, detail.possessorDocument, [
                detail.possessorCellphone,
                detail.possessorPhone
              ])}
            </ReadOnlyField>
            <ReadOnlyField label="Actualizado">{formatTimestamp(detail.updatedAt)}</ReadOnlyField>
            <ReadOnlyField label="Conductores asociados" wide>
              <RelatedDrivers drivers={detail.drivers} />
            </ReadOnlyField>
          </div>
        </div>
      )}
    </section>
  );
}

function DriversTable({
  onSelect,
  rows,
  selectedDocument
}: {
  onSelect: (document: string) => void;
  rows: DriverRow[];
  selectedDocument: string | null;
}) {
  if (rows.length === 0) {
    return <div className="empty-state">Sin registros</div>;
  }

  return (
    <>
      <div className="table-wrap master-desktop-table">
        <table className="doc-table">
        <thead>
          <tr>
            <th>Documento</th>
            <th>Nombre</th>
            <th>Teléfono</th>
            <th>Vehículos</th>
            <th>Actualizado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              aria-selected={selectedDocument === row.document}
              className={selectedDocument === row.document ? "row-click row-selected" : "row-click"}
              key={row._id}
              onClick={() => onSelect(row.document)}
            >
              <td>
                <span className="radicado">{row.document}</span>
              </td>
              <td>{valueOrDash(row.name)}</td>
              <td>{valueOrDash(row.phone)}</td>
              <td>{row.vehicleCount}</td>
              <td className="cell-date">{formatTimestamp(row.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
      <div className="master-mobile-list">
        {rows.map((row) => (
          <button className={selectedDocument === row.document ? "master-mobile-card selected" : "master-mobile-card"} key={row._id} onClick={() => onSelect(row.document)} type="button">
            <span className="master-mobile-heading"><span className="radicado">{row.document}</span><small>{formatTimestamp(row.updatedAt)}</small></span>
            <strong>{valueOrDash(row.name)}</strong>
            <span>{valueOrDash(row.phone)} · {row.vehicleCount} vehículo{row.vehicleCount === 1 ? "" : "s"}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function VehiclesTable({
  onSelect,
  rows,
  selectedPlate
}: {
  onSelect: (plate: string) => void;
  rows: VehicleRow[];
  selectedPlate: string | null;
}) {
  if (rows.length === 0) {
    return <div className="empty-state">Sin registros</div>;
  }

  return (
    <>
      <div className="table-wrap master-desktop-table">
        <table className="doc-table">
        <thead>
          <tr>
            <th>Placa</th>
            <th>Propietario</th>
            <th>Poseedor</th>
            <th>Conductores</th>
            <th>Actualizado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              aria-selected={selectedPlate === row.plate}
              className={selectedPlate === row.plate ? "row-click row-selected" : "row-click"}
              key={row._id}
              onClick={() => onSelect(row.plate)}
            >
              <td>
                <span className="plate-chip">{row.plate}</span>
              </td>
              <td>{partyLabel(row.ownerName, row.ownerDocument)}</td>
              <td>{partyLabel(row.possessorName, row.possessorDocument)}</td>
              <td>{row.driverCount}</td>
              <td className="cell-date">{formatTimestamp(row.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
      <div className="master-mobile-list">
        {rows.map((row) => (
          <button className={selectedPlate === row.plate ? "master-mobile-card selected" : "master-mobile-card"} key={row._id} onClick={() => onSelect(row.plate)} type="button">
            <span className="master-mobile-heading"><span className="plate-chip">{row.plate}</span><small>{formatTimestamp(row.updatedAt)}</small></span>
            <strong>{partyLabel(row.ownerName, row.ownerDocument)}</strong>
            <span>Poseedor: {valuesLabel([row.possessorName, row.possessorDocument])}</span>
            <span>{row.driverCount} conductor{row.driverCount === 1 ? "" : "es"}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function ThirdPartiesTable({ rows }: { rows: ThirdPartyRow[] }) {
  if (rows.length === 0) {
    return <div className="empty-state">Sin registros</div>;
  }

  return (
    <>
      <div className="table-wrap master-desktop-table">
        <table className="doc-table">
          <thead><tr><th>Identificación</th><th>Nombre</th><th>Roles</th><th>Teléfono</th><th>Actualizado</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row._id}><td><span className="radicado">{row.document}</span><small className="table-subline">{row.documentType}</small></td><td>{row.name}</td><td>{rolesLabel(row.roles)}</td><td>{valueOrDash(row.phone)}</td><td className="cell-date">{formatTimestamp(row.updatedAt)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="master-mobile-list">
        {rows.map((row) => <article className="master-mobile-card static" key={row._id}><span className="master-mobile-heading"><span className="radicado">{row.document}</span><small>{formatTimestamp(row.updatedAt)}</small></span><strong>{row.name}</strong><span>{rolesLabel(row.roles)} · {valueOrDash(row.phone)}</span></article>)}
      </div>
    </>
  );
}

function ReadOnlyField({ children, label, wide }: { children: ReactNode; label: string; wide?: boolean }) {
  return (
    <div className={wide ? "field wide" : "field"}>
      <span>{label}</span>
      <div className="field-value">{children}</div>
    </div>
  );
}

function valueOrDash(value: string | undefined) {
  return value && value.trim() !== "" ? value : "—";
}

function valuesLabel(values: Array<string | undefined>) {
  const parts = values.map((value) => value?.trim()).filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function rolesLabel(roles: ThirdPartyRow["roles"]) {
  const labels = { owner: "Propietario", possessor: "Poseedor", holder: "Tenedor", sender: "Remitente", recipient: "Destinatario", other: "Otro" };
  return roles.map((role) => labels[role]).join(" · ");
}

function documentLabel(document: string, documentType: string | undefined) {
  const type = documentType?.trim();
  return type ? `${document} (${type})` : document;
}

function partyDetail(name: string | undefined, document: string | undefined, phones: Array<string | undefined>) {
  const title = valuesLabel([name, document]);
  const phoneLabel = valuesLabel(phones);

  if (title === "—" && phoneLabel === "—") {
    return "—";
  }

  return (
    <span className="doc-kind">
      {title}
      <small>{phoneLabel}</small>
    </span>
  );
}

function partyLabel(name: string | undefined, document: string | undefined): ReactNode {
  const hasName = name && name.trim() !== "";
  const hasDocument = document && document.trim() !== "";

  if (!hasName && !hasDocument) {
    return "—";
  }

  return (
    <span className="doc-kind">
      {hasName ? name : "—"}
      <small>{hasDocument ? document : "—"}</small>
    </span>
  );
}

function RelatedVehicles({ vehicles }: { vehicles: DriverDetail["vehicles"] }) {
  if (vehicles.length === 0) {
    return "—";
  }

  return (
    <div className="related-list">
      {vehicles.map((vehicle) => (
        <span className="related-item" key={vehicle.vehiclePlate}>
          <span className="plate-chip">{vehicle.vehiclePlate}</span>
          <small>{valuesLabel([vehicle.make, vehicle.line, vehicle.modelYear])}</small>
        </span>
      ))}
    </div>
  );
}

function RelatedDrivers({ drivers }: { drivers: VehicleDetail["drivers"] }) {
  if (drivers.length === 0) {
    return "—";
  }

  return (
    <div className="related-list">
      {drivers.map((driver) => (
        <span className="related-item" key={driver.driverDocument}>
          <span className="radicado">{driver.driverDocument}</span>
          <small>{valueOrDash(driver.name)}</small>
        </span>
      ))}
    </div>
  );
}

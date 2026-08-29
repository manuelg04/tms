"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { formatTimestamp } from "../lib/labels";

type Tab = "conductores" | "vehiculos" | "remolques" | "terceros";

const PAGE_SIZE = 50;

function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (value === "") {
      setDebounced("");
      return;
    }
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}
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
  vehicleKind?: string;
  status?: string;
  configuration?: string;
  soatExpiresAt?: string;
  driverCount: number;
  updatedAt: number;
};

type ThirdPartyRow = {
  _id: string;
  document: string;
  documentType: string;
  name: string;
  phone?: string;
  roles: ThirdPartyRole[];
  city?: string;
  siteCount?: number;
  updatedAt: number;
};

type TrailerRow = {
  _id: string;
  plate: string;
  trailerType?: string;
  make?: string;
  modelYear?: string;
  configuration?: string;
  capacityKg?: number;
  emptyWeightKg?: number;
  ownerName?: string;
  status: string;
  updatedAt: number;
};

type TrailerDetail = TrailerRow & {
  linkedVehicleId?: string;
  emptyWeightKg?: number;
  widthM?: number;
  heightM?: number;
  lengthM?: number;
  rearVolumeM3?: number;
  ownerDocumentType?: string;
  ownerDocument?: string;
  bodyType?: string;
  procedureType?: string;
  chassisSerial?: string;
  color?: string;
  observations?: string;
  attachments: Array<{ slot: string; fileName: string; contentType: string; size: number; url: string | null }>;
};

type ThirdPartyRole = "driver" | "owner" | "possessor" | "holder" | "sender" | "recipient" | "insured" | "insurance_company" | "transport_company" | "legal_representative" | "commercial" | "consignee" | "employee" | "logistics_operator" | "fiscal_reviewer" | "other";

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
  insurerNit?: string;
  insurerName?: string;
  soatExpiresAt?: string;
  soatNumber?: string;
  vehicleKind?: string;
  status?: string;
  configurationLabel?: string;
  lineName?: string;
  fuelType?: string;
  axles?: string;
  ownerDocumentType?: string;
  possessorDocumentType?: string;
  rndcRegisteredAt?: string;
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
  const [selectedTrailerPlate, setSelectedTrailerPlate] = useState<string | null>(null);
  const [documentFilter, setDocumentFilter] = useState("");
  const [plateFilter, setPlateFilter] = useState("");
  const [trailerFilter, setTrailerFilter] = useState("");
  const [thirdPartyFilter, setThirdPartyFilter] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const linkDriverVehicle = useMutation(api.fleet.linkDriverVehicle);
  const unlinkDriverVehicle = useMutation(api.fleet.unlinkDriverVehicle);
  async function runLink(action: () => Promise<null>, success: string) {
    try {
      await action();
      setNotice({ tone: "ok", text: success });
    } catch (error) {
      setNotice({ tone: "bad", text: readable(error) });
      throw error;
    }
  }
  const documentSearchPrefix = useDebounced(documentFilter.trim(), 250);
  const plateSearchPrefix = useDebounced(plateFilter.trim().toUpperCase(), 250);
  const trailerSearchPrefix = useDebounced(trailerFilter.trim().toUpperCase(), 250);
  const thirdPartySearchPrefix = useDebounced(thirdPartyFilter.trim(), 250);
  const activeFilter = tab === "conductores" ? documentSearchPrefix : tab === "vehiculos" ? plateSearchPrefix : tab === "remolques" ? trailerSearchPrefix : thirdPartySearchPrefix;
  const isFiltering = activeFilter !== "";
  const driversPage = usePaginatedQuery(api.fleet.driversPage, tab === "conductores" ? { prefix: documentSearchPrefix || undefined } : "skip", { initialNumItems: PAGE_SIZE });
  const vehiclesPage = usePaginatedQuery(api.fleet.vehiclesPage, tab === "vehiculos" ? { prefix: plateSearchPrefix || undefined } : "skip", { initialNumItems: PAGE_SIZE });
  const trailersPage = usePaginatedQuery(api.fleet.trailersPage, tab === "remolques" ? { prefix: trailerSearchPrefix || undefined } : "skip", { initialNumItems: PAGE_SIZE });
  const thirdPartiesPage = usePaginatedQuery(api.fleet.thirdPartiesPage, tab === "terceros" ? { prefix: thirdPartySearchPrefix || undefined } : "skip", { initialNumItems: PAGE_SIZE });
  const drivers = driversPage.results as DriverRow[];
  const vehicles = vehiclesPage.results as VehicleRow[];
  const trailers = trailersPage.results as TrailerRow[];
  const thirdParties = thirdPartiesPage.results as ThirdPartyRow[];
  const activePage = tab === "conductores" ? driversPage : tab === "vehiculos" ? vehiclesPage : tab === "remolques" ? trailersPage : thirdPartiesPage;
  const pageStatus = activePage.status;
  const loadedCount = activePage.results.length;
  const selectedDriver = useQuery(
    api.fleet.driverDetail,
    tab === "conductores" && selectedDocument ? { document: selectedDocument } : "skip"
  );
  const selectedVehicle = useQuery(
    api.fleet.vehicleDetail,
    tab === "vehiculos" && selectedPlate ? { plate: selectedPlate } : "skip"
  );
  const selectedTrailer = useQuery(
    api.fleet.trailerDetail,
    tab === "remolques" && selectedTrailerPlate ? { plate: selectedTrailerPlate } : "skip"
  );

  function selectTab(nextTab: Tab) {
    setTab(nextTab);
    setSelectedDocument(null);
    setSelectedPlate(null);
    setSelectedTrailerPlate(null);
    setDocumentFilter("");
    setPlateFilter("");
    setTrailerFilter("");
    setThirdPartyFilter("");
  }

  return (
    <>
      <section className="master-create-panel">
        <div><span className="eyebrow">Administración operativa</span><h2>Crear y consultar maestros</h2><p>Registra cada recurso una sola vez para reutilizarlo de forma segura en la operación.</p></div>
        <div className="master-create-actions">
          <Link className="ghost-button" href="/maestros/nuevo/conductor">Registrar conductor</Link>
          <Link className="ghost-button" href="/maestros/nuevo/tercero">Registrar tercero</Link>
          <Link className="ghost-button" href="/maestros/nuevo/remolque">Registrar remolque</Link>
          <Link className="primary-action" href="/maestros/nuevo/vehiculo">Registrar vehículo</Link>
        </div>
      </section>
      {notice ? <div className={`operation-notice ${notice.tone}`} role="status"><span />{notice.text}<button aria-label="Cerrar aviso" onClick={() => setNotice(null)} type="button">×</button></div> : null}
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
          Vehículos
        </button>
        <button
          aria-pressed={tab === "remolques"}
          className={tab === "remolques" ? "ops-tab active" : "ops-tab"}
          onClick={() => selectTab("remolques")}
          type="button"
        >
          Remolques
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
        ) : tab === "remolques" ? (
          <input
            aria-label="Filtrar remolques por placa"
            className="filter-input"
            onChange={(event) => setTrailerFilter(event.target.value)}
            placeholder="Filtrar por placa"
            type="search"
            value={trailerFilter}
          />
        ) : (
          <input
            aria-label="Filtrar terceros por identificación"
            className="filter-input"
            onChange={(event) => setThirdPartyFilter(event.target.value)}
            placeholder="Filtrar por identificación"
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
          onLink={(plate) => runLink(() => linkDriverVehicle({ plate, document: selectedDocument }), `Vehículo ${plate.toUpperCase()} asociado al conductor.`)}
          onUnlink={(plate) => runLink(() => unlinkDriverVehicle({ plate, document: selectedDocument }), `Vehículo ${plate} desasociado del conductor.`)}
        />
      ) : null}

      {tab === "vehiculos" && selectedPlate ? (
        <VehicleDetailPanel
          detail={selectedVehicle as VehicleDetail | null | undefined}
          onClose={() => setSelectedPlate(null)}
          onLink={(document) => runLink(() => linkDriverVehicle({ plate: selectedPlate, document }), `Conductor ${document} asociado al vehículo.`)}
          onUnlink={(document) => runLink(() => unlinkDriverVehicle({ plate: selectedPlate, document }), `Conductor ${document} desasociado del vehículo.`)}
          plate={selectedPlate}
        />
      ) : null}

      {tab === "remolques" && selectedTrailerPlate ? (
        <TrailerDetailPanel detail={selectedTrailer as TrailerDetail | null | undefined} onClose={() => setSelectedTrailerPlate(null)} plate={selectedTrailerPlate} />
      ) : null}

      <section className="panel" aria-label={tab === "conductores" ? "Listado de conductores" : tab === "vehiculos" ? "Listado de vehículos" : tab === "remolques" ? "Listado de remolques" : "Listado de terceros"}>
        {pageStatus === "LoadingFirstPage" ? (
          <div className="skeleton">Cargando…</div>
        ) : tab === "conductores" ? (
          <DriversTable
            onSelect={(document) => setSelectedDocument((current) => (current === document ? null : document))}
            rows={drivers}
            selectedDocument={selectedDocument}
          />
        ) : tab === "vehiculos" ? (
          <VehiclesTable
            onSelect={(plate) => setSelectedPlate((current) => (current === plate ? null : plate))}
            rows={vehicles}
            selectedPlate={selectedPlate}
          />
        ) : tab === "remolques" ? (
          <TrailersTable onSelect={(plate) => setSelectedTrailerPlate((current) => current === plate ? null : plate)} rows={trailers} selectedPlate={selectedTrailerPlate} />
        ) : (
          <ThirdPartiesTable rows={thirdParties} />
        )}
      </section>

      {pageStatus !== "LoadingFirstPage" ? (
        <div className="load-more-bar">
          <span className="load-more-count">
            {loadedCount === 0 ? (isFiltering ? `Sin resultados para “${activeFilter}”` : "Sin registros") : `${loadedCount} ${loadedCount === 1 ? "registro" : "registros"}${pageStatus === "Exhausted" ? "" : " cargados"}${isFiltering ? ` · filtro “${activeFilter}”` : ""}`}
          </span>
          {pageStatus === "CanLoadMore" || pageStatus === "LoadingMore" ? (
            <button
              className="load-more"
              disabled={pageStatus === "LoadingMore"}
              onClick={() => activePage.loadMore(PAGE_SIZE)}
              type="button"
            >
              {pageStatus === "LoadingMore" ? "Cargando…" : `Cargar ${PAGE_SIZE} más`}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function readable(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const match = /message:\s*"([^"]+)"/.exec(message);
  return match?.[1] ?? message.replace(/^.*?: /, "");
}

function DriverDetailPanel({
  detail,
  document,
  onClose,
  onLink,
  onUnlink
}: {
  detail: DriverDetail | null | undefined;
  document: string;
  onClose: () => void;
  onLink: (plate: string) => Promise<void>;
  onUnlink: (plate: string) => Promise<void>;
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
              <RelatedVehicles onUnlink={onUnlink} vehicles={detail.vehicles} />
              <LinkEditor label="Asociar vehículo por placa" onLink={onLink} placeholder="Placa" uppercase />
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
  onLink,
  onUnlink,
  plate
}: {
  detail: VehicleDetail | null | undefined;
  onClose: () => void;
  onLink: (document: string) => Promise<void>;
  onUnlink: (document: string) => Promise<void>;
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
            <ReadOnlyField label="Tipo">{vehicleKindLabel(detail.vehicleKind, detail.configuration)}</ReadOnlyField>
            <ReadOnlyField label="Estado">{vehicleStatusLabel(detail.status, detail.soatExpiresAt)}</ReadOnlyField>
            <ReadOnlyField label="Marca/Línea">{valuesLabel([detail.make, detail.lineName ?? detail.line])}</ReadOnlyField>
            <ReadOnlyField label="Modelo">{valueOrDash(detail.modelYear)}</ReadOnlyField>
            <ReadOnlyField label="Color">{valueOrDash(detail.color)}</ReadOnlyField>
            <ReadOnlyField label="Carrocería">{valueOrDash(detail.bodyType)}</ReadOnlyField>
            <ReadOnlyField label="Configuración">{valueOrDash(detail.configurationLabel ?? detail.configuration)}</ReadOnlyField>
            <ReadOnlyField label="Ejes / Combustible">{valuesLabel([detail.axles, detail.fuelType])}</ReadOnlyField>
            <ReadOnlyField label="SOAT">{soatDetail(detail)}</ReadOnlyField>
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
            <ReadOnlyField label="Registrado en RNDC">{valueOrDash(detail.rndcRegisteredAt)}</ReadOnlyField>
            <ReadOnlyField label="Actualizado">{formatTimestamp(detail.updatedAt)}</ReadOnlyField>
            <ReadOnlyField label="Conductores asociados" wide>
              <RelatedDrivers drivers={detail.drivers} onUnlink={onUnlink} />
              <LinkEditor label="Asociar conductor por documento" onLink={onLink} placeholder="Documento del conductor" />
            </ReadOnlyField>
          </div>
        </div>
      )}
    </section>
  );
}

function TrailerDetailPanel({ detail, onClose, plate }: { detail: TrailerDetail | null | undefined; onClose: () => void; plate: string }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Remolque {plate}</h2>
        <button className="text-button" onClick={onClose} type="button">Cerrar</button>
      </div>
      {detail === undefined ? <div className="skeleton">Cargando detalle…</div> : detail === null ? <div className="empty-state">No encontrado</div> : (
        <div className="detail-body">
          <div className="field-grid">
            <ReadOnlyField label="Placa"><span className="plate-chip">{detail.plate}</span></ReadOnlyField>
            <ReadOnlyField label="Estado">{trailerStatusLabel(detail.status)}</ReadOnlyField>
            <ReadOnlyField label="Tipo">{valueOrDash(detail.trailerType)}</ReadOnlyField>
            <ReadOnlyField label="Marca y modelo">{valuesLabel([detail.make, detail.modelYear])}</ReadOnlyField>
            <ReadOnlyField label="Configuración">{valueOrDash(detail.configuration)}</ReadOnlyField>
            <ReadOnlyField label="Carrocería">{valueOrDash(detail.bodyType)}</ReadOnlyField>
            <ReadOnlyField label="Capacidad">{formatTrailerWeight(detail.capacityKg)}</ReadOnlyField>
            <ReadOnlyField label="Peso vacío">{formatTrailerWeight(detail.emptyWeightKg)}</ReadOnlyField>
            <ReadOnlyField label="Dimensiones">{formatTrailerDimensions(detail)}</ReadOnlyField>
            <ReadOnlyField label="Volumen posterior">{detail.rearVolumeM3 === undefined ? "—" : `${formatDecimal(detail.rearVolumeM3)} m³`}</ReadOnlyField>
            <ReadOnlyField label="Propietario" wide>{partyLabel(detail.ownerName, detail.ownerDocument)}</ReadOnlyField>
            <ReadOnlyField label="Vehículo habitual">{detail.linkedVehicleId ? "Vinculación registrada" : "Sin vehículo habitual"}</ReadOnlyField>
            <ReadOnlyField label="Serie de chasis">{valueOrDash(detail.chassisSerial)}</ReadOnlyField>
            <ReadOnlyField label="Color">{valueOrDash(detail.color)}</ReadOnlyField>
            <ReadOnlyField label="Tipo de trámite">{valueOrDash(detail.procedureType)}</ReadOnlyField>
            {detail.observations ? <ReadOnlyField label="Observaciones" wide>{detail.observations}</ReadOnlyField> : null}
            <ReadOnlyField label="Adjuntos" wide><TrailerAttachments attachments={detail.attachments} /></ReadOnlyField>
            <ReadOnlyField label="Actualizado">{formatTimestamp(detail.updatedAt)}</ReadOnlyField>
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
            <th>Tipo</th>
            <th>Estado</th>
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
              <td>{vehicleKindLabel(row.vehicleKind, row.configuration)}</td>
              <td>{vehicleStatusLabel(row.status, row.soatExpiresAt)}</td>
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
            <span>{vehicleKindLabel(row.vehicleKind, row.configuration)} · {vehicleStatusLabel(row.status, row.soatExpiresAt)}</span>
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
          <thead><tr><th>Identificación</th><th>Nombre</th><th>Roles</th><th>Ciudad</th><th>Sedes</th><th>Teléfono</th><th>Actualizado</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row._id}><td><span className="radicado">{row.document}</span><small className="table-subline">{row.documentType}</small></td><td>{row.name}</td><td>{rolesLabel(row.roles)}</td><td>{valueOrDash(row.city)}</td><td>{row.siteCount ?? 1}</td><td>{valueOrDash(row.phone)}</td><td className="cell-date">{formatTimestamp(row.updatedAt)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="master-mobile-list">
        {rows.map((row) => <article className="master-mobile-card static" key={row._id}><span className="master-mobile-heading"><span className="radicado">{row.document}</span><small>{formatTimestamp(row.updatedAt)}</small></span><strong>{row.name}</strong><span>{rolesLabel(row.roles)} · {valueOrDash(row.phone)}</span></article>)}
      </div>
    </>
  );
}

function TrailersTable({ onSelect, rows, selectedPlate }: { onSelect: (plate: string) => void; rows: TrailerRow[]; selectedPlate: string | null }) {
  if (rows.length === 0) return <div className="empty-state">Sin registros</div>;
  return (
    <>
      <div className="table-wrap master-desktop-table">
        <table className="doc-table">
          <thead><tr><th>Placa</th><th>Tipo</th><th>Marca / modelo</th><th>Configuración</th><th>Capacidad</th><th>Propietario</th><th>Estado</th><th>Actualizado</th></tr></thead>
          <tbody>{rows.map((row) => <tr aria-selected={selectedPlate === row.plate} className={selectedPlate === row.plate ? "row-click row-selected" : "row-click"} key={row._id} onClick={() => onSelect(row.plate)}><td><span className="plate-chip">{row.plate}</span></td><td>{valueOrDash(row.trailerType)}</td><td>{valuesLabel([row.make, row.modelYear])}</td><td>{valueOrDash(row.configuration)}</td><td>{formatTrailerWeight(row.capacityKg)}</td><td>{valueOrDash(row.ownerName)}</td><td>{trailerStatusLabel(row.status)}</td><td className="cell-date">{formatTimestamp(row.updatedAt)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="master-mobile-list">
        {rows.map((row) => <button className={selectedPlate === row.plate ? "master-mobile-card selected" : "master-mobile-card"} key={row._id} onClick={() => onSelect(row.plate)} type="button"><span className="master-mobile-heading"><span className="plate-chip">{row.plate}</span><small>{formatTimestamp(row.updatedAt)}</small></span><strong>{valuesLabel([row.make, row.modelYear])}</strong><span>{valuesLabel([row.trailerType, row.configuration])} · {formatTrailerWeight(row.capacityKg)}</span><span>{valueOrDash(row.ownerName)} · {trailerStatusLabel(row.status)}</span></button>)}
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

const VEHICLE_KIND_LABELS: Record<string, string> = {
  cabezote: "Cabezote",
  rigido: "Rígido",
  liviano: "Liviano",
  remolque: "Remolque",
  otro: "Otro"
};

function vehicleKindLabel(kind: string | undefined, configuration: string | undefined) {
  const label = kind ? VEHICLE_KIND_LABELS[kind] ?? kind : undefined;
  return valuesLabel([label, configuration]);
}

function vehicleStatusLabel(status: string | undefined, soatExpiresAt: string | undefined) {
  if (status === "activo" || status === "active") {
    return soatExpiresAt ? `Activo · SOAT ${soatExpiresAt}` : "Activo";
  }
  if (status === "archivado") {
    return soatExpiresAt ? `Archivado · SOAT venció ${soatExpiresAt}` : "Archivado";
  }
  if (status === "maintenance") return soatExpiresAt ? `Mantenimiento · SOAT ${soatExpiresAt}` : "Mantenimiento";
  if (status === "inactive") return soatExpiresAt ? `Inactivo · SOAT ${soatExpiresAt}` : "Inactivo";
  return "—";
}

function soatDetail(detail: VehicleDetail) {
  if (!detail.soatNumber && !detail.soatExpiresAt && !detail.insurerName && !detail.insurerNit) {
    return "—";
  }
  return valuesLabel([detail.soatNumber, detail.soatExpiresAt ? `vence ${detail.soatExpiresAt}` : undefined, detail.insurerName ?? detail.insurerNit]);
}

function valueOrDash(value: string | undefined) {
  return value && value.trim() !== "" ? value : "—";
}

function valuesLabel(values: Array<string | undefined>) {
  const parts = values.map((value) => value?.trim()).filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function rolesLabel(roles: ThirdPartyRow["roles"]) {
  return roles.map((role) => THIRD_PARTY_ROLE_LABELS[role]).join(" · ");
}

const THIRD_PARTY_ROLE_LABELS: Record<ThirdPartyRole, string> = {
  driver: "Conductor",
  owner: "Propietario",
  possessor: "Poseedor",
  holder: "Tenedor",
  sender: "Remitente",
  recipient: "Destinatario",
  insured: "Asegurado",
  insurance_company: "Compañía de seguros",
  transport_company: "Empresa de transporte",
  legal_representative: "Representante legal",
  commercial: "Comercial",
  consignee: "Consignatario",
  employee: "Empleado",
  logistics_operator: "Operador logístico",
  fiscal_reviewer: "Revisor fiscal",
  other: "Otro"
};

function formatTrailerWeight(value: number | undefined): string {
  return value === undefined ? "—" : `${formatDecimal(value / 1000)} t`;
}

function trailerStatusLabel(status: string): string {
  return ({ available: "Disponible", assigned: "Asignado", maintenance: "Mantenimiento", inactive: "Inactivo" } as Record<string, string>)[status] ?? status;
}

function formatTrailerDimensions(detail: Pick<TrailerDetail, "widthM" | "heightM" | "lengthM">): string {
  if (detail.widthM === undefined && detail.heightM === undefined && detail.lengthM === undefined) return "—";
  return `${detail.widthM === undefined ? "—" : formatDecimal(detail.widthM)} × ${detail.heightM === undefined ? "—" : formatDecimal(detail.heightM)} × ${detail.lengthM === undefined ? "—" : formatDecimal(detail.lengthM)} m`;
}

function formatDecimal(value: number): string {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(value);
}

function TrailerAttachments({ attachments }: { attachments: TrailerDetail["attachments"] }) {
  if (attachments.length === 0) return <span className="related-empty">Sin archivos adjuntos</span>;
  return <div className="related-list">{attachments.map((attachment) => attachment.url ? <a className="related-item" href={attachment.url} key={`${attachment.slot}:${attachment.fileName}`} rel="noreferrer" target="_blank"><strong>{attachment.fileName}</strong><small>{attachment.contentType} · {formatFileBytes(attachment.size)}</small></a> : <span className="related-item" key={`${attachment.slot}:${attachment.fileName}`}><strong>{attachment.fileName}</strong><small>{attachment.contentType} · {formatFileBytes(attachment.size)}</small></span>)}</div>;
}

function formatFileBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${formatDecimal(bytes / 1024 / 1024)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
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

function RelatedVehicles({ onUnlink, vehicles }: { onUnlink: (plate: string) => Promise<void>; vehicles: DriverDetail["vehicles"] }) {
  if (vehicles.length === 0) {
    return <span className="related-empty">Sin vehículos asociados</span>;
  }

  return (
    <div className="related-list">
      {vehicles.map((vehicle) => (
        <span className="related-item" key={vehicle.vehiclePlate}>
          <span className="plate-chip">{vehicle.vehiclePlate}</span>
          <small>{valuesLabel([vehicle.make, vehicle.line, vehicle.modelYear])}</small>
          <button aria-label={`Desasociar ${vehicle.vehiclePlate}`} className="related-remove" onClick={() => void onUnlink(vehicle.vehiclePlate)} title="Desasociar" type="button">×</button>
        </span>
      ))}
    </div>
  );
}

function LinkEditor({ label, onLink, placeholder, uppercase }: { label: string; onLink: (value: string) => Promise<void>; placeholder: string; uppercase?: boolean }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onLink(uppercase ? trimmed.toUpperCase() : trimmed);
      setValue("");
    } catch {
      setValue(value);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="link-editor">
      <input
        aria-label={label}
        className={uppercase ? "mono" : undefined}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submit(); } }}
        placeholder={placeholder}
        value={value}
      />
      <button className="ghost-button" disabled={busy || value.trim() === ""} onClick={() => void submit()} type="button">{busy ? "Asociando…" : "Asociar"}</button>
    </div>
  );
}

function RelatedDrivers({ drivers, onUnlink }: { drivers: VehicleDetail["drivers"]; onUnlink: (document: string) => Promise<void> }) {
  if (drivers.length === 0) {
    return <span className="related-empty">Sin conductores asociados</span>;
  }

  return (
    <div className="related-list">
      {drivers.map((driver) => (
        <span className="related-item" key={driver.driverDocument}>
          <span className="radicado">{driver.driverDocument}</span>
          <small>{valueOrDash(driver.name)}</small>
          <button aria-label={`Desasociar ${driver.driverDocument}`} className="related-remove" onClick={() => void onUnlink(driver.driverDocument)} title="Desasociar" type="button">×</button>
        </span>
      ))}
    </div>
  );
}

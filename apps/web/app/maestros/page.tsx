"use client";

import { useState, type ReactNode } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { formatTimestamp } from "../lib/labels";

type Tab = "conductores" | "vehiculos";

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
  const documentSearchPrefix = documentFilter.trim();
  const plateSearchPrefix = plateFilter.trim();
  const activeFilter = tab === "conductores" ? documentSearchPrefix : plateSearchPrefix;
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
  const pageStatus = tab === "conductores" ? driversStatus : vehiclesStatus;
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
  }

  return (
    <>
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
        {tab === "conductores" ? (
          <input
            aria-label="Filtrar conductores por documento"
            className="filter-input"
            onChange={(event) => setDocumentFilter(event.target.value)}
            placeholder="Filtrar por documento"
            type="search"
            value={documentFilter}
          />
        ) : (
          <input
            aria-label="Filtrar vehiculos por placa"
            className="filter-input"
            onChange={(event) => setPlateFilter(event.target.value)}
            placeholder="Filtrar por placa"
            type="search"
            value={plateFilter}
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

      <section className="panel" aria-label={tab === "conductores" ? "Listado de conductores" : "Listado de vehiculos"}>
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
        ) : isFiltering && vehicleSearchResults === undefined ? (
          <div className="skeleton">Cargando…</div>
        ) : !isFiltering && pageStatus === "LoadingFirstPage" ? (
          <div className="skeleton">Cargando…</div>
        ) : (
          <VehiclesTable
            onSelect={(plate) => setSelectedPlate((current) => (current === plate ? null : plate))}
            rows={isFiltering ? ((vehicleSearchResults ?? []) as VehicleRow[]) : vehicles}
            selectedPlate={selectedPlate}
          />
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
    <div className="table-wrap">
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
    <div className="table-wrap">
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

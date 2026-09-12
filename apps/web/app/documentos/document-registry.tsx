"use client";

import Link from "next/link";
import { useDeferredValue, useState, type FormEvent } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type {
  RegistryFilters,
  RegistryRow,
} from "../../convex/model/documentRegistry";
import { useDemoUser } from "../providers";
import NuevoDespachoPage from "../expedientes/nuevo/page";
import { DispatchDetail } from "../expedientes/[id]/dispatch-detail";
import { DocumentPrintPreview } from "./document-print-preview";
import {
  actionLabels,
  registryColumns,
  type RegistryAction,
  type RegistryModule,
} from "./registry-config";
import "./document-registry.css";

export function DocumentRegistry({
  module,
  action,
}: {
  module: RegistryModule;
  action: RegistryAction;
}) {
  const [selected, setSelected] = useState<RegistryRow | null>(null);
  const [filters, setFilters] = useState<RegistryFilters>({});
  const [number, setNumber] = useState("");
  const [searched, setSearched] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const deferredFilters = useDeferredValue(filters);
  const { user } = useDemoUser();
  const lookup = !["listar", "imprimir", "insertar"].includes(action);
  const invalidDates = Boolean(
    filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo,
  );
  const result = useQuery(
    api.documentRegistry.list,
    user && action !== "insertar" && (!lookup || searched) && !invalidDates
      ? { kind: module.kind, filters: deferredFilters, page, pageSize }
      : "skip",
  );
  const columns = registryColumns(module);
  const busy = filters !== deferredFilters || result === undefined;

  function updateFilter(key: string, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function search(event: FormEvent) {
    event.preventDefault();
    if (!number.trim()) return;
    setFilters({ number: number.trim(), numberExact: true });
    setPage(1);
    setSearched(true);
    setSelected(null);
  }

  if (action === "insertar")
    return module.slug === "ordenes" ? (
      <NuevoDespachoPage />
    ) : (
      <InsertDocument module={module} />
    );
  if (selected)
    return (
      <>
        <RegistryHeading
          module={module}
          action={action}
          number={selected.number}
        />
        {action === "imprimir" ? (
          <DocumentPrintPreview
            kind={module.kind}
            expedienteId={selected.expedienteId}
            remesaId={selected.remesaId}
            documentId={selected.documentId}
            pdfArtifactId={selected.pdfArtifactId}
            pdfUrl={selected.pdfUrl}
            onBack={() => setSelected(null)}
          />
        ) : action === "eliminar" ? (
          <DeleteDocument
            module={module}
            row={selected}
            onBack={() => setSelected(null)}
          />
        ) : action === "duplicar" ? (
          <DuplicateDocument
            module={module}
            row={selected}
            onBack={() => setSelected(null)}
          />
        ) : selected.expedienteId ? (
          <DispatchDetail
            key={selected.key}
            id={selected.expedienteId}
            focus={{
              stage: module.stage,
              remesaId: selected.remesaId,
              documentId: selected.documentId,
              action:
                action === "listar"
                  ? "ver"
                  : action === "anular"
                    ? "anular"
                    : "actualizar",
              onClose: () => setSelected(null),
            }}
          />
        ) : (
          <div className="registry-action-panel">
            <p>
              Este registro histórico no tiene un despacho asociado para esta
              acción.
            </p>
            <button
              className="ghost-button"
              onClick={() => setSelected(null)}
              type="button"
            >
              Volver al listado
            </button>
          </div>
        )}
      </>
    );

  return (
    <div className="document-registry">
      <RegistryHeading module={module} action={action} />
      {lookup ? (
        <form className="registry-lookup" onSubmit={search} role="search">
          <label>
            <span>{module.numberLabel}</span>
            <input
              autoComplete="off"
              autoFocus
              inputMode="numeric"
              onChange={(event) => setNumber(event.target.value)}
              placeholder={`Ingresa el número de ${module.singular}`}
              required
              value={number}
            />
          </label>
          <button className="primary-action" type="submit">
            Buscar {module.singular}
          </button>
        </form>
      ) : (
        <div
          className="registry-filters"
          role="search"
          aria-label="Filtros del listado"
        >
          <label>
            <span>{module.numberLabel}</span>
            <input
              inputMode="numeric"
              onChange={(event) => updateFilter("number", event.target.value)}
              placeholder="Todos los números"
              value={filters.number ?? ""}
            />
          </label>
          <label>
            <span>Placa</span>
            <input
              autoCapitalize="characters"
              onChange={(event) =>
                updateFilter("plate", event.target.value.toUpperCase())
              }
              placeholder="Todas las placas"
              value={filters.plate ?? ""}
            />
          </label>
          <label>
            <span>Fecha desde</span>
            <input
              max={filters.dateTo || undefined}
              onChange={(event) => updateFilter("dateFrom", event.target.value)}
              type="date"
              value={filters.dateFrom ?? ""}
            />
          </label>
          <label>
            <span>Fecha hasta</span>
            <input
              aria-invalid={invalidDates || undefined}
              min={filters.dateFrom || undefined}
              onChange={(event) => updateFilter("dateTo", event.target.value)}
              type="date"
              value={filters.dateTo ?? ""}
            />
          </label>
          <button
            className="ghost-button"
            onClick={() => {
              setFilters({});
              setPage(1);
            }}
            type="button"
          >
            Limpiar filtros
          </button>
        </div>
      )}
      {invalidDates ? (
        <p className="form-error" role="alert">
          La fecha hasta debe ser igual o posterior a la fecha desde.
        </p>
      ) : null}
      {lookup && !searched ? (
        <div className="registry-instruction">
          Busca el número de {module.singular} que necesitas {action}.
        </div>
      ) : (
        <section
          className="registry-results"
          aria-label={`Listado de ${module.label}`}
          aria-busy={busy}
        >
          <div className="registry-list-toolbar">
            <div>
              <strong>
                {result
                  ? `${result.total.toLocaleString("es-CO")} registros`
                  : "Cargando registros…"}
              </strong>
              <span>
                Más recientes primero
                {action === "imprimir"
                  ? " · Selecciona una fila para ver e imprimir"
                  : " · Selecciona una fila para continuar"}
              </span>
            </div>
            <label>
              <span>Mostrar</span>
              <select
                aria-label="Registros por página"
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
                value={pageSize}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
          </div>
          <div
            className="registry-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Tabla de documentos con desplazamiento horizontal"
          >
            <table className="registry-table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column.key} scope="col">
                      <span>
                        {column.label}
                        {column.key === "date" ? " ↓" : ""}
                      </span>
                      {!lookup ? (
                        <input
                          aria-label={`Filtrar por ${column.label}`}
                          onChange={(event) =>
                            updateFilter(column.key, event.target.value)
                          }
                          placeholder="Filtrar…"
                          value={String(
                            filters[column.key as keyof RegistryFilters] ?? "",
                          )}
                        />
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result?.rows.map((row) => (
                  <tr key={row.key} onClick={() => setSelected(row)}>
                    {columns.map((column) => (
                      <td key={column.key}>
                        {column.key === "number" ? (
                          <button
                            className="registry-number"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelected(row);
                            }}
                            type="button"
                            aria-label={`${actionLabels[action]} ${module.singular} ${row.number || "sin número"}`}
                          >
                            {row.number || "Sin número"}
                          </button>
                        ) : column.key === "status" ? (
                          <span
                            className={`registry-status registry-status-${row.status}`}
                          >
                            {row.statusLabel}
                          </span>
                        ) : (
                          String(row[column.key] ?? "") || "—"
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                {!result ? (
                  <tr>
                    <td className="registry-empty" colSpan={columns.length}>
                      {invalidDates
                        ? "Corrige el rango de fechas para buscar."
                        : "Cargando documentos…"}
                    </td>
                  </tr>
                ) : result.rows.length === 0 ? (
                  <tr>
                    <td className="registry-empty" colSpan={columns.length}>
                      No se encontraron documentos con estos filtros.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="registry-pagination">
            <span>
              {result && result.total
                ? `${(result.page - 1) * result.pageSize + 1}–${Math.min(result.page * result.pageSize, result.total)} de ${result.total}`
                : "0 registros"}
            </span>
            <div>
              <button
                className="ghost-button"
                disabled={busy || !result || result.page <= 1}
                onClick={() => setPage((result?.page ?? 1) - 1)}
                type="button"
              >
                Anterior
              </button>
              <span>
                Página {result?.page ?? 1} de {result?.pageCount ?? 1}
              </span>
              <button
                className="ghost-button"
                disabled={busy || !result || result.page >= result.pageCount}
                onClick={() => setPage((result?.page ?? 1) + 1)}
                type="button"
              >
                Siguiente
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function RegistryHeading({
  module,
  action,
  number,
}: {
  module: RegistryModule;
  action: RegistryAction;
  number?: string;
}) {
  return (
    <div className="registry-heading">
      <div>
        <p>{module.label}</p>
        <h2>
          {actionLabels[action]} {module.singular}
          {number ? ` · ${number}` : ""}
        </h2>
      </div>
      <Link
        className="ghost-button action-link"
        href={`/documentos/${module.slug}/${action === "insertar" ? "listar" : "insertar"}`}
      >
        {action === "insertar" ? "Ver listado" : `Insertar ${module.singular}`}
      </Link>
    </div>
  );
}

function InsertDocument({ module }: { module: RegistryModule }) {
  const convex = useConvex();
  const [number, setNumber] = useState("");
  const [matches, setMatches] = useState<RegistryRow[]>([]);
  const [prepared, setPrepared] = useState<{
    expedienteId: Id<"expedientes">;
    remesaId?: Id<"expedienteRemesas">;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { user } = useDemoUser();
  const sourceKind = module.kind === "remesa" ? "orden_cargue" : "remesa";
  const sourceLabel = module.kind === "remesa" ? "orden de cargue" : "remesa";
  const ensureConsignment = useMutation(api.dispatches.ensureConsignmentDraft);
  const ensureManifest = useMutation(
    api.documentDraftActions.ensureManifestDraft,
  );

  async function prepare(source: RegistryRow) {
    if (!source.expedienteId)
      throw new Error(
        "Este registro histórico no tiene un despacho asociado. Selecciona un documento creado desde el TMS.",
      );
    const detail = await convex.query(api.expedientes.detail, {
      expedienteId: source.expedienteId,
    });
    if (
      !detail ||
      !["draft", "in_progress", "ready"].includes(detail.expediente.status)
    )
      throw new Error("El despacho seleccionado no admite nuevos borradores.");
    if (module.kind === "remesa") {
      const sequence =
        Math.max(0, ...detail.remesas.map((row) => row.sequence)) + 1;
      const remesa = await ensureConsignment({
        expedienteId: source.expedienteId,
        sequence,
      });
      setPrepared({
        expedienteId: source.expedienteId,
        remesaId: remesa.remesaId,
      });
    } else {
      await ensureManifest({ expedienteId: source.expedienteId });
      setPrepared({ expedienteId: source.expedienteId });
    }
  }

  async function load(source?: RegistryRow) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (source) await prepare(source);
      else {
        const result = await convex.query(api.documentRegistry.list, {
          kind: sourceKind,
          filters: { number: number.trim(), numberExact: true },
        });
        setMatches(result.rows);
        if (result.rows.length === 1) await prepare(result.rows[0]);
        else if (!result.rows.length)
          throw new Error(`No se encontró una ${sourceLabel} con ese número.`);
      }
    } catch (cause) {
      setError(readError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="document-registry">
      <RegistryHeading module={module} action="insertar" />
      {prepared ? (
        <DispatchDetail
          id={prepared.expedienteId}
          focus={{
            stage: module.stage,
            remesaId: prepared.remesaId,
            action: "insertar",
            onClose: () => {
              setPrepared(null);
              setMatches([]);
            },
          }}
        />
      ) : (
        <section className="registry-insert-panel">
          <h3>
            {module.kind === "remesa" ? "Nueva remesa" : "Nuevo manifiesto"}
          </h3>
          <p>
            Ingresa el número de {sourceLabel} para cargar sus datos y completar
            el formulario.
          </p>
          <form
            className="registry-lookup"
            onSubmit={(event) => {
              event.preventDefault();
              void load();
            }}
          >
            <label>
              <span>Nro. {sourceLabel}</span>
              <input
                autoFocus
                inputMode="numeric"
                onChange={(event) => setNumber(event.target.value)}
                required
                value={number}
              />
            </label>
            <button
              className="primary-action"
              disabled={busy || user?.role === "auditor"}
              type="submit"
            >
              {busy ? "Cargando datos…" : "Cargar datos"}
            </button>
          </form>
          {matches.length > 1 ? (
            <>
              <p>Selecciona el documento que corresponde al viaje.</p>
              {matches.map((row) => (
                <button
                  className="registry-source"
                  disabled={busy}
                  key={row.key}
                  onClick={() => void load(row)}
                  type="button"
                >
                  <strong>{row.number}</strong>
                  <span>
                    {row.customer} · {row.plate || "Sin placa"} · {row.origin} →{" "}
                    {row.destination}
                  </span>
                  <span>Seleccionar</span>
                </button>
              ))}
            </>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}

function DeleteDocument({
  module,
  row,
  onBack,
}: {
  module: RegistryModule;
  row: RegistryRow;
  onBack: () => void;
}) {
  const { user } = useDemoUser();
  const detail = useQuery(
    api.expedientes.detail,
    row.expedienteId ? { expedienteId: row.expedienteId } : "skip",
  );
  const removeOrder = useMutation(api.expedientes.removeDraft);
  const removeRemesa = useMutation(api.expedientes.removeDraftRemesa);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const allowed =
    row.status === "draft" &&
    !row.documentId &&
    Boolean(row.expedienteId) &&
    (module.kind === "orden_cargue"
      ? user?.role === "admin" &&
        detail?.expediente.status === "draft" &&
        detail.remesas.length === 0 &&
        detail.documents.length === 0
      : Boolean(row.remesaId) && user?.role !== "auditor");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allowed || busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const reason = String(data.get("reason") ?? "").trim();
      if (!reason) throw new Error("Escribe el motivo de eliminación.");
      if (module.kind === "orden_cargue" && row.expedienteId)
        await removeOrder({ expedienteId: row.expedienteId, reason });
      else if (row.remesaId)
        await removeRemesa({ remesaId: row.remesaId, reason });
      setDone(true);
    } catch (cause) {
      setError(readError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="registry-action-panel">
      <p>
        <strong>{row.number}</strong> · {row.customer} ·{" "}
        {row.plate || "Sin placa"}
      </p>
      {done ? (
        <p role="status">El borrador fue eliminado.</p>
      ) : allowed ? (
        <form onSubmit={submit}>
          <label>
            <span>Motivo de eliminación</span>
            <textarea name="reason" required rows={3} />
          </label>
          <label className="confirmation-check">
            <input required type="checkbox" />
            <span>
              Confirmo que quiero eliminar la {module.singular} {row.number}.
            </span>
          </label>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="danger-action" disabled={busy} type="submit">
            {busy ? "Eliminando…" : "Eliminar borrador"}
          </button>
        </form>
      ) : (
        <p>
          Solo se pueden eliminar borradores sin emisión.{" "}
          {module.kind === "orden_cargue"
            ? "La orden debe estar sin remesas ni operaciones asociadas, y requiere un administrador."
            : "El documento seleccionado o tu perfil no permiten esta acción."}
        </p>
      )}
      <button className="ghost-button" onClick={onBack} type="button">
        Volver al listado
      </button>
    </section>
  );
}

function DuplicateDocument({
  module,
  row,
  onBack,
}: {
  module: RegistryModule;
  row: RegistryRow;
  onBack: () => void;
}) {
  const duplicate = useMutation(api.documentDraftActions.duplicateManifest);
  const { user } = useDemoUser();
  const [requestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{
    expedienteId: Id<"expedientes">;
    manifestNumber: string;
  } | null>(null);
  async function copy() {
    if (!row.expedienteId || busy) return;
    setBusy(true);
    setError("");
    try {
      setCreated(
        await duplicate({ expedienteId: row.expedienteId, requestId }),
      );
    } catch (cause) {
      setError(readError(cause));
    } finally {
      setBusy(false);
    }
  }
  if (created)
    return (
      <>
        <p className="operation-notice ok" role="status">
          Se creó el borrador {created.manifestNumber}. Revisa sus datos antes
          de emitir.
        </p>
        <DispatchDetail
          id={created.expedienteId}
          focus={{ stage: module.stage, action: "actualizar", onClose: onBack }}
        />
      </>
    );
  return (
    <section className="registry-action-panel">
      <h3>Duplicar manifiesto {row.number}</h3>
      <p>
        {row.customer} · {row.plate || "Sin placa"} · {row.origin} →{" "}
        {row.destination}
      </p>
      <p>
        Se creará un borrador con nuevos números de orden, remesas y manifiesto.
        Revisa las fechas y los datos del nuevo viaje antes de emitir.
      </p>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="registry-form-actions">
        <button className="ghost-button" onClick={onBack} type="button">
          Volver
        </button>
        <button
          className="primary-action"
          disabled={busy || !row.expedienteId || user?.role === "auditor"}
          onClick={() => void copy()}
          type="button"
        >
          {busy ? "Duplicando…" : "Crear copia como borrador"}
        </button>
      </div>
    </section>
  );
}

function readError(cause: unknown): string {
  if (
    cause &&
    typeof cause === "object" &&
    "data" in cause &&
    cause.data &&
    typeof cause.data === "object" &&
    "message" in cause.data
  )
    return String(cause.data.message);
  return cause instanceof Error
    ? cause.message
    : "No fue posible completar la acción.";
}

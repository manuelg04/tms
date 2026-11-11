"use client";

import { useDeferredValue, useMemo, useRef, useState, type FormEvent } from "react";
import { useConvex, useConvexAuth, useMutation, useQuery } from "../lib/convex-hooks";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { SideSheet } from "../components/side-sheet";
import { routeName } from "../../convex/model/routes";
import { convexErrorMessage } from "../lib/convex-error";
import {
  parseCatalogueImport,
  sameCatalogueRecord,
  type CatalogueImport,
  type PointInput,
  type RouteInput,
} from "./catalogue-import";
import "../control/tracking.css";
import "./routes.css";
import { Skeleton } from "../components/skeleton";

const blankPoint: PointInput = {
  code: "",
  name: "",
  cityCode: "",
  city: "",
  controller: "",
  address: "",
  phone: "",
  virtual: false,
  active: true,
};
const blankRoute: RouteInput = {
  code: "",
  origin: "",
  originCode: "",
  destination: "",
  destinationCode: "",
  via: "",
  active: true,
  stops: [{ key: "delivery", pointCode: "9999", minutes: 0 }],
};

const PAGE_SIZE = 25;

type Selection =
  | { kind: "point"; point: Doc<"operationalPoints"> | "new" }
  | { kind: "route"; routeId: Id<"operationalRoutes"> | "new"; copy: boolean }
  | { kind: "import" }
  | null;

export default function RoutesPage() {
  const { isAuthenticated } = useConvexAuth(),
    convex = useConvex(),
    summaries = useQuery(api.routes.routeSummaries, isAuthenticated ? {} : "skip"),
    pointData = useQuery(api.routes.points, isAuthenticated ? {} : "skip");
  const savePoint = useMutation(api.routes.savePoint),
    saveRoute = useMutation(api.routes.saveRoute);
  const [tab, setTab] = useState<"routes" | "points">("routes"),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [selection, setSelection] = useState<Selection>(null);
  const [file, setFile] = useState<CatalogueImport | null>(null),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const importing = useRef(false);
  const needle = useDeferredValue(search).trim().toUpperCase();
  const routes = useMemo(
      () =>
        (summaries?.routes ?? []).filter((r) =>
          [r.code, r.origin, r.destination, r.via].some((f) =>
            f.toUpperCase().includes(needle),
          ),
        ),
      [summaries, needle],
    ),
    points = useMemo(
      () =>
        (pointData?.points ?? []).filter((p) =>
          [p.code, p.name, p.city, p.controller, p.address].some((f) =>
            f.toUpperCase().includes(needle),
          ),
        ),
      [pointData, needle],
    );
  const canEdit = summaries?.canEdit ?? false;
  const loading = tab === "routes" ? !summaries : !pointData;
  const total = tab === "routes" ? routes.length : points.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pages - 1);

  async function importFile() {
    if (!file || importing.current) return;
    importing.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    let saved = 0,
      unchanged = 0;
    try {
      const data = await convex.query(api.routes.catalogue, {});
      for (const p of file.points) {
        const existing = data.points.find((r) => r.code === p.code);
        if (existing && existing.source !== "avansat")
          throw new Error(`El puesto ${p.code} ya pertenece al catálogo TMS.`);
        if (existing && sameCatalogueRecord(existing, p)) {
          unchanged++;
          continue;
        }
        await savePoint({
          ...p,
          expectedRevision: existing?.revision ?? 0,
          source: "avansat",
        });
        saved++;
        setProgress(`${saved} registros importados…`);
      }
      for (const r of file.routes) {
        const existing = data.routes.find((p) => p.code === r.code);
        if (existing && existing.source !== "avansat")
          throw new Error(`La ruta ${r.code} ya pertenece al catálogo TMS.`);
        if (existing && sameCatalogueRecord(existing, r)) {
          unchanged++;
          continue;
        }
        await saveRoute({
          ...r,
          expectedRevision: existing?.revision ?? 0,
          source: "avansat",
        });
        saved++;
        setProgress(`${saved} registros importados…`);
      }
      setMessage(
        `Importación terminada: ${saved} guardados, ${unchanged} sin cambios.`,
      );
      setFile(null);
      setSelection(null);
    } catch (e) {
      setError(
        `${convexErrorMessage(e, "No se pudo importar.")} Se guardaron ${saved} registros; puedes revisar y repetir el archivo.`,
      );
    } finally {
      setProgress("");
      setBusy(false);
      importing.current = false;
    }
  }
  async function exportCatalogue() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await convex.query(api.routes.catalogue, {});
      const strip = (record: Record<string, unknown>) =>
        Object.fromEntries(
          Object.entries(record).filter(
            ([key]) =>
              ![
                "_id",
                "_creationTime",
                "organizationId",
                "source",
                "revision",
                "updatedAt",
                "photoId",
              ].includes(key),
          ),
        );
      const url = URL.createObjectURL(
        new Blob(
          [
            JSON.stringify(
              {
                version: 1,
                points: data.points.map(strip),
                routes: data.routes.map(strip),
              },
              null,
              2,
            ),
          ],
          { type: "application/json" },
        ),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "rutas-puestos.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(convexErrorMessage(e, "No se pudo exportar el catálogo."));
    } finally {
      setBusy(false);
    }
  }
  function open(next: Selection) {
    setError("");
    setMessage("");
    setSelection(next);
  }
  function changeTab(next: "routes" | "points") {
    setTab(next);
    setSearch("");
    setPage(0);
  }
  return (
    <div className="tracking-workspace route-workspace">
      <div className="tracking-heading">
        <div>
          <span className="eyebrow">Rutas y P. Control</span>
          <h2>Rutas y puestos de control</h2>
          <p>Catálogo operativo y tiempos desde el origen</p>
        </div>
        <div className="route-heading-actions">
          {canEdit && (
            <button
              className="ghost-button"
              disabled={busy}
              onClick={() => open({ kind: "import" })}
              type="button"
            >
              Importar catálogo
            </button>
          )}
          <button
            className="ghost-button"
            disabled={busy || !summaries}
            onClick={() => void exportCatalogue()}
            type="button"
          >
            Exportar catálogo
          </button>
        </div>
      </div>
      {message && (
        <p role="status" className="tracking-message success">
          {message}
        </p>
      )}
      {error && !selection && (
        <p role="alert" className="tracking-message error">
          {error}
        </p>
      )}
      <section className="panel">
        <div className="route-toolbar">
          <div
            className="tracking-source-tabs"
            role="tablist"
            aria-label="Catálogos"
          >
            <button
              role="tab"
              aria-selected={tab === "routes"}
              onClick={() => changeTab("routes")}
            >
              Rutas
            </button>
            <button
              role="tab"
              aria-selected={tab === "points"}
              onClick={() => changeTab("points")}
            >
              Puestos de control
            </button>
          </div>
          <label className="route-search">
            Buscar
            <input
              type="search"
              placeholder={
                tab === "routes"
                  ? "Código, origen, destino o vía"
                  : "Código, nombre, ciudad o encargado"
              }
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
          {canEdit && (
            <button
              className="primary-action"
              disabled={busy}
              onClick={() =>
                open(
                  tab === "points"
                    ? { kind: "point", point: "new" }
                    : { kind: "route", routeId: "new", copy: false },
                )
              }
            >
              Insertar {tab === "points" ? "puesto" : "ruta"}
            </button>
          )}
        </div>
        {loading ? (
          <Skeleton label="Cargando rutas y puestos" rows={10} />
        ) : (
          <div className="tracking-table-scroll">
            <table className="tracking-table route-table">
              <thead>
                <tr>
                  {(tab === "routes"
                    ? [
                        "Código",
                        "Ruta",
                        "Cant. P/C",
                        "Estado",
                        "Origen de datos",
                        "Acciones",
                      ]
                    : [
                        "Código",
                        "Descripción",
                        "Ciudad",
                        "Encargado",
                        "Dirección",
                        "Teléfono",
                        "Puesto",
                        "Estado",
                        "Acciones",
                      ]
                  ).map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tab === "routes"
                  ? routes
                      .slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
                      .map((r) => (
                        <tr
                          key={r._id}
                          onClick={() =>
                            open({ kind: "route", routeId: r._id, copy: false })
                          }
                        >
                          <td>{r.code}</td>
                          <td>{routeName(r)}</td>
                          <td>{r.stopCount}</td>
                          <td>{r.active ? "Activa" : "Inactiva"}</td>
                          <td>{r.source === "avansat" ? "Avansat" : "TMS"}</td>
                          <td>
                            <button
                              className="text-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                open({
                                  kind: "route",
                                  routeId: r._id,
                                  copy: false,
                                });
                              }}
                            >
                              Ver {canEdit ? "/ actualizar" : ""}
                            </button>
                            {canEdit && (
                              <button
                                className="text-button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  open({
                                    kind: "route",
                                    routeId: r._id,
                                    copy: true,
                                  });
                                }}
                              >
                                Copiar ruta
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                  : points
                      .slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
                      .map((p) => (
                        <tr
                          key={p._id}
                          onClick={() => open({ kind: "point", point: p })}
                        >
                          <td>{p.code}</td>
                          <td>{p.name}</td>
                          <td>{p.city}</td>
                          <td>{p.controller || "—"}</td>
                          <td>{p.address || "—"}</td>
                          <td>{p.phone || "—"}</td>
                          <td>{p.virtual ? "Virtual" : "Físico"}</td>
                          <td>{p.active ? "Activo" : "Inactivo"}</td>
                          <td>
                            <button
                              className="text-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                open({ kind: "point", point: p });
                              }}
                            >
                              Ver {canEdit ? "/ actualizar" : ""}
                            </button>
                          </td>
                        </tr>
                      ))}
                {!total && (
                  <tr className="route-empty-row">
                    <td colSpan={9} className="tracking-empty">
                      No hay registros que coincidan.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="route-actions route-pagination" aria-label="Paginación del catálogo">
          <span>
            {loading
              ? "Catálogo"
              : `${total.toLocaleString("es-CO")} registros · página ${current + 1} de ${pages}`}
          </span>
          <button
            className="ghost-button"
            disabled={loading || current === 0}
            onClick={() => setPage(current - 1)}
          >
            Anterior
          </button>
          <button
            className="ghost-button"
            disabled={loading || current + 1 >= pages}
            onClick={() => setPage(current + 1)}
          >
            Siguiente
          </button>
        </div>
      </section>
      {selection?.kind === "point" && (
        <PointEditor
          key={selection.point === "new" ? "new" : selection.point._id}
          initial={selection.point === "new" ? blankPoint : selection.point}
          revision={selection.point === "new" ? 0 : selection.point.revision}
          source={selection.point === "new" ? "tms" : selection.point.source}
          canEdit={canEdit}
          onClose={() => setSelection(null)}
          onSave={async (values) => {
            await savePoint(values);
            setSelection(null);
            setMessage("Puesto guardado.");
          }}
        />
      )}
      {selection?.kind === "route" && (
        <RouteSheet
          key={`${selection.routeId}:${selection.copy}`}
          routeId={selection.routeId}
          copying={selection.copy}
          points={pointData?.points ?? []}
          canEdit={canEdit}
          onClose={() => setSelection(null)}
          onSave={async (values) => {
            await saveRoute(values);
            setSelection(null);
            setMessage("Ruta guardada.");
          }}
        />
      )}
      {selection?.kind === "import" && (
        <SideSheet
          label="Importar catálogo"
          eyebrow="Rutas y P. Control"
          title="Importar catálogo Avansat"
          description="Conserva códigos, nombres, tiempos y el orden de los puestos. Repetir el mismo archivo conserva los registros que no cambiaron."
          narrow
          busy={busy}
          onClose={() => {
            setFile(null);
            setSelection(null);
          }}
          footer={
            <>
              <button
                className="ghost-button"
                disabled={busy}
                onClick={() => {
                  setFile(null);
                  setSelection(null);
                }}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="primary-action"
                disabled={busy || !file}
                onClick={() => void importFile()}
                type="button"
              >
                {busy ? "Importando…" : "Importar catálogo revisado"}
              </button>
            </>
          }
        >
          <div className="route-import">
            {error && (
              <p role="alert" className="tracking-message error">
                {error}
              </p>
            )}
            <label>
              Archivo JSON del catálogo
              <input
                type="file"
                accept=".json,application/json"
                disabled={busy}
                onChange={async (e) => {
                  setError("");
                  setFile(null);
                  const selected = e.target.files?.[0];
                  if (!selected) return;
                  try {
                    if (selected.size > 25 * 1024 * 1024)
                      throw new Error("El archivo supera 25 MB.");
                    setFile(parseCatalogueImport(await selected.text()));
                  } catch (error) {
                    setError(convexErrorMessage(error, "Archivo inválido."));
                  }
                  e.target.value = "";
                }}
              />
            </label>
            {file && (
              <p>
                {file.points.length} puestos · {file.routes.length} rutas. Los
                cambios se aplican al catálogo; los planes ya asignados
                conservan su versión.
              </p>
            )}
            {progress && <p>{progress}</p>}
            <details>
              <summary>Formato de importación</summary>
              <pre>
                {JSON.stringify(
                  { version: 1, points: [blankPoint], routes: [blankRoute] },
                  null,
                  2,
                )}
              </pre>
            </details>
          </div>
        </SideSheet>
      )}
    </div>
  );
}

function RouteSheet({
  routeId,
  copying,
  points,
  canEdit,
  onClose,
  onSave,
}: {
  routeId: Id<"operationalRoutes"> | "new";
  copying: boolean;
  points: Doc<"operationalPoints">[];
  canEdit: boolean;
  onClose: () => void;
  onSave: (
    value: RouteInput & { expectedRevision: number; source: "avansat" | "tms" },
  ) => Promise<void>;
}) {
  const stored = useQuery(
    api.routes.route,
    routeId === "new" ? "skip" : { routeId },
  );
  if (routeId !== "new" && !stored)
    return (
      <SideSheet
        label="Datos de la ruta"
        eyebrow="Ruta"
        title={stored === null ? "Ruta no disponible" : "Abriendo ruta"}
        onClose={onClose}
      >
        {stored === null ? (
          <p className="tracking-empty">Esta ruta ya no existe en el catálogo.</p>
        ) : (
          <Skeleton label="Cargando ruta" variant="detail" rows={8} />
        )}
      </SideSheet>
    );
  const route = routeId === "new" ? null : stored!;
  return (
    <RouteEditor
      initial={route ?? blankRoute}
      revision={!route || copying ? 0 : route.revision}
      copying={copying}
      source={!route || copying ? "tms" : route.source}
      points={points}
      canEdit={canEdit}
      onClose={onClose}
      onSave={onSave}
    />
  );
}

function PointEditor({
  initial,
  revision,
  source,
  canEdit,
  onClose,
  onSave,
}: {
  initial: PointInput;
  revision: number;
  source: "avansat" | "tms";
  canEdit: boolean;
  onClose: () => void;
  onSave: (
    value: PointInput & { expectedRevision: number; source: "avansat" | "tms" },
  ) => Promise<void>;
}) {
  const [values, setValues] = useState<PointInput>(
      Object.fromEntries(
        Object.entries(initial).filter(
          ([key]) =>
            key in blankPoint ||
            [
              "latitude",
              "longitude",
              "altitude",
              "temperature",
              "photoId",
            ].includes(key),
        ),
      ) as PointInput,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const saving = useRef(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await onSave({ ...values, expectedRevision: revision, source });
    } catch (err) {
      setError(convexErrorMessage(err, "No se pudo guardar."));
    } finally {
      setBusy(false);
      saving.current = false;
    }
  }
  return (
    <SideSheet
      label="Datos del puesto"
      eyebrow={revision ? `Puesto ${initial.code}` : "Puesto de control"}
      title={revision ? (canEdit ? "Actualizar puesto" : "Datos del puesto") : "Insertar puesto"}
      description={revision ? initial.name : undefined}
      narrow
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ghost-button" disabled={busy} onClick={onClose}>
            Cerrar
          </button>
          {canEdit && (
            <button className="primary-action" disabled={busy} form="point-form" type="submit">
              {busy ? "Guardando…" : "Guardar puesto"}
            </button>
          )}
        </>
      }
    >
      {error && (
        <p role="alert" className="tracking-message error">
          {error}
        </p>
      )}
      <form className="route-editor" id="point-form" onSubmit={submit}>
        <fieldset disabled={!canEdit || busy}>
          <div className="route-fields">
            {(
              [
                ["code", "Código"],
                ["name", "Nombre"],
                ["city", "Ciudad"],
                ["cityCode", "Código ciudad"],
                ["controller", "Encargado"],
                ["address", "Dirección"],
                ["phone", "Teléfono"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  value={values[key]}
                  required={
                    ["code", "name"].includes(key) ||
                    (source === "tms" && ["city", "cityCode"].includes(key))
                  }
                  disabled={key === "code" && revision > 0}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [key]: e.target.value }))
                  }
                />
              </label>
            ))}
            {(
              [
                ["latitude", "Latitud"],
                ["longitude", "Longitud"],
                ["altitude", "Altitud"],
                ["temperature", "Temperatura"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="text"
                  inputMode="decimal"
                  value={values[key] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      [key]:
                        e.target.value === ""
                          ? undefined
                          : Number.isFinite(Number(e.target.value))
                            ? Number(e.target.value)
                            : e.target.value,
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <label className="route-check">
            <input
              type="checkbox"
              checked={values.virtual}
              onChange={(e) =>
                setValues((v) => ({ ...v, virtual: e.target.checked }))
              }
            />
            Virtual
          </label>
          <label className="route-check">
            <input
              type="checkbox"
              checked={values.active}
              onChange={(e) =>
                setValues((v) => ({ ...v, active: e.target.checked }))
              }
            />
            Activo
          </label>
        </fieldset>
      </form>
    </SideSheet>
  );
}

function RouteEditor({
  initial,
  revision,
  copying,
  source,
  points,
  canEdit,
  onClose,
  onSave,
}: {
  initial: RouteInput;
  revision: number;
  copying: boolean;
  source: "avansat" | "tms";
  points: Doc<"operationalPoints">[];
  canEdit: boolean;
  onClose: () => void;
  onSave: (
    value: RouteInput & { expectedRevision: number; source: "avansat" | "tms" },
  ) => Promise<void>;
}) {
  const [values, setValues] = useState<RouteInput>({
      code: copying ? "" : initial.code,
      origin: initial.origin,
      originCode: initial.originCode,
      destination: initial.destination,
      destinationCode: initial.destinationCode,
      via: initial.via,
      active: initial.active,
      stops: initial.stops,
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const saving = useRef(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await onSave({ ...values, expectedRevision: revision, source });
    } catch (err) {
      setError(convexErrorMessage(err, "No se pudo guardar."));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function stopValue(
    index: number,
    key: "pointCode" | "minutes" | "kilometers",
    value: string,
  ) {
    setValues((v) => ({
      ...v,
      stops: v.stops.map((s, i) =>
        i !== index
          ? s
          : {
              ...s,
              [key]:
                key === "pointCode"
                  ? value
                  : value === "" && key === "kilometers"
                    ? undefined
                    : source === "avansat" &&
                        (value === "" || !Number.isFinite(Number(value)))
                      ? value
                      : Number(value),
            },
      ),
    }));
  }
  const pointNames = useMemo(
    () => new Map(points.map((p) => [p.code, p])),
    [points],
  );
  return (
    <SideSheet
      label="Datos de la ruta"
      eyebrow={
        copying
          ? `Copia de la ruta ${initial.code}`
          : revision
            ? `Ruta ${initial.code}`
            : "Ruta"
      }
      title={
        copying
          ? "Copiar ruta"
          : revision
            ? canEdit
              ? "Actualizar ruta"
              : "Datos de la ruta"
            : "Insertar ruta"
      }
      description={revision || copying ? routeName(initial) : undefined}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ghost-button" disabled={busy} onClick={onClose}>
            Cerrar
          </button>
          {canEdit && (
            <button className="primary-action" disabled={busy} form="route-form" type="submit">
              {busy ? "Guardando…" : "Guardar ruta"}
            </button>
          )}
        </>
      }
    >
      <datalist id="route-point-options">
        {points.map((p) => (
          <option key={p._id} value={p.code}>
            {p.name}
            {p.active ? "" : " (Inactivo)"}
          </option>
        ))}
        <option value="9999">Lugar Entrega</option>
      </datalist>
      {error && (
        <p role="alert" className="tracking-message error">
          {error}
        </p>
      )}
      <form className="route-editor" id="route-form" onSubmit={submit}>
        <fieldset disabled={!canEdit || busy}>
          <div className="route-fields">
            {(
              [
                ["code", "Código de ruta"],
                ["origin", "Origen"],
                ["originCode", "Código origen"],
                ["destination", "Destino"],
                ["destinationCode", "Código destino"],
                ["via", "Vía"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  required={
                    key !== "via" &&
                    !(
                      source === "avansat" &&
                      ["originCode", "destinationCode"].includes(key)
                    )
                  }
                  disabled={key === "code" && revision > 0}
                  value={values[key]}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [key]: e.target.value }))
                  }
                />
              </label>
            ))}
          </div>
          <label className="route-check">
            <input
              type="checkbox"
              checked={values.active}
              onChange={(e) =>
                setValues((v) => ({ ...v, active: e.target.checked }))
              }
            />
            Activa
          </label>
          <h4>Puestos de control</h4>
          <div className="tracking-table-scroll">
            <table className="tracking-table route-stops">
              <thead>
                <tr>
                  <th>Orden</th>
                  <th>Puesto de control</th>
                  <th>Desde el origen (min)</th>
                  <th>Distancia (km)</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {values.stops.map((s, index) => (
                  <tr key={s.key}>
                    <td>{index + 1}</td>
                    <td>
                      {s.pointCode === "9999" ? (
                        <span className="route-stop-name">Lugar Entrega</span>
                      ) : (
                        <>
                          <input
                            aria-label={`Puesto ${index + 1}`}
                            list="route-point-options"
                            placeholder="Código del puesto"
                            required
                            value={s.pointCode}
                            onChange={(e) =>
                              stopValue(index, "pointCode", e.target.value.trim())
                            }
                          />
                          <span className="route-stop-name">
                            {pointNames.get(s.pointCode)?.name ??
                              (s.pointCode ? "Puesto sin registrar" : "Escribe el código o el nombre")}
                          </span>
                        </>
                      )}
                    </td>
                    <td>
                      <input
                        aria-label={`Minutos ${index + 1}`}
                        type={source === "avansat" ? "text" : "number"}
                        min={0}
                        step={1}
                        required={source === "tms"}
                        value={s.minutes}
                        onChange={(e) =>
                          stopValue(index, "minutes", e.target.value)
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Kilómetros ${index + 1}`}
                        type={source === "avansat" ? "text" : "number"}
                        min={0}
                        step="any"
                        value={s.kilometers ?? ""}
                        onChange={(e) =>
                          stopValue(index, "kilometers", e.target.value)
                        }
                      />
                    </td>
                    <td>
                      <label className="route-check">
                        <input
                          type="checkbox"
                          aria-label={`Activo ${index + 1}`}
                          checked={s.active !== false}
                          onChange={(e) =>
                            setValues((v) => ({
                              ...v,
                              stops: v.stops.map((stop, i) =>
                                i === index
                                  ? { ...stop, active: e.target.checked }
                                  : stop,
                              ),
                            }))
                          }
                        />
                        Activo
                      </label>
                      <label className="route-check">
                        <input
                          type="checkbox"
                          aria-label={`Asignado ${index + 1}`}
                          checked={s.assigned !== false}
                          onChange={(e) =>
                            setValues((v) => ({
                              ...v,
                              stops: v.stops.map((stop, i) =>
                                i === index
                                  ? { ...stop, assigned: e.target.checked }
                                  : stop,
                              ),
                            }))
                          }
                        />
                        Asignado
                      </label>
                    </td>
                    <td>
                      {s.pointCode !== "9999" && (
                        <>
                          <button
                            type="button"
                            className="text-button"
                            disabled={index === 0}
                            aria-label={`Subir puesto ${index + 1}`}
                            onClick={() =>
                              setValues((v) => {
                                const stops = [...v.stops];
                                [stops[index - 1], stops[index]] = [
                                  stops[index],
                                  stops[index - 1],
                                ];
                                return { ...v, stops };
                              })
                            }
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="text-button"
                            aria-label={`Quitar puesto ${index + 1}`}
                            onClick={() =>
                              setValues((v) => ({
                                ...v,
                                stops: v.stops.filter((_, i) => i !== index),
                              }))
                            }
                          >
                            Quitar
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canEdit && (
            <div className="route-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() =>
                  setValues((v) => {
                    const stops = [...v.stops];
                    const index =
                      stops.at(-1)?.pointCode === "9999"
                        ? stops.length - 1
                        : stops.length;
                    stops.splice(index, 0, {
                      key: crypto.randomUUID(),
                      pointCode: "",
                      minutes: stops[index - 1]?.minutes ?? 0,
                    });
                    return { ...v, stops };
                  })
                }
              >
                Adicionar puesto de control
              </button>
            </div>
          )}
        </fieldset>
      </form>
    </SideSheet>
  );
}

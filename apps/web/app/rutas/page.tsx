"use client";

import { useState, useRef, type FormEvent } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
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

export default function RoutesPage() {
  const { isAuthenticated } = useConvexAuth(),
    data = useQuery(api.routes.catalogue, isAuthenticated ? {} : "skip");
  const savePoint = useMutation(api.routes.savePoint),
    saveRoute = useMutation(api.routes.saveRoute);
  const [tab, setTab] = useState<"routes" | "points">("routes"),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0);
  const [point, setPoint] = useState<Doc<"operationalPoints"> | "new" | null>(
      null,
    ),
    [route, setRoute] = useState<Doc<"operationalRoutes"> | "new" | null>(null),
    [copy, setCopy] = useState(false);
  const [file, setFile] = useState<CatalogueImport | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const importing = useRef(false);
  if (!data)
    return (
      <div className="skeleton" role="status">
        Cargando rutas y puestos…
      </div>
    );
  const needle = search.trim().toUpperCase();
  const points = data.points.filter((p) =>
      [p.code, p.name, p.city, p.controller, p.address].some((f) =>
        f.toUpperCase().includes(needle),
      ),
    ),
    routes = data.routes.filter((r) =>
      [r.code, r.origin, r.destination, r.via].some((f) =>
        f.toUpperCase().includes(needle),
      ),
    );
  async function importFile() {
    if (!file || !data || importing.current) return;
    importing.current = true;
    setBusy(true);
    setError("");
    let saved = 0,
      unchanged = 0;
    try {
      for (const p of file.points) {
        const current = data.points.find((r) => r.code === p.code);
        if (current && current.source !== "avansat")
          throw new Error(`El puesto ${p.code} ya pertenece al catálogo TMS.`);
        if (current && sameCatalogueRecord(current, p)) {
          unchanged++;
          continue;
        }
        await savePoint({
          ...p,
          expectedRevision: current?.revision ?? 0,
          source: "avansat",
        });
        saved++;
        setMessage(`${saved} registros importados…`);
      }
      for (const r of file.routes) {
        const current = data.routes.find((p) => p.code === r.code);
        if (current && current.source !== "avansat")
          throw new Error(`La ruta ${r.code} ya pertenece al catálogo TMS.`);
        if (current && sameCatalogueRecord(current, r)) {
          unchanged++;
          continue;
        }
        await saveRoute({
          ...r,
          expectedRevision: current?.revision ?? 0,
          source: "avansat",
        });
        saved++;
        setMessage(`${saved} registros importados…`);
      }
      setMessage(
        `Importación terminada: ${saved} guardados, ${unchanged} sin cambios.`,
      );
      setFile(null);
    } catch (e) {
      setError(
        `${convexErrorMessage(e, "No se pudo importar.")} Se guardaron ${saved} registros; puedes revisar y repetir el archivo.`,
      );
    } finally {
      setBusy(false);
      importing.current = false;
    }
  }
  function exportCatalogue() {
    if (!data) return;
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
  }
  return (
    <div className="tracking-workspace route-workspace">
      <div className="tracking-heading">
        <div>
          <span className="eyebrow">Rutas y P. Control</span>
          <h2>Rutas y puestos de control</h2>
          <p>Catálogo operativo y tiempos desde el origen</p>
        </div>
        <button className="ghost-button" onClick={exportCatalogue}>
          Exportar catálogo
        </button>
      </div>
      {message && (
        <p role="status" className="tracking-message success">
          {message}
        </p>
      )}
      {error && (
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
              onClick={() => {
                setTab("routes");
                setSearch("");
                setPage(0);
              }}
            >
              Rutas
            </button>
            <button
              role="tab"
              aria-selected={tab === "points"}
              onClick={() => {
                setTab("points");
                setSearch("");
                setPage(0);
              }}
            >
              Puestos de control
            </button>
          </div>
          <label>
            Buscar
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
          {data.canEdit && (
            <button
              className="primary-action"
              disabled={busy}
              onClick={() => {
                setError("");
                setCopy(false);
                if (tab === "points") setPoint("new");
                else setRoute("new");
              }}
            >
              Insertar {tab === "points" ? "puesto" : "ruta"}
            </button>
          )}
        </div>
        <div className="tracking-table-scroll">
          <table className="tracking-table">
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
                ? routes.slice(page * 100, (page + 1) * 100).map((r) => (
                    <tr key={r._id}>
                      <td>{r.code}</td>
                      <td>{routeName(r)}</td>
                      <td>{r.stops.length}</td>
                      <td>{r.active ? "Activa" : "Inactiva"}</td>
                      <td>{r.source === "avansat" ? "Avansat" : "TMS"}</td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => {
                            setCopy(false);
                            setRoute(r);
                          }}
                        >
                          Ver {data.canEdit ? "/ actualizar" : ""}
                        </button>
                        {data.canEdit && (
                          <button
                            className="text-button"
                            onClick={() => {
                              setCopy(true);
                              setRoute(r);
                            }}
                          >
                            Copiar ruta
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                : points.slice(page * 100, (page + 1) * 100).map((p) => (
                    <tr key={p._id}>
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
                          onClick={() => setPoint(p)}
                        >
                          Ver {data.canEdit ? "/ actualizar" : ""}
                        </button>
                      </td>
                    </tr>
                  ))}
              {!(tab === "routes" ? routes : points).length && (
                <tr>
                  <td colSpan={9} className="tracking-empty">
                    No hay registros que coincidan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="route-actions" aria-label="Paginación del catálogo">
          <span>
            {tab === "routes" ? routes.length : points.length} registros ·
            página {page + 1} de{" "}
            {Math.max(
              1,
              Math.ceil(
                (tab === "routes" ? routes.length : points.length) / 100,
              ),
            )}
          </span>
          <button
            className="ghost-button"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </button>
          <button
            className="ghost-button"
            disabled={
              (page + 1) * 100 >=
              (tab === "routes" ? routes.length : points.length)
            }
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
          </button>
        </div>
      </section>
      {point && (
        <PointEditor
          key={typeof point === "string" ? "new" : point._id}
          initial={point === "new" ? blankPoint : point}
          revision={point === "new" ? 0 : point.revision}
          source={point === "new" ? "tms" : point.source}
          canEdit={data.canEdit}
          onClose={() => setPoint(null)}
          onSave={async (values) => {
            await savePoint(values);
            setPoint(null);
            setMessage("Puesto guardado.");
          }}
        />
      )}
      {route && (
        <RouteEditor
          key={`${typeof route === "string" ? "new" : route._id}:${copy}`}
          initial={route === "new" ? blankRoute : route}
          revision={route === "new" || copy ? 0 : route.revision}
          copying={copy}
          source={route === "new" || copy ? "tms" : route.source}
          points={data.points}
          canEdit={data.canEdit}
          onClose={() => setRoute(null)}
          onSave={async (values) => {
            await saveRoute(values);
            setRoute(null);
            setMessage("Ruta guardada.");
          }}
        />
      )}
      {data.canEdit && (
        <section className="panel route-import">
          <h3>Importar catálogo Avansat</h3>
          <p>
            Conserva códigos, nombres, tiempos y el orden de los puestos.
            Repetir el mismo archivo conserva los registros que no cambiaron.
          </p>
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
            <div>
              <p>
                {file.points.length} puestos · {file.routes.length} rutas. Los
                cambios se aplican al catálogo; los planes ya asignados
                conservan su versión.
              </p>
              <button
                className="primary-action"
                disabled={busy}
                onClick={() => void importFile()}
              >
                {busy ? "Importando…" : "Importar catálogo revisado"}
              </button>
              <button
                className="ghost-button"
                disabled={busy}
                onClick={() => setFile(null)}
              >
                Cancelar
              </button>
            </div>
          )}
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
        </section>
      )}
    </div>
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
    <section className="panel route-editor" aria-label="Datos del puesto">
      <h3>{revision ? "Actualizar puesto" : "Insertar puesto"}</h3>
      {error && (
        <p role="alert" className="tracking-message error">
          {error}
        </p>
      )}
      <form onSubmit={submit}>
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
          {canEdit && (
            <button className="primary-action" type="submit">
              {busy ? "Guardando…" : "Guardar puesto"}
            </button>
          )}
        </fieldset>
        <button
          type="button"
          className="ghost-button"
          disabled={busy}
          onClick={onClose}
        >
          Cerrar
        </button>
      </form>
    </section>
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
  return (
    <section className="panel route-editor" aria-label="Datos de la ruta">
      <h3>
        {copying
          ? "Copiar ruta"
          : revision
            ? "Actualizar ruta"
            : "Insertar ruta"}
      </h3>
      {error && (
        <p role="alert" className="tracking-message error">
          {error}
        </p>
      )}
      <form onSubmit={submit}>
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
                      <select
                        aria-label={`Puesto ${index + 1}`}
                        value={s.pointCode}
                        disabled={s.pointCode === "9999"}
                        onChange={(e) =>
                          stopValue(index, "pointCode", e.target.value)
                        }
                      >
                        <option value="">Seleccionar puesto</option>
                        {points.map((p) => (
                          <option key={p._id} value={p.code}>
                            {p.code} · {p.name}
                            {p.active ? "" : " (Inactivo)"}
                          </option>
                        ))}
                        <option value="9999">Lugar Entrega</option>
                      </select>
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
              <button className="primary-action" type="submit">
                {busy ? "Guardando…" : "Guardar ruta"}
              </button>
            </div>
          )}
        </fieldset>
        <button
          type="button"
          className="ghost-button"
          disabled={busy}
          onClick={onClose}
        >
          Cerrar
        </button>
      </form>
    </section>
  );
}

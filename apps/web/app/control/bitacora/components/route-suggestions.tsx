"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { formatDate } from "./format";

type Point = { name: string; department: string; lat: number; lng: number; onRoad: boolean };
type Suggestion = { id: string; distanceKm: number; durationMin: number; all: Array<Point & { km: number }>; main: string[] };

const MAX_MAIN = 7;
const NEAR_KM = 5;

const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es").replace(/\bd\.?c\.?$/i, "").replace(/[^a-z0-9 ]/g, "").trim();
const first = (v: string) => norm(v.split(",")[0]);

function projectKm(lat: number) {
  const kx = Math.cos(lat * (Math.PI / 180)) * 111.32;
  return (p: number[]) => [p[0] * kx, p[1] * 110.57];
}

function municipalitiesAlong(line: number[][], points: Point[], skip: string[]): Array<Point & { km: number }> {
  if (line.length < 2) return [];
  const proj = projectKm(line[Math.floor(line.length / 2)][1]);
  const segs = line.map(proj);
  const cumulative: number[] = [0];
  for (let i = 1; i < segs.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(segs[i][0] - segs[i - 1][0], segs[i][1] - segs[i - 1][1]));
  const minX = Math.min(...segs.map((p) => p[0])) - NEAR_KM, maxX = Math.max(...segs.map((p) => p[0])) + NEAR_KM;
  const minY = Math.min(...segs.map((p) => p[1])) - NEAR_KM, maxY = Math.max(...segs.map((p) => p[1])) + NEAR_KM;
  const skipKeys = skip.map(first);
  const found: Array<Point & { km: number; d: number }> = [];
  for (const point of points) {
    if (skipKeys.includes(first(point.name))) continue;
    const [px, py] = proj([point.lng, point.lat]);
    if (px < minX || px > maxX || py < minY || py > maxY) continue;
    let best = Infinity, bestKm = 0;
    for (let i = 1; i < segs.length; i++) {
      const [ax, ay] = segs[i - 1], [bx, by] = segs[i];
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d < best) {
        best = d;
        bestKm = cumulative[i - 1] + t * Math.sqrt(len2);
      }
    }
    if (best <= NEAR_KM) found.push({ ...point, km: bestKm, d: best });
  }
  found.sort((a, b) => a.km - b.km);
  const deduped = found.filter((p, i) => i === 0 || first(p.name) !== first(found[i - 1].name));
  return deduped.map(({ d: _d, ...rest }) => ({ ...rest, name: rest.name.split(",")[0].trim() }));
}

function pickMain(all: Array<Point & { km: number }>, totalKm: number): string[] {
  if (all.length <= MAX_MAIN) return all.map((p) => p.name);
  const target = Math.min(MAX_MAIN, Math.max(3, Math.round(totalKm / 60)));
  const spacing = totalKm / (target + 1);
  const chosen: string[] = [];
  for (let i = 1; i <= target; i++) {
    const ideal = i * spacing;
    const candidates = all.filter((p) => !chosen.includes(p.name) && Math.abs(p.km - ideal) <= spacing * 0.5);
    const pool = candidates.length ? candidates : all.filter((p) => !chosen.includes(p.name));
    const pick = [...pool].sort((a, b) => Number(b.onRoad) - Number(a.onRoad) || Math.abs(a.km - ideal) - Math.abs(b.km - ideal))[0];
    if (pick) chosen.push(pick.name);
  }
  return all.filter((p) => chosen.includes(p.name)).map((p) => p.name);
}

export function RouteSuggestions({ origin, destination, onUse }: { origin: string; destination: string; onUse: (waypoints: string[], deliveryWaypoints?: string[]) => void }) {
  const points = useQuery(api.monitoring.municipalityPoints, origin && destination ? {} : "skip");
  const previous = useQuery(api.monitoring.previousRoutes, origin && destination ? { origin, destination } : "skip");
  const [state, setState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [custom, setCustom] = useState<Record<string, string[]>>({});

  const endpoints = useMemo(() => {
    if (!points || !origin || !destination) return null;
    const find = (label: string) => {
      const parts = label.split(",").map((s) => norm(s)).filter(Boolean);
      const key = parts[0] ?? "";
      if (!key) return null;
      const matches = points.filter((p) => first(p.name) === key);
      return matches.find((p) => parts.slice(1).some((part) => norm(p.department) === part || norm(p.department).startsWith(part))) ?? matches[0] ?? null;
    };
    const a = find(origin), b = find(destination);
    return a && b ? { a, b } : null;
  }, [points, origin, destination]);

  useEffect(() => {
    if (!endpoints || !points) return;
    const controller = new AbortController();
    setState("loading");
    setSuggestions([]);
    setCustom({});
    fetch(`https://router.project-osrm.org/route/v1/driving/${endpoints.a.lng},${endpoints.a.lat};${endpoints.b.lng},${endpoints.b.lat}?alternatives=2&overview=full&geometries=geojson&steps=false`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { code?: string; routes?: Array<{ distance: number; duration: number; geometry: { coordinates: number[][] } }> }) => {
        if (body.code !== "Ok" || !body.routes?.length) throw new Error("no-route");
        const built = body.routes.slice(0, 2).map((route, index) => {
          const line = route.geometry.coordinates.filter((_, i, arr) => i % Math.max(1, Math.floor(arr.length / 700)) === 0 || i === arr.length - 1);
          const all = municipalitiesAlong(line, points, [origin, destination]);
          const distanceKm = Math.round(route.distance / 100) / 10;
          return { id: `r${index}`, distanceKm, durationMin: Math.round(route.duration / 60), all, main: pickMain(all, distanceKm) };
        });
        const distinct = built.filter((s, i) => i === 0 || s.main.join("|") !== built[0].main.join("|"));
        setSuggestions(distinct);
        setState("ready");
      })
      .catch(() => setState("failed"));
    return () => controller.abort();
  }, [endpoints, points, origin, destination]);

  if (!origin || !destination) return null;

  const selectionOf = (s: Suggestion) => custom[s.id] ?? s.main;
  const toggle = (s: Suggestion, name: string) => {
    const current = selectionOf(s);
    const next = current.includes(name) ? current.filter((n) => n !== name) : s.all.filter((p) => current.includes(p.name) || p.name === name).map((p) => p.name);
    setCustom({ ...custom, [s.id]: next });
  };

  return (
    <div className="bm-suggestions">
      <div className="bm-suggestions-head">
        <span className="eyebrow">Rutas sugeridas</span>
        <small>Propuestas para {origin.split(",")[0]} → {destination.split(",")[0]}. Puedes usarlas tal cual o ajustar los puntos después.</small>
      </div>
      {previous?.map((route, index) => (
        <article className="bm-suggestion previous" key={`p${index}`}>
          <header>
            <strong>Ruta usada antes por la empresa</strong>
            <span>{route.uses} {route.uses === 1 ? "viaje" : "viajes"} · última vez {formatDate(route.lastUsedAt)} ({route.lastCode})</span>
          </header>
          <div className="bm-suggestion-stops">
            {route.waypoints.map((w, i) => (
              <span key={w} className={`bm-stop ${route.deliveryWaypoints.includes(w) ? "delivery" : ""}`}>{i + 1}. {w}{route.deliveryWaypoints.includes(w) ? " · entrega" : ""}</span>
            ))}
          </div>
          <button className="ghost-button" type="button" onClick={() => onUse(route.waypoints, route.deliveryWaypoints)}>Usar esta ruta</button>
        </article>
      ))}
      {state === "loading" ? <p className="bm-suggestion-note">Calculando rutas por carretera…</p> : null}
      {state === "failed" ? <p className="bm-suggestion-note">No fue posible calcular la ruta por carretera en este momento. Puedes escribir los puntos manualmente.</p> : null}
      {endpoints === null && points && state !== "loading" ? <p className="bm-suggestion-note">No se encontraron coordenadas para el origen o el destino.</p> : null}
      {suggestions.map((s, index) => {
        const selected = selectionOf(s);
        const open = expanded === s.id;
        return (
          <article className="bm-suggestion" key={s.id}>
            <header>
              <strong>{suggestions.length > 1 ? `Ruta ${index + 1} por carretera` : "Ruta por carretera"}{index === 0 ? " · recomendada" : " · alternativa"}</strong>
              <span>{s.distanceKm.toLocaleString("es-CO")} km · {Math.floor(s.durationMin / 60)} h {s.durationMin % 60} min · pasa por {s.all.length} municipios</span>
            </header>
            <div className="bm-suggestion-stops">
              {(open ? s.all.map((p) => p.name) : selected).map((name) => {
                const on = selected.includes(name);
                return (
                  <button key={name} type="button" className={`bm-stop ${on ? "on" : "off"}`} aria-pressed={on} onClick={() => toggle(s, name)} title={on ? "Quitar de la ruta" : "Agregar a la ruta"}>
                    {on ? `${selected.indexOf(name) + 1}. ` : "+ "}{name}
                  </button>
                );
              })}
              {!selected.length ? <span className="bm-suggestion-note">Sin puntos intermedios seleccionados.</span> : null}
            </div>
            <div className="bm-suggestion-actions">
              <button className="ghost-button" type="button" onClick={() => onUse(selected)}>Usar esta ruta ({selected.length} puntos)</button>
              {s.all.length > selected.length || open ? (
                <button className="text-button" type="button" onClick={() => setExpanded(open ? null : s.id)}>{open ? "Ver solo los principales" : `Ver los ${s.all.length} municipios de la vía`}</button>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

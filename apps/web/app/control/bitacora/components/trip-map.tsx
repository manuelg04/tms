"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import OlMap from "ol/Map";
import View from "ol/View";
import Overlay from "ol/Overlay";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import LineString from "ol/geom/LineString";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import OSM from "ol/source/OSM";
import VectorSource from "ol/source/Vector";
import { fromLonLat } from "ol/proj";
import { defaults as defaultInteractions } from "ol/interaction/defaults";
import Zoom from "ol/control/Zoom";
import Attribution from "ol/control/Attribution";
import { Circle, Fill, Stroke, Style, Text } from "ol/style";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { channelLabels, formatDate, formatDateTime, formatTime, kindLabels } from "./format";
import "ol/ol.css";

type MapData = NonNullable<ReturnType<typeof useQuery<typeof api.monitoring.mapData>>>;
type MapReport = MapData["reports"][number];

const COLORS = {
  ink: "#1b2734",
  navy: "#1f2b3d",
  ok: "#17784b",
  warn: "#b8860b",
  bad: "#bd3838",
  plate: "#ffc72c",
  pending: "#b9c2cc",
  offRoute: "#7c3aed",
  planned: "#8b99a8",
};

function distanceKmToLine(point: number[], line: number[][]): number {
  const kx = Math.cos(point[1] * (Math.PI / 180)) * 111.32;
  const ky = 110.57;
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = line[i - 1][0] * kx, ay = line[i - 1][1] * ky, bx = line[i][0] * kx, by = line[i][1] * ky;
    const px = point[0] * kx, py = point[1] * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best) best = d;
  }
  return best;
}

const OFF_ROUTE_KM = 12;

async function fetchRoute(coords: number[][], signal: AbortSignal): Promise<{ coordinates: number[][]; distanceKm: number; durationMin: number }> {
  const path = coords.map((c) => `${c[0]},${c[1]}`).join(";");
  const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson&steps=false`, { signal });
  if (!r.ok) throw new Error(String(r.status));
  const body = (await r.json()) as { code?: string; routes?: Array<{ distance: number; duration: number; geometry: { coordinates: number[][] } }> };
  const best = body.routes?.[0];
  if (body.code !== "Ok" || !best) throw new Error("no-route");
  return { coordinates: simplify(best.geometry.coordinates, 1800), distanceKm: Math.round(best.distance / 100) / 10, durationMin: Math.round(best.duration / 60) };
}

function simplify(points: number[][], max: number): number[][] {
  if (points.length <= max) return points.map((p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
  const step = points.length / max;
  const out: number[][] = [];
  for (let i = 0; i < max; i++) {
    const p = points[Math.floor(i * step)];
    out.push([Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
  }
  const last = points[points.length - 1];
  out.push([Math.round(last[0] * 1e5) / 1e5, Math.round(last[1] * 1e5) / 1e5]);
  return out;
}

const dateKey = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
const shortDay = (ms: number) => new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short" }).format(ms).replace(".", "");

export function TripMap({ tripId, tripStatus, interactive = true, height = 420, onSummary }: { tripId: Id<"monitoringTrips">; tripStatus: "en_ruta" | "entregado"; interactive?: boolean; height?: number; onSummary?: (summary: { distanceKm: number; durationMin: number } | null) => void }) {
  const data = useQuery(api.monitoring.mapData, { tripId });
  const saveRoute = useMutation(api.monitoring.saveRouteGeometry);
  const container = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<MapReport | null>(null);
  const [offRouteCount, setOffRouteCount] = useState(0);
  const [route, setRoute] = useState<{ coordinates: number[][]; distanceKm: number; durationMin: number; approximate: boolean } | null>(null);
  const [routeState, setRouteState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const requested = useRef<string | null>(null);
  const [actual, setActual] = useState<{ coordinates: number[][]; distanceKm: number; durationMin: number } | null>(null);
  const requestedActual = useRef<string | null>(null);

  const located = data?.stops.filter((s) => s.lat !== null && s.lng !== null) ?? [];
  const stopsKey = data?.stopsKey ?? "";

  useEffect(() => {
    if (!data) return;
    if (data.routeGeometry) {
      setRoute({ coordinates: data.routeGeometry.coordinates, distanceKm: data.routeGeometry.distanceKm, durationMin: data.routeGeometry.durationMin, approximate: false });
      setRouteState("ready");
      return;
    }
    if (located.length < 2 || requested.current === stopsKey) return;
    requested.current = stopsKey;
    setRouteState("loading");
    const controller = new AbortController();
    fetchRoute(located.map((s) => [s.lng!, s.lat!]), controller.signal)
      .then(async (geometry) => {
        setRoute({ ...geometry, approximate: false });
        setRouteState("ready");
        await saveRoute({ tripId, stopsKey, ...geometry, target: "planned" }).catch(() => undefined);
      })
      .catch(() => {
        setRoute({ coordinates: located.map((s) => [s.lng!, s.lat!]), distanceKm: 0, durationMin: 0, approximate: true });
        setRouteState("failed");
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.routeGeometry, stopsKey, tripId]);

  const reportsKey = data?.reportsKey ?? "";
  useEffect(() => {
    if (!data) return;
    if (data.actualGeometry) {
      setActual({ coordinates: data.actualGeometry.coordinates, distanceKm: data.actualGeometry.distanceKm, durationMin: data.actualGeometry.durationMin });
      return;
    }
    const points = data.reports.filter((r) => r.lat !== null && r.lng !== null).map((r) => [r.lng!, r.lat!]);
    const distinct = points.filter((p, i) => i === 0 || Math.abs(p[0] - points[i - 1][0]) > 1e-4 || Math.abs(p[1] - points[i - 1][1]) > 1e-4);
    if (distinct.length < 2 || requestedActual.current === reportsKey) {
      if (distinct.length < 2) setActual(null);
      return;
    }
    requestedActual.current = reportsKey;
    const controller = new AbortController();
    fetchRoute(distinct, controller.signal)
      .then(async (geometry) => {
        setActual(geometry);
        await saveRoute({ tripId, stopsKey: reportsKey, ...geometry, target: "actual" }).catch(() => undefined);
      })
      .catch(() => setActual({ coordinates: distinct, distanceKm: 0, durationMin: 0 }));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.actualGeometry, reportsKey, tripId]);

  useEffect(() => {
    onSummary?.(route && !route.approximate ? { distanceKm: route.distanceKm, durationMin: route.durationMin } : null);
  }, [route, onSummary]);

  useEffect(() => {
    if (!container.current || !data || located.length === 0) return;
    const stopReports = new Map<number, MapReport>();
    for (const report of data.reports) {
      if (report.stopIndex === null) continue;
      const current = stopReports.get(report.stopIndex);
      if (!current || (report.kind === "entrega" && current.kind !== "entrega")) stopReports.set(report.stopIndex, report);
    }
    const departureDay = data.reports[0] ? dateKey(data.reports[0].at) : "";

    const lineSource = new VectorSource();
    const hasActual = Boolean(actual && actual.coordinates.length >= 2);
    if (route) lineSource.addFeature(new Feature({ geometry: new LineString(route.coordinates.map((c) => fromLonLat(c))) }));
    const lineLayer = new VectorLayer({
      source: lineSource,
      style: hasActual
        ? [
            new Style({ stroke: new Stroke({ color: "rgba(255,255,255,0.9)", width: 8 }) }),
            new Style({ stroke: new Stroke({ color: COLORS.planned, width: 3.5, lineDash: [8, 7], lineCap: "round", lineJoin: "round" }) }),
          ]
        : [
            new Style({ stroke: new Stroke({ color: "rgba(255,255,255,0.9)", width: 9 }) }),
            new Style({ stroke: new Stroke({ color: COLORS.navy, width: 4.5, lineDash: route?.approximate ? [10, 8] : undefined, lineCap: "round", lineJoin: "round" }) }),
          ],
    });
    const actualSource = new VectorSource();
    if (hasActual) actualSource.addFeature(new Feature({ geometry: new LineString(actual!.coordinates.map((c) => fromLonLat(c))) }));
    const actualLayer = new VectorLayer({
      source: actualSource,
      style: [
        new Style({ stroke: new Stroke({ color: "rgba(255,255,255,0.9)", width: 9 }) }),
        new Style({ stroke: new Stroke({ color: COLORS.navy, width: 4.5, lineCap: "round", lineJoin: "round" }) }),
      ],
    });
    const plannedLine = route && !route.approximate ? route.coordinates : null;

    const pinSource = new VectorSource();
    const total = data.stops.length;
    for (const stop of data.stops) {
      if (stop.lat === null || stop.lng === null) continue;
      const report = stopReports.get(stop.index);
      const isEnd = stop.index === total - 1;
      const delivered = isEnd && tripStatus === "entregado";
      const deliveredHere = delivered || report?.kind === "entrega_parcial" || report?.kind === "entrega";
      const state = report?.hasNovelty ? "novedad" : deliveredHere || report ? "reportado" : "pendiente";
      const fill = state === "novedad" ? (/(accidente|siniestro|sin contacto)/i.test(report?.noveltyType ?? "") ? COLORS.bad : COLORS.warn) : state === "reportado" ? (deliveredHere ? COLORS.plate : stop.index === 0 ? COLORS.navy : COLORS.ok) : "#ffffff";
      const textColor = deliveredHere ? COLORS.ink : state === "pendiente" ? "#7a8794" : "#ffffff";
      const ringColor = state === "pendiente" ? (stop.deliverySite ? "#c9a227" : COLORS.pending) : "#ffffff";
      const time = report ? formatTime(report.at) : "pendiente";
      const left = stop.index % 2 === 1;
      const dayPrefix = report && dateKey(report.at) !== departureDay ? `${shortDay(report.at)} ` : "";
      const feature = new Feature({ geometry: new Point(fromLonLat([stop.lng, stop.lat])), report, stop });
      feature.setStyle([
        new Style({
          image: new Circle({ radius: 12, fill: new Fill({ color: fill }), stroke: new Stroke({ color: ringColor, width: 2.5, lineDash: state === "pendiente" && stop.deliverySite ? [3, 3] : undefined }), declutterMode: "none" }),
          text: new Text({ text: String(stop.index + 1), font: "700 11px Archivo, system-ui, sans-serif", fill: new Fill({ color: textColor }), declutterMode: "none" }),
          zIndex: 10,
        }),
        new Style({
          text: new Text({
            text: `${stop.name.split(",")[0]}\n${dayPrefix}${time}`,
            font: "600 11.5px Archivo, system-ui, sans-serif",
            fill: new Fill({ color: state === "pendiente" ? "#7a8794" : COLORS.ink }),
            stroke: new Stroke({ color: "rgba(255,255,255,0.95)", width: 4 }),
            textAlign: left ? "right" : "left",
            justify: left ? "right" : "left",
            offsetX: left ? -17 : 17,
            offsetY: 1,
            padding: [2, 4, 2, 4],
          }),
          zIndex: 9,
        }),
      ]);
      pinSource.addFeature(feature);
    }
    const offRoute: MapReport[] = [];
    for (const report of data.reports) {
      if (report.stopIndex !== null || report.lat === null || report.lng === null) continue;
      const isOff = plannedLine ? distanceKmToLine([report.lng, report.lat], plannedLine) > OFF_ROUTE_KM : false;
      if (isOff) offRoute.push(report);
      const feature = new Feature({ geometry: new Point(fromLonLat([report.lng, report.lat])), report });
      const fill = isOff ? COLORS.offRoute : report.kind === "entrega_parcial" ? COLORS.plate : report.hasNovelty ? COLORS.warn : COLORS.ok;
      const label = isOff ? `Fuera de ruta · ${report.location.split(",")[0]}\n${formatTime(report.at)}` : `${report.location.split(",")[0]}\n${formatTime(report.at)}`;
      feature.setStyle([
        new Style({ image: new Circle({ radius: isOff ? 9 : 6.5, fill: new Fill({ color: fill }), stroke: new Stroke({ color: "#ffffff", width: 2 }), declutterMode: "none" }), zIndex: 8 }),
        new Style({ text: new Text({ text: label, font: `${isOff ? "700" : "600"} 10.5px Archivo, system-ui, sans-serif`, fill: new Fill({ color: isOff ? COLORS.offRoute : COLORS.ink }), stroke: new Stroke({ color: "rgba(255,255,255,0.95)", width: 4 }), textAlign: "left", justify: "left", offsetX: isOff ? 14 : 11, offsetY: 1 }), zIndex: 7 }),
      ]);
      pinSource.addFeature(feature);
    }
    setOffRouteCount(offRoute.length);
    const pinLayer = new VectorLayer({ source: pinSource, declutter: true });

    const overlay = new Overlay({ element: popupRef.current ?? undefined, positioning: "bottom-center", offset: [0, -16], stopEvent: true, autoPan: { margin: 24, animation: { duration: 200 } } });
    const map = new OlMap({
      target: container.current,
      layers: [
        new TileLayer({ className: "bm-basemap", source: new OSM({ crossOrigin: "anonymous" }) }),
        lineLayer,
        actualLayer,
        pinLayer,
      ],
      overlays: [overlay],
      controls: interactive ? [new Zoom({ zoomInTipLabel: "Acercar", zoomOutTipLabel: "Alejar" }), new Attribution({ collapsible: false })] : [new Attribution({ collapsible: false })],
      interactions: interactive ? defaultInteractions() : [],
      view: new View({ center: fromLonLat([-74, 5]), zoom: 6 }),
    });
    const extentSource = new VectorSource();
    for (const src of [lineSource, actualSource, pinSource]) extentSource.addFeatures(src.getFeatures().map((f) => f.clone()));
    const extent = extentSource.getExtent();
    if (extent && Number.isFinite(extent[0])) map.getView().fit(extent, { padding: [48, 120, 48, 48], maxZoom: 11 });
    if (interactive) {
      map.on("pointermove", (event) => {
        const hit = map.hasFeatureAtPixel(event.pixel);
        map.getTargetElement().style.cursor = hit ? "pointer" : "";
      });
      map.on("singleclick", (event) => {
        const feature = map.forEachFeatureAtPixel(event.pixel, (f) => f);
        const report = (feature?.get("report") as MapReport | undefined) ?? null;
        setSelected(report);
        overlay.setPosition(report && feature ? (feature.getGeometry() as Point).getCoordinates() : undefined);
      });
    }
    return () => {
      overlay.setElement(undefined);
      map.setTarget(undefined);
      map.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, route, actual, interactive, tripStatus]);

  if (!data) return <div className="skeleton" style={{ height }}>Cargando mapa…</div>;
  if (located.length === 0)
    return <div className="bm-map-empty" style={{ height: Math.min(height, 140) }}>No fue posible ubicar los municipios de la ruta en el mapa.</div>;
  const unlocated = data.stops.filter((s) => s.lat === null);
  return (
    <div className="bm-map">
      <div ref={container} className="bm-map-canvas" style={{ height }} role="region" aria-label="Mapa de la ruta y los reportes" />
      <div className="bm-map-legend">
        <span><i style={{ background: COLORS.navy }} /> Origen</span>
        <span><i style={{ background: COLORS.ok }} /> Reportado</span>
        <span><i style={{ background: COLORS.warn }} /> Con novedad</span>
        <span><i style={{ background: COLORS.plate, borderColor: "#23201a" }} /> Entrega</span>
        <span><i style={{ background: "#fff", borderColor: COLORS.pending }} /> Pendiente</span>
        {offRouteCount ? <span><i style={{ background: COLORS.offRoute }} /> Fuera de ruta</span> : null}
        {actual ? (
          <>
            <span><b className="bm-line planned" /> Ruta planeada</span>
            <span><b className="bm-line actual" /> Trayecto reportado</span>
          </>
        ) : null}
        <span className="bm-map-caption">
          {route && !route.approximate ? `Planeada ${route.distanceKm.toLocaleString("es-CO")} km · ${Math.floor(route.durationMin / 60)} h ${route.durationMin % 60} min` : routeState === "loading" ? "Calculando la ruta por carretera…" : "Trazo aproximado entre puntos"}
          {actual && actual.distanceKm ? ` · Reportado ${actual.distanceKm.toLocaleString("es-CO")} km` : ""}
          {offRouteCount ? ` · ${offRouteCount} reporte${offRouteCount === 1 ? "" : "s"} fuera de la ruta planeada` : ""}
          {unlocated.length ? ` · Sin ubicar: ${unlocated.map((s) => s.name).join(", ")}` : ""}
        </span>
      </div>
      <div ref={popupRef} className="bm-map-popup" hidden={!selected}>
        {selected ? (
          <>
            <button type="button" aria-label="Cerrar" onClick={() => setSelected(null)}>×</button>
            <span className={`bm-kind ${selected.hasNovelty ? "novedad" : ""}`}>{selected.kind === "novedad" ? selected.noveltyType ?? "Novedad" : kindLabels[selected.kind]}</span>
            <strong>{selected.location}</strong>
            <small>{formatDateTime(selected.at)} · {channelLabels[selected.channel]}{selected.contacted ? "" : " · sin respuesta"}</small>
            <p>{selected.observation}</p>
            <small>Registró {selected.operatorName} · {formatDate(selected.at)}</small>
          </>
        ) : null}
      </div>
    </div>
  );
}

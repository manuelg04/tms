"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Map from "ol/Map";
import View from "ol/View";
import Overlay from "ol/Overlay";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import OSM from "ol/source/OSM";
import VectorSource from "ol/source/Vector";
import { fromLonLat } from "ol/proj";
import { Circle, Fill, Stroke, Style } from "ol/style";
import type { Doc } from "../../../convex/_generated/dataModel";
import "ol/ol.css";

export default function RouteMap({
  positions,
}: {
  positions: Doc<"trackingPositions">[];
}) {
  const container = useRef<HTMLDivElement>(null),
    overlayRef = useRef<Overlay | null>(null);
  const [popup] = useState(() => document.createElement("div"));
  const [selected, setSelected] = useState<Doc<"trackingPositions"> | null>(
    null,
  );
  const signature = positions.map((point) => point._id).join(",");
  const stablePositions = useMemo(() => positions, [signature]);
  useEffect(() => {
    if (!container.current || !stablePositions.length) return;
    const source = new VectorSource({
      features: stablePositions.map(
        (point) =>
          new Feature({
            geometry: new Point(fromLonLat([point.longitude, point.latitude])),
            point,
          }),
      ),
    });
    const overlay = new Overlay({
      element: popup,
      positioning: "bottom-center",
      offset: [0, -12],
      autoPan: { animation: { duration: 150 } },
    });
    overlayRef.current = overlay;
    const markerStyle = new Style({
      image: new Circle({
        radius: 7,
        fill: new Fill({ color: "#17784b" }),
        stroke: new Stroke({ color: "white", width: 2 }),
      }),
    });
    const map = new Map({
      target: container.current,
      layers: [
        new TileLayer({ source: new OSM() }),
        new VectorLayer({ source, style: markerStyle }),
      ],
      overlays: [overlay],
      view: new View({ center: fromLonLat([-74, 5]), zoom: 6 }),
    });
    const extent = source.getExtent();
    if (extent)
      map.getView().fit(extent, { padding: [55, 40, 55, 40], maxZoom: 12 });
    map.on("singleclick", (event) => {
      const point = map.forEachFeatureAtPixel(event.pixel, (feature) =>
        feature.get("point"),
      ) as Doc<"trackingPositions"> | undefined;
      setSelected(point ?? null);
      overlay.setPosition(
        point ? fromLonLat([point.longitude, point.latitude]) : undefined,
      );
    });
    return () => {
      overlay.setElement(undefined);
      map.setTarget(undefined);
      map.dispose();
      overlayRef.current = null;
    };
  }, [stablePositions, popup]);
  return (
    <div className="tracking-map">
      <div
        ref={container}
        className="tracking-map-canvas"
        role="region"
        aria-label="Recorrido histórico del vehículo"
        tabIndex={0}
      />
      {createPortal(
        <div className="tracking-map-popup" hidden={!selected}>
          {selected ? (
            <>
              <button
                type="button"
                aria-label="Cerrar detalle de posición"
                onClick={() => {
                  setSelected(null);
                  overlayRef.current?.setPosition(undefined);
                }}
              >
                ×
              </button>
              <strong>{selected.event}</strong>
              <p>Fecha {selected.recordedAt}</p>
              <p>Ubicación: {selected.location}</p>
              {selected.speed !== undefined ? (
                <p>Velocidad: {selected.speed}</p>
              ) : null}
            </>
          ) : null}
        </div>,
        popup,
      )}
    </div>
  );
}

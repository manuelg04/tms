"use client";

import { useState } from "react";

export type RouteView = { origin?: string; destination?: string };

type RouteReview = {
  origin: { code?: string; city?: string };
  destination: { code?: string; city?: string };
  sameMunicipality: boolean;
  blockers: string[];
  differences: string[];
};

function cityKey(value: string | undefined): string {
  return (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function sameCityName(route: RouteView): boolean {
  return Boolean(route.origin && route.destination && cityKey(route.origin) === cityKey(route.destination));
}

export function routeFromForm(form: HTMLFormElement | null, fallback: RouteView): RouteView {
  const read = (suffix: string) => form?.querySelector<HTMLInputElement>(`input[name$="${suffix}"]`)?.value.trim() || undefined;
  return { origin: read("loadingCity") ?? fallback.origin, destination: read("unloadingCity") ?? fallback.destination };
}

export function TripRouteLine({ route, large }: { route: RouteView; large?: boolean }) {
  return (
    <div className={large ? "trip-route-line large" : "trip-route-line"}>
      <span>{route.origin ?? "Origen sin definir"}</span>
      <strong aria-hidden>→</strong>
      <span>{route.destination ?? "Destino sin definir"}</span>
    </div>
  );
}

export function TripRouteNotices({ review }: { review: RouteReview }) {
  const notices = [
    ...(review.sameMunicipality ? [`El origen y el destino son el mismo municipio (${review.origin.city ?? review.origin.code}). Si el viaje es entre ciudades, corrige el destino antes de emitir.`] : []),
    ...review.blockers,
    ...review.differences
  ];
  if (notices.length === 0) return null;
  return (
    <div className="operation-notice bad trip-route-notices" role="alert">
      <span />
      <ul>
        {notices.map((notice) => <li key={notice}>{/[.!?]$/.test(notice) ? notice : `${notice}.`}</li>)}
      </ul>
    </div>
  );
}

export function EmitButtons({
  busy,
  blocked,
  confirmLabel,
  internal,
  onIntent,
  readRoute
}: {
  busy: boolean;
  blocked?: string;
  confirmLabel: string;
  internal?: boolean;
  onIntent: (emit: boolean) => void;
  readRoute: () => RouteView;
}) {
  const [confirming, setConfirming] = useState<RouteView | null>(null);

  if (confirming && !busy) {
    const same = sameCityName(confirming);
    return (
      <div className="emit-confirm" role="alertdialog" aria-label="Confirmar emisión ante el RNDC">
        <div>
          <small>Vas a emitir {confirmLabel} ante el RNDC con este recorrido</small>
          <TripRouteLine large route={confirming} />
          {same ? <p className="emit-confirm-warning">El origen y el destino son el mismo municipio. Emite así solo si el viaje es urbano.</p> : null}
        </div>
        <div className="emit-confirm-actions">
          <button className="ghost-button" onClick={() => setConfirming(null)} type="button">Volver a revisar</button>
          <button className="primary-action" form="stage-primary-form" onClick={() => { onIntent(true); setConfirming(null); }} type="submit">Confirmar y emitir</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <button className="ghost-button" disabled={busy || Boolean(blocked)} form="stage-primary-form" onClick={() => onIntent(false)} title={blocked} type="submit">
        Guardar borrador
      </button>
      {internal ? (
        <button className="primary-action" disabled={busy || Boolean(blocked)} form="stage-primary-form" onClick={() => onIntent(true)} title={blocked} type="submit">
          {busy ? "Guardando la orden…" : "Guardar orden"}
        </button>
      ) : (
        <button className="primary-action" disabled={busy || Boolean(blocked)} onClick={() => setConfirming(readRoute())} title={blocked} type="button">
          {busy ? "Guardando y transmitiendo…" : "Guardar y emitir"}
        </button>
      )}
    </>
  );
}

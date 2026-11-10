"use client";

import Link from "next/link";
import { use } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { companyProfile } from "../../../lib/company-profile";
import "./route-plan-sheet.css";

export default function RoutePlanSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { isAuthenticated } = useConvexAuth();
  const data = useQuery(api.dispatchRoutePlans.forDispatch, isAuthenticated ? { expedienteId: id as Id<"expedientes"> } : "skip");

  if (data === undefined) {
    return (
      <div className="skeleton" role="status">
        Preparando plan de ruta…
      </div>
    );
  }

  if (!data?.plan) {
    return (
      <section className="panel expediente-empty">
        <h2>Este despacho no tiene plan de ruta</h2>
        <p>Asigna una ruta desde el despacho para poder imprimirlo.</p>
        <Link className="primary-action" href={`/expedientes/${id}`}>
          Volver al despacho
        </Link>
      </section>
    );
  }

  const { plan, sheet } = data;
  const departure = plan.departureAt.replace("T", " ");
  const arrival = plan.stops.at(-1)?.scheduledAt ?? "";

  return (
    <div className="route-plan-workspace">
      <div className="route-plan-toolbar">
        <Link className="ghost-button" href={`/expedientes/${id}`}>
          ← Volver al despacho
        </Link>
        <button className="primary-action" onClick={() => window.print()} type="button">
          Imprimir
        </button>
      </div>

      <article className="route-plan-sheet">
        <header className="route-plan-sheet-head">
          <img alt="Transportes MTM" className="route-plan-logo" src="/brand/mtm-logo.png" />
          <div className="route-plan-company">
            <strong>{companyProfile.name}</strong>
            <span>
              <b>NIT:</b> {companyProfile.nit}
            </span>
            <span>
              <b>Dirección:</b> {companyProfile.address}
            </span>
            <span>
              <b>Telefonos:</b> {companyProfile.phones}
            </span>
            <h1>PLAN DE RUTA</h1>
          </div>
          <div className="route-plan-photos">
            <figure>
              <figcaption>FOTO DEL VEHICULO</figcaption>
              <div />
            </figure>
            <figure>
              <figcaption>FOTO DEL CONDUCTOR</figcaption>
              <div />
            </figure>
          </div>
        </header>

        <h2>DATOS DEL DESPACHO No. {sheet.dispatchCode}</h2>
        <div className="route-plan-row cols-4">
          <Field label="MANIFIESTO No." value={sheet.manifestNumber} />
          <Field label="ORIGEN:" value={sheet.origin} />
          <Field label="DESTINO:" value={sheet.destination} />
          <Field label="No. CARAVANA:" value="0" />
        </div>
        <div className="route-plan-row cols-7">
          <Field label="PLACA:" value={sheet.vehicle.plate} />
          <Field label="MARCA:" value={sheet.vehicle.make} />
          <Field label="MODELO:" value={sheet.vehicle.modelYear} />
          <Field label="COLOR:" value={sheet.vehicle.color} />
          <Field label="CARROCERIA:" value={sheet.vehicle.bodyType} />
          <Field label="No. REMOLQUE:" value={sheet.vehicle.trailerPlate} />
          <Field label="LÍNEA:" value={sheet.vehicle.line} />
        </div>
        <div className="route-plan-row cols-5">
          <Field label="CONDUCTOR:" value={sheet.driver.name} />
          <Field label="C.C." value={sheet.driver.document} />
          <Field label="LICENCIA DE CONDUCCIÓN:" value={sheet.driver.licenseNumber} />
          <Field label="CATEGORÍA:" value={sheet.driver.licenseCategory} />
          <Field label="TEL:" value={sheet.driver.phone} />
        </div>
        <div className="route-plan-row cols-3">
          <Field label="FECHA DE SALIDA PROGRAMADA:" value={departure} />
          <Field label="FECHA DE LLEGADA PROGRAMADA:" value={arrival} />
          <Field label="VALOR MULTA:" value={companyProfile.routePlanFine} />
        </div>

        <h2>PUESTOS DE CONTROL</h2>
        <ol className="route-plan-stops">
          {plan.stops.map((stop) => (
            <li key={stop.key}>
              <strong>{stopTitle(stop)}</strong>
              <span>{stop.kind === "delivery" ? "-" : stop.controller || stop.address || "-"}</span>
              <span>{stop.scheduledAt}:00</span>
            </li>
          ))}
        </ol>

        <p className="route-plan-observations">
          <b>OBSERVACIONES:</b> {companyProfile.routePlanObservations}
        </p>
        <div className="route-plan-signatures">
          <span>FIRMA Y SELLO AUTORIZADOS POR LA EMPRESA</span>
          <span>FIRMA Y No. CÉDULA CONDUCTOR</span>
        </div>
      </article>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <b>{label}</b> {value}
    </span>
  );
}

function stopTitle(stop: { label: string; kind: "physical" | "virtual" | "delivery" }): string {
  return stop.kind === "virtual" && !/virtual/i.test(stop.label) ? `${stop.label} (Virtual)` : stop.label;
}

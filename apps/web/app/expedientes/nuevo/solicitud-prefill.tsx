"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
import type { PartyPick, VehiclePick } from "../../components/fields/lookup-fields";
import { Skeleton } from "../../components/skeleton";
import { useQuery } from "../../lib/convex-hooks";
import "../components/operaciones-panel.css";
import {
  documentKey,
  parseMoney,
  parseTons,
  pickByDocument,
  pickByName,
  pickByPlate,
  pickMunicipality,
  pickPackaging,
  requestObservations,
  splitRoute,
  type OperacionesRequest
} from "../../lib/operaciones-request";

type PrefillState = {
  client: PartyPick | null;
  clientName: string;
  clientDocument: string;
  clientIdType: string;
  sender: PartyPick | null;
  senderName: string;
  senderIdType: string;
  senderId: string;
  senderAddress: string;
  senderCity: string;
  senderMunicipality: string;
  senderPhone: string;
  senderSiteCode: string;
  recipientCity: string;
  recipientMunicipality: string;
  vehicle: VehiclePick | null;
  packagingCode: string;
  packagingDescription: string;
};

type PrefillDefaults = {
  cargoDescription?: string;
  weightTons?: string;
  driverFreight?: string;
  observations?: string;
};

type DriverMatch = NonNullable<VehiclePick["drivers"]>[number];

export type PrefillNote = { label: string; value: string; tone: "ok" | "wait" | "bad"; detail: string };

export type SolicitudPrefill = {
  request: OperacionesRequest;
  state: Partial<PrefillState>;
  driver: DriverMatch | null;
  defaults: PrefillDefaults;
  notes: PrefillNote[];
};

type Loaded = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; request: OperacionesRequest };

export function SolicitudPrefillLoader({ solicitudId, children }: { solicitudId: string; children: (prefill: SolicitudPrefill) => ReactNode }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });

  useEffect(() => {
    let active = true;
    setLoaded({ state: "loading" });
    void fetch(`/api/operaciones/solicitudes/${encodeURIComponent(solicitudId)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { item?: OperacionesRequest; error?: string } | null;
        if (!active) return;
        if (response.ok && body?.item) setLoaded({ state: "ready", request: body.item });
        else setLoaded({ state: "error", message: body?.error ?? "No fue posible consultar la solicitud en Operaciones" });
      })
      .catch(() => {
        if (active) setLoaded({ state: "error", message: "No fue posible consultar la solicitud en Operaciones" });
      });
    return () => {
      active = false;
    };
  }, [solicitudId]);

  if (loaded.state === "loading") return <Skeleton label="Trayendo la solicitud de planilla" variant="detail" />;
  if (loaded.state === "error") {
    return (
      <div className="expediente-empty">
        <strong>No se pudo traer la solicitud</strong>
        <p>{loaded.message}</p>
        <Link className="primary-action action-link" href="/solicitudes">Volver a solicitudes</Link>
      </div>
    );
  }
  return <SolicitudMatcher request={loaded.request}>{children}</SolicitudMatcher>;
}

function SolicitudMatcher({ request, children }: { request: OperacionesRequest; children: (prefill: SolicitudPrefill) => ReactNode }) {
  const route = useMemo(() => splitRoute(request), [request]);
  const plate = request.vehicle.plate?.trim();
  const customer = request.customerName?.trim();
  const packaging = request.packaging?.trim();
  const driverDocument = documentKey(request.driver.document);
  const existing = useQuery(api.operaciones.linkedRequests, { operacionesExpedienteIds: [request.expedienteId] });
  const vehicles = useQuery(api.lookups.vehiclesWithDriversSearch, plate && plate.length >= 2 ? { term: plate } : "skip");
  const drivers = useQuery(api.lookups.driversLookup, driverDocument.length >= 2 ? { term: driverDocument } : "skip");
  const parties = useQuery(api.lookups.partiesSearch, customer && customer.length >= 2 ? { term: customer } : "skip");
  const origins = useQuery(api.lookups.divisionsSearch, route.origin && route.origin.length >= 2 ? { term: route.origin } : "skip");
  const destinations = useQuery(api.lookups.divisionsSearch, route.destination && route.destination.length >= 2 ? { term: route.destination } : "skip");
  const packagings = useQuery(api.lookups.packagingSearch, packaging ? { term: packaging } : "skip");
  const clientCandidate = pickByName(parties, customer);
  const clientSites = useQuery(api.lookups.partySites, clientCandidate ? { thirdPartyId: clientCandidate._id } : "skip");
  const waiting = existing === undefined
    || (clientCandidate && clientSites === undefined)
    || (plate && plate.length >= 2 && vehicles === undefined)
    || (driverDocument.length >= 2 && drivers === undefined)
    || (customer && customer.length >= 2 && parties === undefined)
    || (route.origin && route.origin.length >= 2 && origins === undefined)
    || (route.destination && route.destination.length >= 2 && destinations === undefined)
    || (packaging && packagings === undefined);
  const prefill = useMemo(
    () => waiting ? null : buildPrefill(request, route, { vehicles, drivers, parties, origins, destinations, packagings, clientSites }),
    [waiting, request, route, vehicles, drivers, parties, origins, destinations, packagings, clientSites]
  );

  if (!prefill) return <Skeleton label="Buscando la placa y el cliente en los maestros" variant="detail" />;

  if (existing && existing.length > 0) {
    return (
      <div className="expediente-empty">
        <strong>Esta solicitud ya tiene despacho</strong>
        <p>La solicitud de la placa {request.vehicle.plate ?? ""} ya se convirtió en el despacho {existing[0].code}.</p>
        <Link className="primary-action action-link" href={`/expedientes/${existing[0].expedienteId}`}>Abrir {existing[0].code}</Link>
      </div>
    );
  }

  return <>{children(prefill)}</>;
}

type Lookups = {
  vehicles: VehiclePick[] | undefined;
  drivers?: DriverMatch[];
  parties: PartyPick[] | undefined;
  origins: Array<{ code: string; name: string; isMunicipality: boolean; municipalityName: string; departmentName: string }> | undefined;
  destinations: Array<{ code: string; name: string; isMunicipality: boolean; municipalityName: string; departmentName: string }> | undefined;
  packagings: Array<{ code: string; description: string }> | undefined;
  clientSites?: Array<{ siteCode: string; cityCode?: string }>;
};

export function buildPrefill(request: OperacionesRequest, route: { origin?: string; destination?: string }, lookups: Lookups): SolicitudPrefill {
  const vehicle = pickByPlate(lookups.vehicles, request.vehicle.plate);
  const driver = pickByDocument(lookups.drivers, request.driver.document) ?? pickByDocument(vehicle?.drivers, request.driver.document);
  const client = pickByName(lookups.parties, request.customerName);
  const origin = pickMunicipality(lookups.origins, route.origin);
  const destination = pickMunicipality(lookups.destinations, route.destination);
  const packaging = pickPackaging(lookups.packagings, request.packaging);
  const weightTons = request.freightTons !== undefined ? String(request.freightTons) : parseTons(request.weightText);
  const freight = request.freightValue ?? parseMoney(request.freightText);
  const senderIsClient = Boolean(client && origin && client.cityCode && client.cityCode === origin.code);
  const state: Partial<PrefillState> = {};
  const notes: PrefillNote[] = [];
  const add = (label: string, value: string | undefined, tone: PrefillNote["tone"], detail: string) => {
    notes.push({ label, value: value?.trim() || "No viene en la solicitud", tone: value?.trim() ? tone : "bad", detail: value?.trim() ? detail : "Complétalo en el formulario" });
  };

  if (vehicle) state.vehicle = vehicle;
  add("Placa", request.vehicle.plate, vehicle ? "ok" : "bad", vehicle ? "Encontrada en maestros" : "No está en maestros del TMS: regístrala o elige otra");

  const driverLabel = [request.driver.name?.trim(), documentKey(request.driver.document) ? `CC ${request.driver.document?.trim()}` : undefined].filter(Boolean).join(" · ");
  const licenseExpired = Boolean(driver?.licenseExpiresAt && driver.licenseExpiresAt < new Date().toISOString().slice(0, 10));
  if (!documentKey(request.driver.document)) {
    add("Conductor", driverLabel, "wait", "La solicitud no trae la cédula: elige el conductor en el despacho");
  } else if (!driver) {
    add("Conductor", driverLabel, "bad", "No está en maestros del TMS: créalo en Maestros y asígnalo en el despacho");
  } else if (licenseExpired) {
    add("Conductor", driverLabel, "wait", `Encontrado en maestros, con la licencia vencida desde ${driver.licenseExpiresAt}`);
  } else {
    add("Conductor", driverLabel, "ok", `Encontrado en maestros: ${driver.name ?? driver.document}`);
  }

  if (client) {
    Object.assign(state, { client, clientName: client.name, clientDocument: client.document, clientIdType: client.documentType });
  } else if (request.customerName?.trim()) {
    state.clientName = request.customerName.trim();
  }
  add("Cliente", request.customerName, client ? "ok" : "wait", client ? `Encontrado: ${client.name}` : "Sin coincidencia única: búscalo en el campo Cliente");

  if (senderIsClient && client) {
    Object.assign(state, {
      sender: client,
      senderName: client.name,
      senderIdType: client.documentType,
      senderId: client.document,
      senderAddress: client.address ?? "",
      senderPhone: client.phone ?? ""
    });
    const sites = (lookups.clientSites ?? []).filter((site) => !site.cityCode || site.cityCode === origin?.code);
    if (sites.length === 1) state.senderSiteCode = sites[0].siteCode;
  }

  if (origin) Object.assign(state, { senderMunicipality: origin.code, senderCity: origin.name });
  add("Origen", route.origin, origin ? "ok" : "wait", origin ? `${origin.name}, ${origin.departmentName}` : "Elige el municipio del remitente");

  if (destination) Object.assign(state, { recipientMunicipality: destination.code, recipientCity: destination.name });
  add("Destino", route.destination, destination ? "ok" : "wait", destination ? `${destination.name}, ${destination.departmentName}` : "Elige el municipio del destinatario");

  add("Mercancía", request.product, "ok", "Llenada");
  add("Peso", request.weightText ?? (request.freightTons !== undefined ? `${request.freightTons} TN` : undefined), weightTons ? "ok" : "wait", weightTons ? `${weightTons} TN` : "No se pudo leer el número");
  add("Flete", request.freightText ?? (request.freightValue !== undefined ? String(request.freightValue) : undefined), freight ? "ok" : "wait", freight ? `$ ${freight.toLocaleString("es-CO")}` : "No se pudo leer el valor");

  if (packaging) Object.assign(state, { packagingCode: packaging.code, packagingDescription: packaging.description });
  add("Empaque", request.packaging, packaging ? "ok" : "wait", packaging ? packaging.description : "Elige el tipo de empaque del RNDC");

  return {
    request,
    state,
    driver,
    defaults: {
      cargoDescription: request.product?.trim() || undefined,
      weightTons,
      driverFreight: freight ? String(freight) : undefined,
      observations: requestObservations(request)
    },
    notes
  };
}

export function SolicitudSummary({ prefill }: { prefill: SolicitudPrefill }) {
  const { request, notes } = prefill;
  const ready = notes.filter((note) => note.tone === "ok").length;
  const pending = [...(prefill.state.sender ? [] : ["Remitente"]), "Destinatario", ...notes.filter((note) => note.tone !== "ok").map((note) => note.label)];
  return (
    <section className="solicitud-summary" aria-label="Datos de la solicitud de planilla">
      <header>
        <div>
          <strong>Solicitud de {request.dispatcherName ?? request.requestedBy ?? "Operaciones"}</strong>
          <span>{[request.driver.name, request.driver.document ? `CC ${request.driver.document}` : null, request.vehicle.trailer ? `Remolque ${request.vehicle.trailer}` : null].filter(Boolean).join(" · ")}</span>
        </div>
        <span className="solicitud-count">{ready} de {notes.length} datos listos</span>
      </header>
      <ul>
        {notes.map((note) => (
          <li className={`tone-${note.tone}`} key={note.label}>
            <span>{note.label}</span>
            <strong>{note.value}</strong>
            <small>{note.detail}</small>
          </li>
        ))}
      </ul>
      <p>Por revisar o completar: {pending.join(", ")}.</p>
    </section>
  );
}

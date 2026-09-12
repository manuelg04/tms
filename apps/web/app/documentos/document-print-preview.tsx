"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { selectDocumentPdfArtifact } from "../../convex/model/documentPdf";
import { effectiveConsignment, type PartyDraft, type SiteAppointmentDraft } from "../../convex/model/dispatchWorkflow";
import { StatusBadge } from "../expedientes/status-badge";
import { useDemoUser } from "../providers";
import "./document-print.css";

type PrintableKind = "orden_cargue" | "remesa" | "manifiesto";
type Detail = NonNullable<FunctionReturnType<typeof api.expedientes.detail>>;
type DocumentPrintPreviewProps = {
  kind: PrintableKind;
  expedienteId?: Id<"expedientes">;
  remesaId?: Id<"expedienteRemesas">;
  documentId?: Id<"documents">;
  pdfArtifactId?: Id<"evidenceArtifacts">;
  pdfUrl?: string;
  onBack?: () => void;
};
const titles: Record<PrintableKind, string> = {
  orden_cargue: "Orden de cargue",
  remesa: "Remesa terrestre de carga",
  manifiesto: "Manifiesto de carga"
};

export function DocumentPrintPreview({ kind, expedienteId, remesaId, documentId, pdfArtifactId, pdfUrl, onBack }: DocumentPrintPreviewProps) {
  const { user } = useDemoUser();
  const detail = useQuery(api.expedientes.detail, user && expedienteId ? { expedienteId } : "skip");
  const evidence = useQuery(api.evidence.listForExpediente, user && expedienteId ? { expedienteId, limit: 250 } : "skip");
  const selection = detail ? selectDocument(detail, kind, remesaId, documentId) : undefined;
  const artifact = selection?.document ? selectDocumentPdfArtifact(evidence ?? [], selection.document._id) : undefined;
  const sourceUrl = pdfArtifactId ? `/api/evidence/${pdfArtifactId}` : artifact ? `/api/evidence/${artifact._id}` : trustedPdfUrl(pdfUrl);
  const [pdf, setPdf] = useState<{ source: string; url?: string; error?: string }>();
  const [loadedPdf, setLoadedPdf] = useState<string>();
  const [printError, setPrintError] = useState<string>();
  const frame = useRef<HTMLIFrameElement>(null);
  const currentPdf = pdf?.source === sourceUrl ? pdf : undefined;

  useEffect(() => {
    if (!sourceUrl) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void fetch(sourceUrl, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudo cargar el PDF guardado.");
        const blob = await response.blob();
        if (!(await blob.slice(0, 5).text()).startsWith("%PDF-")) throw new Error("El archivo guardado no es un PDF disponible para visualizar.");
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        setPdf({ source: sourceUrl, url: objectUrl });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setPdf({ source: sourceUrl, error: error instanceof Error ? error.message : "No se pudo cargar el PDF guardado." });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sourceUrl]);

  const waiting = Boolean(expedienteId && (detail === undefined || evidence === undefined));
  const missing = Boolean(expedienteId && detail === null);
  const invalidSelection = Boolean(detail && !selection?.valid);
  const hasSheet = Boolean(detail && selection?.valid);
  const pdfReady = Boolean(currentPdf?.url && loadedPdf === currentPdf.url);
  const canPrint = !waiting && !missing && !invalidSelection && (sourceUrl ? pdfReady : hasSheet);

  function printDocument() {
    setPrintError(undefined);
    if (sourceUrl) {
      try {
        if (!pdfReady || !frame.current?.contentWindow) return;
        frame.current.contentWindow.focus();
        frame.current.contentWindow.print();
      } catch {
        setPrintError("Abre el PDF y usa el botón de impresión de su visor.");
      }
      return;
    }
    window.print();
  }

  return (
    <section className="document-print-preview" aria-label={`Vista previa de ${titles[kind].toLowerCase()}`}>
      <div className="document-print-toolbar">
        <div><span className="eyebrow">Vista previa de impresión</span><h2>{titles[kind]}</h2></div>
        <div className="document-print-actions">
          <button className="ghost-button" onClick={onBack ?? (() => window.history.back())} type="button">Volver al listado</button>
          {sourceUrl ? <a className="ghost-button action-link" href={sourceUrl}>Descargar PDF</a> : null}
          <button className="primary-action" disabled={!canPrint} onClick={printDocument} type="button">Imprimir</button>
        </div>
      </div>
      {waiting ? <p className="document-print-notice" role="status">Cargando documento…</p> : null}
      {missing || invalidSelection ? <p className="document-print-notice" role="alert">No se encontró este documento dentro del despacho seleccionado.</p> : null}
      {!waiting && !missing && !invalidSelection ? <>
        {sourceUrl ? <>
          <div className="document-print-notice document-pdf-caption">
            <span>Vista del PDF guardado{!expedienteId ? ". Este documento no tiene un despacho asociado." : "."}</span>
            {selection?.document ? <StatusBadge status={selection.document.officialState ?? selection.document.status} /> : null}
            {selection?.document?.mode === "dry-run" ? <strong>Documento de prueba</strong> : null}
          </div>
          {currentPdf?.error ? <p className="document-print-notice" role="alert">{currentPdf.error} Puedes volver a intentar desde el listado.</p> : !currentPdf?.url ? <p className="document-print-notice" role="status">Preparando PDF…</p> : <>
            <iframe className="document-pdf-frame" onLoad={() => setLoadedPdf(currentPdf.url)} ref={frame} src={`${currentPdf.url}#toolbar=1&view=FitH`} title={`PDF de ${titles[kind].toLowerCase()}`} />
            <p className="document-pdf-help">Si el visor no se muestra, <a href={currentPdf.url} rel="noreferrer" target="_blank">abrir PDF en otra pestaña</a>.</p>
          </>}
          {printError ? <p className="document-print-notice" role="alert">{printError} {currentPdf?.url ? <a href={currentPdf.url} rel="noreferrer" target="_blank">Abrir PDF</a> : null}</p> : null}
        </> : detail && hasSheet ? <DocumentPrintSheet detail={detail} documentId={documentId} kind={kind} remesaId={remesaId} /> : <p className="document-print-notice" role="status">Este documento aún no tiene un PDF guardado ni un despacho asociado para preparar su vista previa.</p>}
      </> : null}
    </section>
  );
}

export function DocumentPrintSheet({ detail, kind, remesaId, documentId }: { detail: Detail; kind: PrintableKind; remesaId?: Id<"expedienteRemesas">; documentId?: Id<"documents"> }) {
  const { document, remesa, valid } = selectDocument(detail, kind, remesaId, documentId);
  if (!valid) return null;
  const { expediente, serviceOrder, customer, vehicle, driver, trailer } = detail;
  const order = expediente.loadingOrderDraft;
  const consignment = effectiveConsignment(remesa?.draft ?? {}, order);
  const manifest = expediente.manifestDraft;
  const cargo = kind === "remesa" ? consignment : order;
  const state = document?.officialState ?? document?.status ?? remesa?.officialState ?? "draft";
  const number = document?.number ?? (kind === "orden_cargue" ? order?.orderNumber ?? expediente.cargoNumber : kind === "manifiesto" ? manifest?.manifestNumber ?? expediente.manifestNumber : remesa?.number);
  const date = kind === "manifiesto" ? manifest?.issueDate : cargo?.expeditionDate;
  const official = document?.mode === "live" && ["authorized", "fulfilled", "annulled"].includes(state);
  const radicado = official ? document?.issuanceRadicado : undefined;
  const note = document?.mode === "dry-run" ? "Documento de prueba · Sin validez oficial" : official ? "Copia de consulta · El PDF emitido aún no está disponible" : "Borrador · Sin autorización RNDC";
  const observations = kind === "manifiesto" ? manifest?.observations : kind === "remesa" ? consignment.generalObservations ?? consignment.transporterObservations : order?.observations;
  const lines = kind === "orden_cargue" ? [{ remissionNumber: order?.customerReference ?? serviceOrder.customerReference, quantity: order?.cargoQuantity ?? serviceOrder.cargoQuantity, packagingClass: order?.packagingCode, weightTons: order?.weightTons ?? tons(serviceOrder.cargoWeightKg), volumeM3: order?.volumeM3, description: order?.cargoDescription ?? serviceOrder.cargoDescription }]
    : kind === "remesa" && consignment.remissions?.length ? consignment.remissions
      : kind === "remesa" ? [{ remissionNumber: remesa?.number, quantity: remesa?.cargoQuantity, packagingClass: consignment.packagingCode, weightTons: tons(remesa?.cargoWeightKg), description: remesa?.cargoDescription }]
        : detail.remesas.map((item) => ({ remissionNumber: item.number, quantity: item.cargoQuantity, packagingClass: item.draft?.packagingCode, weightTons: tons(item.cargoWeightKg), description: item.cargoDescription }));

  return (
    <article className="document-print-sheet">
      <header className="document-paper-heading">
        <div className="document-paper-brand"><strong>MTM</strong><span>Transportes MTM</span></div>
        <div><h1>{titles[kind]}</h1><p>No. <strong>{number || "Pendiente de asignación"}</strong></p>{radicado ? <p>Autorización RNDC: <strong>{radicado}</strong></p> : null}</div>
      </header>
      <div className="document-paper-condition"><strong>{note}</strong><StatusBadge status={state} /></div>
      <div className="document-paper-fields">
        <PaperField label="Fecha" value={date || dateOnly(expediente.createdAt)} />
        <PaperField label="Agencia" value={(kind === "manifiesto" ? manifest?.agencyCode : cargo?.agencyCode) ?? expediente.agencyCode} />
        <PaperField label="Cliente" value={customer.name} />
        <PaperField label="Orden de cargue" value={order?.orderNumber ?? expediente.cargoNumber} />
        <PaperField label="Placa" value={vehicle?.plate} />
        <PaperField label="Remolque" value={trailer?.plate} />
        <PaperField label="Conductor" value={driver?.name} />
        <PaperField label="Identificación conductor" value={driver?.document} />
      </div>
      <div className="document-paper-locations">
        <PaperLocation title="Remitente / Lugar de cargue" party={cargo?.sender} site={cargo?.loading} fallback={detail.loadingLocation} appointment={serviceOrder.scheduledLoadingAt} cityOverride={kind === "manifiesto" ? manifest?.originCityName : undefined} />
        <PaperLocation title="Destinatario / Lugar de descargue" party={cargo?.recipient} site={cargo?.unloading} fallback={detail.unloadingLocation} appointment={serviceOrder.scheduledUnloadingAt} cityOverride={kind === "manifiesto" ? manifest?.destinationCityName : undefined} />
      </div>
      {kind === "remesa" ? <div className="document-paper-fields document-paper-financials">
        <PaperField label="Valor declarado" value={money(consignment.declaredValue)} />
        <PaperField label="Contado" value={booleanLabel(consignment.cashConsignment)} />
        <PaperField label="Contraentrega" value={booleanLabel(consignment.cashOnDelivery)} />
        <PaperField label="Póliza" value={consignment.policyNumber} />
        <PaperField label="Aseguradora" value={consignment.insurerName} />
        <PaperField label="Vencimiento póliza" value={consignment.policyExpiresOn} />
      </div> : null}
      <h2 className="document-paper-section-title">{kind === "manifiesto" ? "Remesas del manifiesto" : "Mercancía transportada"}</h2>
      <div className="document-paper-table-wrap"><table className="document-paper-table">
        <thead><tr><th>{kind === "manifiesto" ? "Nro. Remesa" : "Remisión"}</th><th>Cantidad</th><th>Empaque</th><th>Peso (ton)</th><th>Volumen (m³)</th><th>Contenido</th></tr></thead>
        <tbody>{lines.length ? lines.map((line, index) => <tr key={index}><td>{display(line.remissionNumber)}</td><td>{display(line.quantity)}</td><td>{display(line.packagingClass)}</td><td>{display(line.weightTons)}</td><td>{display("volumeM3" in line ? line.volumeM3 : undefined)}</td><td>{display(line.description)}</td></tr>) : <tr><td colSpan={6}>Sin remesas asociadas</td></tr>}</tbody>
      </table></div>
      {kind === "manifiesto" ? <>
        <h2 className="document-paper-section-title">Liquidación del viaje</h2>
        <div className="document-paper-fields">
          <PaperField label="Flete total" value={money(manifest?.freightTotal)} />
          <PaperField label="Anticipo" value={money(manifest?.advance)} />
          <PaperField label="Retención en la fuente" value={money(manifest?.withholdingSource)} />
          <PaperField label="Retención ICA" value={money(manifest?.withholdingIca)} />
          <PaperField label="Neto a pagar" value={money(manifest?.netPayable)} />
          <PaperField label="Responsable de pago" value={manifest?.paymentResponsible} />
          <PaperField label="Fecha de pago" value={manifest?.paymentDate} />
          <PaperField label="Entrega estimada" value={manifest?.estimatedDeliveryDate} />
        </div>
      </> : null}
      {kind === "orden_cargue" ? <div className="document-paper-fields"><PaperField label="Condiciones de cargue" value={order?.loadingConditions} /><PaperField label="Sellos" value={order?.sealNumbers} /><PaperField label="Fecha mínima de cargue" value={order?.minLoadingDate} /><PaperField label="Fecha máxima de cargue" value={order?.maxLoadingDate} /></div> : null}
      <div className="document-paper-observations"><strong>Observaciones</strong><p>{observations || "Sin observaciones registradas."}</p></div>
      <div className="document-paper-signatures"><div><strong>Elaborado por</strong><span>Firma y sello</span></div><div><strong>Recibido por</strong><span>Firma e identificación</span></div></div>
      <footer className="document-paper-footer"><span>Despacho {expediente.code}</span><span>Datos actuales del sistema · {dateTime(expediente.updatedAt)}</span></footer>
    </article>
  );
}

function selectDocument(detail: Detail, kind: PrintableKind, remesaId?: Id<"expedienteRemesas">, documentId?: Id<"documents">) {
  const remesa = kind === "remesa" ? remesaId ? detail.remesas.find((item) => item._id === remesaId) : documentId ? detail.remesas.find((item) => item.documentId === documentId) : detail.remesas.length === 1 ? detail.remesas[0] : undefined : undefined;
  const targetDocumentId = documentId ?? remesa?.documentId;
  const document = targetDocumentId ? detail.documents.find((item) => item._id === targetDocumentId && item.kind === kind) : kind !== "remesa" ? detail.documents.filter((item) => item.kind === kind).sort((left, right) => right.updatedAt - left.updatedAt)[0] : undefined;
  const valid = (!documentId || Boolean(document)) && (kind !== "remesa" || Boolean(remesa)) && (!remesaId || kind !== "remesa" || !documentId || remesa?.documentId === documentId);
  return { document, remesa, valid };
}

function PaperField({ label, value }: { label: string; value?: ReactNode }) {
  return <div className="document-paper-field"><span>{label}</span><strong>{value === undefined || value === null || value === "" ? "—" : value}</strong></div>;
}

function PaperLocation({ title, party, site, fallback, appointment, cityOverride }: { title: string; party?: PartyDraft; site?: SiteAppointmentDraft; fallback: Detail["loadingLocation"]; appointment?: number; cityOverride?: string }) {
  return <section className="document-paper-location"><h2>{title}</h2><dl>
    <dt>Nombre</dt><dd>{display(party?.name ?? site?.siteName ?? fallback.name)}</dd>
    <dt>Identificación</dt><dd>{display(party?.identificationNumber)}</dd>
    <dt>Sede</dt><dd>{display(site?.siteName ?? party?.siteCode)}</dd>
    <dt>Dirección</dt><dd>{display(site?.address ?? party?.address ?? fallback.address)}</dd>
    <dt>Municipio</dt><dd>{display(cityOverride ?? site?.cityName ?? party?.cityName ?? fallback.city)}</dd>
    <dt>Coordenadas</dt><dd>{site?.latitude && site.longitude ? `${site.latitude}, ${site.longitude}` : "—"}</dd>
    <dt>Fecha y hora de cita</dt><dd>{dateTime(site?.appointmentAt ?? appointment)}</dd>
    <dt>Tiempo pactado</dt><dd>{site?.agreedHours ? `${site.agreedHours} h` : "—"}</dd>
  </dl></section>;
}

function trustedPdfUrl(value?: string): string | undefined {
  if (!value || value.includes("%") || value.split("/").includes("..")) return undefined;
  const path = value.startsWith("/pdf/") ? `/api/rndc${value}` : value;
  return /^\/api\/evidence\/[a-zA-Z0-9]+$/.test(path) || /^\/api\/rndc\/pdf\/[a-zA-Z0-9_./-]+$/.test(path) ? path : undefined;
}

function display(value: unknown): string {
  return value === undefined || value === null || value === "" ? "—" : String(value);
}

function dateOnly(value: number): string {
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeZone: "America/Bogota" }).format(value);
}

function dateTime(value?: number): string {
  return value === undefined ? "—" : new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short", timeZone: "America/Bogota" }).format(value);
}

function tons(value?: number): number | undefined {
  return value === undefined ? undefined : value / 1000;
}

function money(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(amount) : value;
}

function booleanLabel(value?: boolean): string | undefined {
  return value === undefined ? undefined : value ? "Sí" : "No";
}

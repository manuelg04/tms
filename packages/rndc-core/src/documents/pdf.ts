import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { DemoScenario, GeneratedDocument, ManifestRemesaSummary, PersonData, RndcConfig, RndcFlowStep, RndcManifestAcceptance } from "../rndc/types.js";
import { mtmLogoPng, mtmRemesaLogoPng, vigiladoSuperTransportePng } from "./brandAssets.js";
import { box, companyStamp, createDoc, line, numberInWords, PAGE_W, PAGE_X, stackCentered, text, textHeight, waitForStream, widths } from "./pdfPrimitives.js";
import type { Cell, Doc } from "./pdfPrimitives.js";
import { writeManifestPdf } from "./manifestPdf.js";

export type AuthorizationData = {
  loadingOrderAuthorization: string;
  remesaAuthorization: string;
  manifestAuthorization: string;
  seguridadQr: string;
  observacionesQr: string;
  acceptances: RndcManifestAcceptance[];
  radicatedAt?: string;
};

export const loadingOrderBranding = { systemName: "S.@.T. BASICO", agencyName: "DIEGO MANTILLA" } as const;

export function resolveManifestRemesas(scenario: DemoScenario): ManifestRemesaSummary[] {
  const remesas = scenario.manifestRemesas?.length
    ? scenario.manifestRemesas
    : [{ number: scenario.remesaNumber }];

  return remesas.map((remesa) => ({
    number: remesa.number,
    quantityKg: remesa.quantityKg ?? scenario.cargo.quantityKg,
    nature: remesa.nature ?? scenario.cargo.nature,
    productName: remesa.productName ?? scenario.cargo.productName,
    packageName: remesa.packageName ?? scenario.cargo.packageName,
    senderName: remesa.senderName ?? scenario.sender.name,
    recipientName: remesa.recipientName ?? scenario.recipient.name
  }));
}

export function formatManifestAcceptances(acceptances: RndcManifestAcceptance[]): string {
  if (acceptances.length === 0) {
    return "Pendiente";
  }

  return acceptances.map((acceptance) => {
    const actor = acceptance.type === "C" ? "Conductor" : "Titular";
    const identity = [acceptance.actorIdType, acceptance.actorId].filter(Boolean).join(" ");
    const parts = [`${actor}${identity ? ` ${identity}` : ""}`, acceptance.acceptedAt, acceptance.observation].filter(Boolean);
    return parts.join(" - ");
  }).join(" | ");
}

export function documentFooterText(mode: RndcConfig["mode"]): string {
  return mode === "dry-run"
    ? "MODO PRUEBA - Documento sin validez oficial generado con datos de prueba."
    : "";
}

export function amountInWords(value: number): string {
  const amount = Math.max(0, Math.round(value));
  return `${numberInWords(amount).toUpperCase()} PESOS M/C M.CTE.`;
}

export async function generateDocuments(scenario: DemoScenario, steps: RndcFlowStep[], pdfDir: string, mode: RndcConfig["mode"] = "dry-run"): Promise<GeneratedDocument[]> {
  await mkdir(pdfDir, { recursive: true });

  const authorization = readAuthorization(steps);
  const loadingOrderDocument = await generateLoadingOrderDocument(scenario, authorization.loadingOrderAuthorization, pdfDir, mode);
  const remesaDocument = await generateRemesaDocument(scenario, authorization, pdfDir, mode);
  const manifestDocument = await generateManifestDocument(scenario, authorization, pdfDir, mode);

  return [
    loadingOrderDocument,
    remesaDocument,
    manifestDocument
  ];
}

export async function generateLoadingOrderDocument(scenario: DemoScenario, _authorization: string, pdfDir: string, mode: RndcConfig["mode"] = "dry-run"): Promise<GeneratedDocument> {
  await mkdir(pdfDir, { recursive: true });
  const path = join(pdfDir, `orden-cargue-${documentFileSegment(scenario.cargoNumber)}.pdf`);
  await writeLoadingOrderPdf(path, scenario, mode);
  return { kind: "loading-order", number: scenario.cargoNumber, path, urlPath: `/pdf/${basename(path)}` };
}

export async function generateRemesaDocument(scenario: DemoScenario, authorization: Partial<AuthorizationData>, pdfDir: string, mode: RndcConfig["mode"] = "dry-run"): Promise<GeneratedDocument> {
  await mkdir(pdfDir, { recursive: true });
  const path = join(pdfDir, `remesa-${documentFileSegment(scenario.remesaNumber)}.pdf`);
  await writeRemesaPdf(path, scenario, completeAuthorization(authorization), mode);
  return { kind: "remesa", number: scenario.remesaNumber, path, urlPath: `/pdf/${basename(path)}` };
}

export async function generateManifestDocument(scenario: DemoScenario, authorization: Partial<AuthorizationData>, pdfDir: string, mode: RndcConfig["mode"] = "dry-run"): Promise<GeneratedDocument> {
  await mkdir(pdfDir, { recursive: true });
  const path = join(pdfDir, `manifiesto-${documentFileSegment(scenario.manifestNumber)}.pdf`);
  await writeManifestPdf(path, scenario, completeAuthorization(authorization), mode);
  return { kind: "manifest", number: scenario.manifestNumber, path, urlPath: `/pdf/${basename(path)}` };
}

export async function generateManifestFulfillmentDocument(scenario: DemoScenario, pdfDir: string, mode: RndcConfig["mode"] = "dry-run"): Promise<GeneratedDocument> {
  await mkdir(pdfDir, { recursive: true });
  const path = join(pdfDir, `cumplido-${documentFileSegment(scenario.manifestNumber)}.pdf`);
  await writeManifestFulfillmentPdf(path, scenario, mode);
  return { kind: "manifest-fulfillment", number: scenario.manifestNumber, path, urlPath: `/pdf/${basename(path)}` };
}

export function documentFileSegment(value: string): string {
  const segment = value.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return segment || "sin-numero";
}

function readAuthorization(steps: RndcFlowStep[]): AuthorizationData {
  const loadingOrder = steps.find((step) => step.name === "cargo");
  const remesa = steps.find((step) => step.name === "remesa");
  const manifest = steps.find((step) => step.name === "manifest");

  return {
    loadingOrderAuthorization: loadingOrder?.response.radicado ?? "PENDIENTE",
    remesaAuthorization: remesa?.response.radicado ?? "PENDIENTE",
    manifestAuthorization: manifest?.response.radicado ?? "PENDIENTE",
    seguridadQr: manifest?.response.seguridadQr ?? "PENDIENTE",
    observacionesQr: manifest?.response.observacionesQr ?? "PENDIENTE",
    acceptances: []
  };
}

function completeAuthorization(authorization: Partial<AuthorizationData>): AuthorizationData {
  return {
    loadingOrderAuthorization: authorization.loadingOrderAuthorization ?? "PENDIENTE",
    remesaAuthorization: authorization.remesaAuthorization ?? "PENDIENTE",
    manifestAuthorization: authorization.manifestAuthorization ?? "PENDIENTE",
    seguridadQr: authorization.seguridadQr ?? "PENDIENTE",
    observacionesQr: authorization.observacionesQr ?? "PENDIENTE",
    acceptances: authorization.acceptances ?? [],
    radicatedAt: authorization.radicatedAt
  };
}


function inlineRow(doc: Doc, x: number, y: number, w: number, h: number, cells: Cell[]): number {
  const cellWidths = widths(w, cells.map((cell) => cell.ratio));
  let cursor = x;
  cells.forEach((cell, index) => {
    const cw = cellWidths[index];
    box(doc, cursor, y, cw, h);
    const size = cell.size ?? 7.5;
    const pad = 3;
    const textY = y + Math.max(2, (h - size - 1) / 2);
    let textX = cursor + pad;
    if (cell.label) {
      const label = `${cell.label}${cell.labelSuffix ?? ":"}`;
      doc.font("Helvetica-Bold").fontSize(size);
      const lw = doc.widthOfString(label);
      text(doc, label, textX, textY, cw - pad * 2, { size, bold: true });
      textX += lw + 3;
    }
    text(doc, cell.value, textX, textY, Math.max(0, cursor + cw - pad - textX), { size, bold: cell.valueBold, align: cell.align ?? "left", h: h - 2 });
    cursor += cw;
  });
  return y + h;
}

function headerRow(doc: Doc, x: number, y: number, w: number, h: number, ratios: number[], titles: string[], size = 7): number {
  const cellWidths = widths(w, ratios);
  let cursor = x;
  titles.forEach((title, index) => {
    box(doc, cursor, y, cellWidths[index], h);
    const lines = textHeight(doc, title, cellWidths[index] - 4, size, true);
    text(doc, title, cursor + 2, y + Math.max(1.5, (h - lines) / 2), cellWidths[index] - 4, { size, bold: true, align: "center" });
    cursor += cellWidths[index];
  });
  return y + h;
}

function valueRow(doc: Doc, x: number, y: number, w: number, h: number, ratios: number[], values: (string | number)[], options: { size?: number; align?: "left" | "center" | "right"; pad?: number } = {}): number {
  const cellWidths = widths(w, ratios);
  const size = options.size ?? 7;
  let cursor = x;
  values.forEach((value, index) => {
    box(doc, cursor, y, cellWidths[index], h);
    const pad = options.pad ?? 3;
    text(doc, value, cursor + pad, y + Math.max(2, (h - size - 1) / 2), cellWidths[index] - pad * 2, { size, align: options.align ?? "center", h: h - 2 });
    cursor += cellWidths[index];
  });
  return y + h;
}

function sectionBar(doc: Doc, x: number, y: number, w: number, title: string, h = 10, size = 6.5): number {
  box(doc, x, y, w, h);
  text(doc, title, x + 2, y + (h - size) / 2, w - 4, { size, bold: true, align: "center" });
  return y + h;
}

function drawLogo(doc: Doc, x: number, y: number, w: number): number {
  doc.image(mtmLogoPng, x, y, { width: w });
  return y + (w * 210) / 852;
}

function drawStamp(doc: Doc, x: number, y: number, w: number): void {
  const stamp = companyStamp();
  if (stamp) doc.image(stamp, x, y, { width: w });
}

function modeFooter(doc: Doc, mode: RndcConfig["mode"]): void {
  const footer = documentFooterText(mode);
  if (!footer) return;
  text(doc, footer, PAGE_X, doc.page.height - 22, PAGE_W, { size: 6.5, align: "center", color: "#666666" });
}

function companyAddressLines(scenario: DemoScenario): { address: string; phoneLine: string; city: string } {
  return {
    address: scenario.company.address,
    phoneLine: `${scenario.company.address} - ${scenario.company.phone}`,
    city: scenario.company.cityName
  };
}

function companyCity(scenario: DemoScenario): string {
  return scenario.company.cityName.split(" - ")[0].trim();
}

function nit(scenario: DemoScenario): string {
  return `${scenario.company.nit}-${scenario.company.dv}`;
}

function naturalName(person: PersonData): string {
  const composed = [person.firstName, person.firstLastName, person.secondLastName].map((part) => part.trim()).filter(Boolean).join(" ");
  return composed || person.fullName;
}

function isoFromRndcDate(value: string): string {
  const [day, month, year] = value.split("/");
  return day && month && year ? `${year}-${month}-${day}` : value;
}

function dashDateFromRndc(value: string): string {
  return value.replaceAll("/", "-");
}

function formatTons(value: number): string {
  const tons = value / 1000;
  return Number.isInteger(tons) ? String(tons) : String(Number(tons.toFixed(3)));
}

function tonsWithDecimals(value: number): string {
  return (value / 1000).toFixed(3);
}

function agreedTime(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
}

function money(value: number): string {
  return `$ ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value))}`;
}

function vehicleColorName(value: string): string {
  if (value === "1") {
    return "BLANCO";
  }

  return value;
}

function preparedBy(scenario: DemoScenario): string {
  return scenario.preparedBy ?? "";
}

async function writeLoadingOrderPdf(path: string, scenario: DemoScenario, mode: RndcConfig["mode"]): Promise<void> {
  const doc = createDoc();
  const stream = createWriteStream(path);
  doc.pipe(stream);

  drawLoadingOrderCopy(doc, scenario, 28, "Original");
  drawLoadingOrderCopy(doc, scenario, 402, "Copia");
  modeFooter(doc, mode);

  doc.end();
  await waitForStream(stream);
}

function drawLoadingOrderCopy(doc: Doc, scenario: DemoScenario, top: number, copyLabel: string): void {
  const x = PAGE_X;
  const w = PAGE_W;
  const rightW = 170;
  const rightX = x + w - rightW;
  const centerX = x + 145;
  const centerW = rightX - centerX - 6;
  const company = companyAddressLines(scenario);

  doc.image(mtmLogoPng, x, top + 2, { width: 200 });
  doc.image(vigiladoSuperTransportePng, x + 62, top + 53, { width: 76, height: 19 });

  stackCentered(doc, centerX, top, centerW, [
    { text: "ORDEN DE CARGUE", size: 11, bold: true },
    { text: scenario.company.name, size: 11, bold: true },
    { text: `NIT. ${nit(scenario)}`, size: 6.5, bold: true },
    { text: company.phoneLine, size: 6.5 },
    { text: company.city, size: 6.5 },
    { text: copyLabel, size: 7, bold: true }
  ]);

  box(doc, rightX, top, rightW, 26);
  text(doc, `No. ${scenario.cargoNumber}`, rightX, top + 7, rightW, { size: 12, bold: true, align: "center" });
  headerRow(doc, rightX, top + 26, rightW, 17, [1, 1], ["FECHA", "AGENCIA"], 8);
  valueRow(doc, rightX, top + 43, rightW, 17, [1, 1], [dashDateFromRndc(scenario.expeditionDate), loadingOrderBranding.agencyName], { size: 7.5 });

  let y = top + 76;
  y = sectionBar(doc, x, y, w, "DATOS DEL CLIENTE");
  y = inlineRow(doc, x, y, w, 15, [
    { label: "NOMBRE", value: scenario.sender.name, ratio: 0.56 },
    { label: "NIT o C.C. No.", value: scenario.sender.id, ratio: 0.44, labelSuffix: "" }
  ]);
  y += 1;

  y = sectionBar(doc, x, y, w, "DATOS DE LA MERCANCÍA");
  y = inlineRow(doc, x, y, w, 15, [
    { label: "PRODUCTO", value: scenario.cargo.productName, ratio: 0.38 },
    { label: "VOLUMEN", value: scenario.cargo.volumeM3 ?? 0, ratio: 0.22 },
    { label: "CANTIDAD", value: scenario.cargo.quantity ?? 0, ratio: 0.2 },
    { label: "PESO", value: formatTons(scenario.cargo.quantityKg), ratio: 0.2 }
  ]);
  y += 1;

  y = sectionBar(doc, x, y, w, "DATOS DEL VEHÍCULO");
  y = inlineRow(doc, x, y, w, 15, [
    { label: "MARCA", value: scenario.vehicle.brand, ratio: 0.28 },
    { label: "PLACA", value: scenario.vehicle.plate, ratio: 0.14 },
    { label: "MODELO", value: scenario.vehicle.modelYear, ratio: 0.13 },
    { label: "TRAILER", value: scenario.vehicle.trailerPlate, ratio: 0.2 },
    { label: "COLOR", value: vehicleColorName(scenario.vehicle.colorCode), ratio: 0.25 }
  ]);
  y = inlineRow(doc, x, y, w, 15, [
    { label: "CONDUCTOR", value: scenario.driver.fullName, ratio: 0.55 },
    { label: "C.C.", value: scenario.driver.id, ratio: 0.2 },
    { label: "TEL", value: scenario.driver.phone, ratio: 0.25 }
  ]);
  y += 1;

  const halfW = Math.round(w / 2);
  box(doc, x, y, halfW, 10);
  text(doc, "DATOS DEL REMITENTE", x + 2, y + 2, halfW - 4, { size: 6.5, bold: true, align: "center" });
  inlineRow(doc, x + halfW, y, w - halfW, 10, [{ label: "ORIGEN", value: scenario.sender.cityName, ratio: 1, size: 7 }]);
  y += 10;
  y = inlineRow(doc, x, y, w, 20, [
    { label: "NOMBRE", value: scenario.sender.name, ratio: 0.38 },
    { label: "DIRECCIÓN", value: scenario.sender.address, ratio: 0.37 },
    { label: "TELÉFONO", value: scenario.sender.phone ?? "", ratio: 0.25 }
  ]);
  y += 1;

  y = sectionBar(doc, x, y, w, "DATOS DESTINATARIO");
  y = headerRow(doc, x, y, w, 11, [0.275, 0.2, 0.275, 0.25], ["NOMBRE", "DESTINO", "DIRECCIÓN", "TELÉFONO"], 7);
  y = valueRow(doc, x, y, w, 40, [0.275, 0.2, 0.275, 0.25], [
    scenario.recipient.name,
    scenario.recipient.cityName,
    scenario.recipient.address,
    scenario.recipient.phone ?? ""
  ], { size: 7.5, align: "left", pad: 5 });
  y += 1;

  y = sectionBar(doc, x, y, w, "DATOS GENERALES");
  y = inlineRow(doc, x, y, w, 11, [{ label: "CONDICIONES ESPECIALES CARGUE", value: "", ratio: 1, size: 7 }]);
  y = inlineRow(doc, x, y, w, 11, [{ label: "SELLOS DE SEGURIDAD Y/O PRECINTO", value: scenario.seals ?? "", ratio: 1, size: 7 }]);
  y = inlineRow(doc, x, y, w, 11, [{ label: "OBSERVACIONES ADICIONALES", value: scenario.observations, ratio: 1, size: 7 }]);
  y = inlineRow(doc, x, y, w, 11, [{ label: "RECOMENDACIONES", value: "", ratio: 1, size: 7 }]);

  box(doc, x, y, halfW, 40);
  box(doc, x + halfW, y, w - halfW, 40);
  text(doc, "ELABORADO POR", x, y + 3, halfW, { size: 7.5, bold: true, align: "center" });
  drawStamp(doc, x + Math.round(halfW / 2) - 48, y - 2, 96);
  text(doc, "RECIBIDO", x + halfW, y + 3, w - halfW, { size: 7.5, bold: true, align: "center" });
  text(doc, preparedBy(scenario), x, y + 22, halfW, { size: 7.5, align: "center" });
}

async function writeRemesaPdf(path: string, scenario: DemoScenario, authorization: AuthorizationData, mode: RndcConfig["mode"]): Promise<void> {
  const doc = createDoc();
  const stream = createWriteStream(path);
  doc.pipe(stream);

  drawRemesaPage(doc, scenario, authorization, "Original");
  modeFooter(doc, mode);
  doc.addPage();
  drawRemesaPage(doc, scenario, authorization, "Copia");
  modeFooter(doc, mode);

  doc.end();
  await waitForStream(stream);
}

function drawRemesaPage(doc: Doc, scenario: DemoScenario, authorization: AuthorizationData, copyLabel: string): void {
  const x = PAGE_X;
  const w = PAGE_W;
  const top = 30;
  const rightW = 172;
  const rightX = x + w - rightW;
  const centerX = x + 128;
  const centerW = rightX - centerX - 6;
  const company = companyAddressLines(scenario);

  text(doc, "REMESA TERRESTRE DE CARGA", x, top, w, { size: 9, bold: true, align: "center" });

  const bandTop = top + 16;
  doc.image(mtmRemesaLogoPng, x - 12, bandTop - 2, { width: 154 });
  doc.image(vigiladoSuperTransportePng, x + 28, bandTop + 64, { width: 78, height: 22 });

  stackCentered(doc, centerX, bandTop + 18, centerW, [
    { text: scenario.company.name, size: 8, bold: true },
    { text: `NIT:${nit(scenario)}`, size: 6.5, bold: true },
    { text: company.phoneLine, size: 6.5 },
    { text: company.city, size: 6.5 },
    { text: copyLabel, size: 7, bold: true }
  ]);

  box(doc, rightX, bandTop, rightW, 42);
  text(doc, `REMESA No. ${scenario.remesaNumber}`, rightX, bandTop + 14, rightW, { size: 14, bold: true, align: "center" });
  box(doc, rightX, bandTop + 42, rightW, 52);
  text(doc, "NUMERO AUTORIZACION", rightX, bandTop + 58, rightW, { size: 9, bold: true, align: "center" });
  text(doc, authorization.remesaAuthorization, rightX, bandTop + 70, rightW, { size: 9, bold: true, align: "center" });

  let y = bandTop + 102;
  y = inlineRow(doc, x, y, w, 16, [
    { label: "FECHA", value: isoFromRndcDate(scenario.expeditionDate), ratio: 0.235 },
    { label: "OFICINA", value: loadingOrderBranding.agencyName, ratio: 0.5 },
    { label: "ORDEN DE CARGUE", value: scenario.cargoNumber, ratio: 0.265 }
  ]);
  y = inlineRow(doc, x, y, w, 16, [
    { label: "PLACA", value: scenario.vehicle.plate, ratio: 0.235 },
    { label: "CONDUCTOR", value: scenario.driver.fullName, ratio: 0.5 },
    { label: "CÉDULA ", value: scenario.driver.id, ratio: 0.265 }
  ]);
  y += 3;

  const halfW = Math.round(w / 2);
  const senderRows = partyRows(scenario.sender, scenario.loadingAppointment, agreedTime(scenario.loadingAgreedHours, scenario.loadingAgreedMinutes), "Transbordo 1");
  const recipientRows = partyRows(scenario.recipient, scenario.unloadingAppointment, agreedTime(scenario.unloadingAgreedHours, scenario.unloadingAgreedMinutes), "Transbordo 2");
  const partyBottom = drawPartyColumn(doc, x, y, halfW, "Remitente / Lugar de Cargue", senderRows);
  drawPartyColumn(doc, x + halfW, y, w - halfW, "Destinatario / Lugar de Descargue", recipientRows);
  y = partyBottom + 3;

  y = inlineRow(doc, x, y, w, 16, [
    { label: "VALOR DECLARADO", value: String(Math.round(scenario.cargo.declaredValue)), ratio: 0.37 },
    { label: "CONTADO", value: "", ratio: 0.135, align: "right" },
    { value: "", ratio: 0.03 },
    { label: "APLICA SEGURO", value: "", ratio: 0.185 },
    { value: "", ratio: 0.03 },
    { label: "CONTRAENTREGA", value: "", ratio: 0.22 },
    { value: "", ratio: 0.03 }
  ]);
  y = inlineRow(doc, x, y, w, 16, [
    { label: "PROD. TRANSPORTADO", value: scenario.cargo.productName, ratio: 0.58 },
    { label: "NATURALEZA", value: scenario.cargo.nature, ratio: 0.42 }
  ]);
  y += 3;

  const ratios = [0.155, 0.1, 0.14, 0.105, 0.145, 0.355];
  y = headerRow(doc, x, y, w, 16, ratios, ["REMISIÓN", "CANTIDAD", "EMPAQUE", "PESO (Ton)", "VOLUMEN (m3)", "CONTENIDO"], 7.5);
  y = valueRow(doc, x, y, w, 16, ratios, [
    scenario.remissionNumber ?? "",
    scenario.cargo.quantity ?? 1,
    scenario.cargo.packageName,
    formatTons(scenario.cargo.quantityKg),
    scenario.cargo.volumeM3 ?? 0,
    scenario.cargo.productName
  ], { size: 7.5 });
  for (let index = 0; index < 5; index += 1) {
    y = valueRow(doc, x, y, w, 16, ratios, ["", "", "", "", "", ""]);
  }
  y += 3;

  const bottomRatios = widths(w, [0.435, 0.285, 0.28]);
  const bottomH = 70;
  box(doc, x, y, bottomRatios[0], bottomH);
  text(doc, "OBSERVACIONES:", x + 4, y + 4, bottomRatios[0] - 8, { size: 7.5, bold: true });
  text(doc, `${scenario.observations} --`, x + 4, y + 13, bottomRatios[0] - 8, { size: 7, h: bottomH - 16 });
  drawStamp(doc, x + bottomRatios[0] + 28, y + 14, 96);
  const elabX = x + bottomRatios[0];
  box(doc, elabX, y, bottomRatios[1], bottomH);
  text(doc, "Elaborado por", elabX + 4, y + 6, bottomRatios[1] - 8, { size: 7.5, bold: true });
  line(doc, elabX + 4, y + 50, elabX + 4 + 110, y + 50);
  text(doc, "Firma y sello", elabX + 4, y + 54, bottomRatios[1] - 8, { size: 7.5 });
  const recX = elabX + bottomRatios[1];
  box(doc, recX, y, bottomRatios[2], bottomH);
  text(doc, "Recibí a satisfacción:", recX + 4, y + 6, bottomRatios[2] - 8, { size: 7.5, bold: true });
  line(doc, recX + 4, y + 50, recX + 4 + 110, y + 50);
  text(doc, "Firma y c.c.", recX + 4, y + 54, bottomRatios[2] - 8, { size: 7.5 });
  y += bottomH + 6;
  line(doc, x, y, x + w, y, "#9a9a9a", 1);
}

type PartyRow = { label: string; value: string; lines?: [string, string][] };

function partyRows(party: DemoScenario["sender"], appointment: string, agreed: string, transferLabel: string): PartyRow[] {
  return [
    { label: "Nombre", value: party.name },
    { label: "Identificación", value: party.id },
    { label: "Sede", value: party.siteName },
    { label: "Dirección", value: party.address },
    { label: "Coordenadas", value: "", lines: [["Latitud:", party.latitude], ["Longitud:", party.longitude]] },
    { label: "Municipio", value: party.cityName },
    { label: "Fecha Hora Cita", value: appointment },
    { label: "Tiempo Pactado", value: agreed },
    { label: transferLabel, value: "" }
  ];
}

function drawPartyColumn(doc: Doc, x: number, y: number, w: number, title: string, rows: PartyRow[]): number {
  box(doc, x, y, w, 16);
  text(doc, title, x + 3, y + 3.5, w - 6, { size: 8.5, bold: true });
  let cursor = y + 16;
  const labelW = Math.round(w * 0.31);
  for (const row of rows) {
    const h = row.lines ? 20 : 16;
    box(doc, x, cursor, labelW, h);
    box(doc, x + labelW, cursor, w - labelW, h);
    text(doc, `${row.label}:`, x + 3, cursor + (h - 9) / 2, labelW - 6, { size: 8.5, bold: true });
    if (row.lines) {
      row.lines.forEach(([label, value], index) => {
        const ly = cursor + 2 + index * 8;
        doc.font("Helvetica-Bold").fontSize(6.5);
        const lw = doc.widthOfString(label);
        text(doc, label, x + labelW + 3, ly, w - labelW - 6, { size: 6.5, bold: true });
        text(doc, value, x + labelW + 3 + lw + 2, ly, w - labelW - lw - 8, { size: 6.5 });
      });
    } else {
      text(doc, row.value, x + labelW + 3, cursor + (h - 7) / 2, w - labelW - 6, { size: 7, h: h - 2 });
    }
    cursor += h;
  }
  return cursor;
}

async function writeManifestFulfillmentPdf(path: string, scenario: DemoScenario, mode: RndcConfig["mode"]): Promise<void> {
  const doc = createDoc();
  const stream = createWriteStream(path);
  doc.pipe(stream);

  drawManifestFulfillmentCopy(doc, scenario, 26, "Original");
  drawManifestFulfillmentCopy(doc, scenario, 400, "Copia");
  modeFooter(doc, mode);

  doc.end();
  await waitForStream(stream);
}

function drawManifestFulfillmentCopy(doc: Doc, scenario: DemoScenario, top: number, copyLabel: string): void {
  const x = PAGE_X;
  const w = PAGE_W;
  const rightW = 205;
  const rightX = x + w - rightW;
  const centerX = x + 120;
  const centerW = rightX - centerX - 6;
  const compliance = scenario.compliance;
  const fulfillmentDate = compliance.documentsDeliveryDate ? isoFromRndcDate(compliance.documentsDeliveryDate) : isoFromRndcDate(scenario.expeditionDate);

  drawLogo(doc, x - 8, top + 8, 130);

  stackCentered(doc, centerX, top, centerW, [
    { text: "CUMPLIDO MANIFIESTO DE CARGA", size: 8.5, bold: true },
    { text: scenario.company.name, size: 8, bold: true },
    { text: `NIT. ${nit(scenario)}`, size: 7, bold: true },
    { text: `Dir.${scenario.company.address} Tel.${scenario.company.phone}`, size: 6.5, bold: true }
  ]);

  const rightRows: [string, string][] = [
    ["FECHA", fulfillmentDate],
    ["LUGAR DE PAGO", companyCity(scenario)],
    ["FECHA DE PAGO", isoFromRndcDate(scenario.balancePaymentDate)],
    ["ORIGEN", scenario.sender.cityName]
  ];
  let ry = top + 4;
  for (const [label, value] of rightRows) {
    box(doc, rightX, ry, 88, 15);
    box(doc, rightX + 88, ry, rightW - 88, 15);
    text(doc, label, rightX + 2, ry + 4, 84, { size: 7.5, bold: true, align: "right" });
    text(doc, value, rightX + 91, ry + 4.5, rightW - 94, { size: 7 });
    ry += 15;
  }

  let y = top + 68;
  y = inlineRow(doc, x, y, w, 15, [
    { label: "POSEEDOR", value: scenario.vehicleHolder.fullName, ratio: 0.55 },
    { label: "CÉDULA", value: scenario.vehicleHolder.id, ratio: 0.45 }
  ]);
  y = inlineRow(doc, x, y, w, 15, [
    { label: "CONDUCTOR", value: scenario.driver.fullName, ratio: 0.55 },
    { label: "CÉDULA", value: scenario.driver.id, ratio: 0.23 },
    { label: "TELÉFONO", value: scenario.driver.phone, ratio: 0.22 }
  ]);
  y = inlineRow(doc, x, y, w, 15, [
    { label: "PLACA", value: scenario.vehicle.plate, ratio: 0.25 },
    { label: "MARCA", value: scenario.vehicle.brand, ratio: 0.25 },
    { label: "MODELO", value: scenario.vehicle.modelYear, ratio: 0.25 },
    { label: "REMOLQUE", value: scenario.vehicle.trailerPlate, ratio: 0.25 }
  ]);
  y = inlineRow(doc, x, y, w, 15, [
    { label: "MANIFIESTO DE CARGA", value: scenario.manifestNumber, ratio: 0.42 },
    { label: "PESO (Tn)", value: formatTons(scenario.cargo.quantityKg), ratio: 0.29 },
    { label: "VOLÚMEN", value: scenario.cargo.volumeM3 ?? 0, ratio: 0.29 }
  ]);
  y = inlineRow(doc, x, y, w, 15, [
    { label: "PLANILLA PUESTOS DE CONTROL", value: "NO", ratio: 0.48 },
    { label: "MULTAS", value: 0, ratio: 0.23 },
    { label: "COMODATO", value: "", ratio: 0.29 }
  ]);
  y += 3;

  const ratios = [0.1, 0.23, 0.18, 0.08, 0.08, 0.13, 0.2];
  y = headerRow(doc, x, y, w, 14, ratios, ["REM-REMI", "CLIENTE", "EMPAQUE", "PESO(Tn)", "VOL.(M3)", "NOVEDAD", "DESTINO"], 7);
  const remesas = resolveManifestRemesas(scenario);
  const rows = Math.max(7, remesas.length);
  for (let index = 0; index < rows; index += 1) {
    const remesa = remesas[index];
    y = valueRow(doc, x, y, w, 13, ratios, remesa ? [
      `${remesa.number}-${remesa.number}`,
      remesa.senderName,
      remesa.packageName,
      tonsWithDecimals(remesa.quantityKg),
      scenario.cargo.volumeM3 ?? 0,
      "Sin Novedad",
      scenario.recipient.cityName
    ] : ["", "", "", "", "", "", ""], { size: 7 });
  }
  y += 3;

  const obsH = 92;
  box(doc, x, y, w, obsH);
  text(doc, "OBSERVACIONES:", x + 4, y + 3, w - 8, { size: 7.5, bold: true });
  text(doc, compliance.observations ?? "", x + 4, y + 13, w - 8, { size: 7, h: 46 });
  text(doc, `Elaborado por:  ${preparedBy(scenario)}`, x + 60, y + 64, 200, { size: 7.5 });
  text(doc, "Recibí", x + Math.round(w * 0.62), y + 64, 100, { size: 7.5 });
  line(doc, x + 75, y + 83, x + Math.round(w * 0.5), y + 83);
  text(doc, "Firma y Sello", x + 130, y + 84, 100, { size: 7.5 });
  line(doc, x + Math.round(w * 0.62), y + 83, x + w - 20, y + 83);
  text(doc, "Firma y Sello", x + Math.round(w * 0.65), y + 84, 100, { size: 7.5 });
  y += obsH + 2;

  doc.font("Helvetica").fontSize(7);
  const conv = "CONVENCIONES: ";
  const convW = doc.widthOfString(conv);
  text(doc, conv, x + 2, y, 200, { size: 7 });
  doc.font("Helvetica-Bold").fontSize(7);
  const remW = doc.widthOfString("REM");
  text(doc, "REM", x + 2 + convW, y, 40, { size: 7, bold: true });
  doc.font("Helvetica").fontSize(7);
  const remesaW = doc.widthOfString(": Remesa,  ");
  text(doc, ": Remesa,  ", x + 2 + convW + remW, y, 60, { size: 7 });
  doc.font("Helvetica-Bold").fontSize(7);
  const remiW = doc.widthOfString("REMI");
  text(doc, "REMI", x + 2 + convW + remW + remesaW, y, 40, { size: 7, bold: true });
  text(doc, ": Remisión", x + 2 + convW + remW + remesaW + remiW, y, 60, { size: 7 });
  text(doc, copyLabel, x, y, w - 2, { size: 7, bold: true, align: "right" });
}


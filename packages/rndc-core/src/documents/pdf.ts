import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import PDFDocument from "pdfkit";
import type { DemoScenario, GeneratedDocument, ManifestRemesaSummary, PersonData, RndcConfig, RndcFlowStep, RndcManifestAcceptance } from "../rndc/types.js";
import { minTransporteLogoPng, mtmLogoPng, vigiladoSuperTransportePng } from "./brandAssets.js";

export type AuthorizationData = {
  loadingOrderAuthorization: string;
  remesaAuthorization: string;
  manifestAuthorization: string;
  seguridadQr: string;
  observacionesQr: string;
  acceptances: RndcManifestAcceptance[];
};

export const loadingOrderBranding = { systemName: "S.@.T. BASICO", agencyName: "DIEGO MANTILLA" } as const;

export const manifestLegalHeader = {
  companyName: "TRANSPORTES MTM SAS BUCARAMANGA - COLOMBIA",
  regional: "425",
  habilitacion: "0000045",
  resolutionNumber: "0000045",
  resolutionDate: "2015-07-27",
  legalNotice: "\"La Impresión en soporte cartular (papel) de este acto administrativo producido por medios electrónicos en cumplimiento de la ley 527 de 1999 (Articulos 6 a 13) y de la ley 962 de 2995 (Articulo 6), es una reproducción del documento original que se encuentra en formato electronico firmado digitalmente, cuya representación digital goza de autenticidad, integridad y no repudio\".",
  recommendations: "Para el cumplimiento del viaje se deben realizar los siguientes requisitos: manifiesto, remesa, orden de cargue, ruto grama y factura electrónica y/o cuenta de cobro dependiendo de su obligación tributaria (todos estos documentos deben estar firmados). Importante Nos acogemos al régimen simple de tributación por ende no hacemos retenciones, Tenerlo presente para futuras certificaciones. Los vehículos deben esperar programación de cita de descargue y/o enturnarse en el sitio de descargue asignado por el generador de carga; Lo anterior queda sujeto a la logística del generador de carga."
} as const;

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
    acceptances: authorization.acceptances ?? []
  };
}

type Doc = PDFKit.PDFDocument;

const PAGE_X = 40;
const PAGE_W = 532;
const INK = "#000000";

type Cell = {
  label?: string;
  value?: string | number;
  ratio: number;
  align?: "left" | "center" | "right";
  size?: number;
  valueBold?: boolean;
  labelSuffix?: string;
};

function createDoc(): Doc {
  return new PDFDocument({ size: "LETTER", margin: 0, info: { Producer: loadingOrderBranding.systemName } });
}

function box(doc: Doc, x: number, y: number, w: number, h: number): void {
  doc.rect(x, y, w, h).lineWidth(0.6).strokeColor(INK).stroke();
}

function line(doc: Doc, x1: number, y1: number, x2: number, y2: number, color = INK, width = 0.6): void {
  doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(width).strokeColor(color).stroke();
}

function text(doc: Doc, value: string | number | undefined, x: number, y: number, w: number, options: { size?: number; bold?: boolean; align?: "left" | "center" | "right" | "justify"; color?: string; h?: number; lineGap?: number } = {}): void {
  const content = value === undefined || value === null ? "" : String(value);
  if (!content) return;
  doc.font(options.bold ? "Helvetica-Bold" : "Helvetica").fontSize(options.size ?? 7.5).fillColor(options.color ?? INK);
  doc.text(content, x, y, { width: w, align: options.align ?? "left", height: options.h, lineBreak: true, lineGap: options.lineGap ?? 0 });
}

function textHeight(doc: Doc, value: string, w: number, size: number, bold = false): number {
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
  return doc.heightOfString(value, { width: w });
}

function stackCentered(doc: Doc, x: number, y: number, w: number, lines: { text: string; size: number; bold?: boolean; color?: string }[]): number {
  let cursor = y;
  for (const entry of lines) {
    text(doc, entry.text, x, cursor, w, { size: entry.size, bold: entry.bold, align: "center", color: entry.color });
    cursor += textHeight(doc, entry.text, w, entry.size, entry.bold);
  }
  return cursor;
}

function widths(total: number, ratios: number[]): number[] {
  const sum = ratios.reduce((acc, ratio) => acc + ratio, 0);
  let used = 0;
  return ratios.map((ratio, index) => {
    if (index === ratios.length - 1) return total - used;
    const w = Math.round((total * ratio) / sum);
    used += w;
    return w;
  });
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

function labeledBox(doc: Doc, x: number, y: number, w: number, h: number, label: string, value: string | number, options: { labelSize?: number; valueSize?: number; valueBold?: boolean; valueColor?: string } = {}): void {
  box(doc, x, y, w, h);
  const labelSize = options.labelSize ?? 5;
  const labelH = textHeight(doc, label, w - 2, labelSize, true);
  text(doc, label, x + 1, y + 1.5, w - 2, { size: labelSize, bold: true, align: "center" });
  text(doc, value, x + 2, y + labelH + 3, w - 4, { size: options.valueSize ?? 7, align: "center", bold: options.valueBold, color: options.valueColor, h: h - labelH - 4 });
}

function drawLogo(doc: Doc, x: number, y: number, w: number): number {
  doc.image(mtmLogoPng, x, y, { width: w });
  return y + (w * 210) / 852;
}

function drawVigilado(doc: Doc, x: number, y: number, w: number): number {
  doc.image(vigiladoSuperTransportePng, x, y, { width: w });
  return y + (w * 53) / 332;
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

  const logoBottom = drawLogo(doc, x, top + 4, 140);
  drawVigilado(doc, x + 28, logoBottom + 4, 84);

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

  let y = top + 86;
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
  const logoBottom = drawLogo(doc, x - 4, bandTop + 6, 124);
  drawVigilado(doc, x + 18, logoBottom + 6, 82);

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
    scenario.remesaNumber,
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
  const bottomH = 100;
  box(doc, x, y, bottomRatios[0], bottomH);
  text(doc, "OBSERVACIONES:", x + 4, y + 4, bottomRatios[0] - 8, { size: 7.5, bold: true });
  text(doc, `${scenario.observations} --`, x + 4, y + 13, bottomRatios[0] - 8, { size: 7, h: bottomH - 16 });
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
  text(doc, title, x + 3, y + 4, w - 6, { size: 7.5, bold: true });
  let cursor = y + 16;
  const labelW = Math.round(w * 0.31);
  for (const row of rows) {
    const h = row.lines ? 20 : 16;
    box(doc, x, cursor, labelW, h);
    box(doc, x + labelW, cursor, w - labelW, h);
    text(doc, `${row.label}:`, x + 3, cursor + (h - 8) / 2, labelW - 6, { size: 7.5, bold: true });
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

async function writeManifestPdf(path: string, scenario: DemoScenario, authorization: AuthorizationData, mode: RndcConfig["mode"]): Promise<void> {
  const doc = createDoc();
  const stream = createWriteStream(path);
  doc.pipe(stream);

  drawManifestPage(doc, scenario, authorization);
  modeFooter(doc, mode);

  doc.end();
  await waitForStream(stream);
}

function drawManifestPage(doc: Doc, scenario: DemoScenario, _authorization: AuthorizationData): void {
  const x = PAGE_X;
  const w = PAGE_W;
  const top = 28;
  const rightW = 176;
  const rightX = x + w - rightW;

  doc.image(minTransporteLogoPng, x, top, { width: 24 });
  text(doc, "FORMATO MANIFIESTO ÚNICO DE CARGA", x + 30, top + 2, 300, { size: 7, bold: true });
  text(doc, "MINISTERIO DE TRANSPORTE  -  DIRECCIÓN DE TRANSPORTE Y TRÁNSITO", x + 30, top + 11, 320, { size: 6, bold: true });
  text(doc, manifestLegalHeader.legalNotice, rightX - 20, top - 2, rightW + 20, { size: 5.2, align: "justify" });

  const bandTop = top + 44;
  drawLogo(doc, x + 8, bandTop + 10, 110);

  const centerX = x + 128;
  const centerW = rightX - centerX - 8;
  stackCentered(doc, centerX, bandTop, centerW, [
    { text: manifestLegalHeader.companyName, size: 8, bold: true },
    { text: `NIT: ${nit(scenario)}`, size: 7, bold: true },
    { text: scenario.company.address, size: 7 },
    { text: `Tels: ${scenario.company.phone}`, size: 7 },
    { text: "Fax:", size: 7 },
    { text: `HABILITACIÓN NACIONAL No.  ${manifestLegalHeader.habilitacion}`, size: 7, bold: true }
  ]);

  let ry = bandTop;
  box(doc, rightX, ry, rightW, 13);
  text(doc, "NÚMERO MANIFIESTO ELECTRÓNICO", rightX, ry + 3.5, rightW, { size: 6.5, align: "center" });
  ry += 13;
  box(doc, rightX, ry, rightW, 21);
  text(doc, `${manifestLegalHeader.regional}--${scenario.manifestNumber}`, rightX, ry + 4, rightW, { size: 13, bold: true, align: "center", color: "#ff0000" });
  ry += 21;
  box(doc, rightX, ry, rightW, 11);
  text(doc, "CÓDIGO NUMERADO CONSECUTIVO", rightX, ry + 3, rightW, { size: 5.5, align: "center" });
  ry += 11;
  box(doc, rightX, ry, rightW, 18);
  text(doc, `Regional ${manifestLegalHeader.regional} - Nro.Resolución ${manifestLegalHeader.resolutionNumber} - Fecha Resolución ${manifestLegalHeader.resolutionDate}`, rightX + 2, ry + 2.5, rightW - 4, { size: 6, align: "center" });
  ry += 18;

  const rowC = ry + 4;
  labeledBox(doc, rightX, rowC, rightW, 20, "FECHA LÍMITE ENTREGA CARGA", isoFromRndcDate(scenario.balancePaymentDate));
  const leftW = rightX - x - 8;
  const cWidths = widths(leftW, [1, 1, 1]);
  labeledBox(doc, x, rowC, cWidths[0], 20, "FECHA DE EXPEDICION (DD/MM/AA)", scenario.expeditionDate);
  labeledBox(doc, x + cWidths[0], rowC, cWidths[1], 20, "ORIGEN DEL VIAJE", scenario.sender.cityName);
  labeledBox(doc, x + cWidths[0] + cWidths[1], rowC, cWidths[2], 20, "DESTINO DEL VIAJE", scenario.recipient.cityName);

  let y = rowC + 24;
  y = sectionBar(doc, x, y, w, "INFORMACIÓN DEL TITULAR DEL MANIFIESTO Y DEL VEHÍCULO", 9, 5.5);
  y = labeledRow(doc, x, y, w, 20, [0.33, 0.2, 0.2, 0.15, 0.12], [
    ["TITULAR DEL MANIFIESTO", naturalName(scenario.vehicleHolder)],
    ["DOCUMENTO DE IDENTIFICACIÓN No.", scenario.vehicleHolder.id],
    ["DIRECCIÓN", scenario.vehicleHolder.address],
    ["TELÉFONO", scenario.vehicleHolder.phone],
    ["CIUDAD", scenario.vehicleHolder.cityName]
  ]);
  y = labeledRow(doc, x, y, w, 20, [0.075, 0.125, 0.105, 0.125, 0.07, 0.15, 0.15, 0.2], [
    ["PLACA", scenario.vehicle.plate],
    ["MARCA", scenario.vehicle.brand],
    ["CONFIGURACIÓN", scenario.vehicle.configuration],
    ["PLACA SEMIREMOLQUE", scenario.vehicle.trailerPlate],
    ["PESO VACÍO", formatTons(scenario.vehicle.emptyWeightKg)],
    ["No. PÓLIZA SOAT", scenario.vehicle.soatNumber],
    ["COMPAÑÍA SEGUROS SOAT", scenario.vehicle.insurerName ?? scenario.vehicle.insurerNit],
    ["VENCIMIENTO SOAT (DD/MM/AA)", dashDateFromRndc(scenario.vehicle.soatExpirationDate)]
  ]);
  y = labeledRow(doc, x, y, w, 20, [0.33, 0.2, 0.2, 0.15, 0.12], [
    ["CONDUCTOR", naturalName(scenario.driver)],
    ["DOCUMENTO DE IDENTIFICACIÓN No.", scenario.driver.id],
    ["DIRECCION", scenario.driver.address],
    ["No. LICENCIA CONDUCIÓN", scenario.driver.licenseNumber ?? scenario.driver.id],
    ["CIUDAD", scenario.driver.cityName]
  ]);
  y += 4;

  y = sectionBar(doc, x, y, w, "INFORMACIÓN DE LA MERCANCÍA TRANSPORTADA", 9, 5.5);
  const cargoRatios = [0.07, 0.085, 0.06, 0.075, 0.065, 0.08, 0.1, 0.12, 0.115, 0.11, 0.12];
  y = headerRow(doc, x, y, w, 18, cargoRatios, [
    "NÚMERO DE REMESA", "UNIDAD DE MEDIDA", "PESO", "NATURALEZA", "EMPAQUE", "CÓDIGO DE PRODUCTO", "PRODUCTO TRANSPORTADO", "INFORMACIÓN REMITENTE", "INFORMACIÓN DESTINATARIO", "MERCANCÍAS ASEGURADA", "TOMADOR DEL SEGURO"
  ], 4.6);
  const bodyH = 170;
  const cargoWidths = widths(w, cargoRatios);
  box(doc, x, y, w, bodyH);
  let cx = x;
  cargoWidths.slice(0, -1).forEach((cw) => {
    cx += cw;
    line(doc, cx, y, cx, y + bodyH);
  });
  resolveManifestRemesas(scenario).forEach((remesa, index) => {
    const rowY = y + 10 + index * 32;
    const values = [
      remesa.number,
      "Kilogramos",
      String(remesa.quantityKg),
      scenario.cargo.natureCode,
      scenario.cargo.packageCode,
      scenario.cargo.merchandiseCode,
      remesa.productName,
      remesa.senderName,
      remesa.recipientName,
      scenario.recipient.cityName,
      "EMPRESA"
    ];
    let vx = x;
    values.forEach((value, column) => {
      text(doc, value, vx + 1, rowY, cargoWidths[column] - 2, { size: 6.5, align: "center" });
      vx += cargoWidths[column];
    });
  });
  y += bodyH + 4;

  const netToPay = scenario.money.freightValue - scenario.money.sourceRetention - scenario.money.icaRetention - scenario.money.fopatRetention;
  const priceLabelW = Math.round(w * 0.2);
  const priceValueW = Math.round(w * 0.145);
  const midW = Math.round(w * 0.275);
  const recW = w - priceLabelW - priceValueW - midW;
  const bottomTop = y;
  sectionBar(doc, x, y, priceLabelW + priceValueW, "PRECIO DEL VIAJE", 9, 5.5);
  let py = y + 9;
  const priceRows: [string, number][] = [
    ["VALOR TOTAL DEL VIAJE", scenario.money.freightValue],
    ["RETENCIÓN EN LA FUENTE", scenario.money.sourceRetention],
    ["RETENCIÓN ICA", scenario.money.icaRetention],
    ["RETENCIÓN FOPAT", scenario.money.fopatRetention],
    ["VALOR NETO A PAGAR", netToPay],
    ["VALOR ANTICIPO", scenario.money.advanceValue],
    ["SALDO POR PAGAR", netToPay - scenario.money.advanceValue]
  ];
  for (const [label, value] of priceRows) {
    box(doc, x, py, priceLabelW, 13);
    box(doc, x + priceLabelW, py, priceValueW, 13);
    text(doc, label, x + 2, py + 3.5, priceLabelW - 4, { size: 5.5, bold: true });
    text(doc, money(value), x + priceLabelW + 2, py + 2.5, priceValueW - 6, { size: 7, align: "right" });
    py += 13;
  }

  const midX = x + priceLabelW + priceValueW;
  sectionBar(doc, midX, y, midW, "PAGO DE SALDO", 9, 5.5);
  const midHalf = widths(midW, [1, 1]);
  labeledBox(doc, midX, y + 9, midHalf[0], 30, "LUGAR", companyCity(scenario));
  labeledBox(doc, midX + midHalf[0], y + 9, midHalf[1], 30, "FECHA (DD/MM/AA)", dashDateFromRndc(scenario.balancePaymentDate));
  labeledBox(doc, midX, y + 39, midW, 30, "CARGUE PAGADO POR", "REMITENTE");
  labeledBox(doc, midX, y + 69, midW, 31, "DESCARGUE PAGADO POR", "DESTINATARIO");

  const recX = midX + midW;
  sectionBar(doc, recX, y, recW, "RECOMENDACIONES", 9, 5.5);
  box(doc, recX, y + 9, recW, 91);
  text(doc, `/Número Manifiesto Interno: ${scenario.manifestNumber}\n${manifestLegalHeader.recommendations}`, recX + 3, y + 12, recW - 6, { size: 5.5, align: "justify", h: 86 });
  y = bottomTop + 104;

  box(doc, x, y, w, 16);
  doc.font("Helvetica-Bold").fontSize(7.5);
  const lettersLabel = "VALOR TOTAL EN LETRAS:";
  const lettersW = doc.widthOfString(lettersLabel);
  text(doc, lettersLabel, x + 3, y + 4.5, w, { size: 7.5, bold: true });
  text(doc, amountInWords(scenario.money.freightValue), x + 3 + lettersW + 4, y + 4.5, w - lettersW - 12, { size: 7.5 });
  y += 20;

  const signWidths = widths(w, [0.5, 0.25, 0.25]);
  box(doc, x, y, signWidths[0], 50);
  box(doc, x + signWidths[0], y, signWidths[1], 50);
  box(doc, x + signWidths[0] + signWidths[1], y, signWidths[2], 50);
  text(doc, "Documento firmado digitalmente por  en calidad delegado por el representante legal de la empresa", x + 4, y + 3, signWidths[0] - 8, { size: 5, align: "center" });
  text(doc, "FIRMA Y HUELLA TITULAR DEL MANIFIESTO", x + signWidths[0] + 2, y + 3, signWidths[1] - 4, { size: 5.5, bold: true, align: "center" });
  text(doc, "FIRMA Y HUELLA DEL CONDUCTOR", x + signWidths[0] + signWidths[1] + 2, y + 3, signWidths[2] - 4, { size: 5.5, bold: true, align: "center" });
}

function labeledRow(doc: Doc, x: number, y: number, w: number, h: number, ratios: number[], cells: [string, string | number][]): number {
  const cellWidths = widths(w, ratios);
  let cursor = x;
  cells.forEach(([label, value], index) => {
    labeledBox(doc, cursor, y, cellWidths[index], h, label, value);
    cursor += cellWidths[index];
  });
  return y + h;
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

const UNITS = ["", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiún", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function numberInWords(value: number): string {
  if (value === 0) return "cero";
  if (value < 30) return UNITS[value];
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const rest = value % 10;
    return rest === 0 ? TENS[tens] : `${TENS[tens]} y ${UNITS[rest]}`;
  }
  if (value === 100) return "cien";
  if (value < 1000) {
    const hundreds = Math.floor(value / 100);
    const rest = value % 100;
    return rest === 0 ? HUNDREDS[hundreds] : `${HUNDREDS[hundreds]} ${numberInWords(rest)}`;
  }
  if (value < 1_000_000) {
    const thousands = Math.floor(value / 1000);
    const rest = value % 1000;
    const prefix = thousands === 1 ? "mil" : `${numberInWords(thousands)} mil`;
    return rest === 0 ? prefix : `${prefix} ${numberInWords(rest)}`;
  }
  const millions = Math.floor(value / 1_000_000);
  const rest = value % 1_000_000;
  const prefix = millions === 1 ? "un millón" : `${numberInWords(millions)} millones`;
  return rest === 0 ? prefix : `${prefix} ${numberInWords(rest)}`;
}

function waitForStream(stream: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}

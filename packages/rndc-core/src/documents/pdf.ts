import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { DemoScenario, GeneratedDocument, ManifestRemesaSummary, RndcConfig, RndcFlowStep, RndcManifestAcceptance } from "../rndc/types.js";

export type AuthorizationData = {
  loadingOrderAuthorization: string;
  remesaAuthorization: string;
  manifestAuthorization: string;
  seguridadQr: string;
  observacionesQr: string;
  acceptances: RndcManifestAcceptance[];
};

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
    : "Documento generado por el sistema TMS. Verifique su estado oficial en RNDC.";
}

export async function generateDocuments(scenario: DemoScenario, steps: RndcFlowStep[], pdfDir: string, mode: RndcConfig["mode"] = "dry-run"): Promise<GeneratedDocument[]> {
  await mkdir(pdfDir, { recursive: true });

  const authorization = readAuthorization(steps);
  const loadingOrderDocument = await generateLoadingOrderDocument(scenario, authorization.loadingOrderAuthorization, pdfDir);
  const remesaDocument = await generateRemesaDocument(scenario, authorization, pdfDir, mode);
  const manifestDocument = await generateManifestDocument(scenario, authorization, pdfDir, mode);

  return [
    loadingOrderDocument,
    remesaDocument,
    manifestDocument
  ];
}

export async function generateLoadingOrderDocument(scenario: DemoScenario, authorization: string, pdfDir: string): Promise<GeneratedDocument> {
  await mkdir(pdfDir, { recursive: true });
  const path = join(pdfDir, `orden-cargue-${documentFileSegment(scenario.cargoNumber)}.pdf`);
  await writeLoadingOrderPdf(path, scenario, authorization);
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

async function writeLoadingOrderPdf(path: string, scenario: DemoScenario, authorization: string): Promise<void> {
  const doc = new PDFDocument({ size: "LETTER", margin: 28 });
  const stream = createWriteStream(path);
  doc.pipe(stream);

  drawLoadingOrderCopy(doc, scenario, authorization, 28, "Original");
  drawLoadingOrderCopy(doc, scenario, authorization, 398, "Copia");

  doc.end();
  await waitForStream(stream);
}

function drawLoadingOrderCopy(doc: PDFKit.PDFDocument, scenario: DemoScenario, authorization: string, top: number, copyLabel: string): void {
  const x = 36;
  const width = 540;
  const rightX = x + width - 166;
  const centerX = x + 94;

  doc.font("Helvetica").fontSize(8).fillColor("#111111").text("S.@.T. BASICO", centerX, top, { width: 280, align: "center" });
  doc.font("Helvetica-Bold").fontSize(12).text("ORDEN DE CARGUE", centerX, top + 15, { width: 280, align: "center" });
  doc.fontSize(9).text(scenario.company.name, centerX, top + 30, { width: 280, align: "center" });
  doc.fontSize(7).text(`NIT. ${formatNit(scenario.company.nit, scenario.company.dv)}`, centerX, top + 43, { width: 280, align: "center" });
  doc.font("Helvetica").fontSize(7).text(scenario.company.address, centerX, top + 54, { width: 280, align: "center" });
  doc.text(`${scenario.company.cityName} - ${scenario.company.phone}`, centerX, top + 64, { width: 280, align: "center" });
  doc.font("Helvetica-Bold").fontSize(8).text(copyLabel, centerX, top + 75, { width: 280, align: "center" });

  drawBrandMark(doc, x, top + 6, 90, 58);
  drawHeaderNumberBox(doc, rightX, top + 2, 166, scenario.cargoNumber, displayDateFromRndc(scenario.expeditionDate), "TMS DEMO", authorization);

  let y = top + 88;
  y = drawLoadingOrderSection(doc, x, y, width, "DATOS DEL CLIENTE");
  y = drawFieldRow(doc, x, y, width, 16, [
    ["NOMBRE", scenario.sender.name, 0.62],
    ["NIT o C.C. No.", scenario.sender.id, 0.38]
  ]);
  y += 4;

  y = drawLoadingOrderSection(doc, x, y, width, "DATOS DE LA MERCANCIA");
  y = drawFieldRow(doc, x, y, width, 16, [
    ["PRODUCTO", scenario.cargo.productName, 0.38],
    ["VOLUMEN", "0", 0.22],
    ["CANTIDAD", "0", 0.22],
    ["PESO", formatTons(scenario.cargo.quantityKg), 0.18]
  ]);
  y += 4;

  y = drawLoadingOrderSection(doc, x, y, width, "DATOS DEL VEHICULO");
  y = drawFieldRow(doc, x, y, width, 16, [
    ["MARCA", scenario.vehicle.brand, 0.28],
    ["PLACA", scenario.vehicle.plate, 0.18],
    ["MODELO", scenario.vehicle.modelYear, 0.18],
    ["TRAILER", scenario.vehicle.trailerPlate, 0.20],
    ["COLOR", vehicleColorName(scenario.vehicle.colorCode), 0.16]
  ]);
  y = drawFieldRow(doc, x, y, width, 16, [
    ["CONDUCTOR", scenario.driver.fullName, 0.56],
    ["C.C.", scenario.driver.id, 0.22],
    ["TEL", scenario.driver.phone, 0.22]
  ]);
  y += 4;

  y = drawLoadingOrderSection(doc, x, y, width, "DATOS DEL REMITENTE");
  y = drawFieldRow(doc, x, y, width, 16, [
    ["NOMBRE", scenario.sender.name, 0.38],
    ["ORIGEN", scenario.sender.cityName, 0.22],
    ["DIRECCION", scenario.sender.address, 0.22],
    ["TELEFONO", scenario.company.phone, 0.18]
  ]);
  y += 4;

  y = drawLoadingOrderSection(doc, x, y, width, "DATOS DESTINATARIO");
  y = drawTableHeader(doc, x, y, width, 12, ["NOMBRE", "DESTINO", "DIRECCION", "TELEFONO"]);
  y = drawPlainRow(doc, x, y, width, 30, [
    scenario.recipient.name,
    scenario.recipient.cityName,
    scenario.recipient.address,
    scenario.company.phone
  ]);
  y += 4;

  y = drawLoadingOrderSection(doc, x, y, width, "DATOS GENERALES");
  y = drawFieldRow(doc, x, y, width, 12, [["CONDICIONES ESPECIALES CARGUE", "", 1]]);
  y = drawFieldRow(doc, x, y, width, 12, [["SELLOS DE SEGURIDAD Y/O PRECINTO", "", 1]]);
  y = drawFieldRow(doc, x, y, width, 12, [["OBSERVACIONES ADICIONALES", scenario.observations, 1]]);
  y = drawFieldRow(doc, x, y, width, 12, [["RECOMENDACIONES", `RADICADO INFO CARGA RNDC: ${authorization}`, 1]]);
  drawSignatureBoxes(doc, x, y, width, 28);
}

function drawBrandMark(doc: PDFKit.PDFDocument, x: number, y: number, width: number, height: number): void {
  doc.roundedRect(x, y, width, height, 4).strokeColor("#1d4ed8").lineWidth(0.8).stroke();
  doc.font("Helvetica-Bold").fontSize(14).fillColor("#1d4ed8").text("MTM", x, y + 9, { width, align: "center" });
  doc.fontSize(7).text("TRANSPORTE DE CARGA", x + 4, y + 28, { width: width - 8, align: "center" });
  doc.font("Helvetica").fontSize(7).fillColor("#f97316").text("Vigilado SuperTransporte", x + 4, y + 42, { width: width - 8, align: "center" });
  doc.fillColor("#111111").lineWidth(0.6);
}

function drawHeaderNumberBox(doc: PDFKit.PDFDocument, x: number, y: number, width: number, number: string, date: string, agency: string, authorization: string): void {
  doc.rect(x, y, width, 78).strokeColor("#111111").lineWidth(0.7).stroke();
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111111").text(`No. ${number}`, x, y + 10, { width, align: "center" });
  doc.moveTo(x, y + 32).lineTo(x + width, y + 32).stroke();
  doc.moveTo(x + width / 2, y + 32).lineTo(x + width / 2, y + 57).stroke();
  doc.fontSize(8).text("FECHA", x, y + 38, { width: width / 2, align: "center" });
  doc.text("AGENCIA", x + width / 2, y + 38, { width: width / 2, align: "center" });
  doc.font("Helvetica").fontSize(7.2).text(date, x, y + 49, { width: width / 2, align: "center" });
  doc.text(agency, x + width / 2, y + 49, { width: width / 2, align: "center" });
  doc.moveTo(x, y + 57).lineTo(x + width, y + 57).stroke();
  doc.font("Helvetica-Bold").fontSize(6.2).text("RADICADO RNDC", x + 4, y + 62, { width: 62 });
  doc.font("Helvetica").fontSize(6.2).text(authorization, x + 70, y + 62, { width: width - 74 });
}

function drawLoadingOrderSection(doc: PDFKit.PDFDocument, x: number, y: number, width: number, title: string): number {
  doc.rect(x, y, width, 10).strokeColor("#111111").lineWidth(0.6).stroke();
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#111111").text(title, x + 4, y + 2, { width: width - 8, align: "center" });
  return y + 10;
}

function drawFieldRow(doc: PDFKit.PDFDocument, x: number, y: number, width: number, height: number, fields: [string, string | number, number][]): number {
  let currentX = x;
  fields.forEach(([label, value, ratio], index) => {
    const cellWidth = index === fields.length - 1 ? x + width - currentX : width * ratio;
    doc.rect(currentX, y, cellWidth, height).strokeColor("#111111").lineWidth(0.6).stroke();
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#111111").text(`${label}:`, currentX + 4, y + 3, { width: Math.min(190, cellWidth - 8), height: height - 4 });
    const labelWidth = Math.min(doc.widthOfString(`${label}:`) + 8, Math.max(34, cellWidth * 0.42), cellWidth - 24);
    doc.font("Helvetica").fontSize(7).text(String(value), currentX + 4 + labelWidth, y + 3, { width: cellWidth - labelWidth - 8, height: height - 4 });
    currentX += cellWidth;
  });
  return y + height;
}

function drawTableHeader(doc: PDFKit.PDFDocument, x: number, y: number, width: number, height: number, headers: string[]): number {
  const cellWidth = width / headers.length;
  headers.forEach((header, index) => {
    doc.rect(x + index * cellWidth, y, cellWidth, height).strokeColor("#111111").lineWidth(0.6).stroke();
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#111111").text(header, x + index * cellWidth + 4, y + 3, { width: cellWidth - 8, align: "center" });
  });
  return y + height;
}

function drawPlainRow(doc: PDFKit.PDFDocument, x: number, y: number, width: number, height: number, values: string[]): number {
  const cellWidth = width / values.length;
  values.forEach((value, index) => {
    doc.rect(x + index * cellWidth, y, cellWidth, height).strokeColor("#111111").lineWidth(0.6).stroke();
    doc.font("Helvetica").fontSize(7).fillColor("#111111").text(value, x + index * cellWidth + 4, y + 5, { width: cellWidth - 8, height: height - 8 });
  });
  return y + height;
}

function drawSignatureBoxes(doc: PDFKit.PDFDocument, x: number, y: number, width: number, height: number): void {
  const cellWidth = width / 2;
  doc.rect(x, y, cellWidth, height).strokeColor("#111111").lineWidth(0.6).stroke();
  doc.rect(x + cellWidth, y, cellWidth, height).stroke();
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#111111").text("ELABORADO POR", x, y + 5, { width: cellWidth, align: "center" });
  doc.text("RECIBIDO", x + cellWidth, y + 5, { width: cellWidth, align: "center" });
}

async function writeRemesaPdf(path: string, scenario: DemoScenario, authorization: AuthorizationData, mode: RndcConfig["mode"]): Promise<void> {
  const doc = new PDFDocument({ size: "LETTER", margin: 36 });
  const stream = createWriteStream(path);
  doc.pipe(stream);

  header(doc, scenario.company.name, "REMESA TERRESTRE DE CARGA");
  doc.fontSize(10).text(`NIT: ${formatNit(scenario.company.nit, scenario.company.dv)}`, { align: "center" });
  doc.text(scenario.company.address, { align: "center" });
  doc.text(`${scenario.company.cityName} - ${scenario.company.phone}`, { align: "center" });
  doc.moveDown(1);

  twoColumns(doc, [
    ["FECHA", isoFromRndcDate(scenario.expeditionDate)],
    ["OFICINA", scenario.company.cityName],
    ["PLACA", scenario.vehicle.plate],
    ["CONDUCTOR", scenario.driver.fullName],
    ["CEDULA", scenario.driver.id]
  ], [
    ["REMESA No.", scenario.remesaNumber],
    ["NUMERO AUTORIZACION", authorization.remesaAuthorization],
    ["ORDEN DE CARGUE", scenario.cargoNumber],
    ["MODO", mode === "dry-run" ? "RNDC PRUEBA" : "RNDC"]
  ]);

  sectionTitle(doc, "Remitente / Lugar de Cargue");
  partyBlock(doc, scenario.sender, scenario.loadingAppointment, "01:00:00");
  sectionTitle(doc, "Destinatario / Lugar de Descargue");
  partyBlock(doc, scenario.recipient, scenario.unloadingAppointment, "02:00:00");

  sectionTitle(doc, "Mercancia");
  keyValueGrid(doc, [
    ["VALOR DECLARADO", money(scenario.cargo.declaredValue)],
    ["APLICA SEGURO", "SI"],
    ["PROD. TRANSPORTADO", scenario.cargo.productName],
    ["NATURALEZA", scenario.cargo.nature],
    ["EMPAQUE", scenario.cargo.packageName],
    ["PESO", `${scenario.cargo.quantityKg / 1000} Ton`]
  ], 3);

  table(doc, ["REMISION", "CANTIDAD", "EMPAQUE", "PESO (Ton)", "CONTENIDO"], [
    [scenario.remesaNumber, "1", scenario.cargo.packageName, String(scenario.cargo.quantityKg / 1000), scenario.cargo.productName]
  ]);

  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").text("OBSERVACIONES:");
  doc.font("Helvetica").text(`${scenario.observations}, --`);
  signatureRow(doc, ["Elaborado por", "Recibi a satisfaccion"]);
  footer(doc, mode);

  doc.end();
  await waitForStream(stream);
}

async function writeManifestPdf(path: string, scenario: DemoScenario, authorization: AuthorizationData, mode: RndcConfig["mode"]): Promise<void> {
  const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 28 });
  const stream = createWriteStream(path);
  doc.pipe(stream);

  header(doc, scenario.company.name, "FORMATO MANIFIESTO UNICO DE CARGA");
  doc.fontSize(9).text(`Nit: ${formatNit(scenario.company.nit, scenario.company.dv)}`, { align: "center" });
  doc.text(scenario.company.address, { align: "center" });
  doc.text(`${scenario.company.cityName} - ${scenario.company.phone}`, { align: "center" });
  doc.moveDown(0.5);

  const topY = doc.y;
  doc.font("Helvetica-Bold").fontSize(10).text(`Manifiesto: ${scenario.manifestNumber}`, 620, topY - 34, { width: 130 });
  doc.text(`Autorizacion: ${authorization.manifestAuthorization}`, 620, topY - 18, { width: 130 });

  keyValueGrid(doc, [
    ["FECHA DE EXPEDICION", isoFromRndcDate(scenario.expeditionDate)],
    ["TIPO MANIFIESTO", "Generales"],
    ["CANTIDAD DE VIAJES", "1"],
    ["ORIGEN DEL VIAJE", scenario.sender.cityName],
    ["DESTINO DEL VIAJE", scenario.recipient.cityName]
  ], 5);

  sectionTitle(doc, "Informacion del vehiculo y conductor");
  keyValueGrid(doc, [
    ["TITULAR MANIFIESTO", scenario.vehicleHolder.fullName],
    ["DOCUMENTO", scenario.vehicleHolder.id],
    ["DIRECCION", scenario.vehicleHolder.address],
    ["TELEFONO", scenario.vehicleHolder.phone],
    ["CIUDAD", scenario.vehicleHolder.cityName],
    ["PLACA", scenario.vehicle.plate],
    ["MARCA", scenario.vehicle.brand],
    ["PLACA SEMIREMOLQUE", scenario.vehicle.trailerPlate],
    ["CONFIGURACION", scenario.vehicle.configuration],
    ["PESO VACIO", `${scenario.vehicle.emptyWeightKg}`],
    ["No. POLIZA", scenario.vehicle.soatNumber],
    ["SOAT", scenario.vehicle.insurerNit],
    ["VENCE SOAT", scenario.vehicle.soatExpirationDate],
    ["CONDUCTOR", scenario.driver.fullName],
    ["DOCUMENTO CONDUCTOR", scenario.driver.id],
    ["TELEFONO CONDUCTOR", scenario.driver.phone],
    ["LICENCIA", scenario.driver.licenseNumber ?? scenario.driver.id],
    ["CIUDAD CONDUCTOR", scenario.driver.cityName]
  ], 5, 24);

  sectionTitle(doc, "Informacion de la mercancia transportada");
  table(doc, ["Nro. Remesa", "Unidad", "Cantidad", "Naturaleza", "Producto", "Remitente", "Destinatario"], resolveManifestRemesas(scenario).map((remesa) => [
      remesa.number,
      "Kilogramos",
      String(remesa.quantityKg),
      remesa.nature,
      `${remesa.packageName} - ${remesa.productName}`,
      remesa.senderName,
      remesa.recipientName
    ]), 24);

  const netToPay = scenario.money.freightValue - scenario.money.sourceRetention - scenario.money.icaRetention - scenario.money.fopatRetention;
  sectionTitle(doc, "Valores");
  keyValueGrid(doc, [
    ["VALOR TOTAL DEL VIAJE", money(scenario.money.freightValue)],
    ["RETENCION EN LA FUENTE", money(scenario.money.sourceRetention)],
    ["RETENCION ICA", money(scenario.money.icaRetention)],
    ["RETENCION FOPAT", money(scenario.money.fopatRetention)],
    ["VALOR NETO A PAGAR", money(netToPay)],
    ["VALOR ANTICIPO", money(scenario.money.advanceValue)],
    ["SALDO A PAGAR", money(netToPay - scenario.money.advanceValue)]
  ], 4, 24);

  const qrPayload = [
    `MEC:${authorization.manifestAuthorization}`,
    `Fecha:${isoFromRndcDate(scenario.expeditionDate)}`,
    `Placa:${scenario.vehicle.plate}`,
    `Remolque:${scenario.vehicle.trailerPlate}`,
    `Config:${scenario.vehicle.configuration}`,
    `Orig:${scenario.sender.cityName}`,
    `Dest:${scenario.recipient.cityName}`,
    `Mercancia:${scenario.cargo.productName}`,
    `Conductor:${scenario.driver.id}`,
    `Empresa:${scenario.company.rndcNit}`,
    `Obs:${authorization.observacionesQr}`,
    `Seguro:${authorization.seguridadQr}`
  ].join("|");
  const qr = await QRCode.toDataURL(qrPayload, { margin: 1, width: 110 });
  const observationsY = Math.max(doc.y + 4, 390);
  doc.image(qr, 632, observationsY, { width: 84 });
  doc.font("Helvetica").fontSize(7).text("QR RNDC", 632, observationsY + 86, { width: 84, align: "center" });
  doc.font("Helvetica-Bold").fontSize(8).text("OBSERVACIONES", 350, observationsY, { width: 260 });
  doc.font("Helvetica").fontSize(7).text(`${scenario.observations}. CEL CONDUC: ${scenario.driver.phone}`, 350, observationsY + 13, { width: 260, height: 28 });
  doc.font("Helvetica-Bold").fontSize(7).text("ACEPTACION ELECTRONICA", 350, observationsY + 43, { width: 260 });
  doc.font("Helvetica").fontSize(6.5).text(formatManifestAcceptances(authorization.acceptances), 350, observationsY + 54, { width: 260, height: 28 });
  signatureRow(doc, ["Firma y huella titular manifiesto", "Firma y huella del conductor"]);
  footer(doc, mode);

  doc.end();
  await waitForStream(stream);
}

function header(doc: PDFKit.PDFDocument, company: string, title: string): void {
  doc.font("Helvetica-Bold").fontSize(15).text(title, { align: "center" });
  doc.moveDown(0.35);
  doc.fontSize(11).text(company, { align: "center" });
  resetX(doc);
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string): void {
  resetX(doc);
  doc.moveDown(0.7);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#111111").text(title.toUpperCase());
  doc.moveDown(0.2);
  doc.font("Helvetica").fillColor("#111111");
  resetX(doc);
}

function twoColumns(doc: PDFKit.PDFDocument, left: [string, string][], right: [string, string][]): void {
  const y = doc.y;
  keyValueLines(doc, left, 40, y, 260);
  keyValueLines(doc, right, 350, y, 210);
  doc.y = Math.max(y + left.length * 15, y + right.length * 15) + 8;
  resetX(doc);
}

function keyValueLines(doc: PDFKit.PDFDocument, rows: [string, string][], x: number, y: number, width: number): void {
  rows.forEach(([label, value], index) => {
    doc.font("Helvetica-Bold").fontSize(8).text(`${label}:`, x, y + index * 15, { width: 105 });
    doc.font("Helvetica").text(value, x + 112, y + index * 15, { width: width - 112 });
  });
}

function partyBlock(doc: PDFKit.PDFDocument, party: DemoScenario["sender"], appointment: string, agreedTime: string): void {
  keyValueGrid(doc, [
    ["Nombre", party.name],
    ["Identificacion", party.id],
    ["Direccion", party.address],
    ["Coordenadas", `Lat ${party.latitude}, Long ${party.longitude}`],
    ["Municipio", party.cityName],
    ["Fecha Hora Cita", appointment],
    ["Tiempo Pactado", agreedTime]
  ], 2);
}

function keyValueGrid(doc: PDFKit.PDFDocument, rows: [string, string | number][], columns: number, rowHeight = 30): void {
  const startX = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = width / columns;
  const startY = doc.y;
  rows.forEach(([label, value], index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = startX + col * colWidth;
    const y = startY + row * rowHeight;
    doc.rect(x, y, colWidth, rowHeight).strokeColor("#d6d6d6").stroke();
    doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#333333").text(label, x + 4, y + 4, { width: colWidth - 8, height: 8 });
    doc.font("Helvetica").fontSize(7.5).fillColor("#111111").text(String(value), x + 4, y + 13, { width: colWidth - 8, height: 14 });
  });

  doc.y = startY + Math.ceil(rows.length / columns) * rowHeight + 4;
  resetX(doc);
}

function table(doc: PDFKit.PDFDocument, headers: string[], rows: string[][], rowHeight = 36): void {
  const startX = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = width / headers.length;
  const headerY = doc.y;
  const headerHeight = 20;
  doc.rect(startX, headerY, width, headerHeight).fillAndStroke("#f0f2f5", "#cfd4dc");
  headers.forEach((header, index) => {
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#111111").text(header, startX + index * colWidth + 4, headerY + 6, { width: colWidth - 8, height: 8 });
  });

  let y = headerY + headerHeight;
  rows.forEach((row) => {
    doc.rect(startX, y, width, rowHeight).strokeColor("#cfd4dc").stroke();
    row.forEach((value, index) => {
      doc.font("Helvetica").fontSize(6.8).fillColor("#111111").text(value, startX + index * colWidth + 4, y + 6, { width: colWidth - 8, height: rowHeight - 8 });
    });
    y += rowHeight;
  });

  doc.y = y + 6;
  resetX(doc);
}

function signatureRow(doc: PDFKit.PDFDocument, labels: string[]): void {
  const y = doc.page.height - doc.page.margins.bottom - 58;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const gap = 40;
  const colWidth = (width - gap) / 2;
  labels.forEach((label, index) => {
    const x = doc.page.margins.left + index * (colWidth + gap);
    doc.moveTo(x, y + 24).lineTo(x + colWidth, y + 24).strokeColor("#111111").stroke();
    doc.font("Helvetica").fontSize(8).fillColor("#111111").text(label, x, y + 30, { width: colWidth, align: "center" });
  });
}

function footer(doc: PDFKit.PDFDocument, mode: RndcConfig["mode"]): void {
  doc.font("Helvetica").fontSize(7).fillColor("#666666").text(documentFooterText(mode), doc.page.margins.left, doc.page.height - doc.page.margins.bottom - 10, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    align: "center"
  });
}

function resetX(doc: PDFKit.PDFDocument): void {
  doc.x = doc.page.margins.left;
}

function money(value: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  }).format(value);
}

function formatNit(value: string, dv: string): string {
  return `${value}-${dv}`;
}

function isoFromRndcDate(value: string): string {
  const [day, month, year] = value.split("/");
  return `${year}-${month}-${day}`;
}

function displayDateFromRndc(value: string): string {
  return value.replaceAll("/", "-");
}

function formatTons(value: number): string {
  const tons = value / 1000;
  return Number.isInteger(tons) ? String(tons) : tons.toFixed(2);
}

function vehicleColorName(value: string): string {
  if (value === "1") {
    return "BLANCO";
  }

  return value;
}

function waitForStream(stream: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}

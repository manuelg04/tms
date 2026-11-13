import { createWriteStream } from "node:fs";
import QRCode from "qrcode";
import type { DemoScenario, PersonData, RndcConfig } from "../rndc/types.js";
import { superTransporteLogoPng, transporteLogoPng } from "./brandAssets.js";
import type { AuthorizationData } from "./pdf.js";
import { documentFooterText, resolveManifestRemesas } from "./pdf.js";
import { box, companyStamp, createDoc, line, numberInWords, text, waitForStream } from "./pdfPrimitives.js";
import type { Doc } from "./pdfPrimitives.js";

const PAGE_WIDTH = 855;
const PAGE_HEIGHT = 612;
const LEFT = 28.9;
const RIGHT = 794.5;
const SHADE = "#e6e6e6";

export const manifestLegalNotice = "\"La impresión en soporte cartular (papel) de este acto administrativo producido por medios electronicos en cumplimiento de la ley 527 de 1999 (Articulos 6 al 13) y de la ley 962 de 2005 (Articulo 6), es una reproducción del documento original que se encuentra en formato electrónico en la Base de Datos del RNDC en el Ministerio de Transporte, cuya representación digital goza de autenticidad, integridad y no repudio\"";

export const manifestFraudNotice = "Si es víctima de algún fraude o conoce de alguna irregularidad en el Registro Nacional de Despachos de Carga RNDC denúncielo a la Superintendencia de Puertos y Transporte, en la línea gratuita nacional 018000 915615 y a través del correo electrónico: atencionciudadano@supertransporte.gov.co";

const manifestTypeNames: Record<string, string> = {
  G: "General",
  M: "Multiparada",
  W: "Viaje vacío",
  V: "Varios viajes en el día"
};

export function manifestQrText(scenario: DemoScenario, authorization: AuthorizationData): string {
  const lines = [
    `MEC:${authorization.manifestAuthorization}`,
    `Fecha:${slashDate(scenario.expeditionDate)}`,
    `Placa:${scenario.vehicle.plate}`,
    `Remolque:${scenario.vehicle.trailerPlate}`,
    `Config:${scenario.vehicle.configuration}`,
    `Orig:${scenario.sender.cityName.slice(0, 20).trim()}`,
    `Dest:${scenario.recipient.cityName.slice(0, 20).trim()}`,
    `Mercancia:${scenario.cargo.productName.slice(0, 30).trim()}`,
    `Conductor:${scenario.driver.id}`,
    `Empresa:${scenario.company.name.slice(0, 30).trim()}`
  ];
  const observations = authorization.observacionesQr.trim();
  if (observations && observations !== "PENDIENTE") {
    lines.push(`Obs:${observations}`);
  }
  lines.push(`Seguro:${authorization.seguridadQr}`);
  return lines.join("\r\n");
}

export function manifestRadicationStamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: true }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}/${part("month")}/${part("day")} ${part("hour")}:${part("minute")} ${part("dayPeriod").toLowerCase()}`;
}

export function manifestAmountInWords(value: number): string {
  return `${numberInWords(Math.max(0, Math.round(value))).toUpperCase()} PESOS`;
}

export type ManifestPdfOptions = { pending?: boolean };

export const manifestPendingNotice = "PENDIENTE DE AUTORIZACIÓN DEL RNDC";

export function manifestIsPending(authorization: AuthorizationData, options: ManifestPdfOptions = {}): boolean {
  const value = authorization.manifestAuthorization.trim();
  return options.pending === true || !value || value.toUpperCase() === "PENDIENTE";
}

export async function writeManifestPdf(path: string, scenario: DemoScenario, authorization: AuthorizationData, mode: RndcConfig["mode"], options: ManifestPdfOptions = {}): Promise<void> {
  const doc = createManifestDoc(scenario);
  const stream = createWriteStream(path);
  doc.pipe(stream);
  drawManifest(doc, scenario, authorization, mode, options);
  doc.end();
  await waitForStream(stream);
}

export async function renderManifestPdf(scenario: DemoScenario, authorization: AuthorizationData, mode: RndcConfig["mode"], options: ManifestPdfOptions = {}): Promise<Buffer> {
  const doc = createManifestDoc(scenario);
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  drawManifest(doc, scenario, authorization, mode, options);
  doc.end();
  return await finished;
}

function createManifestDoc(scenario: DemoScenario): Doc {
  const remesas = resolveManifestRemesas(scenario);
  const extra = Math.max(0, remesas.length * remesaRowHeight(remesas.length) - 40.5);
  return createDoc([PAGE_WIDTH, Math.max(PAGE_HEIGHT, 560 + extra + 30)]);
}

function drawManifest(doc: Doc, scenario: DemoScenario, authorization: AuthorizationData, mode: RndcConfig["mode"], options: ManifestPdfOptions): void {
  const simulated = manifestIsSimulated(authorization, mode, options);
  const pending = simulated || manifestIsPending(authorization, options);
  const remesas = resolveManifestRemesas(scenario);
  drawHeader(doc, scenario, authorization, pending, simulated);
  drawActors(doc, scenario);
  const bottom = drawCargo(doc, scenario, remesas, pending);
  drawValues(doc, scenario, bottom, pending);
  const footer = simulated
    ? "MODO PRUEBA - Documento sin validez oficial. La transmisión al RNDC fue simulada: este manifiesto no tiene autorización."
    : pending
      ? "Documento en preparación. No reemplaza el manifiesto electrónico de carga autorizado por el RNDC ni es válido para transitar."
      : documentFooterText(mode);
  if (footer) {
    text(doc, footer, LEFT, bottom + 168, RIGHT - LEFT, { size: 6.5, align: "center", color: "#666666" });
  }
  if (pending) {
    drawPendingMarks(doc, simulated);
  }
}

export function manifestIsSimulated(authorization: AuthorizationData, mode: RndcConfig["mode"], options: ManifestPdfOptions = {}): boolean {
  return mode === "dry-run" && !manifestIsPending(authorization, options);
}

function drawPendingMarks(doc: Doc, simulated: boolean): void {
  doc.rect(LEFT, 9, RIGHT - LEFT, 15).fill("#b45309");
  text(doc, simulated ? "MODO PRUEBA  ·  Transmisión simulada, sin autorización del RNDC  ·  Sin número de autorización ni código QR" : `${manifestPendingNotice}  ·  Sin número de autorización ni código QR`, LEFT, 13.4, RIGHT - LEFT, { size: 8, bold: true, align: "center", color: "#ffffff" });
  const height = doc.page.height;
  doc.save();
  doc.fillOpacity(0.07);
  doc.rotate(-24, { origin: [PAGE_WIDTH / 2, height / 2] });
  text(doc, simulated ? "MODO PRUEBA · SIN AUTORIZACIÓN" : "PENDIENTE DE AUTORIZACIÓN", 0, height / 2 - 24, PAGE_WIDTH, { size: 40, bold: true, align: "center" });
  doc.restore();
  doc.fillOpacity(1);
}

function drawHeader(doc: Doc, scenario: DemoScenario, authorization: AuthorizationData, pending: boolean, simulated: boolean): void {
  doc.image(transporteLogoPng, 31, 30, { width: 100 });
  doc.image(superTransporteLogoPng, 31, 93, { width: 84 });

  text(doc, "MANIFIESTO ELECTRONICO DE CARGA", 201, 38, 310, { size: 11.2, bold: true, align: "center" });
  text(doc, scenario.company.name, 201, 52.5, 310, { size: 9.3, bold: true, align: "center" });
  text(doc, `Nit: ${scenario.company.nit}${scenario.company.dv}`, 201, 79, 310, { size: 7.5, bold: true, align: "center" });
  text(doc, scenario.company.address, 201, 92.5, 310, { size: 7.5, align: "center" });
  text(doc, `Tel: ${scenario.company.phone} ${scenario.company.cityName}`, 201, 107.5, 310, { size: 7.5, align: "center" });

  text(doc, manifestLegalNotice, 491, 32, 184, { size: 5.6, lineGap: 1 });
  shaded(doc, 493.1, 84.7, 189.8, 19.8);
  text(doc, `Manifiesto : ${scenario.manifestNumber}`, 495.4, 89, 186, { size: 10.4, bold: true });
  shaded(doc, 493.1, 107.8, 189.8, 16.8);
  text(doc, simulated ? "Autorización: MODO PRUEBA" : pending ? "Autorización: PENDIENTE" : `Autorización: ${authorization.manifestAuthorization}`, 495.4, 112, 186, { size: 11.3, bold: true });

  if (pending) {
    doc.rect(690.5, 36, 109, 109).dash(3, { space: 2 }).lineWidth(0.6).strokeColor("#666666").stroke().undash();
    text(doc, "SIN CÓDIGO QR", 690.5, 72, 109, { size: 8.4, bold: true, align: "center", color: "#444444" });
    text(doc, simulated ? "En modo prueba el RNDC no autoriza el manifiesto" : "Se genera cuando el RNDC autorice el manifiesto", 698, 86, 94, { size: 6.2, align: "center", color: "#444444", lineGap: 1 });
  } else {
    drawQr(doc, manifestQrText(scenario, authorization), 684.5, 30, 121);
  }

  cell(doc, 116.4, 102.7, 85, 25.5, "FECHA HORA RADICACION", pending ? "" : authorization.radicatedAt ?? slashDate(scenario.expeditionDate), { valueSize: 7.2, labelAlign: "center", valueX: 4 });

  const rowB = 128.1;
  cell(doc, LEFT, rowB, 87.6, 25.5, "FECHA DE EXPEDICION", slashDate(scenario.expeditionDate), { valueSize: 8.4 });
  cell(doc, 116.5, rowB, 84.7, 25.5, "TIPO DE MANIFIESTO", manifestTypeName(scenario.manifestType), { valueSize: 6.6, labelAlign: "center", valueAlign: "center" });
  cell(doc, 201.2, rowB, 169.8, 25.5, "ORIGEN DEL VIAJE", scenario.sender.cityName, { valueSize: 8.4, labelX: 6.7, valueX: 5.8, clip: true });
  cell(doc, 371, rowB, 141.6, 25.5, "MUNICIPIO INTERMEDIO", "", { labelX: 8.3 });
  cell(doc, 512.6, rowB, 170.2, 25.5, "DESTINO DEL VIAJE", scenario.recipient.cityName, { valueSize: 8.4, labelX: 8.3, valueX: 0.6, clip: true });

  const rowC = 153.6;
  cell(doc, LEFT, rowC, 171.8, 25.5, "ORIGEN TRAYECTO EN VACIO 1", "", { labelX: 6.5 });
  cell(doc, 200.7, rowC, 170.3, 25.5, "DESTINO TRAYECTO EN VACIO 1", "", { labelX: 7.5 });
  cell(doc, 371, rowC, 141.7, 25.5, "ORIGEN TRAYECTO EN VACIO 2", "", { labelX: 4.6 });
  cell(doc, 512.7, rowC, 170.1, 25.5, "DESTINO TRAYECTO EN VACIO 2", "", { labelX: 7.3 });
  line(doc, 682.8, 179.1, RIGHT, 179.1);

  box(doc, LEFT, 179.1, RIGHT - LEFT, 11.2);
  text(doc, "VIA A UTILIZAR :", 32.4, 183.9, 200, { size: 5.6, bold: true });
}

function drawActors(doc: Doc, scenario: DemoScenario): void {
  sectionTitle(doc, 190.3, 15, "INFORMACION DEL TITULAR, VEHICULO Y CONDUCTORES");

  const holder = scenario.vehicleHolder;
  const driver = scenario.driver;
  const vehicle = scenario.vehicle;
  const big = 9.4;
  const mid = 7.5;

  const rowE = 205.4;
  cell(doc, 29.1, rowE, 181.4, 25.5, "TITULAR MANIFIESTO", personName(holder), { valueSize: big, valueX: 23.7, clip: true });
  cell(doc, 210.6, rowE, 113.3, 25.5, "DOCUMENTO  IDENTIFICACION", holder.id, { valueSize: big, labelAlign: "center", valueAlign: "center" });
  cell(doc, 323.9, rowE, 184.9, 25.5, "DIRECCION", holder.address, { valueSize: mid, labelX: 6.2, valueX: 11.7, clip: true });
  cell(doc, 508.9, rowE, 63, 25.5, "TELEFONOS", holder.phone, { valueSize: big, labelX: 11.1, valueX: 1.2, clip: true });
  cell(doc, 571.9, rowE, 111.7, 25.5, "CIUDAD", holder.cityName, { valueSize: big, labelX: 6.5, valueX: 8.5, clip: true });
  box(doc, 683.6, rowE, 111, 25.5);

  const rowF = 230.9;
  cell(doc, 29.3, rowF, 64.6, 25.5, "PLACA", vehicle.plate, { valueSize: big, labelAlign: "center", valueAlign: "center", valueY: 15.9 });
  cell(doc, 93.9, rowF, 82.1, 25.5, "MARCA", vehicle.brand, { valueSize: big, labelAlign: "center", valueAlign: "center", clip: true });
  cell(doc, 176, rowF, 76.6, 25.5, "PLACA SEMIREMOLQUE", vehicle.trailerPlate, { valueSize: big, labelAlign: "center", valueAlign: "center" });
  cell(doc, 252.6, rowF, 71.3, 25.5, "PLACA SEMIREMOL 2", "", { labelAlign: "center", labelBold: false });
  cell(doc, 323.9, rowF, 60.2, 25.5, "CONFIGURACION", vehicle.configuration, { valueSize: vehicle.configuration.length > 6 ? 5.6 : big, labelAlign: "center", valueAlign: "center", clip: vehicle.configuration.length <= 6 });
  box(doc, 384.1, rowF, 124.7, 25.5);
  text(doc, "PesoVacío", 394.3, rowF + 3.2, 40, { size: 5.6 });
  text(doc, "PesoVacíoRemolque", 431.4, rowF + 3.2, 70, { size: 5.6 });
  text(doc, vehicle.emptyWeightKg ? String(vehicle.emptyWeightKg) : "", 384.1, rowF + 15.1, 56, { size: big, align: "center" });
  cell(doc, 508.9, rowF, 174.7, 25.5, "COMPAÑIA SEGUROS SOAT", [vehicle.insurerNit, vehicle.insurerName].filter(Boolean).join(" "), { valueSize: mid, labelBold: false, labelX: 12.4, valueX: 2.1, valueY: 14.8, clip: true });
  box(doc, 683.6, rowF, 111, 25.5);
  text(doc, "No POLIZA", 689.6, rowF + 3.2, 40, { size: 5.6 });
  text(doc, "F.Vencimiento SOAT", 734.5, rowF + 3.2, 60, { size: 5.6 });
  text(doc, vehicle.soatNumber, 685, rowF + 14.8, 47, { size: mid, align: "center", h: 9 });
  text(doc, slashDate(vehicle.soatExpirationDate), 733.8, rowF + 15.1, 60, { size: big, h: 10 });

  const rowG = 256.4;
  cell(doc, 29, rowG, 181.4, 25.5, "CONDUCTOR", personName(driver), { valueSize: big, labelX: 23.9, valueX: 5.9, valueY: 15.2, clip: true });
  cell(doc, 210.4, rowG, 113.5, 25.5, "DOCUMENTO IDENTIFICACION", driver.id, { valueSize: big, labelBold: false, labelX: 7.5, valueX: 6.9, valueY: 15.2 });
  cell(doc, 323.9, rowG, 184.9, 25.5, "DIRECCION", driver.address, { valueSize: mid, labelBold: false, labelX: 40.2, valueX: 4.8, valueY: 13.3, clip: true });
  cell(doc, 508.9, rowG, 82.5, 25.5, "TELEFONOS", driver.phone, { valueSize: 6.6, labelBold: false, labelX: 12.1, valueX: 3.8, valueY: 13 });
  cell(doc, 591.4, rowG, 70.5, 25.5, "No de LICENCIA", driverLicense(driver), { valueSize: mid, labelBold: false, labelX: 13.3, valueX: 3.1, valueY: 14.9, clip: true });
  cell(doc, 661.9, rowG, 132.7, 25.5, "CIUDAD CONDUCTOR", driver.cityName, { valueSize: big, labelBold: false, labelX: 20.2, valueX: 3.6, valueY: 15.2, clip: true });

  const rowH = 281.9;
  cell(doc, 28.9, rowH, 181.4, 25.5, "CONDUCTOR Nro. 2", "", { labelX: 48.5, labelY: 4.6 });
  cell(doc, 210.3, rowH, 113.5, 25.5, "DOCUMENTO IDENTIFICACION", "", { labelBold: false, labelX: 7.4, labelY: 4.6 });
  cell(doc, 323.8, rowH, 185.1, 25.5, "DIRECCION CONDUCTOR 2", "", { labelBold: false, labelX: 40.3, labelY: 4.6 });
  cell(doc, 508.9, rowH, 82.5, 25.5, "TELEFONOS", "", { labelBold: false, labelX: 12.1, labelY: 4.6 });
  cell(doc, 591.4, rowH, 70.5, 25.5, "No de LICENCIA", "-", { valueSize: 7.5, labelBold: false, labelX: 12.4, labelY: 4.6, valueAlign: "center", valueY: 15.1 });
  cell(doc, 661.9, rowH, 132.7, 25.5, "CIUDAD CONDUCTOR 2", "", { labelBold: false, labelX: 22.2, labelY: 4.6 });
}

function drawCargo(doc: Doc, scenario: DemoScenario, remesas: ReturnType<typeof resolveManifestRemesas>, pending: boolean): number {
  sectionTitle(doc, 307.2, 16.5, "INFORMACION DE LA MERCANCIA TRANSPORTADA");

  const columns = [LEFT, 85.5, 142.2, 179.1, 232.9, 369, 541.9, 714.8, 794.3];
  const headerTop = 323.7;
  const headerHeight = 12.8;
  const titles: [string, number, number][] = [
    ["Nro. Remesa", 34, 5.9],
    ["Unidad Medida", 91.5, 5.9],
    ["Cantidad", 148.4, 5.9],
    ["Naturaleza", 188.2, 5],
    ["Empaque", 241.3, 5],
    ["Producto Transportado", 284, 5],
    ["Información Remitente  / Lugar Cargue", 391, 5.9],
    ["Información Destinatario / Lugar Descargue", 559.3, 5.9],
    ["Dueño Poliza", 734, 5]
  ];
  box(doc, LEFT, headerTop, columns[8] - LEFT, headerHeight);
  for (const [title, x, size] of titles) {
    text(doc, title, x, headerTop + 5.6, 160, { size });
  }

  const bodyTop = headerTop + headerHeight;
  const rowHeight = remesaRowHeight(remesas.length);
  const bodyHeight = Math.max(1, remesas.length) * rowHeight;
  box(doc, LEFT, bodyTop, columns[8] - LEFT, bodyHeight);
  for (const x of columns.slice(1, -1)) {
    line(doc, x, headerTop, x, bodyTop + bodyHeight);
  }

  remesas.forEach((remesa, index) => {
    const y = bodyTop + index * rowHeight;
    if (index > 0) line(doc, LEFT, y, columns[8], y);
    const top = y + 3.6;
    if (pending && !remesa.number.trim()) {
      text(doc, "Sin remesas asociadas todavía", 31.1, top + 12, columns[8] - LEFT - 4, { size: 6.6, align: "center", color: "#666666" });
      return;
    }
    text(doc, remesa.number, 31.1, top, 53, { size: 6.6, h: 8 });
    text(doc, "Kilogramos", 91.4, top, 50, { size: 6.6 });
    text(doc, pending && !remesa.quantityKg ? "" : quantity(remesa.quantityKg), 143.2, top, 35, { size: 6.6, align: "right" });
    text(doc, remesa.nature, 181.2, top, 51, { size: 6.6, h: 34 });
    text(doc, remesa.packageName, 237.6, top, 46, { size: 6.6, h: 44, lineGap: 0.8 });
    text(doc, scenario.cargo.merchandiseCode, 288.1, top, 78, { size: 6.6 });
    text(doc, remesa.productName, 286, top + 13.2, 82, { size: 6.6, h: 22 });
    drawParty(doc, scenario.sender, remesa.senderName, 374.1, 419, 122, y);
    drawParty(doc, scenario.recipient, remesa.recipientName, 547.5, 595.3, 118, y);
    text(doc, "Empresa de Transporte", 716, top - 0.2, 77, { size: 5.6, align: "center" });
  });

  return bodyTop + bodyHeight + 0.8;
}

function remesaRowHeight(count: number): number {
  return count > 1 ? 47 : 40.5;
}

function drawParty(doc: Doc, party: DemoScenario["sender"], name: string, idX: number, nameX: number, nameWidth: number, y: number): void {
  text(doc, party.id, idX, y + 3.6, nameX - idX - 2, { size: 6.6, h: 8 });
  text(doc, name, nameX, y + 3.8, nameWidth, { size: 6.6, h: 17, lineGap: 0.8 });
  text(doc, party.address, idX, y + 20.1, nameX + nameWidth - idX, { size: 6.6, h: 8 });
  text(doc, party.cityName, idX, y + 32.6, nameX + nameWidth - idX, { size: 6.6, h: 8 });
}

function drawValues(doc: Doc, scenario: DemoScenario, top: number, pending: boolean): void {
  const money = scenario.money;
  const withoutValues = pending && !money.freightValue;
  const net = money.freightValue - money.sourceRetention - money.icaRetention - money.fopatRetention;
  const barHeight = 14.1;
  const bodyTop = top + barHeight;
  const bodyHeight = 99.2;

  shaded(doc, 29.1, top, 258, barHeight);
  shaded(doc, 287.1, top, 206.9, barHeight);
  shaded(doc, 494, top, RIGHT - 494, barHeight);
  text(doc, "VALORES", 29.1, top + 4.1, 366, { size: 9.4, bold: true, align: "center" });
  text(doc, "OBSERVACIONES", 502.5, top + 4.3, 200, { size: 9.4, bold: true });

  box(doc, 29.1, bodyTop, RIGHT - 29.1, bodyHeight);
  line(doc, 286.8, bodyTop, 286.8, bodyTop + bodyHeight - 2.8);
  line(doc, 493.7, bodyTop, 493.7, bodyTop + bodyHeight - 2.8);

  const rows: [string, number][] = [
    ["VALOR TOTAL DEL VIAJE", money.freightValue],
    ["RETENCION EN LA FUENTE", money.sourceRetention],
    ["RETENCION ICA", money.icaRetention],
    ["RETENCION FOPAT", money.fopatRetention],
    ["VALOR NETO A PAGAR", net],
    ["VALOR ANTICIPO", money.advanceValue],
    ["SALDO A PAGAR", net - money.advanceValue]
  ];
  rows.forEach(([label, value], index) => {
    const y = bodyTop + index * 13.62;
    box(doc, 158.4, y, 107.7, 13.62);
    text(doc, label, 29.1, y + 5.6, 129.3, { size: 6.6, align: "center" });
    text(doc, withoutValues ? "" : amount(value), 160, y + 5.2, 100.6, { size: 6.6, align: "right" });
  });

  text(doc, "LUGAR", 292.1, bodyTop + 7.1, 28, { size: 5.6 });
  text(doc, "DE PAGO", 292.1, bodyTop + 14.6, 28, { size: 5.6 });
  box(doc, 320.6, bodyTop + 1.8, 79.4, 19.8);
  text(doc, scenario.recipient.cityName, 327.3, bodyTop + 7.2, 71, { size: 6.6, h: 24, lineGap: 0.8 });
  text(doc, "FECHA", 408.3, bodyTop + 9.9, 25, { size: 5.6 });
  box(doc, 434, bodyTop + 1.8, 51.1, 19.8);
  text(doc, slashDate(scenario.balancePaymentDate), 437.7, bodyTop + 7.2, 46, { size: 6.6 });

  underlined(doc, "CARGUE PAGADO POR", 294.6, bodyTop + 30.5);
  box(doc, 293.6, bodyTop + 37.1, 195.6, 14.1);
  text(doc, "REMITENTE", 293.6, bodyTop + 40.5, 195.6, { size: 6.6, align: "center" });
  underlined(doc, "DESCARGUE PAGADO POR", 295.6, bodyTop + 60.6);
  box(doc, 294, bodyTop + 65.6, 195.6, 14.2);
  text(doc, "DESTINATARIO", 294, bodyTop + 69.8, 195.6, { size: 6.6, align: "center" });

  text(doc, scenario.observations, 500, bodyTop + 9.4, 284, { size: 7.5, h: bodyHeight - 14, lineGap: 0.9 });

  const lettersTop = bodyTop + bodyHeight;
  box(doc, 29.1, lettersTop, RIGHT - 29.1, 12.8);
  text(doc, "VALOR TOTAL DEL VIAJE EN LETRAS:", 36, lettersTop + 6.2, 140, { size: 5.6 });
  text(doc, withoutValues ? "" : manifestAmountInWords(money.freightValue), 177.3, lettersTop + 3.5, 600, { size: 5.6, h: 7 });

  const signTop = lettersTop + 13;
  box(doc, 29.6, signTop, 283.5, 34);
  box(doc, 313.1, signTop, 251.9, 34);
  box(doc, 565, signTop, RIGHT - 565, 34);
  text(doc, manifestFraudNotice, 31.1, signTop + 7.3, 280, { size: 5.6, lineGap: 1 });
  text(doc, "Firma y Huella TITULAR MANIFIESTO  o  ACEPTACION DIGITAL", 316.3, signTop + 5.2, 247, { size: 7.5, bold: true });
  text(doc, "Firma y Huella del CONDUCTOR  o  ACEPTACION DIGITAL", 568.1, signTop + 4.8, 226, { size: 7.5, bold: true });

  const stamp = companyStamp();
  if (stamp) {
    doc.image(stamp, 127.2, signTop - 5.9, { width: 107.8 });
  }
}

type CellOptions = {
  valueSize?: number;
  labelX?: number;
  labelY?: number;
  labelAlign?: "left" | "center";
  labelBold?: boolean;
  valueX?: number;
  valueY?: number;
  valueAlign?: "left" | "center";
  clip?: boolean;
};

function cell(doc: Doc, x: number, y: number, w: number, h: number, label: string, value: string, options: CellOptions = {}): void {
  box(doc, x, y, w, h);
  const labelPad = options.labelX ?? 4.6;
  text(doc, label, x + (options.labelAlign === "center" ? 0 : labelPad), y + (options.labelY ?? 4.4), options.labelAlign === "center" ? w : w - labelPad, { size: 5.6, bold: options.labelBold ?? true, align: options.labelAlign ?? "left" });
  if (!value) return;
  const size = options.valueSize ?? 7.5;
  const valuePad = options.valueX ?? 4.8;
  const centered = options.valueAlign === "center";
  text(doc, value, x + (centered ? 1 : valuePad), y + (options.valueY ?? 14.5), centered ? w - 2 : w - valuePad - 1, { size, align: options.valueAlign ?? "left", h: options.clip ? size + 2 : undefined });
}

function sectionTitle(doc: Doc, y: number, h: number, title: string): void {
  shaded(doc, LEFT, y, RIGHT - LEFT, h);
  text(doc, title, LEFT, y + (h - 9.4) / 2 + 0.4, RIGHT - LEFT, { size: 9.4, bold: true, align: "center" });
}

function shaded(doc: Doc, x: number, y: number, w: number, h: number): void {
  doc.rect(x, y, w, h).fill(SHADE);
  box(doc, x, y, w, h);
}

function underlined(doc: Doc, value: string, x: number, y: number): void {
  text(doc, value, x, y, 190, { size: 5.6 });
  doc.font("Helvetica").fontSize(5.6);
  line(doc, x, y + 5.9, x + doc.widthOfString(value), y + 5.9, "#000000", 0.4);
}

function drawQr(doc: Doc, value: string, x: number, y: number, size: number): void {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const count = qr.modules.size;
  const step = size / count;
  doc.fillColor("#000000");
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (qr.modules.get(row, column)) {
        doc.rect(x + column * step, y + row * step, step + 0.05, step + 0.05).fill();
      }
    }
  }
}

function manifestTypeName(code: string | undefined): string {
  const key = (code ?? "").trim().toUpperCase();
  return manifestTypeNames[key] ?? (key || "General");
}

function personName(person: PersonData): string {
  const composed = [person.firstName, person.firstLastName, person.secondLastName].map((part) => part.trim()).filter(Boolean).join(" ");
  return composed || person.fullName;
}

function driverLicense(driver: PersonData): string {
  const number = driver.licenseNumber ?? driver.id;
  return driver.licenseCategory ? `${driver.licenseCategory}-${number}` : number;
}

function slashDate(value: string): string {
  const [day, month, year] = value.split("/");
  return day && month && year && year.length === 4 ? `${year}/${month}/${day}` : value;
}

function quantity(value: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function amount(value: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

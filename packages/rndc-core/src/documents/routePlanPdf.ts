import { mtmLogoPng } from "./brandAssets.js";
import { box, companyStamp, createDoc, line, text, textHeight, widths, type Doc } from "./pdfPrimitives.js";

export type RoutePlanPdfStop = {
  label: string;
  detail: string;
  scheduledAt: string;
};

export type RoutePlanPdfInput = {
  company: { name: string; nit: string; address: string; phones: string };
  dispatchCode: string;
  manifestNumber: string;
  origin: string;
  destination: string;
  convoy: string;
  vehicle: { plate: string; make: string; modelYear: string; color: string; bodyType: string; trailerPlate: string; line: string };
  driver: { name: string; document: string; licenseNumber: string; licenseCategory: string; phone: string };
  departureAt: string;
  arrivalAt: string;
  fine: string;
  stops: RoutePlanPdfStop[];
  observations: string;
  printedAt: string;
};

const PAGE: [number, number] = [792, 612];
const LEFT = 36;
const WIDTH = 720;
const STOP_COLUMNS = 5;

export async function buildRoutePlanPdf(input: RoutePlanPdfInput): Promise<Buffer> {
  const doc = createDoc(PAGE);
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  drawHeader(doc, input);
  let cursor = drawDispatch(doc, input, 142);
  cursor = drawStops(doc, input.stops, cursor + 14);
  drawFooter(doc, input, cursor + 18);

  doc.end();
  return finished;
}

function drawHeader(doc: Doc, input: RoutePlanPdfInput): void {
  text(doc, input.printedAt, LEFT, 20, 200, { size: 7 });
  text(doc, "S.@.T. BASICO", LEFT + WIDTH - 200, 20, 200, { size: 7, align: "right" });
  doc.image(mtmLogoPng, LEFT, 34, { fit: [160, 96] });

  const centerX = LEFT + 170;
  const centerW = 330;
  let cursor = 40;

  for (const entry of [
    { value: input.company.name, size: 9, bold: true },
    { value: `NIT: ${input.company.nit}`, size: 8 },
    { value: `Dirección: ${input.company.address}`, size: 8 },
    { value: `Telefonos: ${input.company.phones}`, size: 8 }
  ]) {
    text(doc, entry.value, centerX, cursor, centerW, { size: entry.size, bold: entry.bold, align: "center" });
    cursor += textHeight(doc, entry.value, centerW, entry.size, entry.bold) + 2;
  }

  text(doc, "PLAN DE RUTA", centerX, cursor + 4, centerW, { size: 14, bold: true, align: "center" });
  photoBox(doc, "FOTO DEL VEHICULO", LEFT + WIDTH - 216, 36);
  photoBox(doc, "FOTO DEL CONDUCTOR", LEFT + WIDTH - 104, 36);
}

function photoBox(doc: Doc, label: string, x: number, y: number): void {
  text(doc, label, x, y, 104, { size: 7.5, bold: true, align: "center" });
  box(doc, x + 4, y + 11, 96, 72);
}

function drawDispatch(doc: Doc, input: RoutePlanPdfInput, top: number): number {
  text(doc, `DATOS DEL DESPACHO No. ${input.dispatchCode}`, LEFT, top, WIDTH, { size: 9, bold: true, align: "center" });
  const rows: { label: string; value: string }[][] = [
    [
      { label: "MANIFIESTO No.", value: input.manifestNumber },
      { label: "ORIGEN:", value: input.origin },
      { label: "DESTINO:", value: input.destination },
      { label: "No. CARAVANA:", value: input.convoy }
    ],
    [
      { label: "PLACA:", value: input.vehicle.plate },
      { label: "MARCA:", value: input.vehicle.make },
      { label: "MODELO:", value: input.vehicle.modelYear },
      { label: "COLOR:", value: input.vehicle.color },
      { label: "CARROCERIA:", value: input.vehicle.bodyType },
      { label: "No. REMOLQUE:", value: input.vehicle.trailerPlate },
      { label: "LÍNEA:", value: input.vehicle.line }
    ],
    [
      { label: "CONDUCTOR:", value: input.driver.name },
      { label: "C.C.", value: input.driver.document },
      { label: "LICENCIA DE CONDUCCIÓN:", value: input.driver.licenseNumber },
      { label: "CATEGORÍA:", value: input.driver.licenseCategory },
      { label: "TEL:", value: input.driver.phone }
    ],
    [
      { label: "FECHA DE SALIDA PROGRAMADA:", value: input.departureAt },
      { label: "FECHA DE LLEGADA PROGRAMADA:", value: input.arrivalAt },
      { label: "VALOR MULTA:", value: input.fine }
    ]
  ];
  const ratios = [
    [2, 3, 4, 2],
    [1.5, 2.1, 1.3, 1.7, 2.1, 2, 1.4],
    [4.2, 1.6, 3, 1.5, 2],
    [3, 3, 2]
  ];
  let cursor = top + 16;

  for (const [rowIndex, row] of rows.entries()) {
    const cells = widths(WIDTH, ratios[rowIndex]);
    let height = 0;
    let x = LEFT;

    row.forEach((cell, index) => {
      const cellWidth = cells[index];
      const labelWidth = Math.min(doc.font("Helvetica-Bold").fontSize(7).widthOfString(cell.label) + 3, cellWidth - 10);
      text(doc, cell.label, x, cursor, labelWidth, { size: 7, bold: true });
      text(doc, cell.value, x + labelWidth, cursor, cellWidth - labelWidth - 4, { size: 7 });
      height = Math.max(height, textHeight(doc, cell.value || " ", cellWidth - labelWidth - 4, 7));
      x += cellWidth;
    });

    cursor += Math.max(height, 9) + 6;
  }

  return cursor;
}

function drawStops(doc: Doc, stops: RoutePlanPdfStop[], top: number): number {
  text(doc, "PUESTOS DE CONTROL", LEFT, top, WIDTH, { size: 9, bold: true, align: "center" });
  const cellWidth = WIDTH / STOP_COLUMNS;
  let cursor = top + 22;

  for (let start = 0; start < stops.length; start += STOP_COLUMNS) {
    const row = stops.slice(start, start + STOP_COLUMNS);
    const heights = row.map((stop) => textHeight(doc, stop.label, cellWidth - 8, 8) + textHeight(doc, stop.detail || "-", cellWidth - 8, 6.5) + 12);
    const rowHeight = Math.max(...heights);

    if (cursor + rowHeight > PAGE[1] - 96) {
      doc.addPage({ size: PAGE, margin: 0 });
      cursor = 40;
    }

    row.forEach((stop, index) => {
      const x = LEFT + cellWidth * index + 4;
      const labelHeight = textHeight(doc, stop.label, cellWidth - 8, 8);
      const detailHeight = textHeight(doc, stop.detail || "-", cellWidth - 8, 6.5);
      text(doc, stop.label, x, cursor, cellWidth - 8, { size: 8, align: "center" });
      text(doc, stop.detail || "-", x, cursor + labelHeight + 1, cellWidth - 8, { size: 6.5, align: "center" });
      text(doc, stop.scheduledAt, x, cursor + labelHeight + detailHeight + 3, cellWidth - 8, { size: 6.5, align: "center" });
    });

    cursor += rowHeight + 14;
  }

  return cursor;
}

function drawFooter(doc: Doc, input: RoutePlanPdfInput, top: number): void {
  let cursor = top;

  if (cursor > PAGE[1] - 110) {
    doc.addPage({ size: PAGE, margin: 0 });
    cursor = 40;
  }

  const observations = `OBSERVACIONES: ${input.observations}`;
  text(doc, observations, LEFT, cursor, WIDTH, { size: 7.5 });
  cursor += textHeight(doc, observations, WIDTH, 7.5) + 14;

  const stamp = companyStamp();

  if (stamp) {
    doc.image(stamp, LEFT + 110, cursor, { fit: [130, 46] });
  }

  cursor += 50;
  line(doc, LEFT + 60, cursor, LEFT + 300, cursor);
  line(doc, LEFT + 420, cursor, LEFT + 660, cursor);
  text(doc, "FIRMA Y SELLO AUTORIZADOS POR LA EMPRESA", LEFT + 60, cursor + 4, 240, { size: 7.5, align: "center" });
  text(doc, "FIRMA Y No. CÉDULA CONDUCTOR", LEFT + 420, cursor + 4, 240, { size: 7.5, align: "center" });
}

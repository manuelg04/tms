import { existsSync, readFileSync } from "node:fs";
import PDFDocument from "pdfkit";

export type Doc = PDFKit.PDFDocument;

export const PAGE_X = 40;
export const PAGE_W = 532;
export const INK = "#000000";

export type Cell = {
  label?: string;
  value?: string | number;
  ratio: number;
  align?: "left" | "center" | "right";
  size?: number;
  valueBold?: boolean;
  labelSuffix?: string;
};

export function createDoc(size: "LETTER" | [number, number] = "LETTER"): Doc {
  return new PDFDocument({ size, margin: 0, info: { Producer: "S.@.T. BASICO" } });
}

export function box(doc: Doc, x: number, y: number, w: number, h: number): void {
  doc.rect(x, y, w, h).lineWidth(0.6).strokeColor(INK).stroke();
}

export function line(doc: Doc, x1: number, y1: number, x2: number, y2: number, color = INK, width = 0.6): void {
  doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(width).strokeColor(color).stroke();
}

export function text(doc: Doc, value: string | number | undefined, x: number, y: number, w: number, options: { size?: number; bold?: boolean; align?: "left" | "center" | "right" | "justify"; color?: string; h?: number; lineGap?: number } = {}): void {
  const content = value === undefined || value === null ? "" : String(value);
  if (!content) return;
  doc.font(options.bold ? "Helvetica-Bold" : "Helvetica").fontSize(options.size ?? 7.5).fillColor(options.color ?? INK);
  doc.text(content, x, y, { width: w, align: options.align ?? "left", height: options.h, lineBreak: true, lineGap: options.lineGap ?? 0 });
}

export function textHeight(doc: Doc, value: string, w: number, size: number, bold = false): number {
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
  return doc.heightOfString(value, { width: w });
}

export function stackCentered(doc: Doc, x: number, y: number, w: number, lines: { text: string; size: number; bold?: boolean; color?: string }[]): number {
  let cursor = y;
  for (const entry of lines) {
    text(doc, entry.text, x, cursor, w, { size: entry.size, bold: entry.bold, align: "center", color: entry.color });
    cursor += textHeight(doc, entry.text, w, entry.size, entry.bold);
  }
  return cursor;
}

export function widths(total: number, ratios: number[]): number[] {
  const sum = ratios.reduce((acc, ratio) => acc + ratio, 0);
  let used = 0;
  return ratios.map((ratio, index) => {
    if (index === ratios.length - 1) return total - used;
    const w = Math.round((total * ratio) / sum);
    used += w;
    return w;
  });
}

const UNITS = ["", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiún", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

export function numberInWords(value: number): string {
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

export function waitForStream(stream: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}

let cachedStamp: Buffer | null | undefined;

export function companyStamp(): Buffer | null {
  if (cachedStamp !== undefined) return cachedStamp;
  const path = process.env.RNDC_COMPANY_STAMP_PATH?.trim();
  cachedStamp = path && existsSync(path) ? readFileSync(path) : null;
  return cachedStamp;
}

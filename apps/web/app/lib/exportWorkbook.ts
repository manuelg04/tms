import ExcelJS from "exceljs";
import type { ExportCell, ExportRow } from "./exportSchemas";

export async function createExportWorkbook(sheetName: string, rows: ExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MTM TMS";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet(safeSheetName(sheetName), {
    views: [{ state: "frozen", ySplit: 1 }]
  });
  const columns = rows.length > 0 ? Object.keys(rows[0]) : ["Sin resultados"];
  worksheet.columns = columns.map((header) => ({
    header,
    key: header,
    width: Math.min(Math.max(header.length + 2, 14), 36)
  }));
  worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF182B49" } };
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  for (const row of rows) {
    const excelRow = worksheet.addRow(row);
    columns.forEach((column, index) => formatCell(excelRow.getCell(index + 1), row[column]));
  }

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

function formatCell(cell: ExcelJS.Cell, value: ExportCell): void {
  if (value instanceof Date) {
    cell.numFmt = "yyyy-mm-dd hh:mm";
    return;
  }

  if (typeof value === "string") {
    cell.numFmt = "@";
  }
}

function safeSheetName(value: string): string {
  return value.replace(/[\\/?*:[\]]/g, " ").slice(0, 31) || "Exportación";
}

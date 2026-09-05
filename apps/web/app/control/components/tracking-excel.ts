import type { TrackingDispatch } from "../../../convex/model/tracking";
import { cellValue, queueColumns } from "../../../convex/model/tracking";

export async function trackingWorkbook(
  rows: TrackingDispatch[],
  queue: "en_route" | "pending_arrival",
) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const label =
    queue === "en_route" ? "Despachos En Ruta" : "Pendientes por llegada";
  const sheet = workbook.addWorksheet(label, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const columns = queueColumns(queue);
  sheet.columns = columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: Math.max(14, Math.min(28, c.label.length + 6)),
  }));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F2B3D" },
  };
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };
  for (const row of rows) {
    const inserted = sheet.addRow(columns.map((c) => cellValue(row, c.key)));
    inserted.eachCell((cell) => {
      cell.numFmt = "@";
    });
  }
  return { bytes: new Uint8Array(await workbook.xlsx.writeBuffer()), label };
}

export async function downloadTrackingExcel(
  rows: TrackingDispatch[],
  queue: "en_route" | "pending_arrival",
) {
  const { bytes, label } = await trackingWorkbook(rows, queue);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = `${label} ${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function buildEvidenceDownloadHeaders(fileName: string, contentType: string | undefined, size: number): Headers {
  const safeName = fileName
    .replace(/[\\/\r\n\0]/g, "_")
    .slice(0, 180)
    || "evidencia";
  return new Headers({
    "Cache-Control": "private, no-store",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    "Content-Length": String(size),
    "Content-Type": contentType || "application/octet-stream",
    "X-Content-Type-Options": "nosniff"
  });
}

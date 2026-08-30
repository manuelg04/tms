export function isFulfillmentPdf(fileName: string | undefined): boolean {
  return (fileName ?? "").startsWith("cumplido-");
}

export function selectDocumentPdfArtifact<T extends { _id: string; kind: string; documentId?: string; fileName?: string; createdAt: number }>(artifacts: T[], documentId: string): T | undefined {
  return artifacts
    .filter((artifact) => artifact.kind === "pdf" && artifact.documentId === documentId && !isFulfillmentPdf(artifact.fileName))
    .sort((left, right) => right.createdAt - left.createdAt)[0];
}

export function selectFulfillmentPdfArtifact<T extends { _id: string; kind: string; documentId?: string; fileName?: string; createdAt: number }>(artifacts: T[], documentId: string): T | undefined {
  return artifacts
    .filter((artifact) => artifact.kind === "pdf" && artifact.documentId === documentId && isFulfillmentPdf(artifact.fileName))
    .sort((left, right) => right.createdAt - left.createdAt)[0];
}

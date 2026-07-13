export function selectDocumentPdfArtifact<T extends { _id: string; kind: string; documentId?: string; createdAt: number }>(artifacts: T[], documentId: string): T | undefined {
  return artifacts
    .filter((artifact) => artifact.kind === "pdf" && artifact.documentId === documentId)
    .sort((left, right) => right.createdAt - left.createdAt)[0];
}

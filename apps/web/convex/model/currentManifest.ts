type ManifestCandidate = { _id: string; kind: string; number?: string; updatedAt: number };

export function currentManifestDocument<Document extends ManifestCandidate>(
  expediente: {
    manifestDocumentId?: string;
    sourceManifestDocumentId?: string;
    manifestNumber?: string;
    manifestDraft?: { manifestNumber?: string } | null;
  },
  documents: Document[]
): Document | undefined {
  const manifests = documents
    .filter((document) => document.kind === "manifiesto")
    .sort((left, right) => right.updatedAt - left.updatedAt);

  if (expediente.manifestDocumentId) {
    return manifests.find((document) => document._id === expediente.manifestDocumentId);
  }

  if (!expediente.sourceManifestDocumentId) {
    return manifests[0];
  }

  const number = (expediente.manifestDraft?.manifestNumber ?? expediente.manifestNumber)?.trim();
  return manifests.find((document) => document._id !== expediente.sourceManifestDocumentId && Boolean(number) && document.number?.trim() === number);
}

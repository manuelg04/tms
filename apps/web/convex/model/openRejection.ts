const SETTLED_STATES = ["authorized", "fulfilled", "annulled"];

export function hasOpenRejection(
  operations: ReadonlyArray<{ status: string; businessKey?: string; documentId?: string }>,
  documents: ReadonlyArray<{ _id: string; officialState?: string; errorText?: string }>
): boolean {
  const settled = new Set(documents.filter((document) => SETTLED_STATES.includes(document.officialState ?? "")).map((document) => document._id));
  const failedOpen = operations.some(
    (operation) =>
      operation.status === "failed" &&
      !(operation.businessKey ?? "").includes(":rechazada:") &&
      !(operation.documentId && settled.has(operation.documentId))
  );
  return failedOpen || documents.some((document) => Boolean(document.errorText) && !settled.has(document._id));
}

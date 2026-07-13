import assert from "node:assert/strict";
import test from "node:test";
import { selectDocumentPdfArtifact } from "./documentPdf.js";

test("selects the newest protected PDF attached to a document", () => {
  const selected = selectDocumentPdfArtifact([
    { _id: "old", kind: "pdf", documentId: "doc-1", createdAt: 10 },
    { _id: "xml", kind: "request_xml", documentId: "doc-1", createdAt: 30 },
    { _id: "new", kind: "pdf", documentId: "doc-1", createdAt: 20 },
    { _id: "other", kind: "pdf", documentId: "doc-2", createdAt: 40 }
  ], "doc-1");

  assert.equal(selected?._id, "new");
});

test("does not expose a PDF attached to another document", () => {
  assert.equal(selectDocumentPdfArtifact([
    { _id: "other", kind: "pdf", documentId: "doc-2", createdAt: 40 }
  ], "doc-1"), undefined);
});

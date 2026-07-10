import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  readDurableEvidenceContext,
  storeDurableEvidence,
  storeDurableEvidenceToConvex,
  type DurableEvidenceArtifact,
  type DurableEvidenceDependencies
} from "../durableEvidence.js";

const context = {
  organizationId: "org-1",
  expedienteId: "exp-1",
  documentId: "doc-1",
  operationId: "op-1"
};

test("stores masked form XML, result JSON, and generated PDFs as durable evidence", async () => {
  const files = new Map<string, Uint8Array>([
    ["/safe/runs/op/result.json", Buffer.from('{"password":"secret","ok":true}')],
    ["/safe/runs/op/requests/03-remesa.xml", Buffer.from("<root><username>USER</username><password>SECRET</password></root>")],
    ["/safe/runs/op/responses/03-remesa.xml", Buffer.from("<root><ingresoid>123</ingresoid></root>")],
    ["/safe/pdf/remesa-1.pdf", Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff])]
  ]);
  const uploaded: DurableEvidenceArtifact[] = [];
  const dependencies = fakeDependencies(files, uploaded);
  const report = await storeDurableEvidence({
    evidencePath: "/safe/runs/op/result.json",
    steps: [{
      requestPath: "/safe/runs/op/requests/03-remesa.xml",
      responsePath: "/safe/runs/op/responses/03-remesa.xml"
    }],
    documents: [{ path: "/safe/pdf/remesa-1.pdf" }]
  }, context, { outputDir: "/safe/runs", pdfDir: "/safe/pdf" }, dependencies);

  assert.equal(report.stored, true);
  assert.deepEqual(uploaded.map((artifact) => artifact.kind).sort(), ["other", "pdf", "request_xml", "response_xml"]);
  const request = uploaded.find((artifact) => artifact.kind === "request_xml");
  const result = uploaded.find((artifact) => artifact.kind === "other");
  const pdf = uploaded.find((artifact) => artifact.kind === "pdf");
  assert.ok(request);
  assert.ok(result);
  assert.ok(pdf);
  assert.equal(Buffer.from(request.bytes).toString("utf8"), "<root><username>***</username><password>***</password></root>");
  assert.equal(Buffer.from(result.bytes).toString("utf8"), '{"password":"***","ok":true}');
  assert.deepEqual(Buffer.from(pdf.bytes), Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]));
  assert.equal(request.sha256, createHash("sha256").update(request.bytes).digest("base64"));
});

test("stores phase one request and response paths and skips an identical existing artifact", async () => {
  const files = new Map<string, Uint8Array>([
    ["/safe/runs/query/result.json", Buffer.from('{"ok":true}')],
    ["/safe/runs/query/request.xml", Buffer.from("<root><tipo>3</tipo></root>")],
    ["/safe/runs/query/response.xml", Buffer.from("<root><documento/></root>")]
  ]);
  const responseSha = createHash("sha256").update(files.get("/safe/runs/query/response.xml")!).digest("base64");
  const uploaded: DurableEvidenceArtifact[] = [];
  const dependencies = fakeDependencies(files, uploaded, [{
    artifactId: "artifact-existing",
    kind: "response_xml",
    fileName: "response.xml",
    sha256: responseSha,
    size: files.get("/safe/runs/query/response.xml")!.byteLength
  }]);
  const report = await storeDurableEvidence({
    evidencePath: "/safe/runs/query/result.json",
    request: { path: "/safe/runs/query/request.xml" },
    response: { path: "/safe/runs/query/response.xml" }
  }, context, { outputDir: "/safe/runs", pdfDir: "/safe/pdf" }, dependencies);

  assert.equal(report.stored, true);
  assert.deepEqual(uploaded.map((artifact) => artifact.kind).sort(), ["other", "request_xml"]);
  assert.equal(report.artifacts.find((artifact) => artifact.kind === "response_xml")?.artifactId, "artifact-existing");
});

test("requires complete server-provided references for durable operations", () => {
  const headers = new Headers({
    "X-TMS-Durable-Operation": "true",
    "X-TMS-Organization-Id": "org-1",
    "X-TMS-Expediente-Id": "exp-1",
    "X-TMS-Operation-Id": "op-1"
  });
  const valid = readDurableEvidenceContext((name) => headers.get(name) ?? undefined);
  headers.delete("X-TMS-Operation-Id");
  const invalid = readDurableEvidenceContext((name) => headers.get(name) ?? undefined);

  assert.deepEqual(valid, {
    requested: true,
    context: {
      organizationId: "org-1",
      expedienteId: "exp-1",
      operationId: "op-1"
    }
  });
  assert.deepEqual(invalid, { requested: true, error: "Durable evidence references are incomplete" });
});

test("fails safely before reading files when Convex evidence storage is not configured", async () => {
  const report = await storeDurableEvidenceToConvex(
    { evidencePath: "/safe/runs/op/result.json" },
    context,
    { outputDir: "/safe/runs", pdfDir: "/safe/pdf" },
    {}
  );

  assert.deepEqual(report, {
    stored: false,
    artifacts: [],
    error: "Durable evidence storage is not configured"
  });
});

function fakeDependencies(
  files: Map<string, Uint8Array>,
  uploaded: DurableEvidenceArtifact[],
  existing: Awaited<ReturnType<DurableEvidenceDependencies["listExisting"]>> = []
): DurableEvidenceDependencies {
  return {
    readFile: async (path) => {
      const file = files.get(path);
      if (!file) throw new Error(`Missing fixture ${path}`);
      return file;
    },
    listExisting: async () => existing,
    upload: async (_context, artifact) => {
      uploaded.push(artifact);
      return `artifact-${uploaded.length}`;
    }
  };
}

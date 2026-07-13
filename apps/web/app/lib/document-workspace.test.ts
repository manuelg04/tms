import assert from "node:assert/strict";
import test from "node:test";
import {
  correctionDetailHref,
  documentDetailHref,
  documentSections,
  resolveDispatchEntry,
  resolveDocumentSection
} from "./document-workspace";

test("resolves every document workspace to a stable kind and dispatch stage", () => {
  assert.deepEqual(documentSections.map((section) => ({ slug: section.slug, kind: section.kind, stage: section.stage })), [
    { slug: "todos", kind: undefined, stage: undefined },
    { slug: "ordenes", kind: "orden_cargue", stage: "orden_cargue" },
    { slug: "remesas", kind: "remesa", stage: "remesas" },
    { slug: "manifiestos", kind: "manifiesto", stage: "manifiesto" },
    { slug: "cumplidos", kind: "cumplido", stage: "cumplido_inicial" }
  ]);
});

test("rejects an unknown document workspace", () => {
  assert.equal(resolveDocumentSection("desconocido"), undefined);
});

test("builds a dispatch link that opens the document stage", () => {
  assert.equal(
    documentDetailHref({ expedienteId: "dispatch-1", kind: "remesa" }),
    "/expedientes/dispatch-1?stage=remesas#centro-documental"
  );
  assert.equal(documentDetailHref({ kind: "manifiesto" }), undefined);
});

test("builds protected correction and annulment links without executing them", () => {
  assert.equal(
    correctionDetailHref("dispatch-1", "correct"),
    "/expedientes/dispatch-1?panel=correcciones&action=correct#correcciones"
  );
  assert.equal(
    correctionDetailHref("dispatch-1", "annul"),
    "/expedientes/dispatch-1?panel=correcciones&action=annul#correcciones"
  );
});

test("accepts only supported dispatch entry parameters", () => {
  assert.deepEqual(resolveDispatchEntry({ stage: "remesas", panel: "correcciones", action: "annul" }), {
    stage: "remesas",
    showCorrections: true,
    action: "annul"
  });
  assert.deepEqual(resolveDispatchEntry({ stage: "inventada", panel: "otro", action: "delete" }), {
    stage: undefined,
    showCorrections: false,
    action: undefined
  });
});

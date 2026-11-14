import assert from "node:assert/strict";
import { test } from "node:test";
import { fulfillmentNotes, lookupRemesaFulfillment, readFinding } from "./rndc-fulfillment-lookup";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("reads whether the RNDC has a fulfillment for a remesa", () => {
  assert.equal(readFinding(true, { records: [{ id: "1234567" }] }), "found");
  assert.equal(readFinding(true, { records: [] }), "none");
  assert.equal(readFinding(true, { records: [], response: { errorText: "Error RNDC11: Documento no encontrado." } }), "none");
  assert.equal(readFinding(true, { records: [], response: { errorText: "Error de conexión" } }), "unknown");
  assert.equal(readFinding(false, { records: [] }), "unknown");
  assert.equal(readFinding(true, null), "unknown");
});

test("only read-only queries are sent, one pair per remesa with number", async () => {
  const paths: string[] = [];
  const findings = await lookupRemesaFulfillment(
    [{ documentId: "doc-1", number: "90001" }, { documentId: "doc-2" }],
    async (path) => {
      paths.push(path);
      return path.includes("initial-compliance") ? json({ records: [{ id: "1234567" }] }) : json({ records: [] });
    }
  );

  assert.deepEqual(paths.sort(), ["/rndc/initial-compliance/90001", "/rndc/remesa-compliance/90001"]);
  assert.deepEqual(findings, { "doc-1": { initial: "found", final: "none" }, "doc-2": { initial: "none", final: "none" } });
});

test("a failed query is reported as unknown instead of assuming there is nothing", async () => {
  const findings = await lookupRemesaFulfillment([{ documentId: "doc-1", number: "90001" }], async () => {
    throw new Error("sin red");
  });
  assert.deepEqual(findings, { "doc-1": { initial: "unknown", final: "unknown" } });
  const notes = fulfillmentNotes([{ documentId: "doc-1", number: "90001" }], findings, new Set());
  assert.match(notes[0], /No fue posible consultar/);
  assert.match(fulfillmentNotes([{ documentId: "doc-1", number: "90001" }], { "doc-1": { initial: "found" } }, new Set())[0], /empresa de monitoreo GPS/);
  assert.deepEqual(fulfillmentNotes([{ documentId: "doc-1", number: "90001" }], { "doc-1": { initial: "found" } }, new Set(["doc-1"])), []);
});

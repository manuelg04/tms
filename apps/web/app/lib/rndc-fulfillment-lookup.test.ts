import assert from "node:assert/strict";
import { test } from "node:test";
import { fulfillmentNotes, lookupRemesaFulfillment, lookupRemesaFulfillmentDetailed, readFinding, type FulfillmentCache } from "./rndc-fulfillment-lookup";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("reads whether the RNDC has a fulfillment for a remesa", () => {
  assert.equal(readFinding(true, { records: [{ id: "1234567" }] }), "found");
  assert.equal(readFinding(true, { records: [] }), "none");
  assert.equal(readFinding(true, { records: [], response: { errorText: "Error RNDC11: Documento no encontrado." } }), "none");
  assert.equal(readFinding(true, { records: [], response: { errorText: "No se encontraron registros para la consulta" } }), "none");
  assert.equal(readFinding(true, { records: [], response: { errorText: "Consulta sin resultados" } }), "none");
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

test("a failed final query warns that the remesa annulment may be rejected", () => {
  const notes = fulfillmentNotes([{ documentId: "doc-1", number: "90001" }], { "doc-1": { initial: "none", final: "unknown" } }, new Set());
  assert.equal(notes.length, 1);
  assert.match(notes[0], /cumplido final/);
});

test("keeps the RNDC evidence of each query and reuses recent answers only when a cache is given", async () => {
  let calls = 0;
  const fetcher = async (path: string) => {
    calls += 1;
    return json({
      mode: "dry-run",
      startedAt: "2026-11-14T10:00:00.000Z",
      requestId: "req-1",
      response: { status: 200 },
      records: path.includes("initial") ? [{ id: "4596876" }] : [],
      xml: { request: "<root>consulta</root>", response: "<root>respuesta</root>" }
    });
  };
  const cache: FulfillmentCache = new Map();
  let clock = 1_000;
  const first = await lookupRemesaFulfillmentDetailed([{ documentId: "doc-1", number: "90001" }], fetcher, { cache, now: () => clock });
  assert.equal(calls, 2);
  assert.equal(first.evidence.length, 2);
  const initial = first.evidence.find((item) => item.query === "initial");
  assert.equal(initial?.finding, "found");
  assert.equal(initial?.requestXml, "<root>consulta</root>");
  assert.equal(initial?.responseXml, "<root>respuesta</root>");
  assert.equal(initial?.cached, false);
  const second = await lookupRemesaFulfillmentDetailed([{ documentId: "doc-1", number: "90001" }], fetcher, { cache, now: () => clock + 1_000 });
  assert.equal(calls, 2);
  assert.ok(second.evidence.every((item) => item.cached));
  clock += 10 * 60_000;
  await lookupRemesaFulfillmentDetailed([{ documentId: "doc-1", number: "90001" }], fetcher, { cache, now: () => clock });
  assert.equal(calls, 4);
  await lookupRemesaFulfillmentDetailed([{ documentId: "doc-1", number: "90001" }], fetcher);
  assert.equal(calls, 6);
});

test("an unknown answer is never cached", async () => {
  let calls = 0;
  const cache: FulfillmentCache = new Map();
  const fetcher = async () => {
    calls += 1;
    return json({ records: [], response: { errorText: "Error de conexión" } });
  };
  await lookupRemesaFulfillmentDetailed([{ documentId: "doc-1", number: "90001" }], fetcher, { cache });
  await lookupRemesaFulfillmentDetailed([{ documentId: "doc-1", number: "90001" }], fetcher, { cache });
  assert.equal(calls, 4);
});

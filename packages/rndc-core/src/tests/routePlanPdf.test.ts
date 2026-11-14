import assert from "node:assert/strict";
import test from "node:test";
import { buildRoutePlanPdf, type RoutePlanPdfInput } from "../documents/routePlanPdf.js";

const input: RoutePlanPdfInput = {
  company: { name: "TRANSPORTES DE PRUEBA SAS", nit: "900000000-1", address: "CALLE 1 # 2 - 3", phones: "6000000" },
  dispatchCode: "DSP-000001",
  manifestNumber: "0900001",
  origin: "CUCUTA (Nort)",
  destination: "CARTAGENA DE INDIAS (Boli)",
  convoy: "0",
  vehicle: { plate: "AAA000", make: "KENWORTH", modelYear: "2004", color: "BLANCO", bodyType: "ESTACAS", trailerPlate: "R00000", line: "T800" },
  driver: { name: "CONDUCTOR DE PRUEBA", document: "1000000", licenseNumber: "1000000", licenseCategory: "C3", phone: "3000000000" },
  departureAt: "2026-11-13 18:14",
  arrivalAt: "2026-11-14 10:54",
  fine: "$ 50,000",
  stops: Array.from({ length: 12 }, (_, index) => ({
    label: `PUESTO ${index + 1} (Virtual)`,
    detail: index % 2 ? "Llamada al conductor" : "",
    scheduledAt: `2026-11-13 ${String(19 + (index % 4)).padStart(2, "0")}:44:00`
  })),
  observations: "REPORTARSE A SEGURIDAD EN TODOS LOS PUESTOS DE CONTROL.",
  printedAt: "13/11/26, 18:14"
};

test("route plan PDF is a single landscape page for a normal route", async () => {
  const pdf = await buildRoutePlanPdf(input);
  const body = pdf.toString("latin1");

  assert.equal(body.slice(0, 5), "%PDF-");
  assert.ok(pdf.length > 5000);
  assert.equal((body.match(/\/Type \/Page\b/g) ?? []).length, 1);
  assert.match(body, /\/MediaBox \[0 0 792 612\]/);
});

test("route plan PDF adds pages instead of dropping control posts on long routes", async () => {
  const stops = Array.from({ length: 60 }, (_, index) => ({ label: `PUESTO ${index + 1}`, detail: "Reporte del conductor", scheduledAt: "2026-11-14 01:00:00" }));
  const pdf = await buildRoutePlanPdf({ ...input, stops });

  assert.ok((pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length > 1);
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bogotaLocalInput,
  describeReport,
  formatTripCode,
  nextDueAt,
  parseBogotaLocalInput,
  routeProgress,
  validateTripInput,
} from "./monitoring";

describe("monitoring model", () => {
  it("formats sequential trip codes", () => {
    assert.equal(formatTripCode(1), "BM-00001");
    assert.equal(formatTripCode(1234), "BM-01234");
  });

  it("round-trips Bogotá local datetimes", () => {
    const ms = parseBogotaLocalInput("2026-09-17T15:30");
    assert.equal(bogotaLocalInput(ms), "2026-09-17T15:30");
    assert.throws(() => parseBogotaLocalInput("17/09/2026 15:30"), /fecha y hora/);
  });

  it("schedules the next report from the last one", () => {
    assert.equal(nextDueAt(1000, 180), 1000 + 180 * 60 * 1000);
  });

  it("describes reports for the board summary", () => {
    assert.equal(describeReport({ kind: "control", location: "San Gil", hasNovelty: false }), "Sin novedad · San Gil");
    assert.equal(describeReport({ kind: "novedad", location: "Socorro", hasNovelty: true, noveltyType: "Retraso en ruta" }), "Retraso en ruta · Socorro");
    assert.equal(describeReport({ kind: "entrega", location: "Planta", hasNovelty: false }), "Entrega en Planta");
  });

  it("marks route stops visited from report locations, ignoring accents and departments", () => {
    const route = ["Bucaramanga, Santander", "San Gil", "Socorro", "Bogotá D.C."];
    const visited = routeProgress(route, ["Bucaramanga", "san gil (peaje)", "Planta Bogota"]);
    assert.deepEqual(visited, [true, true, false, true]);
  });

  it("validates required trip fields and report frequency", () => {
    const base = { origin: "A", destination: "B", waypoints: [], plate: "ABC123", driverName: "X", driverPhone: "3000000000", customer: "C", cargo: "M", intervalMinutes: 180 };
    assert.doesNotThrow(() => validateTripInput(base));
    assert.throws(() => validateTripInput({ ...base, plate: " " }), /placa/);
    assert.throws(() => validateTripInput({ ...base, intervalMinutes: 10 }), /frecuencia/);
    assert.throws(() => validateTripInput({ ...base, waypoints: [" "] }), /intermedios/);
  });
});

describe("report compliance", () => {
  it("flags gaps beyond the interval plus tolerance", async () => {
    const { reportCompliance } = await import("./monitoring");
    const hour = 60 * 60 * 1000;
    const result = reportCompliance(
      [{ at: 0, kind: "inicio" }, { at: 3 * hour, kind: "control" }, { at: 7 * hour, kind: "control" }, { at: 9 * hour, kind: "entrega" }],
      180,
    );
    assert.deepEqual(result.rows.map((r) => r.onTime), [null, true, false, true]);
    assert.equal(result.onTime, 2);
    assert.equal(result.late, 1);
    assert.equal(result.maxGapMinutes, 240);
    assert.equal(result.averageGapMinutes, 180);
  });
});

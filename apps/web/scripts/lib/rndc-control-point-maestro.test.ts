import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapRndcControlPointRow, normalizeCoordinates, parseRndcControlPointMaestro } from "./rndc-control-point-maestro.js";

const HEADER = [
  "FECHAINGRESO",
  "NUMIDCONTROLADOR",
  "NOMBRECONTROLADOR",
  "CODIGOCONTROLADOR",
  "CODIGOPUESTOCONTROL",
  "NOMBREPUESTOCONTROL",
  "TELEFONO",
  "DIRECCION",
  "CODMUNICIPIOORIGEN",
  "CODMUNICIPIODESTINO",
  "MUNICIPIOORIGEN",
  "MUNICIPIODESTINO",
  "LATITUD",
  "LONGITUD",
  "TIPOCONTROL",
  "EMPRESACALIBRACION",
  "REPORTECALIBRACION",
  "FECHACALIBRACION",
  "ESTADOPUESTOCONTROL",
  "FECHAVENCECALIBRACION",
  ""
];

const TODAY = "2026-08-27";

function line(values: Record<string, string>): string {
  return HEADER.map((column) => values[column] ?? "").join("\t") + "\r";
}

const scale = {
  FECHAINGRESO: "2026/02/28 10:30:42",
  NUMIDCONTROLADOR: "9002577923",
  NOMBRECONTROLADOR: "OILTANKING COLOMBIA S.A.",
  CODIGOCONTROLADOR: "6144",
  CODIGOPUESTOCONTROL: "b1433",
  NOMBREPUESTOCONTROL: "BASCULA SALIDA  OILTANKING",
  DIRECCION: "KM 14 VIA MAMONAL",
  CODMUNICIPIOORIGEN: "13001000",
  CODMUNICIPIODESTINO: "13001000",
  MUNICIPIOORIGEN: "CARTAGENA BOLIVAR",
  MUNICIPIODESTINO: "CARTAGENA BOLIVAR",
  LATITUD: "10.3036696",
  LONGITUD: "75.5006487",
  TIPOCONTROL: "PES",
  EMPRESACALIBRACION: "metro legal",
  REPORTECALIBRACION: "197045",
  FECHACALIBRACION: "2025-04-26-00:00:00",
  ESTADOPUESTOCONTROL: "AC",
  FECHAVENCECALIBRACION: "2026-05-26-00:00:00"
};

const fixed = {
  FECHAINGRESO: "2024/01/10 08:00:00",
  NUMIDCONTROLADOR: "8000000001",
  NOMBRECONTROLADOR: "INSTITUTO NACIONAL DE VIAS - INVIAS",
  CODIGOPUESTOCONTROL: "F100",
  NOMBREPUESTOCONTROL: "PESAJE INVIAS",
  CODMUNICIPIOORIGEN: "11001000",
  CODMUNICIPIODESTINO: "25754000",
  TIPOCONTROL: "FIJ",
  FECHACALIBRACION: "1899-12-30-00:00:00"
};

describe("rndc control point maestro parsing", () => {
  it("normalizes coordinates: Colombian longitudes are negative and swapped pairs are fixed", () => {
    assert.deepEqual(normalizeCoordinates("10.30", "75.50"), { latitude: "10.3", longitude: "-75.5", swapped: false });
    assert.deepEqual(normalizeCoordinates("75.52", "10.39"), { latitude: "10.39", longitude: "-75.52", swapped: true });
    assert.deepEqual(normalizeCoordinates("7.92", "-76.73"), { latitude: "7.92", longitude: "-76.73", swapped: false });
    assert.deepEqual(normalizeCoordinates("", "-76.73"), { swapped: false });
    assert.deepEqual(normalizeCoordinates("10,96741", "-74,76565"), { latitude: "10.96741", longitude: "-74.76565", swapped: false });
    assert.deepEqual(normalizeCoordinates("1028739", "-75,525086"), { swapped: false });
  });

  it("maps a weighbridge with an expired calibration", () => {
    const point = mapRndcControlPointRow(scale, TODAY);
    assert.equal(point.code, "B1433");
    assert.equal(point.name, "BASCULA SALIDA OILTANKING");
    assert.equal(point.controlType, "bascula");
    assert.equal(point.rndcControlType, "PES");
    assert.equal(point.status, "activo");
    assert.equal(point.controllerName, "OILTANKING COLOMBIA S.A.");
    assert.equal(point.longitude, "-75.5006487");
    assert.equal(point.calibrationCompany, "METRO LEGAL");
    assert.equal(point.calibratedAt, "2025-04-26");
    assert.equal(point.calibrationExpiresAt, "2026-05-26");
    assert.equal(point.calibrationValid, false);
    assert.equal(point.rndcRegisteredAt, "2026-02-28");
  });

  it("maps a fixed point without status or calibration", () => {
    const point = mapRndcControlPointRow(fixed, TODAY);
    assert.equal(point.controlType, "fijo");
    assert.equal(point.status, "sin_estado");
    assert.equal(point.calibratedAt, undefined);
    assert.equal(point.calibrationValid, undefined);
    assert.equal(point.latitude, undefined);
    assert.equal(point.destinationCityCode, "25754000");
  });

  it("parses the file, keeps the most recent duplicate and reports stats", () => {
    const text = [
      HEADER.join("\t"),
      line(scale),
      line(fixed),
      line({ ...scale, FECHAINGRESO: "2026/06/01 00:00:00", NOMBREPUESTOCONTROL: "BASCULA NUEVA", FECHAVENCECALIBRACION: "2027-06-01-00:00:00" }),
      line({ ...fixed, CODIGOPUESTOCONTROL: "", NOMBREPUESTOCONTROL: "SIN CODIGO" }),
      line({ ...fixed, CODIGOPUESTOCONTROL: "X1", NOMBREPUESTOCONTROL: "" })
    ].join("\n");
    const result = parseRndcControlPointMaestro(text, TODAY);
    assert.equal(result.stats.rows, 5);
    assert.equal(result.controlPoints.length, 2);
    assert.equal(result.controlPoints[0].name, "BASCULA NUEVA");
    assert.equal(result.controlPoints[0].calibrationValid, true);
    assert.deepEqual(
      result.rejected.map((row) => row.reason),
      ["codigo_duplicado_se_conserva_el_mas_reciente", "codigo_invalido", "nombre_vacio"]
    );
    assert.deepEqual(result.stats.byType, { bascula: 1, fijo: 1, alterno: 0, otro: 0 });
    assert.deepEqual(result.stats.byStatus, { activo: 1, inactivo: 0, sin_estado: 1 });
    assert.equal(result.stats.calibrationValid, 1);
    assert.equal(result.stats.calibrationExpired, 0);
    assert.equal(result.stats.withCoordinates, 1);
  });
});

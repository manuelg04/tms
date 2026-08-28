import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRndcDivisionMaestro, titleCase } from "./rndc-division-maestro.js";
import { normalizeSearchText } from "../../convex/model/searchText.js";

const HEADER = "FECHAINGRESO\tCODIGODIVISION\tNOMBREDIVISION\tCODIGOZONA\tCARRETERA\tNOMBREZONA\tCODIGOMUNICIPIO\tNOMBREMUNICIPIO\tCODIGODEPTO\tNOMBREDEPTO\tCODIGODIVISIONMETROPOLITANA\tLONGITUD\tLATITUD\tDISTANCIAGEOCERCA\t";

function file(rows: string[]): string {
  return [HEADER, ...rows].join("\r\n") + "\r\n";
}

test("pads municipality codes to the RNDC 8-digit format and flags municipalities", () => {
  const result = parseRndcDivisionMaestro(file([
    "2020/11/07 13:50:57\t5001000\tMEDELLIN ANTIOQUIA\t0\tSI\tMEDELLIN\t5001\tMEDELLIN\t5\tANTIOQUIA\t0\t-75.5\t6.25\t0\t",
    "2026/03/11 11:06:19\t5172007\tGUAPÁ CARRETERAS CHIGORODO ANTIOQUIA\t7\t \tGUAPÁ CARRETERAS\t5172\tCHIGORODO\t5\tANTIOQUIA\t0\t \t \t0\t"
  ]), "2026-08-28");

  assert.equal(result.rejected.length, 0);
  assert.equal(result.divisions.length, 2);
  const [medellin, guapa] = result.divisions;
  assert.equal(medellin.code, "05001000");
  assert.equal(medellin.isMunicipality, true);
  assert.equal(medellin.name, "Medellin");
  assert.equal(medellin.municipalityCode, "05001");
  assert.equal(medellin.departmentCode, "05");
  assert.equal(medellin.departmentName, "Antioquia");
  assert.equal(medellin.latitude, "6.25");
  assert.equal(medellin.longitude, "-75.5");
  assert.equal(medellin.rndcRegisteredAt, "2020-11-07");
  assert.equal(guapa.code, "05172007");
  assert.equal(guapa.isMunicipality, false);
  assert.equal(guapa.name, "Guapá Carreteras");
  assert.equal(guapa.municipalityName, "Chigorodo");
  assert.equal(guapa.zoneCode, "7");
  assert.equal(guapa.searchText, "guapa carreteras chigorodo antioquia 05172007 05172");
  assert.deepEqual(result.stats, { rows: 2, municipalities: 1, zones: 1, departments: 1, withCoordinates: 1 });
});

test("rejects duplicates and rows without municipality", () => {
  const result = parseRndcDivisionMaestro(file([
    "2020/11/07 13:50:57\t11001000\tBOGOTA\t0\tSI\tBOGOTA\t11001\tBOGOTA, DISTRITO CAPITAL\t11\tBOGOTA D. C.\t0\t \t \t0\t",
    "2020/11/07 13:50:57\t11001000\tBOGOTA\t0\tSI\tBOGOTA\t11001\tBOGOTA, DISTRITO CAPITAL\t11\tBOGOTA D. C.\t0\t \t \t0\t",
    "2020/11/07 13:50:57\t99999001\tX\t1\t \tX\t\tX\t99\t\t0\t \t \t0\t"
  ]), "2026-08-28");
  assert.equal(result.divisions.length, 1);
  assert.equal(result.divisions[0].name, "Bogota, Distrito Capital");
  assert.deepEqual(result.rejected.map((row) => row.reason), ["Código duplicado", "Faltan municipio o departamento"]);
});

test("throws when a required column is missing", () => {
  assert.throws(() => parseRndcDivisionMaestro("CODIGODIVISION\tNOMBREDIVISION\n", "2026-08-28"), /CODIGOMUNICIPIO/);
});

test("search text strips accents and punctuation", () => {
  assert.equal(normalizeSearchText("Cañaveral", "Puerto Berrío", "05579014"), "canaveral puerto berrio 05579014");
  assert.equal(titleCase("VALLE DEL CAUCA"), "Valle del Cauca");
});

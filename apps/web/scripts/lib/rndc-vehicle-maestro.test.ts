import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyKind,
  mapRndcVehicleRow,
  parseRndcDate,
  parseRndcVehicleMaestro,
  resolveStatus,
  splitConfiguration
} from "./rndc-vehicle-maestro.js";

const HEADER = [
  "FECHAINGRESO",
  "NUMNITEMPRESATRANSPORTE",
  "NUMPLACA",
  "CODMARCAVEHICULOCARGA",
  "CONFIGURACIONUNIDADCARGA",
  "CODCONFIGURACIONUNIDADCARGA",
  "CODLINEAVEHICULOCARGA",
  "LINEAVEHICULOCARGA",
  "ANOFABRICACIONVEHICULOCARGA",
  "CODTIPOCARROCERIA",
  "PESOVEHICULOVACIO",
  "NUMSEGUROSOAT",
  "FECHAVENCIMIENTOSOAT",
  "ASEGURADORASOAT",
  "NUMNITASEGURADORASOAT",
  "CODTIPOIDPROPIETARIO",
  "NUMIDPROPIETARIO",
  "VEHNOMBREPROP",
  "CODTIPOIDTENEDOR",
  "NUMIDTENEDOR",
  "VEHNOMBRETENENC",
  "MARCAVEHICULOCARGA",
  "TIPOCOMBUSTIBLE",
  "CODCOLORVEHICULOCARGA",
  "TIPOCARROCERIA",
  "CODTIPOCOMBUSTIBLE",
  "NUMEJES",
  ""
];

const TODAY = "2026-08-27";

function line(values: Record<string, string>): string {
  return HEADER.map((column) => values[column] ?? " ").join("\t") + "\t\r";
}

const tractor = {
  FECHAINGRESO: "2026/08/27 13:51:40",
  NUMNITEMPRESATRANSPORTE: "9007736849",
  NUMPLACA: "kzl702",
  CODMARCAVEHICULOCARGA: "169",
  CONFIGURACIONUNIDADCARGA: "3S - Tractocamión de 3 ejes",
  CODCONFIGURACIONUNIDADCARGA: "54",
  CODLINEAVEHICULOCARGA: "32",
  LINEAVEHICULOCARGA: "SIN LINEA",
  ANOFABRICACIONVEHICULOCARGA: "2023",
  CODTIPOCARROCERIA: "7",
  PESOVEHICULOVACIO: "7000",
  NUMSEGUROSOAT: "10565300215200",
  FECHAVENCIMIENTOSOAT: "2027-08-23-00:00:00",
  ASEGURADORASOAT: "SEGUROS DEL ESTADO",
  NUMNITASEGURADORASOAT: "8600095786",
  CODTIPOIDPROPIETARIO: "N",
  NUMIDPROPIETARIO: "9016070338",
  VEHNOMBREPROP: "JOHN  FREDDY   BOCANEGRA S.A.S",
  CODTIPOIDTENEDOR: "N",
  NUMIDTENEDOR: "9016070338",
  MARCAVEHICULOCARGA: "FREIGHTLINER",
  TIPOCOMBUSTIBLE: "Diesel o ACPM",
  CODCOLORVEHICULOCARGA: "8",
  TIPOCARROCERIA: "SRS",
  CODTIPOCOMBUSTIBLE: "3",
  NUMEJES: "3"
};

const trailer = {
  FECHAINGRESO: "2023/02/01 10:00:00",
  NUMPLACA: "S48771",
  CONFIGURACIONUNIDADCARGA: "S3 - Semiremolque de 3 ejes",
  CODCONFIGURACIONUNIDADCARGA: "63",
  ANOFABRICACIONVEHICULOCARGA: "0",
  CODTIPOCARROCERIA: "285",
  PESOVEHICULOVACIO: "7000",
  FECHAVENCIMIENTOSOAT: "1899-12-30-00:00:00",
  CODTIPOIDPROPIETARIO: "N",
  NUMIDPROPIETARIO: "9013831554",
  MARCAVEHICULOCARGA: "ADRIANOS TRAILERS",
  CODCOLORVEHICULOCARGA: "0",
  TIPOCARROCERIA: "PLATAFORMA CON ESTACAS DESMONTABLES",
  NUMEJES: "3"
};

describe("rndc vehicle maestro parsing", () => {
  it("parses RNDC dates and discards the 1899 placeholder", () => {
    assert.equal(parseRndcDate("2026-12-11-00:00:00"), "2026-12-11");
    assert.equal(parseRndcDate("1899-12-30-00:00:00"), undefined);
    assert.equal(parseRndcDate(" "), undefined);
  });

  it("splits configuration labels into RNDC code and label", () => {
    assert.deepEqual(splitConfiguration("3S - Tractocamión de 3 ejes"), {
      code: "3S",
      label: "3S - Tractocamión de 3 ejes"
    });
    assert.deepEqual(splitConfiguration("2"), { code: "2", label: "2" });
  });

  it("classifies vehicles by configuration code", () => {
    assert.equal(classifyKind("3S"), "cabezote");
    assert.equal(classifyKind("2S"), "cabezote");
    assert.equal(classifyKind("S3"), "remolque");
    assert.equal(classifyKind("R3"), "remolque");
    assert.equal(classifyKind("B1"), "remolque");
    assert.equal(classifyKind("2"), "rigido");
    assert.equal(classifyKind("CA"), "rigido");
    assert.equal(classifyKind("V4"), "rigido");
    assert.equal(classifyKind(undefined), "otro");
  });

  it("marks motor vehicles active only with a valid SOAT", () => {
    assert.equal(resolveStatus({ kind: "cabezote", soatExpiresAt: "2026-08-27", today: TODAY }), "activo");
    assert.equal(resolveStatus({ kind: "cabezote", soatExpiresAt: "2026-08-26", today: TODAY }), "archivado");
    assert.equal(resolveStatus({ kind: "rigido", today: TODAY }), "archivado");
  });

  it("marks trailers active when registered in the last 24 months", () => {
    assert.equal(resolveStatus({ kind: "remolque", registeredAt: "2024-08-27", today: TODAY }), "activo");
    assert.equal(resolveStatus({ kind: "remolque", registeredAt: "2024-08-26", today: TODAY }), "archivado");
    assert.equal(resolveStatus({ kind: "remolque", today: TODAY }), "archivado");
  });

  it("maps a tractor row into the vehicle model", () => {
    const vehicle = mapRndcVehicleRow(tractor, TODAY);
    assert.equal(vehicle.plate, "KZL702");
    assert.equal(vehicle.vehicleKind, "cabezote");
    assert.equal(vehicle.status, "activo");
    assert.equal(vehicle.configuration, "3S");
    assert.equal(vehicle.rndcConfigurationCode, "54");
    assert.equal(vehicle.line, "32");
    assert.equal(vehicle.lineName, undefined);
    assert.equal(vehicle.modelYear, "2023");
    assert.equal(vehicle.emptyWeightTn, "7");
    assert.equal(vehicle.color, "8");
    assert.equal(vehicle.soatExpiresAt, "2027-08-23");
    assert.equal(vehicle.insurerNit, "8600095786");
    assert.equal(vehicle.ownerName, "JOHN FREDDY BOCANEGRA S.A.S");
    assert.equal(vehicle.ownerDocumentType, "N");
    assert.equal(vehicle.possessorDocument, "9016070338");
    assert.equal(vehicle.possessorName, undefined);
    assert.equal(vehicle.fuelType, "Diesel o ACPM");
    assert.equal(vehicle.axles, "3");
    assert.equal(vehicle.rndcRegisteredAt, "2026-08-27");
    assert.equal(vehicle.source, "rndc-maestro");
    assert.equal(vehicle.sourceCompanyNit, "9007736849");
  });

  it("maps a trailer row and drops placeholder values", () => {
    const vehicle = mapRndcVehicleRow(trailer, TODAY);
    assert.equal(vehicle.vehicleKind, "remolque");
    assert.equal(vehicle.status, "archivado");
    assert.equal(vehicle.modelYear, undefined);
    assert.equal(vehicle.color, undefined);
    assert.equal(vehicle.soatExpiresAt, undefined);
    assert.equal(vehicle.possessorDocument, undefined);
    assert.equal(vehicle.bodyType, "PLATAFORMA CON ESTACAS DESMONTABLES");
    assert.equal(vehicle.rndcBodyTypeCode, "285");
  });

  it("parses the tab separated file, rejects invalid and duplicate plates", () => {
    const text = [
      HEADER.join("\t") + "\r",
      line(tractor),
      line(trailer),
      line({ ...tractor, NUMPLACA: "KZL702" }),
      line({ ...tractor, NUMPLACA: "AB-12" })
    ].join("\n");

    const result = parseRndcVehicleMaestro(text, TODAY);
    assert.equal(result.stats.rows, 4);
    assert.equal(result.vehicles.length, 2);
    assert.deepEqual(result.rejected, [
      { line: 4, plate: "KZL702", reason: "placa_duplicada_linea_2" },
      { line: 5, plate: "AB-12", reason: "placa_invalida" }
    ]);
    assert.deepEqual(result.stats.byKind, { cabezote: 1, rigido: 0, remolque: 1, otro: 0 });
    assert.deepEqual(result.stats.byStatus, { activo: 1, archivado: 1 });
    assert.equal(result.stats.missingPossessor, 1);
  });

  it("fails loudly when required columns are missing", () => {
    assert.throws(() => parseRndcVehicleMaestro("NUMPLACA\tOTRA\nABC123\tx", TODAY), /Faltan columnas/);
  });
});

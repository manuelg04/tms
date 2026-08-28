import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, it } from "node:test";
import {
  parseRndcBodyTypeCatalog,
  parseRndcInsurerCatalog,
  parseRndcPackageCatalog,
  parseRndcVehicleLineCatalog
} from "./rndc-reference-catalogs.js";

const INSURER_HEADER = ["FECHAINGRESO", "NITASEGURADORA", "NOMBREASEGURADORA", "TIPOASEGURADORA", ""];
const VEHICLE_LINE_HEADER = [
  "FECHAINGRESO",
  "CODIGOMARCA",
  "DESCRIPCIONMARCA",
  "CODIGOLINEA",
  "DESCRIPCIONLINEA",
  "PESOBRUTO",
  ""
];
const PACKAGE_HEADER = [
  "FECHAINGRESO",
  "CODIGO",
  "DESCRIPCION",
  "DESCRIPCIONCOMPLETA",
  "DEFINICION",
  "PESOVACIOMINIMO",
  "PESOVACIOMAXIMO",
  "MERCANCIAPELIGROSA",
  "TIPOEMPAQUE",
  "NOMTIPOEMPAQUE",
  "MATERIALEMPAQUE",
  "NOMMATERIALEMPAQUE",
  "TIPOOPERACION",
  ""
];
const BODY_TYPE_HEADER = ["FECHAINGRESO", "CODIGOCARROCERIA", "CARROCERIADESCRIPCION", ""];

function windows1252Tsv(header: string[], rows: Record<string, string>[]): Buffer {
  const lines = [header.join("\t"), ...rows.map((row) => header.map((column) => row[column] ?? "").join("\t"))];
  return Buffer.from(`${lines.join("\r\n")}\r\n`, "latin1");
}

describe("RNDC reference catalog parsing", () => {
  it("decodes Windows-1252 and normalizes RNDC insurer text", () => {
    const bytes = windows1252Tsv(INSURER_HEADER, [
      {
        FECHAINGRESO: "2026/08/27 14:58:38",
        NITASEGURADORA: " 09002004353 ",
        NOMBREASEGURADORA: "  COMPA\xD1\xCDA \xA0 \x96 CASTA\xC3\x91EDA  ",
        TIPOASEGURADORA: " REN "
      }
    ]);

    assert.deepEqual(parseRndcInsurerCatalog(bytes), {
      rows: [
        {
          insurerNit: "09002004353",
          name: "COMPAÑÍA – CASTAÑEDA",
          insurerType: "REN",
          sourceRegisteredAt: "2026-08-27T14:58:38"
        }
      ],
      rawRows: 1,
      deduplicated: 0
    });
  });

  it("deduplicates insurers by NIT using the newest source timestamp", () => {
    const bytes = windows1252Tsv(INSURER_HEADER, [
      {
        FECHAINGRESO: "2011/05/03 15:43:01",
        NITASEGURADORA: "8600377079",
        NOMBREASEGURADORA: "AIG SEGUROS GENERALES S. A.",
        TIPOASEGURADORA: " "
      },
      {
        FECHAINGRESO: "2018/08/06 09:15:23",
        NITASEGURADORA: "8600377079",
        NOMBREASEGURADORA: "SBS SEGUROS COLOMBIA",
        TIPOASEGURADORA: " "
      }
    ]);

    assert.deepEqual(parseRndcInsurerCatalog(bytes), {
      rows: [
        {
          insurerNit: "8600377079",
          name: "SBS SEGUROS COLOMBIA",
          insurerType: undefined,
          sourceRegisteredAt: "2018-08-06T09:15:23"
        }
      ],
      rawRows: 2,
      deduplicated: 1
    });
  });

  it("keeps vehicle line identifiers as strings and uses the brand-line composite key", () => {
    const bytes = windows1252Tsv(VEHICLE_LINE_HEADER, [
      {
        FECHAINGRESO: "2026/08/03 14:45:29",
        CODIGOMARCA: "001",
        DESCRIPCIONMARCA: "MARCA UNO",
        CODIGOLINEA: "01",
        DESCRIPCIONLINEA: "LÍNEA A",
        PESOBRUTO: "0"
      },
      {
        FECHAINGRESO: "2026/08/03 14:45:30",
        CODIGOMARCA: "002",
        DESCRIPCIONMARCA: "MARCA DOS",
        CODIGOLINEA: "01",
        DESCRIPCIONLINEA: "LÍNEA B",
        PESOBRUTO: "10500"
      }
    ]);

    assert.deepEqual(parseRndcVehicleLineCatalog(bytes), {
      rows: [
        {
          makeCode: "001",
          makeName: "MARCA UNO",
          lineCode: "01",
          lineName: "LÍNEA A",
          grossWeightKg: 0,
          sourceRegisteredAt: "2026-08-03T14:45:29"
        },
        {
          makeCode: "002",
          makeName: "MARCA DOS",
          lineCode: "01",
          lineName: "LÍNEA B",
          grossWeightKg: 10500,
          sourceRegisteredAt: "2026-08-03T14:45:30"
        }
      ],
      rawRows: 2,
      deduplicated: 0
    });
  });

  it("keeps the newest vehicle line for a repeated composite key", () => {
    const bytes = windows1252Tsv(VEHICLE_LINE_HEADER, [
      {
        FECHAINGRESO: "2020/01/01 00:00:00",
        CODIGOMARCA: "001",
        DESCRIPCIONMARCA: "MARCA UNO",
        CODIGOLINEA: "01",
        DESCRIPCIONLINEA: "LÍNEA ANTERIOR",
        PESOBRUTO: "0"
      },
      {
        FECHAINGRESO: "2026/08/03 14:45:29",
        CODIGOMARCA: "001",
        DESCRIPCIONMARCA: "MARCA UNO",
        CODIGOLINEA: "01",
        DESCRIPCIONLINEA: "LÍNEA VIGENTE",
        PESOBRUTO: "10500"
      }
    ]);

    const result = parseRndcVehicleLineCatalog(bytes);
    assert.equal(result.rawRows, 2);
    assert.equal(result.deduplicated, 1);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].lineName, "LÍNEA VIGENTE");
  });

  it("parses alphanumeric package codes without inventing an unknown hazardous flag", () => {
    const bytes = windows1252Tsv(PACKAGE_HEADER, [
      {
        FECHAINGRESO: "2025/03/12 14:52:39",
        CODIGO: "3H",
        DESCRIPCION: "Jerrican",
        DESCRIPCIONCOMPLETA: "Jerrican en plástico",
        DEFINICION: "Envase poligonal",
        PESOVACIOMINIMO: "0",
        PESOVACIOMAXIMO: "6500",
        MERCANCIAPELIGROSA: " ",
        TIPOEMPAQUE: "3",
        NOMTIPOEMPAQUE: "JERRICAN",
        MATERIALEMPAQUE: "H",
        NOMMATERIALEMPAQUE: "PLASTICO",
        TIPOOPERACION: "."
      }
    ]);

    assert.deepEqual(parseRndcPackageCatalog(bytes), {
      rows: [
        {
          code: "3H",
          description: "Jerrican",
          fullDescription: "Jerrican en plástico",
          definition: "Envase poligonal",
          minimumEmptyWeightKg: 0,
          maximumEmptyWeightKg: 6500,
          hazardous: undefined,
          packageTypeCode: "3",
          packageTypeName: "JERRICAN",
          materialCode: "H",
          materialName: "PLASTICO",
          operationType: ".",
          sourceRegisteredAt: "2025-03-12T14:52:39"
        }
      ],
      rawRows: 1,
      deduplicated: 0
    });
  });

  it("keeps the newest package row for a repeated code", () => {
    const row = {
      FECHAINGRESO: "2020/01/01 00:00:00",
      CODIGO: "3H",
      DESCRIPCION: "Jerrican anterior",
      DESCRIPCIONCOMPLETA: "Jerrican anterior",
      DEFINICION: "Envase poligonal",
      PESOVACIOMINIMO: "0",
      PESOVACIOMAXIMO: "6500",
      MERCANCIAPELIGROSA: "SI",
      TIPOEMPAQUE: "3",
      NOMTIPOEMPAQUE: "JERRICAN",
      MATERIALEMPAQUE: "H",
      NOMMATERIALEMPAQUE: "PLASTICO",
      TIPOOPERACION: "."
    };
    const bytes = windows1252Tsv(PACKAGE_HEADER, [
      row,
      {
        ...row,
        FECHAINGRESO: "2025/03/12 14:52:39",
        DESCRIPCION: "Jerrican vigente",
        DESCRIPCIONCOMPLETA: "Jerrican vigente"
      }
    ]);

    const result = parseRndcPackageCatalog(bytes);
    assert.equal(result.rawRows, 2);
    assert.equal(result.deduplicated, 1);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].description, "Jerrican vigente");
  });

  it("keeps the newest body type row when a natural key repeats", () => {
    const bytes = windows1252Tsv(BODY_TYPE_HEADER, [
      {
        FECHAINGRESO: "2011/08/17 10:21:59",
        CODIGOCARROCERIA: "231",
        CARROCERIADESCRIPCION: "PORTACONTENEDORES"
      },
      {
        FECHAINGRESO: "2025/02/21 15:42:33",
        CODIGOCARROCERIA: "231",
        CARROCERIADESCRIPCION: "PORTA CONTENEDOR"
      }
    ]);

    assert.deepEqual(parseRndcBodyTypeCatalog(bytes), {
      rows: [
        {
          code: "231",
          description: "PORTA CONTENEDOR",
          sourceRegisteredAt: "2025-02-21T15:42:33"
        }
      ],
      rawRows: 2,
      deduplicated: 1
    });
  });

  it("rejects different payloads for the same key and source timestamp", () => {
    const bytes = windows1252Tsv(BODY_TYPE_HEADER, [
      {
        FECHAINGRESO: "2025/02/21 15:42:33",
        CODIGOCARROCERIA: "231",
        CARROCERIADESCRIPCION: "PORTACONTENEDORES"
      },
      {
        FECHAINGRESO: "2025/02/21 15:42:33",
        CODIGOCARROCERIA: "231",
        CARROCERIADESCRIPCION: "PORTA CONTENEDOR"
      }
    ]);

    assert.throws(() => parseRndcBodyTypeCatalog(bytes), /misma fecha/);
  });

  it("rejects a catalog whose header is not the exact RNDC header", () => {
    const invalidHeader = [...INSURER_HEADER];
    [invalidHeader[1], invalidHeader[2]] = [invalidHeader[2], invalidHeader[1]];

    assert.throws(() => parseRndcInsurerCatalog(windows1252Tsv(invalidHeader, [])), /encabezado exacto/);
  });

  it("rejects a catalog without data rows", () => {
    assert.throws(() => parseRndcBodyTypeCatalog(windows1252Tsv(BODY_TYPE_HEADER, [])), /no contiene filas/);
  });

  it("rejects rows that omit the RNDC trailing blank column", () => {
    const row = ["2026/07/08 10:35:07", "225", "DOBLE CABINA FURGON"].join("\t");
    const bytes = Buffer.from(`${BODY_TYPE_HEADER.join("\t")}\r\n${row}\r\n`, "latin1");

    assert.throws(() => parseRndcBodyTypeCatalog(bytes), /cantidad de columnas/);
  });

  it("rejects blank rows inside a catalog", () => {
    const row = ["2026/07/08 10:35:07", "225", "DOBLE CABINA FURGON", ""].join("\t");
    const bytes = Buffer.from(`${BODY_TYPE_HEADER.join("\t")}\r\n${row}\r\n\r\n${row}\r\n`, "latin1");

    assert.throws(() => parseRndcBodyTypeCatalog(bytes), /fila 3/);
  });

  it("rejects invalid RNDC source dates", () => {
    const bytes = windows1252Tsv(BODY_TYPE_HEADER, [
      {
        FECHAINGRESO: "2026/02/30 10:00:00",
        CODIGOCARROCERIA: "225",
        CARROCERIADESCRIPCION: "DOBLE CABINA FURGON"
      }
    ]);

    assert.throws(() => parseRndcBodyTypeCatalog(bytes), /Fecha RNDC inválida/);
  });

  it("rejects blank catalog keys", () => {
    const bytes = windows1252Tsv(BODY_TYPE_HEADER, [
      {
        FECHAINGRESO: "2026/07/08 10:35:07",
        CODIGOCARROCERIA: " ",
        CARROCERIADESCRIPCION: "DOBLE CABINA FURGON"
      }
    ]);

    assert.throws(() => parseRndcBodyTypeCatalog(bytes), /llave CODIGOCARROCERIA está vacía/);
  });

  it("rejects catalog keys outside the RNDC formats", () => {
    const bodyBytes = windows1252Tsv(BODY_TYPE_HEADER, [
      {
        FECHAINGRESO: "2026/07/08 10:35:07",
        CODIGOCARROCERIA: "***",
        CARROCERIADESCRIPCION: "DOBLE CABINA FURGON"
      }
    ]);
    const packageBytes = windows1252Tsv(PACKAGE_HEADER, [
      {
        FECHAINGRESO: "2025/03/12 14:52:39",
        CODIGO: "3 h",
        DESCRIPCION: "Jerrican",
        DESCRIPCIONCOMPLETA: "Jerrican en plástico",
        DEFINICION: "Envase poligonal",
        PESOVACIOMINIMO: "0",
        PESOVACIOMAXIMO: "6500",
        MERCANCIAPELIGROSA: "SI",
        TIPOEMPAQUE: "3",
        NOMTIPOEMPAQUE: "JERRICAN",
        MATERIALEMPAQUE: "H",
        NOMMATERIALEMPAQUE: "PLASTICO",
        TIPOOPERACION: "."
      }
    ]);

    assert.throws(() => parseRndcBodyTypeCatalog(bodyBytes), /formato de la llave CODIGOCARROCERIA/);
    assert.throws(() => parseRndcPackageCatalog(packageBytes), /formato de la llave CODIGO/);
  });

  it("rejects an invalid vehicle-line gross weight", () => {
    const row = {
      FECHAINGRESO: "2026/08/03 14:45:29",
      CODIGOMARCA: "001",
      DESCRIPCIONMARCA: "MARCA UNO",
      CODIGOLINEA: "01",
      DESCRIPCIONLINEA: "LÍNEA A",
      PESOBRUTO: "desconocido"
    };

    for (const invalidWeight of ["desconocido", "0x10", "1e3", "9007199254740992"]) {
      assert.throws(
        () => parseRndcVehicleLineCatalog(windows1252Tsv(VEHICLE_LINE_HEADER, [{ ...row, PESOBRUTO: invalidWeight }])),
        /peso bruto/
      );
    }
  });

  it("rejects blank backend-required descriptions before an import can start", () => {
    const insurerBytes = windows1252Tsv(INSURER_HEADER, [
      {
        FECHAINGRESO: "2026/08/27 14:58:38",
        NITASEGURADORA: "9002004353",
        NOMBREASEGURADORA: " ",
        TIPOASEGURADORA: "REN"
      }
    ]);
    const bodyBytes = windows1252Tsv(BODY_TYPE_HEADER, [
      {
        FECHAINGRESO: "2026/07/08 10:35:07",
        CODIGOCARROCERIA: "225",
        CARROCERIADESCRIPCION: " "
      }
    ]);

    assert.throws(() => parseRndcInsurerCatalog(insurerBytes), /NOMBREASEGURADORA/);
    assert.throws(() => parseRndcBodyTypeCatalog(bodyBytes), /CARROCERIADESCRIPCION/);
  });

  it("rejects values that exceed the backend limits before an import can start", () => {
    const insurerBytes = windows1252Tsv(INSURER_HEADER, [
      {
        FECHAINGRESO: "2026/08/27 14:58:38",
        NITASEGURADORA: "9002004353",
        NOMBREASEGURADORA: "A".repeat(301),
        TIPOASEGURADORA: "REN"
      }
    ]);
    const vehicleBytes = windows1252Tsv(VEHICLE_LINE_HEADER, [
      {
        FECHAINGRESO: "2026/08/03 14:45:29",
        CODIGOMARCA: "1".repeat(81),
        DESCRIPCIONMARCA: "MARCA UNO",
        CODIGOLINEA: "01",
        DESCRIPCIONLINEA: "LÍNEA A",
        PESOBRUTO: "1000"
      }
    ]);
    const packageBytes = windows1252Tsv(PACKAGE_HEADER, [
      {
        FECHAINGRESO: "2025/03/12 14:52:39",
        CODIGO: "3H",
        DESCRIPCION: "A".repeat(1001),
        DESCRIPCIONCOMPLETA: "Jerrican en plástico",
        DEFINICION: "Envase poligonal",
        PESOVACIOMINIMO: "0",
        PESOVACIOMAXIMO: "6500",
        MERCANCIAPELIGROSA: "SI",
        TIPOEMPAQUE: "3",
        NOMTIPOEMPAQUE: "JERRICAN",
        MATERIALEMPAQUE: "H",
        NOMMATERIALEMPAQUE: "PLASTICO",
        TIPOOPERACION: "."
      }
    ]);

    assert.throws(() => parseRndcInsurerCatalog(insurerBytes), /NOMBREASEGURADORA supera/);
    assert.throws(() => parseRndcVehicleLineCatalog(vehicleBytes), /CODIGOMARCA supera/);
    assert.throws(() => parseRndcPackageCatalog(packageBytes), /DESCRIPCION supera/);
  });

  it("requires the exact RNDC CRLF file terminator", () => {
    const complete = windows1252Tsv(BODY_TYPE_HEADER, [
      {
        FECHAINGRESO: "2026/07/08 10:35:07",
        CODIGOCARROCERIA: "225",
        CARROCERIADESCRIPCION: "DOBLE CABINA FURGON"
      }
    ]);

    assert.throws(() => parseRndcBodyTypeCatalog(complete.subarray(0, complete.length - 2)), /terminación CRLF/);
  });

  it("rejects an unknown hazardous-package marker", () => {
    const bytes = windows1252Tsv(PACKAGE_HEADER, [
      {
        FECHAINGRESO: "2025/03/12 14:52:39",
        CODIGO: "3H",
        DESCRIPCION: "Jerrican",
        DESCRIPCIONCOMPLETA: "Jerrican en plástico",
        DEFINICION: "Envase poligonal",
        PESOVACIOMINIMO: "0",
        PESOVACIOMAXIMO: "6500",
        MERCANCIAPELIGROSA: "QUIZAS",
        TIPOEMPAQUE: "3",
        NOMTIPOEMPAQUE: "JERRICAN",
        MATERIALEMPAQUE: "H",
        NOMMATERIALEMPAQUE: "PLASTICO",
        TIPOOPERACION: "."
      }
    ]);

    assert.throws(() => parseRndcPackageCatalog(bytes), /MERCANCIAPELIGROSA desconocido/);
  });

  it("rejects invalid package weights", () => {
    const valid = {
      FECHAINGRESO: "2025/03/12 14:52:39",
      CODIGO: "3H",
      DESCRIPCION: "Jerrican",
      DESCRIPCIONCOMPLETA: "Jerrican en plastico",
      DEFINICION: "Envase poligonal",
      PESOVACIOMINIMO: "0",
      PESOVACIOMAXIMO: "6500",
      MERCANCIAPELIGROSA: "SI",
      TIPOEMPAQUE: "3",
      NOMTIPOEMPAQUE: "JERRICAN",
      MATERIALEMPAQUE: "H",
      NOMMATERIALEMPAQUE: "PLASTICO",
      TIPOOPERACION: "."
    };

    assert.throws(
      () => parseRndcPackageCatalog(windows1252Tsv(PACKAGE_HEADER, [{ ...valid, PESOVACIOMINIMO: "-1" }])),
      /peso vacío mínimo/
    );
    assert.throws(
      () => parseRndcPackageCatalog(windows1252Tsv(PACKAGE_HEADER, [{ ...valid, PESOVACIOMAXIMO: "x" }])),
      /peso vacío máximo/
    );
    assert.throws(
      () =>
        parseRndcPackageCatalog(
          windows1252Tsv(PACKAGE_HEADER, [{ ...valid, PESOVACIOMINIMO: "7000", PESOVACIOMAXIMO: "6500" }])
        ),
      /mínimo supera el máximo/
    );
  });
});

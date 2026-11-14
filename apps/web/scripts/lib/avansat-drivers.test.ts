import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCityIndex, cityKey, parseAvansatDrivers } from "./avansat-drivers.js";

const HEADER = [
  "DOC_CONDUCTOR",
  "CONDUCTOR",
  "1APELLIDO",
  "2APELLIDO",
  "DIRECCION",
  "TELEFONO1",
  "TELEFONO2",
  "TELMOVIL",
  "ORIGEN",
  "SEXO",
  "GSANGUINEO",
  "NRO_LICENCIA",
  "CAT_LICENCIA",
  "F_VENCLICENCIA",
  "EPS",
  "ARP",
  "PENSIONES",
  "NOM_REFPERSONALES",
  "TEL_REFPERSONALES",
  "OBS_CONDCUTOR",
  "U_CREADO",
  "F_CREADO",
  "U_MODIFICADO",
  "F_MODIFICADO",
  ""
];

const TODAY = "2026-11-13";

const base: Record<string, string> = {
  DOC_CONDUCTOR: "1000000001",
  CONDUCTOR: "Pedro  Luis",
  "1APELLIDO": "Rojas ",
  "2APELLIDO": "Mora",
  DIRECCION: "CLL 1 2-3",
  TELEFONO1: "3000000001",
  TELMOVIL: "3000000001",
  ORIGEN: "BOGOTA, D.C.",
  SEXO: "1",
  GSANGUINEO: "AB (+",
  NRO_LICENCIA: "1000000001",
  CAT_LICENCIA: "9",
  F_VENCLICENCIA: "2028-05-09",
  EPS: "NUEVA EPS ",
  ARP: "SURA",
  PENSIONES: "PORVENIR",
  NOM_REFPERSONALES: "ANA ROJAS",
  TEL_REFPERSONALES: "3000000002",
  U_CREADO: "AUXSEG1",
  F_CREADO: "2026-11-12 09:37:17"
};

function line(values: Record<string, string>): string {
  return HEADER.map((column) => values[column] ?? "").join("\t") + "\r";
}

function file(rows: Array<Record<string, string>>, name = "noviembre.xls") {
  return { name, text: [HEADER.join("\t"), ...rows.map(line)].join("\n") };
}

const cities = buildCityIndex([
  { code: "11001000", isMunicipality: true, municipalityName: "BOGOTA D.C." },
  { code: "68001000", isMunicipality: true, municipalityName: "BUCARAMANGA" },
  { code: "68001001", isMunicipality: false, municipalityName: "BUCARAMANGA" },
  { code: "05055000", isMunicipality: true, municipalityName: "ARGELIA" },
  { code: "19050000", isMunicipality: true, municipalityName: "ARGELIA" }
]);

describe("parseAvansatDrivers", () => {
  it("convierte una fila en un conductor listo para el TMS", () => {
    const result = parseAvansatDrivers([file([base])], { today: TODAY, cities });
    assert.equal(result.drivers.length, 1);
    assert.deepEqual(result.drivers[0], {
      document: "1000000001",
      documentType: "C",
      name: "PEDRO LUIS ROJAS MORA",
      firstNames: "PEDRO LUIS",
      firstLastName: "ROJAS",
      secondLastName: "MORA",
      status: "Activo",
      sex: "Masculino",
      bloodType: "AB (+)",
      address: "CLL 1 2-3",
      city: "BOGOTA, D.C.",
      cityCode: "11001000",
      phone1: "3000000001",
      phone2: undefined,
      cellphone: "3000000001",
      licenseNumber: "1000000001",
      licenseCategory: "C3",
      licenseExpiresAt: "2028-05-09",
      eps: "NUEVA EPS",
      arp: "SURA",
      pensionFund: "PORVENIR",
      observations: "Referencia personal: ANA ROJAS · 3000000002"
    });
    assert.deepEqual(result.warnings, []);
    assert.equal(result.stats.withValidLicense, 1);
    assert.equal(result.stats.createdFrom, "2026-11-12");
  });

  it("traduce las categorías 7, 8 y 9 y avisa de las que no conoce", () => {
    const result = parseAvansatDrivers(
      [file([
        { ...base, DOC_CONDUCTOR: "11111111", CAT_LICENCIA: "7" },
        { ...base, DOC_CONDUCTOR: "22222222", CAT_LICENCIA: "8" },
        { ...base, DOC_CONDUCTOR: "33333333", CAT_LICENCIA: "c2" },
        { ...base, DOC_CONDUCTOR: "44444444", CAT_LICENCIA: "4" }
      ])],
      { today: TODAY, cities }
    );
    assert.deepEqual(result.drivers.map((driver) => driver.licenseCategory), ["C1", "C2", "C2", undefined]);
    assert.deepEqual(result.warnings, [{ document: "44444444", field: "licenseCategory", value: "4", reason: "categoria_sin_equivalencia" }]);
    assert.deepEqual(result.stats.byLicenseCategory, { C1: 1, C2: 2, sin_categoria: 1 });
  });

  it("deja sin código la ciudad que no existe o que se repite en varios departamentos", () => {
    const result = parseAvansatDrivers(
      [file([
        { ...base, DOC_CONDUCTOR: "11111111", ORIGEN: "Bucaramanga" },
        { ...base, DOC_CONDUCTOR: "22222222", ORIGEN: "ARGELIA" },
        { ...base, DOC_CONDUCTOR: "33333333", ORIGEN: "MACONDO" }
      ])],
      { today: TODAY, cities }
    );
    assert.deepEqual(result.drivers.map((driver) => driver.cityCode), ["68001000", undefined, undefined]);
    assert.deepEqual(result.warnings.map((warning) => warning.reason), ["municipio_repetido_en_varios_departamentos", "municipio_no_encontrado"]);
    assert.equal(result.stats.withCityCode, 1);
  });

  it("rechaza filas sin cédula válida o sin nombre y limpia fechas en cero", () => {
    const result = parseAvansatDrivers(
      [file([
        { ...base, DOC_CONDUCTOR: "ABC" },
        { ...base, DOC_CONDUCTOR: "55555555", "1APELLIDO": " " },
        { ...base, DOC_CONDUCTOR: "66666666", F_VENCLICENCIA: "0000-00-00", SEXO: "2", GSANGUINEO: "O (-)" }
      ])],
      { today: TODAY, cities }
    );
    assert.deepEqual(result.rejected.map((row) => [row.line, row.reason]), [[2, "identificacion_invalida"], [3, "nombre_incompleto"]]);
    assert.equal(result.drivers.length, 1);
    assert.equal(result.drivers[0].licenseExpiresAt, undefined);
    assert.equal(result.drivers[0].sex, "Femenino");
    assert.equal(result.drivers[0].bloodType, "O (-)");
    assert.equal(result.stats.withValidLicense, 0);
  });

  it("une varios archivos y se queda con la versión más reciente de una cédula repetida", () => {
    const result = parseAvansatDrivers(
      [
        file([{ ...base, F_VENCLICENCIA: "2026-12-01", F_CREADO: "2026-10-02 08:00:00" }], "octubre.xls"),
        file([{ ...base, F_VENCLICENCIA: "2029-12-01", F_CREADO: "2026-10-02 08:00:00", F_MODIFICADO: "2026-11-05 10:00:00" }, { ...base, DOC_CONDUCTOR: "77777777" }])
      ],
      { today: TODAY, cities }
    );
    assert.equal(result.stats.rows, 3);
    assert.equal(result.stats.drivers, 2);
    assert.equal(result.stats.duplicates, 1);
    assert.equal(result.drivers.find((driver) => driver.document === "1000000001")?.licenseExpiresAt, "2029-12-01");
  });

  it("falla si el archivo no es el reporte de conductores", () => {
    assert.throws(() => parseAvansatDrivers([{ name: "otro.xls", text: "PLACA\tMARCA\nABC123\tKENWORTH" }], { today: TODAY }), /faltan columnas/);
  });
});

describe("cityKey", () => {
  it("ignora tildes, puntuación y el sufijo de Bogotá", () => {
    assert.equal(cityKey("BOGOTA, D.C."), "bogota");
    assert.equal(cityKey("Bogotá D.C."), "bogota");
    assert.equal(cityKey("OCAÑA"), "ocana");
    assert.equal(cityKey("SANTIAGO DE CALI"), "cali");
  });
});

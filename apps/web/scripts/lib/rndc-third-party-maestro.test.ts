import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPartyName,
  collectVehicleParties,
  mapRndcThirdPartyRow,
  parseRndcThirdPartyMaestro
} from "./rndc-third-party-maestro.js";

const HEADER = [
  "FECHAINGRESO",
  "NUMNITEMPRESATRANSPORTE",
  "TIPOIDTERCERO",
  "CODTIPOIDTERCERO",
  "NOMSEDETERCERO",
  "NUMIDTERCERO",
  "CODSEDETERCERO",
  "NOMIDTERCERO",
  "PRIMERAPELLIDOIDTERCERO",
  "SEGUNDOAPELLIDOIDTERCERO",
  "NUMTELEFONOCONTACTO",
  "NUMCELULARPERSONA",
  "NOMENCLATURADIRECCION",
  "MUNICIPIORNDC",
  "CODMUNICIPIORNDC",
  "CODCATEGORIALICENCIACONDUCCION",
  "NUMLICENCIACONDUCCION",
  "FECHAVENCIMIENTOLICENCIA",
  "EMAILTERCERO",
  "LATITUD",
  "LONGITUD",
  ""
];

const TODAY = "2026-08-27";

function line(values: Record<string, string>): string {
  return HEADER.map((column) => values[column] ?? " ").join("\t") + "\r";
}

const driverRow = {
  FECHAINGRESO: "2026/08/27 16:53:10",
  CODTIPOIDTERCERO: "C",
  NOMSEDETERCERO: "CR 36 A  21 - 68",
  NUMIDTERCERO: "1052399857",
  CODSEDETERCERO: "0",
  NOMIDTERCERO: "ERIKA  YANETH",
  PRIMERAPELLIDOIDTERCERO: "FONSECA",
  SEGUNDOAPELLIDOIDTERCERO: "CASTRO",
  NUMTELEFONOCONTACTO: "3104867412",
  NUMCELULARPERSONA: "0",
  NOMENCLATURADIRECCION: "CR 36 A  21   68",
  MUNICIPIORNDC: "DUITAMA BOYACA",
  CODMUNICIPIORNDC: "15238000",
  CODCATEGORIALICENCIACONDUCCION: "C3",
  NUMLICENCIACONDUCCION: "1052399857",
  FECHAVENCIMIENTOLICENCIA: "2028-12-01-16:53:09",
  EMAILTERCERO: ".@."
};

const companyMain = {
  FECHAINGRESO: "2019/03/01 10:00:00",
  CODTIPOIDTERCERO: "N",
  NOMSEDETERCERO: "CR 69 A 37 B 65 SUR",
  NUMIDTERCERO: "8320041044",
  CODSEDETERCERO: "0",
  NOMIDTERCERO: "MAXICASSA S A S",
  PRIMERAPELLIDOIDTERCERO: "NO DISPONIBLE",
  NUMTELEFONOCONTACTO: "6012345678",
  NOMENCLATURADIRECCION: "CR 69 A 37 B 65 SUR",
  MUNICIPIORNDC: "BOGOTA BOGOTA D. C.",
  CODMUNICIPIORNDC: "11001000",
  NUMLICENCIACONDUCCION: "0"
};

const companyBranch = {
  ...companyMain,
  FECHAINGRESO: "2024/05/10 09:00:00",
  NOMSEDETERCERO: "MONTERIA",
  CODSEDETERCERO: "51",
  NOMIDTERCERO: "MAXICASSA S.A.S.-MONTERIA",
  NOMENCLATURADIRECCION: "MONTERIA",
  MUNICIPIORNDC: "MONTERIA CORDOBA",
  CODMUNICIPIORNDC: "23001000",
  LATITUD: "8.75",
  LONGITUD: "-75.88"
};

describe("rndc third party maestro parsing", () => {
  it("builds person names from name and surnames, and company names as given", () => {
    assert.equal(buildPartyName(driverRow), "ERIKA YANETH FONSECA CASTRO");
    assert.equal(buildPartyName(companyMain), "MAXICASSA S A S");
  });

  it("maps a driver row with license data and drops placeholders", () => {
    const mapped = mapRndcThirdPartyRow(driverRow);
    assert.equal(mapped.document, "1052399857");
    assert.equal(mapped.cellphone, undefined);
    assert.equal(mapped.email, undefined);
    assert.equal(mapped.phone, "3104867412");
    assert.equal(mapped.site.siteCode, "0");
    assert.equal(mapped.site.siteName, "CR 36 A 21 - 68");
    assert.deepEqual(mapped.driver, {
      document: "1052399857",
      documentType: "C",
      name: "ERIKA YANETH FONSECA CASTRO",
      address: "CR 36 A 21 68",
      city: "DUITAMA BOYACA",
      cityCode: "15238000",
      phone1: "3104867412",
      cellphone: undefined,
      licenseNumber: "1052399857",
      licenseCategory: "C3",
      licenseExpiresAt: "2028-12-01"
    });
  });

  it("does not treat a company row as a driver", () => {
    assert.equal(mapRndcThirdPartyRow(companyMain).driver, undefined);
  });

  it("groups sites per document, infers roles and counts stats", () => {
    const text = [HEADER.join("\t") + "\r", line(driverRow), line(companyMain), line(companyBranch), line({ ...companyBranch, FECHAINGRESO: "2020/01/01 00:00:00", LATITUD: "" })].join("\n");
    const result = parseRndcThirdPartyMaestro(text, {
      today: TODAY,
      ownerDocuments: new Set(["1052399857"]),
      possessorDocuments: new Set(["8320041044"])
    });

    assert.equal(result.stats.rows, 4);
    assert.equal(result.parties.length, 2);
    assert.equal(result.sites.length, 3);
    assert.equal(result.drivers.length, 1);
    assert.equal(result.stats.driversWithValidLicense, 1);
    assert.equal(result.stats.multiSiteParties, 1);
    assert.deepEqual(result.rejected, []);

    const driver = result.parties.find((party) => party.document === "1052399857")!;
    assert.deepEqual(driver.roles, ["driver", "owner"]);
    assert.equal(driver.siteCount, 1);

    const company = result.parties.find((party) => party.document === "8320041044")!;
    assert.equal(company.name, "MAXICASSA S A S");
    assert.deepEqual(company.roles, ["possessor"]);
    assert.equal(company.siteCount, 2);
    assert.equal(company.rndcRegisteredAt, "2019-03-01");

    const branch = result.sites.find((site) => site.document === "8320041044" && site.siteCode === "51")!;
    assert.equal(branch.siteName, "MONTERIA");
    assert.equal(branch.latitude, "8.75");
    assert.equal(branch.rndcRegisteredAt, "2024-05-10");
  });

  it("marks companies without other roles as senders and persons as other", () => {
    const person = { ...driverRow, NUMIDTERCERO: "79000000", CODCATEGORIALICENCIACONDUCCION: "" };
    const text = [HEADER.join("\t"), line(companyMain), line(person)].join("\n");
    const result = parseRndcThirdPartyMaestro(text, { today: TODAY });
    assert.deepEqual(result.parties.map((party) => party.roles), [["sender"], ["other"]]);
  });

  it("rejects rows without a usable document, type or name", () => {
    const text = [
      HEADER.join("\t"),
      line({ ...driverRow, NUMIDTERCERO: "1-2" }),
      line({ ...driverRow, CODTIPOIDTERCERO: "" }),
      line({ ...driverRow, NOMIDTERCERO: "", PRIMERAPELLIDOIDTERCERO: "", SEGUNDOAPELLIDOIDTERCERO: "" })
    ].join("\n");
    const result = parseRndcThirdPartyMaestro(text, { today: TODAY });
    assert.deepEqual(
      result.rejected.map((row) => row.reason),
      ["identificacion_invalida", "tipo_identificacion_vacio", "nombre_vacio"]
    );
  });

  it("keeps companies without a name in RNDC using a placeholder name", () => {
    const text = [HEADER.join("\t"), line({ ...companyMain, NOMIDTERCERO: "NO DISPONIBLE" })].join("\n");
    const result = parseRndcThirdPartyMaestro(text, { today: TODAY });
    assert.deepEqual(result.rejected, []);
    assert.equal(result.parties[0].name, "NIT 8320041044 (sin nombre en RNDC)");
  });

  it("collects owner and possessor documents from the vehicle maestro", () => {
    const vehicles = ["NUMPLACA\tNUMIDPROPIETARIO\tNUMIDTENEDOR", "ABC123\t111\t222", "DEF456\t333\t "].join("\n");
    const parties = collectVehicleParties(vehicles);
    assert.deepEqual([...parties.owners], ["111", "333"]);
    assert.deepEqual([...parties.possessors], ["222"]);
  });
});

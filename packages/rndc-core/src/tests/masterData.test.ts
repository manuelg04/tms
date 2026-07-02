import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildDriverMasterQuery,
  buildThirdPartyMasterQuery,
  buildVehicleMasterQuery,
  normalizeDriverMaster,
  normalizeThirdPartyMaster,
  normalizeVehicleMaster,
  saveLocalOwnerVehicleSnapshot,
  saveLocalMasterSnapshot
} from "../rndc/masterData.js";
import { loadConfig } from "../rndc/config.js";
import { RndcClient } from "../rndc/client.js";
import { parseXml } from "../rndc/xml.js";

test("builds RNDC master queries for one driver and one vehicle", () => {
  const driver = buildDriverMasterQuery({ companyRndcNit: "9007736849", idType: "C", id: "123456789" });
  const vehicle = buildVehicleMasterQuery({ companyRndcNit: "9007736849", plate: "ABC123" });

  assert.equal(driver.tipo, 2);
  assert.equal(driver.procesoId, 11);
  assert.deepEqual(driver.documento, {
    NUMNITEMPRESATRANSPORTE: "9007736849",
    CODTIPOIDTERCERO: "'C'",
    NUMIDTERCERO: "123456789"
  });
  assert.match(String(driver.variables), /CODCATEGORIALICENCIACONDUCCION/);

  assert.equal(vehicle.tipo, 2);
  assert.equal(vehicle.procesoId, 12);
  assert.deepEqual(vehicle.documento, {
    NUMNITEMPRESATRANSPORTE: "9007736849",
    NUMPLACA: "'ABC123'"
  });
  assert.match(String(vehicle.variables), /FECHAVENCIMIENTOSOAT/);
});

test("normalizes RNDC master responses into document-ready records", () => {
  const parsedDriver = parseXml([
    "<?xml version=\"1.0\" encoding=\"ISO-8859-1\" ?>",
    "<root>",
    "<documento>",
    "<CODTIPOIDTERCERO>C</CODTIPOIDTERCERO>",
    "<NUMIDTERCERO>123456789</NUMIDTERCERO>",
    "<NOMIDTERCERO>ANA MARIA</NOMIDTERCERO>",
    "<PRIMERAPELLIDOIDTERCERO>PEREZ</PRIMERAPELLIDOIDTERCERO>",
    "<NUMCELULARPERSONA>3001234567</NUMCELULARPERSONA>",
    "<CODCATEGORIALICENCIACONDUCCION>C3</CODCATEGORIALICENCIACONDUCCION>",
    "<NUMLICENCIACONDUCCION>LC123</NUMLICENCIACONDUCCION>",
    "<FECHAVENCIMIENTOLICENCIA>31/12/2030</FECHAVENCIMIENTOLICENCIA>",
    "</documento>",
    "</root>"
  ].join("\n"));
  const parsedVehicle = parseXml([
    "<?xml version=\"1.0\" encoding=\"ISO-8859-1\" ?>",
    "<root>",
    "<documento>",
    "<NUMPLACA>ABC123</NUMPLACA>",
    "<CODCONFIGURACIONUNIDADCARGA>55</CODCONFIGURACIONUNIDADCARGA>",
    "<NUMIDPROPIETARIO>123456789</NUMIDPROPIETARIO>",
    "<NUMIDTENEDOR>123456789</NUMIDTENEDOR>",
    "<CAPACIDADUNIDADCARGA>34000</CAPACIDADUNIDADCARGA>",
    "<NUMSEGUROSOAT>SOAT123</NUMSEGUROSOAT>",
    "<FECHAVENCIMIENTOSOAT>31/12/2030</FECHAVENCIMIENTOSOAT>",
    "</documento>",
    "</root>"
  ].join("\n"));

  const driver = normalizeDriverMaster(parsedDriver, new Date("2026-06-25T00:00:00.000Z"));
  const vehicle = normalizeVehicleMaster(parsedVehicle, new Date("2026-06-25T00:00:00.000Z"));

  assert.equal(driver?.key, "C-123456789");
  assert.equal(driver?.fullName, "ANA MARIA PEREZ");
  assert.equal(driver?.readyForDocuments, true);
  assert.deepEqual(driver?.reviewReasons, []);
  assert.equal(vehicle?.key, "ABC123");
  assert.equal(vehicle?.readyForDocuments, true);
  assert.deepEqual(vehicle?.reviewReasons, []);
});

test("marks expired local master records for review", () => {
  const driver = normalizeDriverMaster(parseXml([
    "<root>",
    "<documento>",
    "<CODTIPOIDTERCERO>C</CODTIPOIDTERCERO>",
    "<NUMIDTERCERO>123456789</NUMIDTERCERO>",
    "<NOMIDTERCERO>ANA</NOMIDTERCERO>",
    "<FECHAVENCIMIENTOLICENCIA>24/06/2026</FECHAVENCIMIENTOLICENCIA>",
    "</documento>",
    "</root>"
  ].join("\n")), new Date("2026-06-25T00:00:00.000Z"));
  const vehicle = normalizeVehicleMaster(parseXml([
    "<root>",
    "<documento>",
    "<NUMPLACA>ABC123</NUMPLACA>",
    "<FECHAVENCIMIENTOSOAT>24/06/2026</FECHAVENCIMIENTOSOAT>",
    "</documento>",
    "</root>"
  ].join("\n")), new Date("2026-06-25T00:00:00.000Z"));

  assert.equal(driver?.readyForDocuments, false);
  assert.deepEqual(driver?.reviewReasons, ["license expired"]);
  assert.equal(vehicle?.readyForDocuments, false);
  assert.deepEqual(vehicle?.reviewReasons, ["SOAT expired"]);
});

test("normalizes owner third parties without requiring a driver license", () => {
  const parsedOwner = parseXml([
    "<root>",
    "<documento>",
    "<CODTIPOIDTERCERO>C</CODTIPOIDTERCERO>",
    "<NUMIDTERCERO>79277934</NUMIDTERCERO>",
    "<NOMIDTERCERO>PROPIETARIO REAL</NOMIDTERCERO>",
    "<PRIMERAPELLIDOIDTERCERO>RNDC</PRIMERAPELLIDOIDTERCERO>",
    "<NUMCELULARPERSONA>3001234567</NUMCELULARPERSONA>",
    "<CODMUNICIPIORNDC>11001000</CODMUNICIPIORNDC>",
    "</documento>",
    "</root>"
  ].join("\n"));
  const request = buildThirdPartyMasterQuery({ companyRndcNit: "9007736849", idType: "C", id: "79277934" });
  const owner = normalizeThirdPartyMaster(parsedOwner);

  assert.equal(request.tipo, 2);
  assert.equal(request.procesoId, 11);
  assert.equal(owner?.key, "C-79277934");
  assert.equal(owner?.fullName, "PROPIETARIO REAL RNDC");
  assert.equal(owner?.readyForDocuments, true);
  assert.deepEqual(owner?.reviewReasons, []);
});

test("stores owner and vehicle snapshots with owner match status", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-owner-vehicle-"));
  const owner = normalizeThirdPartyMaster(parseXml([
    "<root>",
    "<documento>",
    "<CODTIPOIDTERCERO>C</CODTIPOIDTERCERO>",
    "<NUMIDTERCERO>79277934</NUMIDTERCERO>",
    "<NOMIDTERCERO>PROPIETARIO REAL</NOMIDTERCERO>",
    "</documento>",
    "</root>"
  ].join("\n")));
  const vehicle = normalizeVehicleMaster(parseXml([
    "<root>",
    "<documento>",
    "<NUMPLACA>SZX910</NUMPLACA>",
    "<NUMIDPROPIETARIO>79277934</NUMIDPROPIETARIO>",
    "<NUMIDTENEDOR>79277934</NUMIDTENEDOR>",
    "<FECHAVENCIMIENTOSOAT>31/12/2030</FECHAVENCIMIENTOSOAT>",
    "</documento>",
    "</root>"
  ].join("\n")), new Date("2026-06-25T00:00:00.000Z"));

  const saved = await saveLocalOwnerVehicleSnapshot({
    storeDir: base,
    fetchedAt: "2026-06-25T12:00:00.000Z",
    owner,
    vehicle,
    ownerRequestXml: "<root><acceso><username>***</username><password>***</password></acceso></root>",
    vehicleRequestXml: "<root><acceso><username>***</username><password>***</password></acceso></root>",
    ownerResponseXml: "<root><documento><NUMIDTERCERO>79277934</NUMIDTERCERO></documento></root>",
    vehicleResponseXml: "<root><documento><NUMPLACA>SZX910</NUMPLACA></documento></root>"
  });

  assert.equal(saved.readyForDocuments, true);
  assert.equal(saved.ownerMatchesVehicle, true);
  assert.ok(existsSync(saved.ownerPath));
  assert.ok(existsSync(saved.vehiclePath));
  assert.ok(existsSync(saved.ownerVehiclePath));

  const stored = await readFile(saved.ownerVehiclePath, "utf8");
  assert.match(stored, /SZX910/);
  assert.match(stored, /79277934/);
  assert.match(stored, /ownerMatchesVehicle/);
  assert.doesNotMatch(stored, /PASSWORD1/);
});

test("stores local master snapshots without RNDC credentials", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-masters-"));
  const saved = await saveLocalMasterSnapshot({
    storeDir: base,
    fetchedAt: "2026-06-25T12:00:00.000Z",
    driver: {
      key: "C-123456789",
      idType: "C",
      id: "123456789",
      fullName: "ANA MARIA PEREZ",
      phone: "3001234567",
      cityCode: undefined,
      licenseCategory: "C3",
      licenseNumber: "LC123",
      licenseExpirationDate: "31/12/2030",
      readyForDocuments: true,
      reviewReasons: []
    },
    vehicle: {
      key: "ABC123",
      plate: "ABC123",
      configurationCode: "55",
      ownerId: "123456789",
      holderId: "123456789",
      capacityKg: 34000,
      soatNumber: "SOAT123",
      soatExpirationDate: "31/12/2030",
      readyForDocuments: true,
      reviewReasons: []
    },
    driverResponseXml: "<root><documento><NUMIDTERCERO>123456789</NUMIDTERCERO></documento></root>",
    vehicleResponseXml: "<root><documento><NUMPLACA>ABC123</NUMPLACA></documento></root>",
    driverRequestXml: "<root><acceso><username>***</username><password>***</password></acceso></root>",
    vehicleRequestXml: "<root><acceso><username>***</username><password>***</password></acceso></root>"
  });

  assert.equal(saved.readyForDocuments, true);
  assert.ok(existsSync(saved.pairPath));
  assert.ok(existsSync(saved.driverPath));
  assert.ok(existsSync(saved.vehiclePath));

  const stored = await readFile(saved.pairPath, "utf8");
  assert.match(stored, /ANA MARIA PEREZ/);
  assert.match(stored, /ABC123/);
  assert.match(stored, /<password>\*\*\*<\/password>/);
  assert.doesNotMatch(stored, /PASSWORD1/);
});

test("dry-run master queries return local records that can be saved", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-dry-run-masters-"));
  const config = loadConfig({
    outputDir: join(base, "runs"),
    localDataDir: join(base, "local"),
    username: "TEST_USER",
    password: "TEST_PASSWORD",
    companyRndcNit: "9007736849"
  });
  const client = new RndcClient(config);
  const driverResponse = await client.sendMessage(buildDriverMasterQuery({ companyRndcNit: config.companyRndcNit, idType: "C", id: "123456789" }));
  const vehicleResponse = await client.sendMessage(buildVehicleMasterQuery({ companyRndcNit: config.companyRndcNit, plate: "ABC123" }));
  const driver = normalizeDriverMaster(driverResponse.parsed, new Date("2026-06-25T00:00:00.000Z"));
  const vehicle = normalizeVehicleMaster(vehicleResponse.parsed, new Date("2026-06-25T00:00:00.000Z"));

  assert.equal(driverResponse.ok, true);
  assert.equal(vehicleResponse.ok, true);
  assert.equal(driver?.key, "C-123456789");
  assert.equal(vehicle?.key, "ABC123");
  assert.doesNotMatch(driverResponse.requestXml, /TEST_PASSWORD/);

  const saved = await saveLocalMasterSnapshot({
    storeDir: config.localDataDir,
    fetchedAt: "2026-06-25T12:00:00.000Z",
    driver,
    vehicle,
    driverRequestXml: driverResponse.requestXml,
    vehicleRequestXml: vehicleResponse.requestXml,
    driverResponseXml: driverResponse.rndcResponseXml,
    vehicleResponseXml: vehicleResponse.rndcResponseXml
  });

  assert.equal(saved.readyForDocuments, true);
  assert.ok(existsSync(saved.pairPath));
});

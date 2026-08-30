import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDriverSyncPayload,
  buildPartySyncPayloads,
  buildVehicleSyncPayload,
  isMasterSyncStale,
  masterSyncSummary,
  rndcIdType,
  splitPersonName
} from "./masterSync";

test("imported masters count as registered until they are edited", () => {
  assert.equal(masterSyncSummary({ source: "rndc-maestro" }).state, "registered");
  assert.equal(masterSyncSummary({ rndcRegisteredAt: "2024-03-01" }).state, "registered");
  assert.equal(masterSyncSummary({ source: "manual" }).state, "pending");
  assert.equal(masterSyncSummary(null).state, "pending");
  const rejected = masterSyncSummary({ source: "rndc-maestro", rndcSync: { state: "rejected", updatedAt: 10, error: "MAN014" } });
  assert.equal(rejected.state, "rejected");
  assert.equal(rejected.error, "MAN014");
});

test("a registered master edited later becomes stale", () => {
  assert.equal(isMasterSyncStale({ rndcSync: { state: "registered", updatedAt: 5, version: 5 }, updatedAt: 5 }), false);
  assert.equal(isMasterSyncStale({ rndcSync: { state: "registered", updatedAt: 5, version: 5 }, updatedAt: 9 }), true);
  assert.equal(isMasterSyncStale({ rndcSync: { state: "pending", updatedAt: 5 }, updatedAt: 5 }), true);
});

test("document types map to RNDC codes", () => {
  assert.equal(rndcIdType("CC", "conductor"), "C");
  assert.equal(rndcIdType("nit", "tercero"), "N");
  assert.equal(rndcIdType("C", "conductor"), "C");
  assert.throws(() => rndcIdType("TI", "conductor"), /no es válido/);
  assert.throws(() => rndcIdType(undefined, "conductor"), /obligatorio/);
});

test("person names split into RNDC name parts", () => {
  assert.deepEqual(splitPersonName({ firstNames: "JUAN CARLOS", firstLastName: "PEREZ", secondLastName: "GOMEZ" }, "conductor"), { firstName: "JUAN CARLOS", firstLastName: "PEREZ", secondLastName: "GOMEZ" });
  assert.deepEqual(splitPersonName({ name: "JUAN CARLOS PEREZ GOMEZ" }, "conductor"), { firstName: "JUAN CARLOS", firstLastName: "PEREZ", secondLastName: "GOMEZ" });
  assert.deepEqual(splitPersonName({ name: "JUAN PEREZ" }, "conductor"), { firstName: "JUAN", firstLastName: "PEREZ", secondLastName: undefined });
});

test("driver payload requires the RNDC mandatory fields", () => {
  const payload = buildDriverSyncPayload({
    documentType: "CC",
    document: "80756632",
    name: "JUAN PEREZ",
    cellphone: "3001234567",
    address: "CALLE 1",
    cityCode: "11001000",
    licenseCategory: "C2",
    licenseNumber: "80756632",
    licenseExpiresAt: "2027-01-01"
  });
  assert.equal(payload.driver.idType, "C");
  assert.equal(payload.driver.firstName, "JUAN");
  assert.equal(payload.driver.licenseCategory, "C2");
  assert.throws(() => buildDriverSyncPayload({ documentType: "CC", document: "1", name: "X Y", address: "A", cityCode: "1", licenseCategory: "C2", licenseNumber: "1", licenseExpiresAt: "2027-01-01" }), /teléfono del conductor/);
});

test("vehicle payload converts tons to kilograms and validates codes", () => {
  const party = { documentType: "NIT", document: "900123456", name: "TRANSPORTES SA", personType: "legal" as const, phone: "6011234567", address: "CRA 2", cityCode: "11001000" };
  const payload = buildVehicleSyncPayload({
    plate: "swm776",
    rndcConfigurationCode: "3",
    rndcMakeCode: "123",
    rndcBodyTypeCode: "4",
    rndcFuelCode: "1",
    line: "555",
    modelYear: "2018",
    emptyWeightTn: "8.5",
    capacityTn: "17",
    color: "12",
    insurerNit: "860002400",
    soatExpiresAt: "2027-01-01",
    soatNumber: "SOAT1"
  }, party, party);
  assert.equal(payload.vehicle.plate, "SWM776");
  assert.equal(payload.vehicle.emptyWeightKg, 8500);
  assert.equal(payload.vehicle.capacityKg, 17000);
  assert.equal(payload.vehicleOwner.idType, "N");
  assert.equal(payload.vehicleOwner.firstName, "TRANSPORTES SA");
  assert.throws(() => buildVehicleSyncPayload({ plate: "AAA111", rndcConfigurationCode: "3X" }, party, party), /configuración RNDC/);
});

test("party payload emits one message per site", () => {
  const party = { documentType: "NIT", document: "890100756", name: "ITALCOL S.A", personType: "legal" as const, phone: "6051234567", address: "VIA 40", cityCode: "08001000" };
  const single = buildPartySyncPayloads(party, []);
  assert.equal(single.length, 1);
  assert.equal(single[0].payload.sender.siteCode, "0");
  assert.equal(single[0].payload.sender.idType, "N");
  const multi = buildPartySyncPayloads(party, [
    { siteCode: "1", siteName: "PLANTA", address: "KM 3", cityCode: "08001000" },
    { siteCode: "2", siteName: "BODEGA", latitude: "10.9", longitude: "-74.8" }
  ]);
  assert.deepEqual(multi.map((entry) => entry.siteCode), ["1", "2"]);
  assert.equal(multi[1].payload.sender.address, "VIA 40");
  assert.equal(multi[1].payload.sender.latitude, "10.9");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMasterRegistrationPayload,
  normalizeDriverInput,
  normalizeThirdPartyInput,
  normalizeVehicleInput
} from "./masterData.js";

test("normalizes master identifiers without losing leading zeroes", () => {
  assert.deepEqual(normalizeThirdPartyInput({
    documentType: " C ",
    document: " 0012345678 ",
    name: "  Ana Torres  ",
    roles: ["owner", "owner", "possessor"]
  }), {
    documentType: "C",
    document: "0012345678",
    name: "Ana Torres",
    roles: ["owner", "possessor"]
  });
});

test("requires the RNDC identity and license fields for a driver", () => {
  assert.throws(() => normalizeDriverInput({ documentType: "C", document: "123" }), /nombre/i);
  assert.throws(() => normalizeDriverInput({ documentType: "C", document: "123", name: "Ana" }), /licencia/i);
});

test("normalizes a vehicle plate and keeps owner and possessor separate", () => {
  assert.deepEqual(normalizeVehicleInput({
    plate: " sto172 ",
    modelYear: " 2024 ",
    ownerDocument: "9001",
    possessorDocument: "9002",
    capacityTn: "12.5",
    emptyWeightTn: "8"
  }), {
    plate: "STO172",
    modelYear: "2024",
    ownerDocument: "9001",
    possessorDocument: "9002",
    capacityTn: "12.5",
    emptyWeightTn: "8"
  });
});

test("builds the RNDC registration only from persisted master records", () => {
  const payload = buildMasterRegistrationPayload({
    driver: {
      documentType: "C",
      document: "1001",
      name: "ANA MARIA TORRES",
      phone: "3000000000",
      address: "CALLE 1",
      cityCode: "11001000",
      licenseCategory: "C2",
      licenseNumber: "LIC-1",
      licenseExpiresAt: "2030-01-01"
    },
    owner: { documentType: "N", document: "9001", name: "TRANSPORTES UNO", phone: "6010000000", address: "CALLE 2", cityCode: "11001000" },
    possessor: { documentType: "C", document: "9002", name: "PEDRO PEREZ", phone: "3000000001", address: "CALLE 3", cityCode: "11001000" },
    vehicle: {
      plate: "STO172",
      configuration: "2",
      line: "1",
      modelYear: "2024",
      emptyWeightTn: "8",
      capacityTn: "12.5",
      color: "1",
      insurerNit: "9003",
      soatExpiresAt: "2030-02-01",
      soatNumber: "SOAT-1"
    }
  });

  assert.equal(payload.driver.id, "1001");
  assert.equal(payload.driver.firstName, "ANA MARIA");
  assert.equal(payload.driver.firstLastName, "TORRES");
  assert.equal(payload.vehicleOwner.id, "9001");
  assert.equal(payload.vehicleHolder.id, "9002");
  assert.equal(payload.vehicle.plate, "STO172");
  assert.equal(payload.vehicle.emptyWeightKg, 8000);
  assert.equal(payload.vehicle.capacityKg, 12500);
});

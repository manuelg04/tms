import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMasterRegistrationPayload,
  deriveDriverThirdPartyRoles,
  normalizeDriverInput,
  normalizeDriverMasterInput,
  normalizeThirdPartyMasterInput,
  normalizeThirdPartyInput,
  normalizeTrailerMasterInput,
  normalizeVehicleMasterInput,
  normalizeVehicleInput
} from "./masterData.js";
import type {
  DriverMasterInput,
  ThirdPartyMasterInput,
  TrailerMasterInput,
  VehicleMasterInput
} from "./masterData.js";

test("canonicalizes formatted numeric identifiers without losing leading zeroes", () => {
  assert.deepEqual(normalizeThirdPartyInput({
    documentType: " C ",
    document: " 00.123-456 78 ",
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
    ownerDocument: " 900.1 ",
    possessorDocument: " 9-002 ",
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
      rndcConfigurationCode: "54",
      rndcMakeCode: "169",
      rndcBodyTypeCode: "285",
      rndcFuelCode: "1",
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
  assert.equal(payload.vehicle.rndcConfigurationCode, "54");
  assert.equal(payload.vehicle.rndcMakeCode, "169");
  assert.equal(payload.vehicle.rndcBodyTypeCode, "285");
  assert.equal(payload.vehicle.rndcFuelCode, "1");
  assert.equal(payload.vehicle.emptyWeightKg, 8000);
  assert.equal(payload.vehicle.capacityKg, 12500);
});

test("normalizes a structured driver name and required operational fields", () => {
  const input: DriverMasterInput = {
    documentType: " c ",
    document: " 00.123-456 78 ",
    firstNames: " Ana Maria ",
    firstLastName: " Torres ",
    secondLastName: " Ruiz ",
    address: " Calle 1 ",
    cityCode: " 11001000 ",
    cellphone: " 3001234567 ",
    licenseCategory: " c2 ",
    licenseNumber: " LIC-001 ",
    licenseExpiresAt: "2030-01-31"
  };

  assert.deepEqual(normalizeDriverMasterInput(input), {
    documentType: "C",
    document: "0012345678",
    firstNames: "Ana Maria",
    firstLastName: "Torres",
    secondLastName: "Ruiz",
    name: "Ana Maria Torres Ruiz",
    address: "Calle 1",
    cityCode: "11001000",
    cellphone: "3001234567",
    licenseCategory: "C2",
    licenseNumber: "LIC-001",
    licenseExpiresAt: "2030-01-31"
  });
});

test("rejects a driver without the required identity, contact, location, or license core", () => {
  const valid: DriverMasterInput = {
    documentType: "C",
    document: "12345678",
    firstNames: "Ana",
    firstLastName: "Torres",
    address: "Calle 1",
    cityCode: "11001000",
    cellphone: "3001234567",
    licenseCategory: "C2",
    licenseNumber: "LIC-001",
    licenseExpiresAt: "2030-01-31"
  };

  assert.throws(() => normalizeDriverMasterInput({ ...valid, firstLastName: "" }), /primer apellido/i);
  assert.throws(() => normalizeDriverMasterInput({ ...valid, cellphone: "" }), /celular/i);
  assert.throws(() => normalizeDriverMasterInput({ ...valid, cityCode: "" }), /municipio|ciudad/i);
  assert.throws(() => normalizeDriverMasterInput({ ...valid, licenseExpiresAt: "" }), /vencimiento.*licencia/i);
});

test("derives driver activities without erasing existing third-party roles", () => {
  const roles = deriveDriverThirdPartyRoles(["sender", "employee"], {
    owner: true,
    possessor: true,
    employee: true
  });

  assert.deepEqual(new Set(roles), new Set(["sender", "employee", "driver", "owner", "possessor"]));
  assert.equal(roles.length, 5);
});

test("derives the canonical name for a natural third party", () => {
  const input: ThirdPartyMasterInput = {
    personType: "natural",
    documentType: " c ",
    document: " 00.123-456 78 ",
    firstNames: " Laura Marcela ",
    firstLastName: " Gomez ",
    secondLastName: " Diaz ",
    roles: ["owner", "owner", "recipient"]
  };

  assert.deepEqual(normalizeThirdPartyMasterInput(input), {
    personType: "natural",
    documentType: "C",
    document: "0012345678",
    firstNames: "Laura Marcela",
    firstLastName: "Gomez",
    secondLastName: "Diaz",
    name: "Laura Marcela Gomez Diaz",
    roles: ["owner", "recipient"]
  });
});

test("keeps letters while canonicalizing a passport identifier", () => {
  const input: ThirdPartyMasterInput = {
    personType: "natural",
    documentType: " p ",
    document: " pa-12 34.a ",
    firstNames: "Laura",
    firstLastName: "Gomez",
    roles: ["owner"]
  };

  assert.equal(normalizeThirdPartyMasterInput(input).document, "PA1234A");
});

test("normalizes a legal NIT and validates its Colombian verification digit", () => {
  const input: ThirdPartyMasterInput = {
    personType: "legal",
    documentType: " n ",
    document: " 860.009.578-6 ",
    verificationDigit: " 6 ",
    legalName: " Transportes MTM SAS ",
    abbreviation: " MTM ",
    roles: ["transport_company", "commercial", "transport_company"]
  };

  assert.deepEqual(normalizeThirdPartyMasterInput(input), {
    personType: "legal",
    documentType: "N",
    document: "8600095786",
    verificationDigit: "6",
    legalName: "Transportes MTM SAS",
    abbreviation: "MTM",
    name: "Transportes MTM SAS",
    roles: ["transport_company", "commercial"]
  });
});

test("does not mistake a valid NIT base ending in its verification digit for an appended digit", () => {
  const normalized = normalizeThirdPartyMasterInput({
    personType: "legal",
    documentType: "N",
    document: "100000053",
    verificationDigit: "3",
    legalName: "Empresa de Prueba SAS",
    roles: ["transport_company"]
  });

  assert.equal(normalized.document, "1000000533");
});

test("rejects an invalid legal verification digit", () => {
  const input: ThirdPartyMasterInput = {
    personType: "legal",
    documentType: "N",
    document: "900123456",
    verificationDigit: "12",
    legalName: "Transportes MTM SAS",
    roles: ["transport_company"]
  };

  assert.throws(() => normalizeThirdPartyMasterInput(input), /digito de verificacion|d.gito de verificaci.n/i);
});

test("rejects a legal NIT when its verification digit does not match", () => {
  const input: ThirdPartyMasterInput = {
    personType: "legal",
    documentType: "NIT",
    document: "860.009.578",
    verificationDigit: "7",
    legalName: "Seguros de Prueba SAS",
    roles: ["insurance_company"]
  };

  assert.throws(() => normalizeThirdPartyMasterInput(input), /digito de verificacion.*no corresponde/i);
});

test("normalizes a trailer plate and positive weights and dimensions", () => {
  const input: TrailerMasterInput = {
    plate: " r00123 ",
    trailerType: "SEMIRREMOLQUE",
    configuration: "3S2",
    capacityKg: 34000,
    emptyWeightKg: 8500,
    widthM: 2.6,
    heightM: 4.1,
    lengthM: 13.5,
    status: "available"
  };

  assert.deepEqual(normalizeTrailerMasterInput(input), {
    plate: "R00123",
    trailerType: "SEMIRREMOLQUE",
    configuration: "3S2",
    capacityKg: 34000,
    emptyWeightKg: 8500,
    widthM: 2.6,
    heightM: 4.1,
    lengthM: 13.5,
    status: "available"
  });
});

test("rejects non-positive trailer weights and dimensions", () => {
  const valid: TrailerMasterInput = {
    plate: "R00123",
    capacityKg: 34000,
    emptyWeightKg: 8500,
    widthM: 2.6,
    heightM: 4.1,
    lengthM: 13.5,
    status: "available"
  };

  assert.throws(() => normalizeTrailerMasterInput({ ...valid, capacityKg: 0 }), /capacidad.*mayor que cero/i);
  assert.throws(() => normalizeTrailerMasterInput({ ...valid, emptyWeightKg: -1 }), /peso.*mayor que cero/i);
  assert.throws(() => normalizeTrailerMasterInput({ ...valid, widthM: 0 }), /ancho.*mayor que cero/i);
});

test("requires the RNDC R plus five digits pattern for trailer plates", () => {
  const valid: TrailerMasterInput = {
    plate: "R00123",
    capacityKg: 34000,
    emptyWeightKg: 8500,
    widthM: 2.6,
    heightM: 4.1,
    lengthM: 13.5,
    status: "available"
  };

  assert.throws(() => normalizeTrailerMasterInput({ ...valid, plate: "TRL001" }), /placa.*remolque/i);
  assert.throws(() => normalizeTrailerMasterInput({ ...valid, plate: "R1234A" }), /placa.*remolque/i);
});

test("normalizes a vehicle plate, date, and positive weights", () => {
  const input: VehicleMasterInput = {
    plate: " sto172 ",
    modelYear: "2024",
    emptyWeightTn: "8.00",
    capacityTn: "12.5",
    soatExpiresAt: "2030-02-01"
  };

  assert.deepEqual(normalizeVehicleMasterInput(input), {
    plate: "STO172",
    modelYear: "2024",
    emptyWeightTn: "8",
    capacityTn: "12.5",
    soatExpiresAt: "2030-02-01"
  });
});

test("rejects an invalid vehicle plate, calendar date, or weight", () => {
  const valid: VehicleMasterInput = {
    plate: "STO172",
    emptyWeightTn: "8",
    capacityTn: "12.5",
    soatExpiresAt: "2030-02-01"
  };

  assert.throws(() => normalizeVehicleMasterInput({ ...valid, plate: "S*1" }), /placa/i);
  assert.throws(() => normalizeVehicleMasterInput({ ...valid, plate: "ST0172" }), /placa/i);
  assert.throws(() => normalizeVehicleInput({ plate: "ST0172" }), /placa/i);
  assert.throws(() => normalizeVehicleMasterInput({ ...valid, soatExpiresAt: "2030-02-31" }), /fecha|soat/i);
  assert.throws(() => normalizeVehicleMasterInput({ ...valid, emptyWeightTn: "0" }), /peso.*mayor que cero/i);
  assert.throws(() => normalizeVehicleMasterInput({ ...valid, capacityTn: "-1" }), /capacidad.*mayor que cero/i);
});

test("never returns a plaintext GPS password from vehicle normalization", () => {
  const input: VehicleMasterInput = {
    plate: "STO172",
    emptyWeightTn: "8",
    capacityTn: "12.5",
    soatExpiresAt: "2030-02-01",
    gpsOperator: "SATRACK",
    gpsUsername: " operador-1 ",
    gpsPassword: "secreto-no-persistir"
  };

  const normalized = normalizeVehicleMasterInput(input);

  assert.equal(normalized.gpsOperator, "SATRACK");
  assert.equal(normalized.gpsUsername, "operador-1");
  assert.equal("gpsPassword" in normalized, false);
});

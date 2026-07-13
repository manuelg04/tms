import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExportRows,
  maskIdentifier,
  type DispatchExportRecord
} from "./exportSchemas.js";

const record: DispatchExportRecord = {
  dispatchCode: "EXP-0007",
  updatedAt: Date.UTC(2026, 6, 10, 15, 30),
  customerName: "Cliente Uno",
  originCity: "Bogotá",
  destinationCity: "Cali",
  agencyCode: "001",
  order: {
    number: "00001234",
    issuedAt: "2026-07-10",
    vehiclePlate: "ABC012",
    agencyCity: "Bogotá",
    senderName: "Remitente",
    cargoDescription: "Café",
    localStatus: "Autorizado",
    printStatus: "Impreso",
    createdAt: "2026-07-10",
    annulledAt: ""
  },
  consignments: [{
    number: "00004567",
    reference: "00000009",
    rndcNumber: "00007777",
    orderNumber: "00001234",
    pickupAppointment: "2026-07-10 08:00",
    deliveryAppointment: "2026-07-11 10:00",
    quantity: "10",
    weightKg: "2500",
    declaredValue: "15000000",
    insurancePolicy: "POL-001",
    localStatus: "Autorizada",
    printStatus: "Sin imprimir",
    loadingRadicado: "00009991",
    unloadingRadicado: "00009992",
    driverDocument: "0012345678",
    driverPhone: "3001234567"
  }],
  manifest: {
    internalNumber: "00000088",
    rndcNumber: "00000099",
    type: "General",
    issuedAt: "2026-07-10",
    dueAt: "2026-07-18",
    route: "Bogotá → Cali",
    originCode: "11001",
    destinationCode: "76001",
    vehiclePlate: "ABC012",
    trailerPlate: "R12345",
    consignmentNumbers: ["00004567"],
    freight: "3200000",
    advance: "1000000",
    netPay: "2200000",
    localStatus: "Autorizado",
    printStatus: "Impreso",
    filingNumber: "0000123456",
    annulmentNumber: "",
    fulfillmentNumber: "0000456789",
    driverDocument: "0012345678",
    driverPhone: "3001234567",
    driverLicense: "000998877",
    vehicleSoat: "000112233"
  }
};

test("keeps document numbers and leading zeroes as strings", () => {
  const [row] = buildExportRows("orders", [record], "admin");

  assert.equal(row["Número orden"], "00001234");
  assert.equal(typeof row["Número orden"], "string");
  assert.equal(row["Placa"], "ABC012");
  assert.equal(row["Fecha orden"], "2026-07-10");
});

test("exports one row per consignment in the same dispatch order", () => {
  const second = { ...record, dispatchCode: "EXP-0008", updatedAt: record.updatedAt - 1_000 };
  const rows = buildExportRows("consignments", [second, record], "admin");

  assert.deepEqual(rows.map((row) => row["Expediente"]), ["EXP-0008", "EXP-0007"]);
  assert.deepEqual(rows.map((row) => row["Número remesa"]), ["00004567", "00004567"]);
});

test("applies personal-data policy by role on the server export", () => {
  const admin = buildExportRows("manifests", [record], "admin")[0];
  const auditor = buildExportRows("manifests", [record], "auditor")[0];
  const operator = buildExportRows("manifests", [record], "operator")[0];

  assert.equal(admin["Documento conductor"], "0012345678");
  assert.equal(auditor["Documento conductor"], "******5678");
  assert.equal(auditor["Teléfono conductor"], "******4567");
  assert.equal(operator["Documento conductor"], undefined);
  assert.equal(operator["Licencia conductor"], undefined);
  assert.equal(operator["SOAT vehículo"], undefined);
});

test("masks short and long identifiers without exposing their prefix", () => {
  assert.equal(maskIdentifier("1234567890"), "******7890");
  assert.equal(maskIdentifier("123"), "***");
  assert.equal(maskIdentifier(""), "");
});

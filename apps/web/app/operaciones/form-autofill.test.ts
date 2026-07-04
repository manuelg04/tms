import test from "node:test";
import assert from "node:assert/strict";
import { tonsToKg, vehiclePatches, driverPatches, applyPatches } from "./form-autofill";
import { initialForm } from "./operations-config";
import { readPath } from "./form-state";

test("tonsToKg convierte toneladas a kg", () => {
  assert.equal(tonsToKg("34"), "34000");
  assert.equal(tonsToKg("7.5"), "7500");
  assert.equal(tonsToKg(undefined), "");
  assert.equal(tonsToKg("N/A"), "");
});

test("vehiclePatches mapea detalle Convex a paths del formulario", () => {
  const patches = vehiclePatches({
    plate: "XYZ789",
    make: "KENWORTH",
    modelYear: "2019",
    configuration: "2S3",
    trailer: "S12345",
    capacityTn: "35",
    emptyWeightTn: "8",
    ownerDocument: "123",
    ownerName: "PEPE PEREZ",
    ownerCellphone: "3001112233",
    possessorDocument: "456",
    possessorName: "ANA GOMEZ"
  });
  const map = Object.fromEntries(patches);
  assert.equal(map["vehicle.plate"], "XYZ789");
  assert.equal(map["vehicle.brand"], "KENWORTH");
  assert.equal(map["vehicle.trailerPlate"], "S12345");
  assert.equal(map["vehicle.configuration"], "2S3");
  assert.equal(map["vehicle.modelYear"], "2019");
  assert.equal(map["vehicle.capacityKg"], "35000");
  assert.equal(map["vehicle.emptyWeightKg"], "8000");
  assert.equal(map["vehicleOwner.id"], "123");
  assert.equal(map["vehicleOwner.fullName"], "PEPE PEREZ");
  assert.equal(map["vehicleOwner.phone"], "3001112233");
  assert.equal(map["vehicleHolder.id"], "456");
  assert.equal(map["vehicleHolder.fullName"], "ANA GOMEZ");
});

test("vehiclePatches omite campos vacios (no pisa lo digitado)", () => {
  const patches = vehiclePatches({ plate: "XYZ789" });
  const paths = patches.map(([path]) => path);
  assert.ok(!paths.includes("vehicle.brand"));
  assert.ok(!paths.includes("vehicleOwner.id"));
});

test("driverPatches mapea conductor", () => {
  const map = Object.fromEntries(
    driverPatches({
      document: "999888",
      name: "ROJAS PINTO CARLOS",
      cellphone: "3109998877",
      city: "PAIPA - Boyaca",
      address: "CL 1 2-3",
      licenseNumber: "999888",
      licenseCategory: "C2",
      licenseExpiresAt: "01/01/2030"
    })
  );
  assert.equal(map["driver.id"], "999888");
  assert.equal(map["driver.fullName"], "ROJAS PINTO CARLOS");
  assert.equal(map["driver.phone"], "3109998877");
  assert.equal(map["driver.cityName"], "PAIPA - Boyaca");
  assert.equal(map["driver.licenseNumber"], "999888");
  assert.equal(map["driver.licenseCategory"], "C2");
  assert.equal(map["driver.licenseExpirationDate"], "01/01/2030");
});

test("applyPatches aplica en orden sobre el form", () => {
  const next = applyPatches(initialForm, [["vehicle.plate", "XYZ789"], ["vehicle.brand", "KENWORTH"]]);
  assert.equal(readPath(next, "vehicle.plate"), "XYZ789");
  assert.equal(readPath(next, "vehicle.brand"), "KENWORTH");
  assert.equal(readPath(initialForm, "vehicle.plate"), "JVK276");
});

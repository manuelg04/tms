import test from "node:test";
import assert from "node:assert/strict";
import { initialForm, operations } from "./operations-config";

const legacyInitialForm = {
  seed: "421960041464",
  cargoNumber: "000044579",
  tripNumber: "IV42196",
  remesaNumber: "42196",
  manifestNumber: "0041464",
  expeditionDate: "22/06/2026",
  loadingAppointmentDate: "22/06/2026",
  loadingAppointmentTime: "11:02",
  unloadingAppointmentDate: "25/06/2026",
  unloadingAppointmentTime: "12:06",
  balancePaymentDate: "30/06/2026",
  observations: "CARGAMENTO ENTREGADO EN BUEN ESTADO Y COMPLETO",
  driver: {
    idType: "C",
    id: "80756632",
    firstName: "LUIS GERMAN",
    firstLastName: "FONSECA",
    secondLastName: "GUTIERREZ",
    fullName: "FONSECA GUTIERREZ LUIS GERMAN",
    phone: "3118980752",
    address: "CALLE 19 22 - 26",
    cityName: "PAIPA - Boyaca",
    cityCode: "15516000",
    licenseCategory: "C3",
    licenseNumber: "80756632",
    licenseExpirationDate: "23/06/2028"
  },
  vehicleOwner: {
    idType: "C",
    id: "74322799",
    firstName: "GONZALO",
    firstLastName: "FONSECA",
    secondLastName: "",
    fullName: "FONSECA GONZALO",
    phone: "7852586",
    address: "CL 19 22 - 26",
    cityName: "PAIPA - Boyaca",
    cityCode: "15516000"
  },
  vehicleHolder: {
    idType: "C",
    id: "74322799",
    firstName: "GONZALO",
    firstLastName: "FONSECA",
    secondLastName: "",
    fullName: "FONSECA GONZALO",
    phone: "7852586",
    address: "CL 19 22 - 26",
    cityName: "PAIPA - Boyaca",
    cityCode: "15516000"
  },
  sender: {
    idType: "N",
    id: "9002266843",
    siteCode: "0",
    siteName: "LANDAZURI",
    name: "C.I BULKTRADIN - LANDAZURI",
    address: "LANDAZURI",
    cityName: "LANDAZURI",
    cityCode: "68385000",
    latitude: "6.316071",
    longitude: "-73.949992"
  },
  recipient: {
    idType: "N",
    id: "9002266843",
    siteCode: "1",
    siteName: "MINGUEO",
    name: "C.I BULKTRADIN-MINGUEO",
    address: "MINGUEO",
    cityName: "MINGUEO",
    cityCode: "44090003",
    latitude: "11.2171951",
    longitude: "-73.3983323"
  },
  vehicle: {
    plate: "JVK276",
    trailerPlate: "R41537",
    brand: "FREIGHTLINER",
    configuration: "3S2",
    rndcConfigurationCode: "55",
    lineCode: "373",
    colorCode: "1",
    modelYear: "2020",
    emptyWeightKg: 7000,
    capacityKg: 34000,
    soatNumber: "4356454300",
    soatExpirationDate: "23/03/2027",
    insurerNit: "8110191907"
  },
  cargo: {
    productName: "CARBON",
    shortDescription: "CARBON",
    merchandiseCode: "002803",
    packageName: "Granel Solido",
    packageCode: "10",
    nature: "Carga Normal",
    natureCode: "1",
    quantityKg: 34000,
    declaredValue: 40000000
  },
  money: {
    freightValue: 4760000,
    advanceValue: 3808000,
    sourceRetention: 0,
    icaRetention: 0,
    icaRetentionPerMille: 3,
    fopatRetention: 4760
  },
  compliance: {
    remesaType: "C",
    manifestType: "C",
    remesaSuspensionReason: "",
    manifestSuspensionReason: "",
    suspensionConsequence: "",
    loadedQuantityKg: 34000,
    deliveredQuantityKg: 34000,
    unitCode: 1,
    loadingArrivalDate: "22/06/2026",
    loadingArrivalTime: "11:02",
    loadingEntryDate: "22/06/2026",
    loadingEntryTime: "11:32",
    loadingExitDate: "22/06/2026",
    loadingExitTime: "12:02",
    unloadingArrivalDate: "25/06/2026",
    unloadingArrivalTime: "12:06",
    unloadingEntryDate: "25/06/2026",
    unloadingEntryTime: "12:36",
    unloadingExitDate: "25/06/2026",
    unloadingExitTime: "14:06",
    documentsDeliveryDate: "30/06/2026",
    additionalLoadHoursValue: 0,
    additionalUnloadHoursValue: 0,
    additionalFreightValue: 0,
    additionalValueReason: "",
    freightDiscountValue: 0,
    discountReason: "",
    overAdvanceValue: 0,
    observations: "CARGAMENTO ENTREGADO EN BUEN ESTADO Y COMPLETO"
  }
};

test("initialForm conserva el payload legacy y agrega compliance para cumplidos", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(initialForm)), legacyInitialForm);
});

test("las operaciones siguen el flujo RNDC operativo", () => {
  assert.deepEqual(
    operations.map((o) => o.id),
    ["loading-order", "remesa", "manifest", "fulfill-remesa", "fulfill-manifest", "driver-vehicle"]
  );
});

test("las configuraciones de cumplidos exponen campos requeridos clave", () => {
  const fulfillRemesa = operations.find((operation) => operation.id === "fulfill-remesa");
  const fulfillManifest = operations.find((operation) => operation.id === "fulfill-manifest");

  assert.equal(fulfillRemesa?.label, "Cumplir remesa");
  assert.equal(fulfillRemesa?.processIds, "Proceso 5");
  assert.ok(fulfillRemesa?.sections.flatMap((section) => section.fields).some((field) => field.path === "manifestNumber" && field.required));
  assert.ok(fulfillRemesa?.sections.flatMap((section) => section.fields).some((field) => field.path === "compliance.remesaType" && field.required));
  assert.ok(fulfillRemesa?.sections.flatMap((section) => section.fields).some((field) => field.path === "compliance.loadedQuantityKg" && field.required));
  assert.ok(fulfillRemesa?.sections.flatMap((section) => section.fields).some((field) => field.path === "compliance.unloadingExitTime" && field.required));

  assert.equal(fulfillManifest?.label, "Cumplir manifiesto");
  assert.equal(fulfillManifest?.processIds, "Proceso 6");
  assert.ok(fulfillManifest?.sections.flatMap((section) => section.fields).some((field) => field.path === "manifestNumber" && field.required));
  assert.ok(fulfillManifest?.sections.flatMap((section) => section.fields).some((field) => field.path === "compliance.manifestType" && field.required));
  assert.ok(fulfillManifest?.sections.flatMap((section) => section.fields).some((field) => field.path === "compliance.documentsDeliveryDate" && field.required));
  assert.ok(fulfillManifest?.sections.flatMap((section) => section.fields).some((field) => field.path === "compliance.discountReason"));
});

test("todo path de campo existe en initialForm", () => {
  for (const op of operations) {
    for (const section of op.sections) {
      for (const f of section.fields) {
        let cursor: unknown = initialForm;
        for (const part of f.path.split(".")) {
          assert.ok(typeof cursor === "object" && cursor !== null && part in (cursor as object), `path roto: ${f.path}`);
          cursor = (cursor as Record<string, unknown>)[part];
        }
      }
    }
  }
});

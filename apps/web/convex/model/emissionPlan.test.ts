import test from "node:test";
import assert from "node:assert/strict";
import { buildEmissionPlan, type EmissionPlanInput } from "./emissionPlan";

const orderSnapshot = {
  orderNumber: "0000001",
  agencyCode: "BOG",
  customerId: "cust1",
  sender: {
    name: "ITALCOL S.A",
    identificationType: "NIT",
    identificationNumber: "890100756",
    municipalityCode: "08001000",
    siteCode: "01"
  },
  recipient: {
    name: "GRANJA LA ESPERANZA",
    identificationType: "C.C",
    identificationNumber: "900222333",
    municipalityCode: "68307000",
    siteCode: "01"
  },
  loading: { address: "VIA 40 850", cityName: "BARRANQUILLA", municipalityCode: "08001000", appointmentAt: 1783700000000 },
  unloading: { address: "KM 4", cityName: "GIRON", municipalityCode: "68307000", appointmentAt: 1783790000000 },
  cargoDescription: "MAIZ",
  weightTons: "34",
  packagingCode: "0",
  merchandiseCode: "005229",
  natureOfCargo: "1"
};

const consignmentSnapshot = {
  consignmentClass: "terrestre_carga" as const,
  declaredValue: "58000000",
  sender: orderSnapshot.sender,
  recipient: orderSnapshot.recipient,
  loading: orderSnapshot.loading,
  unloading: orderSnapshot.unloading,
  remissions: [{ quantity: "12000", description: "MAIZ", weightTons: "34", packagingClass: "0" }],
  packagingCode: "0",
  merchandiseCode: "005229",
  natureOfCargo: "1",
  policyNumber: "AB002905",
  policyExpiresOn: "2027-04-09",
  insurerNit: "860002400",
  number: "00001",
  sequence: 1
};

const manifestSnapshot = {
  manifestNumber: "0000001",
  issueDate: "2026-07-10",
  estimatedDeliveryDate: "2026-07-14",
  operationScope: "intermunicipal" as const,
  manifestType: "GENERAL",
  freightTotal: "3500000",
  advance: "1500000",
  withholdingIca: "0",
  paymentDate: "2026-07-20",
  paymentResponsible: "EMPRESA"
};

const assignmentSnapshot = {
  driver: { document: "71851149", documentType: "C.C", name: "ZOILO ANDRES MAZO" },
  secondDriver: null,
  vehicle: {
    plate: "STO172",
    trailer: "R80508",
    possessorDocument: "1002329298",
    possessorName: "AVILA CHAVEZ MARIA FERNANDA"
  },
  trailer: null
};

function baseInput(overrides: Partial<EmissionPlanInput> = {}): EmissionPlanInput {
  return {
    order: { number: "0000001", snapshot: orderSnapshot, officialState: "draft" },
    consignments: [
      { remesaId: "rem1", number: "00001", snapshot: consignmentSnapshot, officialState: "draft" }
    ],
    manifest: { number: "0000001", snapshot: manifestSnapshot, officialState: "draft" },
    assignment: assignmentSnapshot,
    tripNumber: "0000001",
    tripEmitted: false,
    operationsInFlight: [],
    ...overrides
  };
}

test("a fresh dispatch plans cargo, consignments, trip and manifest in order", () => {
  const plan = buildEmissionPlan(baseInput());

  assert.equal(plan.ok, true);
  assert.deepEqual(
    plan.ok ? plan.steps.map((step) => step.action) : [],
    ["emit_loading_order", "emit_remesa", "register_trip", "issue_manifest"]
  );
  assert.deepEqual(plan.ok ? plan.steps.map((step) => step.state) : [], ["pending", "pending", "pending", "pending"]);
});

test("authorized documents are skipped and never resent", () => {
  const plan = buildEmissionPlan(
    baseInput({
      order: { number: "0000001", snapshot: orderSnapshot, officialState: "authorized" },
      consignments: [
        { remesaId: "rem1", number: "00001", snapshot: consignmentSnapshot, officialState: "authorized" }
      ]
    })
  );

  assert.equal(plan.ok, true);
  const states = plan.ok ? Object.fromEntries(plan.steps.map((step) => [step.action, step.state])) : {};
  assert.equal(states.emit_loading_order, "authorized");
  assert.equal(states.emit_remesa, "authorized");
  assert.equal(states.register_trip, "pending");
  assert.equal(states.issue_manifest, "pending");
});

test("an emitted trip is not resent when the manifest failed", () => {
  const plan = buildEmissionPlan(
    baseInput({
      order: { number: "0000001", snapshot: orderSnapshot, officialState: "authorized" },
      consignments: [
        { remesaId: "rem1", number: "00001", snapshot: consignmentSnapshot, officialState: "authorized" }
      ],
      tripEmitted: true
    })
  );

  assert.equal(plan.ok, true);
  const states = plan.ok ? Object.fromEntries(plan.steps.map((step) => [step.action, step.state])) : {};
  assert.equal(states.register_trip, "authorized");
  assert.equal(states.issue_manifest, "pending");
});

test("an uncertain operation blocks the plan and demands reconciliation", () => {
  const plan = buildEmissionPlan(
    baseInput({ operationsInFlight: [{ operationType: "emit_remesa", status: "uncertain" }] })
  );

  assert.equal(plan.ok, false);
  assert.equal(!plan.ok ? plan.reason : "", "uncertain");
});

test("an in-flight operation blocks a second concurrent sequence", () => {
  const plan = buildEmissionPlan(
    baseInput({ operationsInFlight: [{ operationType: "emit_cargo", status: "claimed" }] })
  );

  assert.equal(plan.ok, false);
  assert.equal(!plan.ok ? plan.reason : "", "in_flight");
});

test("a reconciliation in progress blocks the emission sequence", () => {
  const plan = buildEmissionPlan(
    baseInput({ operationsInFlight: [{ operationType: "emit_cargo", status: "reconciling" }] })
  );

  assert.equal(plan.ok, false);
  assert.equal(!plan.ok ? plan.reason : "", "in_flight");
});

test("a dispatch without snapshots is not prepared for emission", () => {
  const plan = buildEmissionPlan(baseInput({ order: { number: "0000001", snapshot: null, officialState: "draft" } }));

  assert.equal(plan.ok, false);
  assert.equal(!plan.ok ? plan.reason : "", "not_prepared");
});

test("payloads are built only from snapshot data", () => {
  const plan = buildEmissionPlan(baseInput());
  assert.equal(plan.ok, true);
  if (!plan.ok) {
    return;
  }

  const cargo = plan.steps[0].payload;
  const sender = cargo.sender as Record<string, unknown>;
  const recipient = cargo.recipient as Record<string, unknown>;
  assert.equal(cargo.cargoNumber, "0000001");
  assert.equal(sender.idType, "N");
  assert.equal(sender.id, "890100756");
  assert.equal(sender.siteCode, "01");
  assert.equal(sender.cityCode, "08001000");
  assert.equal(recipient.idType, "C");
  assert.equal(recipient.id, "900222333");
  assert.equal(recipient.cityCode, "68307000");
  assert.equal((cargo.cargo as Record<string, unknown>).quantityKg, 34000);
  assert.equal((cargo.cargo as Record<string, unknown>).shortDescription, "MAIZ");
  assert.equal((cargo.cargo as Record<string, unknown>).natureCode, "1");

  const remesa = plan.steps[1].payload;
  assert.equal(remesa.remesaNumber, "00001");
  assert.equal(remesa.cargoNumber, "0000001");
  assert.deepEqual(remesa.cargoPolicy, { number: "AB002905", expirationDate: "2027-04-09", insurerNit: "860002400" });

  const trip = plan.steps[2].payload;
  assert.equal(trip.tripNumber, "0000001");
  assert.deepEqual(trip.driver, { idType: "C", id: "71851149" });
  assert.deepEqual(trip.vehicle, { plate: "STO172", trailerPlate: "R80508" });
  assert.equal((trip.money as Record<string, unknown>).freightValue, 3500000);

  const manifest = plan.steps[3].payload;
  assert.equal(manifest.manifestNumber, "0000001");
  assert.equal(manifest.tripNumber, "0000001");
  assert.equal(manifest.remesaNumber, "00001");
  assert.equal(manifest.expeditionDate, "2026-07-10");
  assert.equal(manifest.balancePaymentDate, "2026-07-20");
  assert.deepEqual(manifest.vehicleHolder, { idType: "C", id: "1002329298" });
  assert.equal((manifest.money as Record<string, unknown>).advanceValue, 1500000);
  assert.equal((manifest.money as Record<string, unknown>).icaRetentionPerMille, 0);
});

test("appointments come from the snapshot epoch in Bogota time", () => {
  const plan = buildEmissionPlan(baseInput());
  assert.equal(plan.ok, true);
  if (!plan.ok) {
    return;
  }

  const cargo = plan.steps[0].payload;
  const expectedDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", dateStyle: "short" }).format(1783700000000);
  assert.equal(cargo.loadingAppointmentDate, expectedDate);
  assert.match(String(cargo.loadingAppointmentTime), /^\d{2}:\d{2}$/);
});

test("missing RNDC fields are reported per step without inventing data", () => {
  const withoutSiteCode = {
    ...orderSnapshot,
    sender: { ...orderSnapshot.sender, siteCode: undefined },
    merchandiseCode: undefined
  };
  const plan = buildEmissionPlan(baseInput({ order: { number: "0000001", snapshot: withoutSiteCode, officialState: "draft" } }));

  assert.equal(plan.ok, true);
  if (!plan.ok) {
    return;
  }

  const cargoStep = plan.steps[0];
  assert.equal(cargoStep.state, "blocked");
  assert.ok(cargoStep.missingFields.includes("sender.siteCode"));
  assert.ok(cargoStep.missingFields.includes("cargo.merchandiseCode"));
  assert.equal((cargoStep.payload.sender as Record<string, unknown>).siteCode, undefined);
});

test("an unknown identification type is reported instead of guessed", () => {
  const strangeIdType = {
    ...orderSnapshot,
    sender: { ...orderSnapshot.sender, identificationType: "REGISTRO RARO" }
  };
  const plan = buildEmissionPlan(baseInput({ order: { number: "0000001", snapshot: strangeIdType, officialState: "draft" } }));

  assert.equal(plan.ok, true);
  if (!plan.ok) {
    return;
  }

  assert.ok(plan.steps[0].missingFields.includes("sender.idType"));
});

test("a fully authorized and emitted dispatch has no pending steps", () => {
  const plan = buildEmissionPlan(
    baseInput({
      order: { number: "0000001", snapshot: orderSnapshot, officialState: "authorized" },
      consignments: [
        { remesaId: "rem1", number: "00001", snapshot: consignmentSnapshot, officialState: "authorized" }
      ],
      manifest: { number: "0000001", snapshot: manifestSnapshot, officialState: "authorized" },
      tripEmitted: true
    })
  );

  assert.equal(plan.ok, true);
  assert.equal(plan.ok ? plan.steps.every((step) => step.state === "authorized") : false, true);
});

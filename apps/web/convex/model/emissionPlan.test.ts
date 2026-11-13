import test from "node:test";
import assert from "node:assert/strict";
import { buildEmissionPlan, type EmissionPlanInput } from "./emissionPlan";

const orderSnapshot = {
  orderNumber: "0000001",
  expeditionDate: "2026-07-09",
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
  expeditionDate: "2026-07-09",
  consignmentClass: "terrestre_carga" as const,
  declaredValue: "58000000",
  sender: orderSnapshot.sender,
  recipient: orderSnapshot.recipient,
  loading: { ...orderSnapshot.loading, agreedHours: "1.5" },
  unloading: { ...orderSnapshot.unloading, agreedHours: "2.25" },
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
  manifestType: "G",
  freightTotal: "3500000",
  advance: "1500000",
  withholdingIca: "0",
  paymentDate: "2026-07-20",
  paymentResponsible: "EMPRESA"
};

const assignmentSnapshot = {
  driver: { document: "71851149", documentType: "C.C", name: "ZOILO ANDRES MAZO", cellphone: "3001234567", licenseNumber: "71851149", licenseCategory: "C2", cityCode: "11001000" },
  secondDriver: null,
  vehicle: {
    plate: "STO172",
    trailer: "R80508",
    make: "KENWORTH",
    modelYear: "2022",
    configuration: "3S3",
    emptyWeightTn: "8",
    possessorDocument: "1002329298",
    possessorName: "AVILA CHAVEZ MARIA FERNANDA"
  },
  vehicleHolder: { documentType: "C", document: "1002329298", name: "AVILA CHAVEZ MARIA FERNANDA", phone: "3007654321", address: "CALLE 10", cityCode: "11001000" },
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

test("a fresh dispatch plans the internal order, consignments and manifest in order without trip registration", () => {
  const plan = buildEmissionPlan(baseInput());

  assert.equal(plan.ok, true);
  assert.deepEqual(
    plan.ok ? plan.steps.map((step) => step.action) : [],
    ["emit_loading_order", "emit_remesa", "issue_manifest"]
  );
  assert.deepEqual(plan.ok ? plan.steps.map((step) => step.state) : [], ["pending", "pending", "pending"]);
});

test("independently emitted order and remesa payloads use their own expedition date instead of the manifest date", () => {
  const plan = buildEmissionPlan(baseInput());
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  const cargo = plan.steps.find((step) => step.action === "emit_loading_order")?.payload as Record<string, any>;
  const remesa = plan.steps.find((step) => step.action === "emit_remesa")?.payload as Record<string, any>;
  const manifest = plan.steps.find((step) => step.action === "issue_manifest")?.payload as Record<string, any>;

  assert.equal(cargo.expeditionDate, "2026-07-09");
  assert.equal(cargo.driver.fullName, "ZOILO ANDRES MAZO");
  assert.equal(cargo.vehicle.brand, "KENWORTH");
  assert.equal(remesa.expeditionDate, "2026-07-09");
  assert.equal(remesa.vehicle.plate, "STO172");
  assert.equal(remesa.cargo.productName, "MAIZ");
  assert.equal(remesa.loadingAgreedHours, 1);
  assert.equal(remesa.loadingAgreedMinutes, 30);
  assert.equal(remesa.unloadingAgreedHours, 2);
  assert.equal(remesa.unloadingAgreedMinutes, 15);
  assert.equal(manifest.sender.cityName, "BARRANQUILLA");
  assert.equal(manifest.recipient.cityName, "GIRON");
  assert.equal(manifest.vehicleHolder.fullName, "AVILA CHAVEZ MARIA FERNANDA");
});

test("the manifest payload carries the fleet monitoring company only as clean digits", () => {
  const withNit = buildEmissionPlan(baseInput({
    manifest: { number: "0000001", snapshot: { ...manifestSnapshot, monitoringCompanyNit: "830.059.699-3" }, officialState: "draft" }
  }));
  const withoutNit = buildEmissionPlan(baseInput());
  const payloadOf = (plan: ReturnType<typeof buildEmissionPlan>) =>
    (plan.ok ? plan.steps.find((step) => step.action === "issue_manifest")?.payload : undefined) as Record<string, unknown> | undefined;

  assert.equal(payloadOf(withNit)?.monitoringCompanyNit, "8300596993");
  assert.equal(payloadOf(withoutNit)?.monitoringCompanyNit, undefined);
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
  assert.equal("register_trip" in states, false);
  assert.equal(states.issue_manifest, "pending");
});

test("trip registration is never planned, whether or not a trip was emitted before", () => {
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
  assert.deepEqual(
    plan.ok ? plan.steps.map((step) => [step.action, step.state]) : [],
    [["emit_loading_order", "authorized"], ["emit_remesa", "authorized"], ["issue_manifest", "pending"]]
  );

  for (const scope of ["todo", "manifiesto"] as const) {
    const scoped = buildEmissionPlan(
      baseInput({
        order: { number: "0000001", snapshot: orderSnapshot, officialState: "authorized" },
        consignments: [
          { remesaId: "rem1", number: "00001", snapshot: consignmentSnapshot, officialState: "authorized" }
        ]
      }),
      scope
    );
    assert.equal(scoped.ok, true);
    assert.equal(scoped.ok ? scoped.steps.some((step) => step.action === "register_trip") : true, false);
  }
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

  assert.equal(plan.steps.length, 3);
  const manifest = plan.steps[2].payload;
  assert.equal(plan.steps[2].action, "issue_manifest");
  assert.equal((manifest.driver as Record<string, unknown>).id, "71851149");
  assert.equal((manifest.driver as Record<string, unknown>).fullName, "ZOILO ANDRES MAZO");
  assert.equal((manifest.vehicle as Record<string, unknown>).plate, "STO172");
  assert.equal((manifest.vehicle as Record<string, unknown>).trailerPlate, "R80508");
  assert.equal((manifest.money as Record<string, unknown>).freightValue, 3500000);
  assert.equal(manifest.manifestNumber, "0000001");
  assert.equal(manifest.tripNumber, "0000001");
  assert.equal(manifest.remesaNumber, "00001");
  assert.equal(manifest.expeditionDate, "2026-07-10");
  assert.equal(manifest.balancePaymentDate, "2026-07-20");
  assert.equal((manifest.vehicleHolder as Record<string, unknown>).id, "1002329298");
  assert.equal((manifest.vehicleHolder as Record<string, unknown>).fullName, "AVILA CHAVEZ MARIA FERNANDA");
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

test("the internal loading order is not blocked by RNDC party or cargo classification data", () => {
  const withoutRndcData = {
    ...orderSnapshot,
    sender: { ...orderSnapshot.sender, siteCode: undefined },
    merchandiseCode: undefined
  };
  const plan = buildEmissionPlan(baseInput({ order: { number: "0000001", snapshot: withoutRndcData, officialState: "draft" } }));

  assert.equal(plan.ok, true);
  if (!plan.ok) {
    return;
  }

  const cargoStep = plan.steps[0];
  assert.equal(cargoStep.action, "emit_loading_order");
  assert.equal(cargoStep.state, "pending");
  assert.deepEqual(cargoStep.missingFields, []);
  assert.equal((cargoStep.payload.sender as Record<string, unknown>).siteCode, undefined);
  assert.equal((cargoStep.payload.cargo as Record<string, unknown>).merchandiseCode, undefined);
});

test("the loading order still reports its missing expedition date and appointments", () => {
  const withoutDates = {
    ...orderSnapshot,
    expeditionDate: undefined,
    loading: { ...orderSnapshot.loading, appointmentAt: undefined }
  };
  const plan = buildEmissionPlan(baseInput({ order: { number: "0000001", snapshot: withoutDates, officialState: "draft" } }));

  assert.equal(plan.ok, true);
  if (!plan.ok) {
    return;
  }

  const cargoStep = plan.steps[0];
  assert.equal(cargoStep.state, "blocked");
  assert.deepEqual([...cargoStep.missingFields].sort(), ["expeditionDate", "loadingAppointmentDate"]);
});

test("missing RNDC fields are reported on the remesa step without inventing data", () => {
  const withoutSiteCode = {
    ...consignmentSnapshot,
    sender: { ...consignmentSnapshot.sender, siteCode: undefined },
    merchandiseCode: undefined
  };
  const plan = buildEmissionPlan(
    baseInput({ consignments: [{ remesaId: "rem1", number: "00001", snapshot: withoutSiteCode, officialState: "draft" }] })
  );

  assert.equal(plan.ok, true);
  if (!plan.ok) {
    return;
  }

  const remesaStep = plan.steps[1];
  assert.equal(remesaStep.action, "emit_remesa");
  assert.equal(remesaStep.state, "blocked");
  assert.ok(remesaStep.missingFields.includes("sender.siteCode"));
  assert.ok(remesaStep.missingFields.includes("cargo.merchandiseCode"));
  assert.equal((remesaStep.payload.sender as Record<string, unknown>).siteCode, undefined);
});

test("an unknown identification type is reported on the remesa instead of guessed, and ignored on the internal order", () => {
  const strangeSender = { ...orderSnapshot.sender, identificationType: "REGISTRO RARO" };
  const plan = buildEmissionPlan(
    baseInput({
      order: { number: "0000001", snapshot: { ...orderSnapshot, sender: strangeSender }, officialState: "draft" },
      consignments: [
        { remesaId: "rem1", number: "00001", snapshot: { ...consignmentSnapshot, sender: strangeSender }, officialState: "draft" }
      ]
    })
  );

  assert.equal(plan.ok, true);
  if (!plan.ok) {
    return;
  }

  assert.deepEqual(plan.steps[0].missingFields, []);
  assert.ok(plan.steps[1].missingFields.includes("sender.idType"));
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

test("remesa without loading order emits the remesa and manifest without invented cargo or trip numbers", () => {
  const plan = buildEmissionPlan({
    ...baseInput(),
    workflowVariant: "remesa_without_order",
    order: { number: undefined, snapshot: null, officialState: "draft" },
    tripNumber: undefined
  } as EmissionPlanInput);

  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.steps.map((step) => step.action), ["emit_remesa", "issue_manifest"]);
  assert.equal("cargoNumber" in plan.steps[0].payload, false);
  assert.equal("tripNumber" in plan.steps[1].payload, false);
});

test("empty manifest emits only a Viaje Vacío manifest with no remesa or tracking fields", () => {
  const plan = buildEmissionPlan({
    ...baseInput(),
    workflowVariant: "empty_manifest",
    order: { number: undefined, snapshot: null, officialState: "draft" },
    consignments: [],
    tripNumber: undefined,
    manifest: { number: "0000009", snapshot: { ...manifestSnapshot, manifestType: "W", emptyManifestReason: "Retorno vacío" }, officialState: "draft" }
  } as EmissionPlanInput);

  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.steps.map((step) => step.action), ["issue_manifest"]);
  assert.equal(plan.steps[0].payload.manifestType, "W");
  assert.equal("remesaNumber" in plan.steps[0].payload, false);
  assert.equal("manifestRemesas" in plan.steps[0].payload, false);
  assert.equal("gpsOperator" in plan.steps[0].payload, false);
});

test("order scope plans only the loading order without remesa or manifest preparation", () => {
  const plan = buildEmissionPlan(
    baseInput({
      consignments: [],
      manifest: { number: undefined, snapshot: null, officialState: "draft" },
      tripNumber: undefined
    }),
    "orden"
  );

  assert.equal(plan.ok, true);
  assert.deepEqual(plan.ok ? plan.steps.map((step) => step.action) : [], ["emit_loading_order"]);
});

test("remesa scope requires a saved loading order for the standard workflow", () => {
  const blocked = buildEmissionPlan(baseInput(), "remesas");

  assert.equal(blocked.ok, false);
  assert.match(!blocked.ok ? blocked.blockers.join(" ") : "", /Requiere la orden de cargue guardada/);

  const plan = buildEmissionPlan(
    baseInput({ order: { number: "0000001", snapshot: orderSnapshot, officialState: "authorized" } }),
    "remesas"
  );

  assert.equal(plan.ok, true);
  assert.deepEqual(plan.ok ? plan.steps.map((step) => step.action) : [], ["emit_remesa"]);
});

test("manifest scope requires every remesa to be authorized and plans only the manifest", () => {
  const blocked = buildEmissionPlan(
    baseInput({ order: { number: "0000001", snapshot: orderSnapshot, officialState: "authorized" } }),
    "manifiesto"
  );

  assert.equal(blocked.ok, false);
  assert.match(!blocked.ok ? blocked.blockers.join(" ") : "", /remesas autorizadas/i);

  const plan = buildEmissionPlan(
    baseInput({
      order: { number: "0000001", snapshot: orderSnapshot, officialState: "authorized" },
      consignments: [{ remesaId: "rem1", number: "00001", snapshot: consignmentSnapshot, officialState: "authorized" }]
    }),
    "manifiesto"
  );

  assert.equal(plan.ok, true);
  assert.deepEqual(plan.ok ? plan.steps.map((step) => step.action) : [], ["issue_manifest"]);
});

test("remesa without order keeps its independent remesa and manifest scopes", () => {
  const remesaPlan = buildEmissionPlan(
    {
      ...baseInput(),
      workflowVariant: "remesa_without_order",
      order: { number: undefined, snapshot: null, officialState: "draft" },
      tripNumber: undefined
    },
    "remesas"
  );

  assert.equal(remesaPlan.ok, true);
  assert.deepEqual(remesaPlan.ok ? remesaPlan.steps.map((step) => step.action) : [], ["emit_remesa"]);

  const manifestPlan = buildEmissionPlan(
    {
      ...baseInput(),
      workflowVariant: "remesa_without_order",
      order: { number: undefined, snapshot: null, officialState: "draft" },
      consignments: [{ remesaId: "rem1", number: "00001", snapshot: consignmentSnapshot, officialState: "authorized" }],
      tripNumber: undefined
    },
    "manifiesto"
  );

  assert.equal(manifestPlan.ok, true);
  assert.deepEqual(manifestPlan.ok ? manifestPlan.steps.map((step) => step.action) : [], ["issue_manifest"]);
});

test("empty manifest keeps a manifest-only scope", () => {
  const plan = buildEmissionPlan(
    {
      ...baseInput(),
      workflowVariant: "empty_manifest",
      order: { number: undefined, snapshot: null, officialState: "draft" },
      consignments: [],
      tripNumber: undefined,
      manifest: {
        number: "0000009",
        snapshot: { ...manifestSnapshot, manifestType: "W", emptyManifestReason: "Retorno vacío" },
        officialState: "draft"
      }
    },
    "manifiesto"
  );

  assert.equal(plan.ok, true);
  assert.deepEqual(plan.ok ? plan.steps.map((step) => step.action) : [], ["issue_manifest"]);
});

test("a remesa with several remissions reports the total loaded weight", () => {
  const snapshot = {
    ...consignmentSnapshot,
    remissions: [
      { quantity: "600", description: "MAIZ", weightTons: "20", packagingClass: "0" },
      { quantity: "400", description: "MAIZ", weightTons: "14,5", packagingClass: "0" }
    ]
  };
  const plan = buildEmissionPlan(baseInput({ consignments: [{ remesaId: "rem1", number: "00001", snapshot, officialState: "draft" }] }));
  assert.equal(plan.ok, true);
  const remesa = plan.ok ? plan.steps.find((step) => step.action === "emit_remesa") : undefined;
  const cargo = (remesa?.payload as Record<string, unknown> | undefined)?.cargo as Record<string, unknown> | undefined;
  assert.equal(cargo?.quantityKg, 34500);
});

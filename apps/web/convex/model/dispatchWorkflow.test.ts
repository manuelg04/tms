import test from "node:test";
import assert from "node:assert/strict";
import {
  assertStageEditable,
  bogotaDate,
  canFulfillManifest,
  consignmentMissingFields,
  deriveDispatchStage,
  emissionDependencyBlockers,
  emissionScopeTargets,
  loadingOrderMissingFields,
  manifestMissingFields,
  type DispatchProjection,
  type LoadingOrderDraft
} from "./dispatchWorkflow";

const completeOrder: LoadingOrderDraft = {
  customerId: "cust1",
  sender: { name: "ITALCOL S.A", identificationType: "NIT", identificationNumber: "890100756", siteCode: "1", municipalityCode: "08001000" },
  recipient: { name: "GRANJA GIRON", identificationType: "NIT", identificationNumber: "900222333", siteCode: "1", municipalityCode: "68001000" },
  loading: { address: "VIA 40 850", cityName: "BARRANQUILLA", appointmentAt: 1720000000000 },
  unloading: { address: "KM 4 VIA GIRON", cityName: "GIRON", appointmentAt: 1720100000000 },
  cargoDescription: "MAIZ",
  weightTons: "34",
  packagingCode: "GRANEL",
  merchandiseCode: "005229",
  natureOfCargo: "1"
};

function baseProjection(overrides: Partial<DispatchProjection> = {}): DispatchProjection {
  return {
    annulled: false,
    loadingOrder: { missingFields: [], officialState: "draft" },
    consignments: [
      { missingFields: [], officialState: "draft", fulfillmentState: "not_requested" }
    ],
    assignment: { vehicleAssigned: true, driverAssigned: true },
    manifest: { missingFields: [], officialState: "draft", fulfillmentState: "not_requested" },
    cargoInfoState: "draft",
    logistics: { originComplete: false, destinationComplete: false, finalDeliveryRecorded: false },
    ...overrides
  };
}

test("a new dispatch starts at the loading order stage", () => {
  const stage = deriveDispatchStage(
    baseProjection({ loadingOrder: null, consignments: [], assignment: { vehicleAssigned: false, driverAssigned: false }, manifest: null })
  );

  assert.equal(stage.stage, "orden_cargue");
});

test("an incomplete loading order stays at the loading order stage and lists blockers", () => {
  const stage = deriveDispatchStage(
    baseProjection({ loadingOrder: { missingFields: ["Remitente", "Cita de cargue"], officialState: "draft" } })
  );

  assert.equal(stage.stage, "orden_cargue");
  assert.deepEqual(stage.blockers, ["Remitente", "Cita de cargue"]);
});

test("a complete order without consignments moves to the consignments stage", () => {
  const stage = deriveDispatchStage(baseProjection({ consignments: [] }));

  assert.equal(stage.stage, "remesas");
});

test("an incomplete consignment keeps the dispatch at the consignments stage", () => {
  const stage = deriveDispatchStage(
    baseProjection({
      consignments: [
        { missingFields: [], officialState: "draft", fulfillmentState: "not_requested" },
        { missingFields: ["Destinatario"], officialState: "draft", fulfillmentState: "not_requested" }
      ]
    })
  );

  assert.equal(stage.stage, "remesas");
  assert.deepEqual(stage.blockers, ["Remesa 2: Destinatario"]);
});

test("missing vehicle or driver blocks at the assignment stage", () => {
  const stage = deriveDispatchStage(baseProjection({ assignment: { vehicleAssigned: true, driverAssigned: false } }));

  assert.equal(stage.stage, "vehiculo_conductor");
});

test("a missing or incomplete manifest blocks at the manifest stage", () => {
  assert.equal(deriveDispatchStage(baseProjection({ manifest: null })).stage, "manifiesto");
  assert.equal(
    deriveDispatchStage(baseProjection({ manifest: { missingFields: ["Flete"], officialState: "draft", fulfillmentState: "not_requested" } }))
      .stage,
    "manifiesto"
  );
});

test("a complete draft dispatch waits at the RNDC emission stage", () => {
  const stage = deriveDispatchStage(baseProjection());

  assert.equal(stage.stage, "envio_rndc");
});

test("a partially emitted sequence stays at the emission stage", () => {
  const stage = deriveDispatchStage(
    baseProjection({
      cargoInfoState: "authorized",
      consignments: [{ missingFields: [], officialState: "authorized", fulfillmentState: "not_requested" }],
      manifest: { missingFields: [], officialState: "pending", fulfillmentState: "not_requested" }
    })
  );

  assert.equal(stage.stage, "envio_rndc");
});

test("a fully authorized dispatch moves to logistics recording", () => {
  const stage = deriveDispatchStage(
    baseProjection({
      cargoInfoState: "authorized",
      consignments: [{ missingFields: [], officialState: "authorized", fulfillmentState: "not_requested" }],
      manifest: { missingFields: [], officialState: "authorized", fulfillmentState: "not_requested" }
    })
  );

  assert.equal(stage.stage, "cargue_descargue");
});

test("recorded logistics move the dispatch to individual fulfillment", () => {
  const stage = deriveDispatchStage(
    baseProjection({
      cargoInfoState: "authorized",
      consignments: [{ missingFields: [], officialState: "authorized", fulfillmentState: "not_requested" }],
      manifest: { missingFields: [], officialState: "authorized", fulfillmentState: "not_requested" },
      logistics: { originComplete: true, destinationComplete: true, finalDeliveryRecorded: true }
    })
  );

  assert.equal(stage.stage, "cumplido_inicial");
});

test("the final fulfillment stays blocked while any consignment is pending", () => {
  const projection = baseProjection({
    cargoInfoState: "authorized",
    consignments: [
      { missingFields: [], officialState: "fulfilled", fulfillmentState: "fulfilled" },
      { missingFields: [], officialState: "authorized", fulfillmentState: "not_requested" }
    ],
    manifest: { missingFields: [], officialState: "authorized", fulfillmentState: "not_requested" },
    logistics: { originComplete: true, destinationComplete: true, finalDeliveryRecorded: true }
  });

  assert.equal(deriveDispatchStage(projection).stage, "cumplido_inicial");
  assert.equal(canFulfillManifest(projection.consignments), false);
});

test("all consignments fulfilled enable the final fulfillment stage", () => {
  const projection = baseProjection({
    cargoInfoState: "authorized",
    consignments: [{ missingFields: [], officialState: "fulfilled", fulfillmentState: "fulfilled" }],
    manifest: { missingFields: [], officialState: "authorized", fulfillmentState: "not_requested" },
    logistics: { originComplete: true, destinationComplete: true, finalDeliveryRecorded: true }
  });

  assert.equal(deriveDispatchStage(projection).stage, "cumplido_final");
  assert.equal(canFulfillManifest(projection.consignments), true);
});

test("a fulfilled manifest closes the dispatch", () => {
  const stage = deriveDispatchStage(
    baseProjection({
      cargoInfoState: "authorized",
      consignments: [{ missingFields: [], officialState: "fulfilled", fulfillmentState: "fulfilled" }],
      manifest: { missingFields: [], officialState: "fulfilled", fulfillmentState: "fulfilled" },
      logistics: { originComplete: true, destinationComplete: true, finalDeliveryRecorded: true }
    })
  );

  assert.equal(stage.stage, "cumplido");
});

test("authorized legacy documents do not send the operator back to missing draft forms", () => {
  const stage = deriveDispatchStage({
    annulled: false,
    loadingOrder: { missingFields: ["Orden de cargue sin iniciar"], officialState: "authorized" },
    consignments: [{ missingFields: ["Remesa sin borrador"], officialState: "authorized", fulfillmentState: "not_requested" }],
    assignment: { vehicleAssigned: true, driverAssigned: true },
    manifest: { missingFields: ["Manifiesto sin preparar"], officialState: "authorized", fulfillmentState: "not_requested" },
    cargoInfoState: "authorized",
    logistics: { originComplete: false, destinationComplete: false, finalDeliveryRecorded: false }
  });

  assert.equal(stage.stage, "cargue_descargue");
  assert.deepEqual(stage.blockers, []);
});

test("a legacy authorized remesa and manifest chain does not require a missing local loading-order record", () => {
  const stage = deriveDispatchStage({
    annulled: false,
    loadingOrder: null,
    consignments: [{ missingFields: ["Remesa sin borrador"], officialState: "authorized", fulfillmentState: "not_requested" }],
    assignment: { vehicleAssigned: true, driverAssigned: true },
    manifest: { missingFields: [], officialState: "authorized", fulfillmentState: "not_requested" },
    cargoInfoState: "draft",
    logistics: { originComplete: false, destinationComplete: false, finalDeliveryRecorded: false }
  });

  assert.equal(stage.stage, "cargue_descargue");
});

test("an annulled dispatch reports the annulled stage", () => {
  assert.equal(deriveDispatchStage(baseProjection({ annulled: true })).stage, "anulado");
});

test("order scope has no documentary dependency in the standard workflow", () => {
  assert.deepEqual(
    emissionDependencyBlockers("orden", {
      workflowVariant: "standard",
      orderOfficialState: "draft",
      consignmentOfficialStates: []
    }),
    []
  );
});

test("remesa scope waits for the order unless the workflow has no loading order", () => {
  assert.match(
    emissionDependencyBlockers("remesas", {
      workflowVariant: "standard",
      orderOfficialState: "draft",
      consignmentOfficialStates: ["draft"]
    }).join(" "),
    /orden de cargue autorizada/i
  );
  assert.deepEqual(
    emissionDependencyBlockers("remesas", {
      workflowVariant: "remesa_without_order",
      orderOfficialState: "draft",
      consignmentOfficialStates: ["draft"]
    }),
    []
  );
});

test("manifest scope waits for all remesas except in an empty manifest workflow", () => {
  assert.match(
    emissionDependencyBlockers("manifiesto", {
      workflowVariant: "standard",
      orderOfficialState: "authorized",
      consignmentOfficialStates: ["authorized", "pending"]
    }).join(" "),
    /remesas autorizadas/i
  );
  assert.deepEqual(
    emissionDependencyBlockers("manifiesto", {
      workflowVariant: "empty_manifest",
      orderOfficialState: "draft",
      consignmentOfficialStates: []
    }),
    []
  );
});

test("complete scope preserves the resumable linear workflow without pre-authorizing earlier steps", () => {
  assert.deepEqual(
    emissionDependencyBlockers("todo", {
      workflowVariant: "standard",
      orderOfficialState: "draft",
      consignmentOfficialStates: ["draft"]
    }),
    []
  );
});

test("each preparation scope targets only its own numbers and photographs", () => {
  assert.deepEqual(emissionScopeTargets("orden", "standard"), {
    order: true,
    consignments: false,
    manifest: false,
    trip: false,
    assignment: true
  });
  assert.deepEqual(emissionScopeTargets("remesas", "standard"), {
    order: false,
    consignments: true,
    manifest: false,
    trip: false,
    assignment: false
  });
  assert.deepEqual(emissionScopeTargets("manifiesto", "standard"), {
    order: false,
    consignments: false,
    manifest: true,
    trip: true,
    assignment: true
  });
});

test("exception variants preserve their documentary targets", () => {
  assert.deepEqual(emissionScopeTargets("todo", "remesa_without_order"), {
    order: false,
    consignments: true,
    manifest: true,
    trip: false,
    assignment: true
  });
  assert.deepEqual(emissionScopeTargets("todo", "empty_manifest"), {
    order: false,
    consignments: false,
    manifest: true,
    trip: false,
    assignment: true
  });
});

test("preparation defaults expedition dates using the Bogota calendar day", () => {
  assert.equal(bogotaDate(Date.UTC(2026, 6, 13, 3, 59)), "2026-07-12");
  assert.equal(bogotaDate(Date.UTC(2026, 6, 13, 5, 1)), "2026-07-13");
});

test("a complete loading order has no missing fields", () => {
  assert.deepEqual(loadingOrderMissingFields(completeOrder), []);
});

test("a partial loading order lists its missing fields in operational language", () => {
  const missing = loadingOrderMissingFields({ customerId: "cust1", cargoDescription: "MAIZ" });

  assert.ok(missing.includes("Remitente con identificación"));
  assert.ok(missing.includes("Sitio y cita de cargue"));
  assert.ok(missing.includes("Peso (TN)"));
  assert.ok(!missing.includes("Cliente"));
});

test("an empty loading order reports it has not started", () => {
  assert.deepEqual(loadingOrderMissingFields(null), ["Orden de cargue sin iniciar"]);
});

test("a consignment inherits known order data and only asks for the differences", () => {
  const missing = consignmentMissingFields(
    { consignmentClass: "terrestre_carga", declaredValue: "5000000", policyNumber: "POL-1", policyExpiresOn: "2027-07-13", insurerNit: "900123456" },
    completeOrder
  );

  assert.deepEqual(missing, []);
});

test("a consignment without inherited order data lists everything it needs", () => {
  const missing = consignmentMissingFields({ declaredValue: "100" }, null);

  assert.ok(missing.includes("Clase de remesa"));
  assert.ok(missing.includes("Remitente"));
  assert.ok(missing.includes("Destinatario"));
  assert.ok(missing.includes("Sitio y cita de descargue"));
  assert.ok(missing.includes("Remisiones con cantidad, descripción y peso"));
  assert.ok(missing.includes("Póliza de la carga"));
});

test("consignment overrides replace inherited order data", () => {
  const missing = consignmentMissingFields(
    {
      consignmentClass: "municipal",
      declaredValue: "100",
      recipient: { name: "OTRO DESTINATARIO", identificationType: "NIT", identificationNumber: "111", siteCode: "1", municipalityCode: "68001000" },
      remissions: [{ quantity: "10", description: "BULTOS", weightTons: "5" }],
      policyNumber: "POL-2",
      policyExpiresOn: "2027-07-13",
      insurerNit: "900123456"
    },
    { ...completeOrder, recipient: undefined }
  );

  assert.deepEqual(missing, []);
});

test("a manifest draft lists missing settlement fields", () => {
  const missing = manifestMissingFields({ issueDate: "2026-07-10", freightTotal: "3500000" });

  assert.ok(missing.includes("Entrega estimada"));
  assert.ok(missing.includes("Alcance de la operación"));
  assert.ok(missing.includes("Tipo de manifiesto"));
  assert.ok(missing.includes("Responsable de pago"));
  assert.ok(!missing.includes("Fecha de expedición"));
  assert.ok(!missing.includes("Flete total"));
});

test("editing the loading order is rejected once its cargo information left draft", () => {
  assert.throws(
    () => assertStageEditable("orden_cargue", { officialState: "draft", cargoInfoState: "pending" }),
    /ya tiene una transmisión RNDC/i
  );
  assert.throws(
    () => assertStageEditable("orden_cargue", { officialState: "draft", cargoInfoState: "authorized" }),
    /ya tiene una transmisión RNDC/i
  );
  assert.doesNotThrow(() => assertStageEditable("orden_cargue", { officialState: "draft", cargoInfoState: "draft" }));
});

test("editing an official consignment or manifest is rejected", () => {
  assert.throws(() => assertStageEditable("remesa", { officialState: "authorized" }), /documento oficial/i);
  assert.throws(() => assertStageEditable("manifiesto", { officialState: "pending" }), /documento oficial/i);
  assert.doesNotThrow(() => assertStageEditable("remesa", { officialState: "draft" }));
});

test("a consignment inherits the order cargo codes when it does not override them", async () => {
  const { effectiveConsignment } = await import("./dispatchWorkflow");
  const effective = effectiveConsignment(
    { consignmentClass: "terrestre_carga", declaredValue: "100" },
    { ...completeOrder, packagingCode: "0", merchandiseCode: "005229", natureOfCargo: "1" }
  );

  assert.equal(effective.packagingCode, "0");
  assert.equal(effective.merchandiseCode, "005229");
  assert.equal(effective.natureOfCargo, "1");

  const partialLine = effectiveConsignment(
    { remissions: [{ description: undefined, weightTons: undefined }] },
    completeOrder
  );

  assert.equal(partialLine.remissions?.[0]?.description, "MAIZ");
  assert.equal(partialLine.remissions?.[0]?.weightTons, "34");

  const overridden = effectiveConsignment(
    { merchandiseCode: "009999", natureOfCargo: "2" },
    { ...completeOrder, merchandiseCode: "005229", natureOfCargo: "1" }
  );

  assert.equal(overridden.merchandiseCode, "009999");
  assert.equal(overridden.natureOfCargo, "2");
});

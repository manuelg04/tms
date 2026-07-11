import test from "node:test";
import assert from "node:assert/strict";
import {
  assertStageEditable,
  canFulfillManifest,
  consignmentMissingFields,
  deriveDispatchStage,
  loadingOrderMissingFields,
  manifestMissingFields,
  type DispatchProjection,
  type LoadingOrderDraft
} from "./dispatchWorkflow";

const completeOrder: LoadingOrderDraft = {
  customerId: "cust1",
  sender: { name: "ITALCOL S.A", identificationNumber: "890100756" },
  recipient: { name: "GRANJA GIRON", identificationNumber: "900222333" },
  loading: { address: "VIA 40 850", cityName: "BARRANQUILLA", appointmentAt: 1720000000000 },
  unloading: { address: "KM 4 VIA GIRON", cityName: "GIRON", appointmentAt: 1720100000000 },
  cargoDescription: "MAIZ",
  weightTons: "34",
  packagingCode: "GRANEL"
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

test("an annulled dispatch reports the annulled stage", () => {
  assert.equal(deriveDispatchStage(baseProjection({ annulled: true })).stage, "anulado");
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
    { consignmentClass: "terrestre_carga", declaredValue: "5000000" },
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
});

test("consignment overrides replace inherited order data", () => {
  const missing = consignmentMissingFields(
    {
      consignmentClass: "municipal",
      declaredValue: "100",
      recipient: { name: "OTRO DESTINATARIO", identificationNumber: "111" },
      remissions: [{ quantity: "10", description: "BULTOS", weightTons: "5" }]
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

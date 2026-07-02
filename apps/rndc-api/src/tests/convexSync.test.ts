import assert from "node:assert/strict";
import test from "node:test";
import { buildMtmReferenceScenario, loadConfig } from "@tms/rndc-core";
import { buildOperationRecord, syncOperationToConvex } from "../convexSync.js";
import type { SyncableResult } from "../convexSync.js";

function makeResult(overrides: Partial<SyncableResult> = {}): SyncableResult {
  return {
    ok: true,
    operation: "manifest",
    mode: "dry-run",
    startedAt: "2026-07-01T10:00:00.000Z",
    finishedAt: "2026-07-01T10:00:05.000Z",
    evidencePath: "/runs/example/result.json",
    numbers: {
      loadingOrder: "000044579",
      trip: "IV42196",
      remesa: "42196",
      manifest: "0041464",
      plate: "JVK276"
    },
    documents: [{ kind: "manifest", number: "0041464", urlPath: "/pdf/manifiesto-0041464.pdf" }],
    steps: [
      {
        name: "register-trip",
        title: "Registrar informacion de viaje",
        procesoId: 2,
        accepted: true,
        radicado: "956362398",
        requestPath: "/runs/example/requests/02-register-trip.xml",
        responsePath: "/runs/example/responses/02-register-trip.xml"
      },
      {
        name: "issue-manifest",
        title: "Expedir manifiesto de carga",
        procesoId: 4,
        accepted: true,
        radicado: "941080745",
        requestPath: "/runs/example/requests/04-issue-manifest.xml",
        responsePath: "/runs/example/responses/04-issue-manifest.xml"
      }
    ],
    ...overrides
  };
}

test("maps a manifest result to a Convex operation record", () => {
  const scenario = buildMtmReferenceScenario(loadConfig());
  const record = buildOperationRecord(makeResult(), scenario);

  assert.equal(record.operation, "manifest");
  assert.equal(record.ok, true);
  assert.equal(record.trip.code, "IV42196");
  assert.equal(record.trip.vehiclePlate, "JVK276");
  assert.equal(record.trip.originCity, scenario.sender.cityName);
  assert.equal(record.trip.destinationCity, scenario.recipient.cityName);
  assert.deepEqual(record.documents, [
    {
      kind: "manifiesto",
      number: "0041464",
      urlPath: "/pdf/manifiesto-0041464.pdf",
      radicado: "941080745"
    }
  ]);
  assert.equal(record.steps.length, 2);
  assert.equal(record.errorText, undefined);
});

test("maps a rejected remesa with its error and no radicado", () => {
  const scenario = buildMtmReferenceScenario(loadConfig());
  const record = buildOperationRecord(makeResult({
    ok: false,
    operation: "remesa",
    documents: [],
    steps: [
      {
        name: "issue-remesa",
        title: "Expedir remesa terrestre de carga",
        procesoId: 3,
        accepted: false,
        errorText: "Error REM030: remesa rechazada",
        requestPath: "/runs/example/requests/03-issue-remesa.xml",
        responsePath: "/runs/example/responses/03-issue-remesa.xml"
      }
    ]
  }), scenario);

  assert.equal(record.ok, false);
  assert.deepEqual(record.documents, [
    { kind: "remesa", number: "42196", urlPath: undefined, radicado: undefined }
  ]);
  assert.equal(record.errorText, "Error REM030: remesa rechazada");
});

test("driver-vehicle operations produce no documents", () => {
  const scenario = buildMtmReferenceScenario(loadConfig());
  const record = buildOperationRecord(makeResult({ operation: "driver-vehicle", documents: [] }), scenario);

  assert.deepEqual(record.documents, []);
  assert.equal(record.trip.code, "IV42196");
});

test("skips the sync when Convex is not configured", async () => {
  const previousUrl = process.env.CONVEX_URL;
  const previousKey = process.env.RNDC_INGEST_KEY;
  delete process.env.CONVEX_URL;
  delete process.env.RNDC_INGEST_KEY;

  try {
    const scenario = buildMtmReferenceScenario(loadConfig());
    const status = await syncOperationToConvex(makeResult(), scenario);
    assert.equal(status.synced, false);
    assert.match(status.reason ?? "", /not configured/);
  } finally {
    if (previousUrl !== undefined) {
      process.env.CONVEX_URL = previousUrl;
    }

    if (previousKey !== undefined) {
      process.env.RNDC_INGEST_KEY = previousKey;
    }
  }
});

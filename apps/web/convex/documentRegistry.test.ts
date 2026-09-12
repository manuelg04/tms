import assert from "node:assert/strict";
import test from "node:test";
import { list } from "./documentRegistry";
import { duplicateManifest, ensureManifestDraft } from "./documentDraftActions";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };

function harness() {
  const tables = new Map<string, Row[]>();
  let serial = 1000;
  const seed = (table: string, id: string, fields: Record<string, unknown>) => {
    const row: Row = { _id: id, _creationTime: serial++, ...fields };
    tables.set(table, [...(tables.get(table) ?? []), row]);
    return row;
  };
  const rows = (table: string) => tables.get(table) ?? [];
  const ctx = {
    auth: {
      async getUserIdentity() {
        return { subject: "operator" };
      },
    },
    db: {
      query(table: string) {
        const filters: Record<string, unknown> = {};
        let descending = false;
        const matching = () => {
          const found = rows(table).filter((row) =>
            Object.entries(filters).every(([key, value]) => row[key] === value),
          );
          return descending ? [...found].reverse() : found;
        };
        const chain = {
          withIndex(
            _name: string,
            apply: (query: {
              eq: (key: string, value: unknown) => unknown;
            }) => unknown,
          ) {
            const query = {
              eq(key: string, value: unknown) {
                filters[key] = value;
                return query;
              },
            };
            apply(query);
            return chain;
          },
          order(direction: string) {
            descending = direction === "desc";
            return chain;
          },
          async collect() {
            return matching();
          },
          async first() {
            return matching()[0] ?? null;
          },
          async unique() {
            assert.ok(matching().length <= 1);
            return matching()[0] ?? null;
          },
          async take(limit: number) {
            return matching().slice(0, limit);
          },
        };
        return chain;
      },
      async get(tableOrId: string, id?: string) {
        return id
          ? (rows(tableOrId).find((row) => row._id === id) ?? null)
          : ([...tables.values()].flat().find((row) => row._id === tableOrId) ??
              null);
      },
      async insert(table: string, value: Record<string, unknown>) {
        const id = `${table}:${serial++}`;
        seed(table, id, value);
        return id;
      },
      async patch(
        tableOrId: string,
        idOrValue: string | Record<string, unknown>,
        data?: Record<string, unknown>,
      ) {
        const id = typeof idOrValue === "string" ? idOrValue : tableOrId;
        const row = [...tables.values()]
          .flat()
          .find((candidate) => candidate._id === id);
        assert.ok(row);
        Object.assign(row, data ?? idOrValue);
      },
    },
  };
  seed("organizations", "org1", { status: "active" });
  seed("organizations", "org2", { status: "active" });
  seed("users", "user1", {
    organizationId: "org1",
    authSubject: "operator",
    actorToken: "operator-token",
    name: "Operadora",
    roles: ["operator"],
    status: "active",
  });
  seed("customers", "customer1", {
    organizationId: "org1",
    name: "Cliente Uno",
  });
  seed("customerLocations", "origin1", {
    organizationId: "org1",
    name: "Origen",
    city: "Bogotá",
  });
  seed("customerLocations", "destination1", {
    organizationId: "org1",
    name: "Destino",
    city: "Medellín",
  });
  seed("vehicles", "vehicle1", { organizationId: "org1", plate: "ABC123" });
  seed("drivers", "driver1", { organizationId: "org1", name: "Conductor" });
  seed("serviceOrders", "service1", {
    organizationId: "org1",
    code: "OS-1",
    customerId: "customer1",
    loadingLocationId: "origin1",
    unloadingLocationId: "destination1",
    status: "confirmed",
    cargoDescription: "Carga",
    agreedRate: 100,
    currency: "COP",
    createdBy: "user1",
    updatedBy: "user1",
    createdAt: 1000,
    updatedAt: 1000,
  });
  const source = seed("expedientes", "exp1", {
    organizationId: "org1",
    serviceOrderId: "service1",
    code: "DSP-000001",
    status: "completed",
    vehicleId: "vehicle1",
    driverId: "driver1",
    cargoNumber: "000000001",
    manifestNumber: "0000001",
    loadingOrderDraft: {
      orderNumber: "000000001",
      expeditionDate: "2026-09-11",
      printedAt: 1000,
      loading: { cityName: "Bogotá", appointmentAt: 1000 },
    },
    manifestDraft: {
      manifestNumber: "0000001",
      issueDate: "2026-09-11",
      printedAt: 1000,
      originCityName: "Bogotá",
      destinationCityName: "Medellín",
      freightTotal: "3000",
    },
    createdBy: "user1",
    updatedBy: "user1",
    createdAt: Date.parse("2026-09-11T18:00:00Z"),
    updatedAt: Date.parse("2026-09-11T18:00:00Z"),
  });
  seed("expedienteRemesas", "remesa1", {
    organizationId: "org1",
    expedienteId: "exp1",
    sequence: 1,
    number: "00001",
    documentId: "doc1",
    cargoDescription: "Carga",
    officialState: "authorized",
    fulfillmentState: "fulfilled",
    correctionState: "none",
    annulmentState: "none",
    reconciliationState: "confirmed",
    draft: {
      expeditionDate: "2026-09-11",
      printedAt: 1000,
      declaredValue: "9000",
      loading: { cityName: "Bogotá", appointmentAt: 1000 },
    },
    createdBy: "user1",
    updatedBy: "user1",
    createdAt: 1000,
    updatedAt: 1000,
  });
  return { ctx, seed, rows, source };
}

async function run<T = Record<string, unknown>>(
  operation: unknown,
  ctx: unknown,
  args: unknown,
): Promise<T> {
  return await (
    operation as { _handler(ctx: unknown, args: unknown): Promise<T> }
  )._handler(ctx, args);
}

test("registro incluye borradores, documentos legacy y filtra toda la organización", async () => {
  const fixture = harness();
  fixture.seed("trips", "legacyTrip", {
    organizationId: "org1",
    vehiclePlate: "XYZ999",
    originCity: "Cali",
    destinationCity: "Bogotá",
  });
  fixture.seed("documents", "legacyDoc", {
    tripId: "legacyTrip",
    kind: "orden_cargue",
    number: "400",
    status: "authorized",
    createdAt: 3000,
    updatedAt: 3000,
  });
  fixture.seed("documents", "foreignDoc", {
    organizationId: "org2",
    tripId: "legacyTrip",
    kind: "orden_cargue",
    number: "500",
    status: "authorized",
    createdAt: 4000,
    updatedAt: 4000,
  });
  const response = await run<{
    rows: Record<string, unknown>[];
    total: number;
  }>(list, fixture.ctx, { kind: "orden_cargue", pageSize: 1 });
  assert.equal(response.total, 2);
  assert.equal(response.rows.length, 1);
  const filtered = await run<{
    rows: Record<string, unknown>[];
    total: number;
  }>(list, fixture.ctx, { kind: "orden_cargue", filters: { plate: "XYZ999" } });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.rows[0].number, "400");
  assert.equal(filtered.rows[0].expedienteId, undefined);
  assert.equal(filtered.rows[0].customer, "");
});

test("registro no duplica remesa cuando su documento ya está enlazado", async () => {
  const fixture = harness();
  fixture.seed("trips", "trip1", {
    organizationId: "org1",
    expedienteId: "exp1",
  });
  fixture.seed("documents", "doc1", {
    organizationId: "org1",
    expedienteId: "exp1",
    expedienteRemesaId: "remesa1",
    tripId: "trip1",
    kind: "remesa",
    number: "00001",
    status: "authorized",
    createdAt: 1000,
    updatedAt: 1000,
  });
  const response = await run<{
    rows: Record<string, unknown>[];
    total: number;
  }>(list, fixture.ctx, { kind: "remesa" });
  assert.equal(response.total, 1);
  assert.equal(response.rows[0].documentId, "doc1");
  assert.equal(response.rows[0].remesaId, "remesa1");
  assert.equal(response.rows[0].status, "authorized");
});

test("registro rechaza acceso a organización distinta", async () => {
  const fixture = harness();
  await assert.rejects(
    run(list, fixture.ctx, { organizationId: "org2", kind: "manifiesto" }),
    /another organization/,
  );
});

test("duplicar asigna identificadores nuevos y no reutiliza estado oficial", async () => {
  const fixture = harness();
  const before = structuredClone(fixture.source);
  const result = await run<{
    expedienteId: string;
    manifestNumber: string;
    code: string;
  }>(duplicateManifest, fixture.ctx, {
    expedienteId: "exp1",
    requestId: "request-0001",
  });
  const copy = fixture
    .rows("expedientes")
    .find((candidate) => candidate._id === result.expedienteId);
  assert.ok(copy);
  assert.notEqual(result.manifestNumber, fixture.source.manifestNumber);
  assert.notEqual(copy.cargoNumber, fixture.source.cargoNumber);
  assert.notEqual(copy.serviceOrderId, fixture.source.serviceOrderId);
  assert.equal(copy.status, "draft");
  assert.equal(copy.manifestDocumentId, undefined);
  assert.equal(copy.manifestFulfillmentDraft, undefined);
  assert.equal(
    (copy.manifestDraft as Record<string, unknown>).freightTotal,
    "3000",
  );
  assert.equal(
    (copy.manifestDraft as Record<string, unknown>).printedAt,
    undefined,
  );
  const remesa = fixture
    .rows("expedienteRemesas")
    .find((candidate) => candidate.expedienteId === result.expedienteId);
  assert.ok(remesa);
  assert.notEqual(remesa.number, "00001");
  assert.equal(remesa.documentId, undefined);
  assert.equal(remesa.officialState, "draft");
  assert.equal(remesa.fulfillmentState, "not_requested");
  assert.equal((remesa.draft as Record<string, unknown>).declaredValue, "9000");
  assert.equal(
    (
      (remesa.draft as Record<string, unknown>).loading as Record<
        string,
        unknown
      >
    ).appointmentAt,
    undefined,
  );
  assert.deepEqual(fixture.source, before);
  assert.equal(fixture.rows("documents").length, 0);
  assert.equal(fixture.rows("rndcOperations").length, 0);
});

test("reintentar la misma duplicación devuelve la copia sin consumir consecutivos", async () => {
  const fixture = harness();
  const args = { expedienteId: "exp1", requestId: "request-0002" };
  const first = await run(duplicateManifest, fixture.ctx, args);
  const counters = structuredClone(fixture.rows("counterRanges"));
  const second = await run(duplicateManifest, fixture.ctx, args);
  assert.deepEqual(second, first);
  assert.deepEqual(fixture.rows("counterRanges"), counters);
  assert.equal(fixture.rows("expedientes").length, 2);
  assert.equal(fixture.rows("expedienteRemesas").length, 2);
});

test("duplicar valida rol, organización e identificador antes de escribir", async () => {
  const fixture = harness();
  fixture.rows("users")[0].roles = ["auditor"];
  await assert.rejects(
    run(duplicateManifest, fixture.ctx, {
      expedienteId: "exp1",
      requestId: "request-0003",
    }),
    /required role/,
  );
  fixture.rows("users")[0].roles = ["operator"];
  fixture.source.organizationId = "org2";
  await assert.rejects(
    run(duplicateManifest, fixture.ctx, {
      expedienteId: "exp1",
      requestId: "request-0003",
    }),
    /another organization/,
  );
  fixture.source.organizationId = "org1";
  await assert.rejects(
    run(duplicateManifest, fixture.ctx, {
      expedienteId: "exp1",
      requestId: "short",
    }),
    /inválido/,
  );
  assert.equal(fixture.rows("counterRanges").length, 0);
  assert.equal(fixture.rows("expedientes").length, 1);
});

test("preparar manifiesto reserva una vez, evita otro borrador y conserva datos", async () => {
  const fixture = harness();
  fixture.seed("expedientes", "exp2", {
    ...fixture.source,
    _id: "exp2",
    code: "DSP-000010",
    status: "draft",
    manifestNumber: undefined,
    manifestDraft: { freightTotal: "4000" },
  });
  const first = await run<{ manifestNumber: string }>(
    ensureManifestDraft,
    fixture.ctx,
    { expedienteId: "exp2" },
  );
  const counters = structuredClone(fixture.rows("counterRanges"));
  const second = await run(ensureManifestDraft, fixture.ctx, {
    expedienteId: "exp2",
  });
  assert.deepEqual(first, second);
  assert.notEqual(first.manifestNumber, fixture.source.manifestNumber);
  assert.deepEqual(fixture.rows("counterRanges"), counters);
  const prepared = fixture
    .rows("expedientes")
    .find((row) => row._id === "exp2");
  assert.equal(
    (prepared?.manifestDraft as Record<string, unknown>).freightTotal,
    "4000",
  );
  assert.equal(
    (prepared?.manifestDraft as Record<string, unknown>).manifestNumber,
    first.manifestNumber,
  );
  assert.equal(fixture.rows("rndcOperations").length, 0);
});

test("preparar manifiesto bloquea cerrados, emisión y organizaciones ajenas", async () => {
  const fixture = harness();
  await assert.rejects(
    run(ensureManifestDraft, fixture.ctx, { expedienteId: "exp1" }),
    /cerrado/,
  );
  fixture.source.status = "draft";
  fixture.seed("documents", "manifest1", {
    organizationId: "org1",
    expedienteId: "exp1",
    kind: "manifiesto",
    status: "pending",
    number: "0000001",
  });
  await assert.rejects(
    run(ensureManifestDraft, fixture.ctx, { expedienteId: "exp1" }),
    /emisión/,
  );
  fixture.source.organizationId = "org2";
  await assert.rejects(
    run(ensureManifestDraft, fixture.ctx, { expedienteId: "exp1" }),
    /another organization/,
  );
  assert.equal(fixture.rows("counterRanges").length, 0);
});

test("preparar manifiesto no altera una emisión en cola aunque el documento siga draft", async () => {
  const fixture = harness();
  fixture.source.status = "draft";
  fixture.seed("rndcOperations", "op1", {
    organizationId: "org1",
    expedienteId: "exp1",
    operationType: "emit_manifest",
    status: "queued",
  });
  await assert.rejects(
    run(ensureManifestDraft, fixture.ctx, { expedienteId: "exp1" }),
    /emisión/,
  );
  assert.equal(fixture.rows("counterRanges").length, 0);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  createDriverMaster,
  discardMasterUploads,
  createThirdPartyMaster,
  createTrailerMaster,
  createVehicleMaster,
  linkDriverVehicle,
  unlinkDriverVehicle,
  upsertFleetBatch
} from "./fleet";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };

const organizationId = "organizations:1";
const userId = "users:1";

function createHarness() {
  const tables = new Map<string, Row[]>();
  const deletedStorageIds: string[] = [];
  let sequence = 10;

  const seed = (table: string, id: string, value: Record<string, unknown>) => {
    const row: Row = { _id: id, _creationTime: sequence++, ...value };
    tables.set(table, [...(tables.get(table) ?? []), row]);
    return row;
  };

  seed("organizations", organizationId, { status: "active" });
  seed("users", userId, {
    authSubject: "operator-subject",
    organizationId,
    roles: ["admin"],
    status: "active"
  });
  seed("rndcInsurers", "rndcInsurers:1", {
    insurerNit: "8600095786",
    name: "SEGUROS DEL ESTADO"
  });
  seed("rndcVehicleLines", "rndcVehicleLines:1", {
    makeCode: "169",
    makeName: "FREIGHTLINER",
    lineCode: "M2",
    lineName: "M2"
  });
  seed("rndcBodyTypes", "rndcBodyTypes:1", {
    code: "285",
    description: "PLATAFORMA"
  });

  const matchingRows = (table: string, filters: Record<string, unknown>) =>
    (tables.get(table) ?? []).filter((row) =>
      Object.entries(filters).every(([key, value]) => row[key] === value)
    );

  const db = {
    query(table: string) {
      let filters: Record<string, unknown> = {};
      let descending = false;
      const chain = {
        withIndex(_index: string, apply: (builder: { eq: (field: string, value: unknown) => unknown }) => unknown) {
          const builder = {
            eq(field: string, value: unknown) {
              filters[field] = value;
              return builder;
            }
          };
          apply(builder);
          return chain;
        },
        order(direction: string) {
          descending = direction === "desc";
          return chain;
        },
        async collect() {
          const rows = matchingRows(table, filters);
          return descending ? [...rows].reverse() : rows;
        },
        async unique() {
          const rows = matchingRows(table, filters);
          if (rows.length > 1) throw new Error("Expected a unique row");
          return rows[0] ?? null;
        },
        async first() {
          const rows = matchingRows(table, filters);
          return (descending ? rows.at(-1) : rows[0]) ?? null;
        },
        async take(limit: number) {
          return matchingRows(table, filters).slice(0, limit);
        }
      };
      return chain;
    },
    async get(table: string, id: string) {
      return (tables.get(table) ?? []).find((row) => row._id === id) ?? null;
    },
    async insert(table: string, value: Record<string, unknown>) {
      const id = `${table}:${sequence++}`;
      seed(table, id, value);
      return id;
    },
    async patch(id: string, value: Record<string, unknown>) {
      for (const rows of tables.values()) {
        const row = rows.find((candidate) => candidate._id === id);
        if (row) {
          Object.assign(row, value);
          return;
        }
      }
      throw new Error(`Missing row ${id}`);
    },
    async delete(id: string) {
      for (const [table, rows] of tables) {
        const next = rows.filter((row) => row._id !== id);
        if (next.length !== rows.length) {
          tables.set(table, next);
          return;
        }
      }
    },
    system: {
      async get() {
        return null;
      }
    }
  };

  const ctx = {
    auth: {
      async getUserIdentity() {
        return { subject: "operator-subject" };
      }
    },
    db,
    storage: {
      async delete(storageId: string) {
        deletedStorageIds.push(storageId);
      }
    }
  };

  return {
    ctx,
    seed,
    rows: (table: string) => tables.get(table) ?? [],
    deletedStorageIds
  };
}

function seedThirdParty(
  harness: ReturnType<typeof createHarness>,
  id: string,
  document: string,
  roles: string[]
) {
  return harness.seed("thirdParties", id, {
    organizationId,
    personType: "natural",
    documentType: "C",
    document,
    name: `TERCERO ${document}`,
    firstNames: "TERCERO",
    firstLastName: document,
    address: "CALLE 1",
    cityCode: "11001000",
    phone: "6015550000",
    taxRegime: "simple",
    roles,
    createdAt: 1,
    updatedAt: 1
  });
}

function seedDriver(harness: ReturnType<typeof createHarness>, id: string, document: string) {
  return harness.seed("drivers", id, {
    organizationId,
    documentType: "C",
    document,
    name: `CONDUCTOR ${document}`,
    licenseNumber: `LIC-${document}`,
    licenseCategory: "C3",
    licenseExpiresAt: "2030-12-31",
    createdAt: 1,
    updatedAt: 1
  });
}

function validDriverInput(document = "1000000001") {
  return {
    documentType: "C",
    document,
    firstNames: "ANA MARIA",
    firstLastName: "PEREZ",
    birthDate: "1990-01-02",
    bloodType: "O+",
    address: "CALLE 10",
    cityCode: "11001000",
    phone1: "6015551000",
    cellphone: "3005551000",
    rating: "5",
    licenseNumber: "LIC-100",
    licenseCategory: "C3",
    licenseExpiresAt: "2030-12-31",
    activities: { owner: false, possessor: false, employee: false }
  };
}

function validThirdPartyInput(document = "1000000002") {
  return {
    personType: "natural" as const,
    documentType: "C",
    document,
    firstNames: "CARLOS",
    firstLastName: "ROJAS",
    address: "CALLE 20",
    cityCode: "11001000",
    phone1: "6015552000",
    taxRegime: "simple",
    roles: ["sender" as const]
  };
}

function validTrailerInput(ownerThirdPartyId: string, linkedVehicleId?: string) {
  return {
    plate: "R12345",
    linkedVehicleId,
    make: "RANDON",
    modelYear: "2026",
    configuration: "S3",
    capacityKg: 32000,
    emptyWeightKg: 6800,
    widthM: 2.6,
    heightM: 3.9,
    lengthM: 12.5,
    ownerThirdPartyId,
    bodyType: "64",
    status: "available" as const
  };
}

function validVehicleInput(ownerThirdPartyId: string, possessorThirdPartyId: string, driverId: string) {
  return {
    plate: "ABC123",
    make: "FREIGHTLINER",
    line: "M2",
    modelYear: "2026",
    color: "8",
    bodyType: "PLATAFORMA",
    configuration: "Tractocamión de 3 ejes",
    rndcMakeCode: "169",
    rndcBodyTypeCode: "285",
    rndcConfigurationCode: "54",
    fuelType: "Diésel o ACPM",
    rndcFuelCode: "1",
    linkType: "owned",
    engineNumber: "MOTOR-123",
    capacityTn: "32",
    emptyWeightTn: "9",
    transitLicenseNumber: "LIC-TRANS-123",
    rating: "5",
    insurerNit: "8600095786",
    soatExpiresAt: "2030-12-31",
    soatNumber: "SOAT-123",
    ownerThirdPartyId,
    possessorThirdPartyId,
    driverId,
    vehicleKind: "cabezote",
    status: "active"
  };
}

async function invoke<T>(mutation: unknown, ctx: unknown, args: unknown): Promise<T> {
  return await (mutation as { _handler: (ctx: unknown, args: unknown) => Promise<T> })._handler(ctx, args);
}

test("master mutations reject every field marked required by the forms", async (t) => {
  for (const field of ["birthDate", "bloodType", "phone1", "rating"] as const) {
    await t.test(`driver ${field}`, async () => {
      const harness = createHarness();
      await assert.rejects(
        invoke(createDriverMaster, harness.ctx, { input: { ...validDriverInput(), [field]: "" } }),
        /obligatorio/i
      );
    });
  }

  for (const field of ["address", "cityCode", "phone1", "taxRegime"] as const) {
    await t.test(`third party ${field}`, async () => {
      const harness = createHarness();
      await assert.rejects(
        invoke(createThirdPartyMaster, harness.ctx, { input: { ...validThirdPartyInput(), [field]: "" } }),
        /obligatorio/i
      );
    });
  }

  for (const field of ["make", "modelYear", "configuration", "bodyType"] as const) {
    await t.test(`trailer ${field}`, async () => {
      const harness = createHarness();
      const owner = seedThirdParty(harness, "thirdParties:owner", "900000001", ["owner"]);
      await assert.rejects(
        invoke(createTrailerMaster, harness.ctx, {
          input: { ...validTrailerInput(owner._id), [field]: "" }
        }),
        /obligatorio/i
      );
    });
  }

  for (const field of [
    "make",
    "line",
    "color",
    "bodyType",
    "configuration",
    "linkType",
    "engineNumber",
    "transitLicenseNumber",
    "rating",
    "vehicleKind",
    "status",
    "rndcMakeCode",
    "rndcBodyTypeCode",
    "rndcConfigurationCode",
    "fuelType",
    "rndcFuelCode"
  ] as const) {
    await t.test(`vehicle ${field}`, async () => {
      const harness = createHarness();
      const owner = seedThirdParty(harness, "thirdParties:owner", "900000001", ["owner"]);
      const possessor = seedThirdParty(harness, "thirdParties:possessor", "900000002", ["possessor"]);
      const driver = seedDriver(harness, "drivers:primary", "1000000001");
      await assert.rejects(
        invoke(createVehicleMaster, harness.ctx, {
          input: { ...validVehicleInput(owner._id, possessor._id, driver._id), [field]: "" }
        }),
        /obligatorio|no es valido/i
      );
    });
  }
});

test("vehicle creation adds owner and possessor roles without replacing existing roles", async () => {
  const harness = createHarness();
  const party = seedThirdParty(harness, "thirdParties:shared", "900000001", ["commercial"]);
  const driver = seedDriver(harness, "drivers:primary", "1000000001");

  await invoke(createVehicleMaster, harness.ctx, {
    input: validVehicleInput(party._id, party._id, driver._id)
  });

  assert.deepEqual(new Set(party.roles as string[]), new Set(["commercial", "owner", "possessor"]));
});

test("legal third-party creation enriches the existing full NIT identity", async () => {
  const harness = createHarness();
  const existing = harness.seed("thirdParties", "thirdParties:legal", {
    organizationId,
    personType: "legal",
    documentType: "N",
    document: "8600095786",
    verificationDigit: "6",
    legalName: "TRANSPORTES MTM SAS",
    name: "TRANSPORTES MTM SAS",
    address: "CALLE 20",
    cityCode: "11001000",
    phone: "6015552000",
    taxRegime: "simple",
    roles: ["transport_company"],
    createdAt: 1,
    updatedAt: 1
  });

  const result = await invoke<{ id: string }>(createThirdPartyMaster, harness.ctx, {
    input: {
      personType: "legal",
      documentType: "N",
      document: "860009578",
      verificationDigit: "6",
      legalName: "TRANSPORTES MTM SAS",
      address: "CALLE 20",
      cityCode: "11001000",
      phone1: "6015552000",
      taxRegime: "simple",
      roles: ["transport_company"]
    }
  });

  assert.equal(result.id, existing._id);
  assert.equal(harness.rows("thirdParties").length, 1);
});

test("trailer creation adds the owner role without replacing existing roles", async () => {
  const harness = createHarness();
  const owner = seedThirdParty(harness, "thirdParties:owner", "900000001", ["commercial"]);

  await invoke(createTrailerMaster, harness.ctx, { input: validTrailerInput(owner._id) });

  assert.deepEqual(new Set(owner.roles as string[]), new Set(["commercial", "owner"]));
});

test("replacing a vehicle primary driver leaves exactly one primary relation", async () => {
  const harness = createHarness();
  const owner = seedThirdParty(harness, "thirdParties:owner", "900000001", ["owner"]);
  const possessor = seedThirdParty(harness, "thirdParties:possessor", "900000002", ["possessor"]);
  const firstDriver = seedDriver(harness, "drivers:first", "1000000001");
  const secondDriver = seedDriver(harness, "drivers:second", "1000000002");

  await invoke(createVehicleMaster, harness.ctx, {
    input: validVehicleInput(owner._id, possessor._id, firstDriver._id)
  });
  await invoke(createVehicleMaster, harness.ctx, {
    input: validVehicleInput(owner._id, possessor._id, secondDriver._id)
  });

  const primary = harness.rows("driverVehicles").filter((relation) =>
    (relation.roles as string[] | undefined)?.includes("primary")
  );
  assert.equal(primary.length, 1);
  assert.equal(primary[0]?.driverId, secondDriver._id);
});

test("replacing a legacy primary driver migrates the relation without creating a duplicate", async () => {
  const harness = createHarness();
  const owner = seedThirdParty(harness, "thirdParties:owner", "900000001", ["owner"]);
  const possessor = seedThirdParty(harness, "thirdParties:possessor", "900000002", ["possessor"]);
  const firstDriver = seedDriver(harness, "drivers:first", "1000000001");
  const secondDriver = seedDriver(harness, "drivers:second", "1000000002");

  await invoke(createVehicleMaster, harness.ctx, {
    input: validVehicleInput(owner._id, possessor._id, firstDriver._id)
  });
  const legacyRelation = harness.rows("driverVehicles")[0];
  delete legacyRelation?.organizationId;

  await invoke(createVehicleMaster, harness.ctx, {
    input: validVehicleInput(owner._id, possessor._id, secondDriver._id)
  });

  const primary = harness.rows("driverVehicles").filter((relation) =>
    (relation.roles as string[] | undefined)?.includes("primary")
  );
  assert.equal(primary.length, 1);
  assert.equal(primary[0]?.driverId, secondDriver._id);
  assert.equal(primary[0]?.organizationId, organizationId);
});

test("manual linking reuses a matching legacy relation", async () => {
  const harness = createHarness();
  const driver = seedDriver(harness, "drivers:primary", "1000000001");
  const vehicle = harness.seed("vehicles", "vehicles:primary", {
    organizationId,
    plate: "ABC123",
    createdAt: 1,
    updatedAt: 1
  });
  harness.seed("driverVehicles", "driverVehicles:legacy", {
    driverId: driver._id,
    vehicleId: vehicle._id,
    driverDocument: driver.document,
    vehiclePlate: vehicle.plate,
    roles: ["primary"],
    createdAt: 1,
    updatedAt: 1
  });

  await invoke(linkDriverVehicle, harness.ctx, { plate: vehicle.plate, document: driver.document });

  const relations = harness.rows("driverVehicles");
  assert.equal(relations.length, 1);
  assert.equal(relations[0]?.organizationId, organizationId);
  assert.equal(relations[0]?.matchConfidence, "confirmed");
});

test("manual unlinking removes a matching legacy relation", async () => {
  const harness = createHarness();
  const driver = seedDriver(harness, "drivers:primary", "1000000001");
  const vehicle = harness.seed("vehicles", "vehicles:primary", {
    organizationId,
    plate: "ABC123",
    createdAt: 1,
    updatedAt: 1
  });
  harness.seed("driverVehicles", "driverVehicles:legacy", {
    driverId: driver._id,
    vehicleId: vehicle._id,
    driverDocument: driver.document,
    vehiclePlate: vehicle.plate,
    roles: ["primary"],
    createdAt: 1,
    updatedAt: 1
  });

  await invoke(unlinkDriverVehicle, harness.ctx, { plate: vehicle.plate, document: driver.document });

  assert.equal(harness.rows("driverVehicles").length, 0);
});

test("fleet replay migrates a matching legacy relation instead of inserting another", async () => {
  const harness = createHarness();
  const driver = seedDriver(harness, "drivers:primary", "1000000001");
  const vehicle = harness.seed("vehicles", "vehicles:primary", {
    organizationId,
    plate: "ABC123",
    createdAt: 1,
    updatedAt: 1
  });
  harness.seed("driverVehicles", "driverVehicles:legacy", {
    driverId: driver._id,
    vehicleId: vehicle._id,
    driverDocument: driver.document,
    vehiclePlate: vehicle.plate,
    roles: ["primary"],
    createdAt: 1,
    updatedAt: 1
  });
  const previousKey = process.env.RNDC_INGEST_KEY;
  process.env.RNDC_INGEST_KEY = "test-key";

  try {
    const result = await invoke<{ relationsInserted: number; relationsUpdated: number }>(upsertFleetBatch, harness.ctx, {
      ingestKey: "test-key",
      organizationId,
      drivers: [],
      vehicles: [],
      relations: [{ driverDocument: driver.document, vehiclePlate: vehicle.plate, roles: ["primary"] }]
    });

    assert.equal(result.relationsInserted, 0);
    assert.equal(result.relationsUpdated, 1);
    assert.equal(harness.rows("driverVehicles").length, 1);
    assert.equal(harness.rows("driverVehicles")[0]?.organizationId, organizationId);
  } finally {
    if (previousKey === undefined) delete process.env.RNDC_INGEST_KEY;
    else process.env.RNDC_INGEST_KEY = previousKey;
  }
});

test("creating a linked trailer synchronizes the vehicle side of the relationship", async () => {
  const harness = createHarness();
  const owner = seedThirdParty(harness, "thirdParties:owner", "900000001", ["owner"]);
  const possessor = seedThirdParty(harness, "thirdParties:possessor", "900000002", ["possessor"]);
  const driver = seedDriver(harness, "drivers:primary", "1000000001");
  const vehicle = await invoke<{ id: string }>(createVehicleMaster, harness.ctx, {
    input: validVehicleInput(owner._id, possessor._id, driver._id)
  });

  const trailer = await invoke<{ id: string }>(createTrailerMaster, harness.ctx, {
    input: validTrailerInput(owner._id, vehicle.id)
  });

  const storedVehicle = harness.rows("vehicles").find((row) => row._id === vehicle.id);
  assert.equal(storedVehicle?.defaultTrailerId, trailer.id);
  assert.equal(storedVehicle?.trailer, "R12345");
});

test("creating a vehicle with a default trailer synchronizes the trailer side", async () => {
  const harness = createHarness();
  const owner = seedThirdParty(harness, "thirdParties:owner", "900000001", ["owner"]);
  const possessor = seedThirdParty(harness, "thirdParties:possessor", "900000002", ["possessor"]);
  const driver = seedDriver(harness, "drivers:primary", "1000000001");
  const trailer = await invoke<{ id: string }>(createTrailerMaster, harness.ctx, {
    input: validTrailerInput(owner._id)
  });

  const vehicle = await invoke<{ id: string }>(createVehicleMaster, harness.ctx, {
    input: { ...validVehicleInput(owner._id, possessor._id, driver._id), defaultTrailerId: trailer.id }
  });

  const storedTrailer = harness.rows("trailers").find((row) => row._id === trailer.id);
  assert.equal(storedTrailer?.linkedVehicleId, vehicle.id);
});

test("a vehicle rejects a second trailer assignment instead of creating inconsistent links", async () => {
  const harness = createHarness();
  const owner = seedThirdParty(harness, "thirdParties:owner", "900000001", ["owner"]);
  const possessor = seedThirdParty(harness, "thirdParties:possessor", "900000002", ["possessor"]);
  const driver = seedDriver(harness, "drivers:primary", "1000000001");
  const firstTrailer = await invoke<{ id: string }>(createTrailerMaster, harness.ctx, {
    input: validTrailerInput(owner._id)
  });
  const vehicle = await invoke<{ id: string }>(createVehicleMaster, harness.ctx, {
    input: { ...validVehicleInput(owner._id, possessor._id, driver._id), defaultTrailerId: firstTrailer.id }
  });

  await assert.rejects(
    invoke(createTrailerMaster, harness.ctx, {
      input: { ...validTrailerInput(owner._id, vehicle.id), plate: "R54321" }
    }),
    /conflicto|otro remolque|ya tiene/i
  );
});

test("discarding provisional uploads preserves files already attached to a master", async () => {
  const harness = createHarness();
  harness.seed("masterAttachments", "masterAttachments:1", {
    organizationId,
    storageId: "storage:finalized",
    resourceType: "driver",
    resourceId: "drivers:1",
    slot: "profile"
  });

  const deleted = await invoke<number>(discardMasterUploads, harness.ctx, {
    storageIds: ["storage:provisional", "storage:finalized"]
  });

  assert.equal(deleted, 1);
  assert.deepEqual(harness.deletedStorageIds, ["storage:provisional"]);
});

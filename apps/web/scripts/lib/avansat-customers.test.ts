import assert from "node:assert/strict";
import test from "node:test";
import {
  certifyAvansatCustomerArtifact,
  chunkAvansatCustomers,
  deterministicAvansatCustomerRunId,
  hashAvansatCustomerBatch,
  verifyAvansatCustomerReadback,
  normalizeAvansatCustomer
} from "./avansat-customers.js";

const capturedAt = "2026-08-29T15:00:00.000Z";

function rawCustomer(document = "804010412") {
  return {
    list: {
      document,
      name: "  AGROMILENIO S.A.S ",
      phone: "3132849756",
      address: "CARRERA 35W # 71-37 BDGA 59 PRQRO ",
      status: "Habilitado"
    },
    detail: {
      identificationType: "NIT",
      identification: `${document} - `,
      name: "AGROMILENIO S.A.S",
      shortName: "  AGROMILENIO S.A.S",
      city: "BUCARAMANGA (Sant)",
      address: "CARRERA 35W # 71-37 BDGA 59 PRQRO ",
      phone: "3132849756",
      taxRegime: "Regimen Comun",
      economicActivity: "4690",
      observations: "",
      legalRepresentative: "",
      primaryContact: "",
      logisticsContact: "",
      securityContact: "",
      commercialContact: "",
      administrativeContact: "",
      siteName: "(BUCARAMANGA (SANT))",
      siteCity: "BUCARAMANGA (Sant)",
      siteAddress: "CARRERA 35W # 71-37 BDGA 59 PRQRO ",
      contactPhone: "3132849756",
      contactName: "maryuri",
      fax: "",
      website: "",
      email: "contabilidad@agromilenosa.com",
      accessRestrictions: "",
      instructions: "",
      isoCertified: false,
      bascCertified: false,
      selfWithholding: false,
      vatSelfWithholding: false,
      rawFields: { cod_tipdoc: "NIT", cod_tercer: `${document} - ` }
    }
  };
}

test("normalizes a complete Avansat customer without losing source detail", () => {
  const normalized = normalizeAvansatCustomer(rawCustomer(), capturedAt);

  assert.equal(normalized.customer.code, "804010412");
  assert.equal(normalized.customer.identificationType, "NIT");
  assert.equal(normalized.customer.status, "active");
  assert.equal(normalized.customer.email, "contabilidad@agromilenosa.com");
  assert.deepEqual(normalized.location, {
    code: "PRINCIPAL",
    name: "Principal",
    kind: "both",
    address: "CARRERA 35W # 71-37 BDGA 59 PRQRO",
    city: "BUCARAMANGA (Sant)",
    contactName: "maryuri",
    contactPhone: "3132849756",
    status: "active"
  });
  assert.equal(normalized.source.taxRegime, "Regimen Comun");
  assert.equal(normalized.source.economicActivity, "4690");
  assert.match(normalized.contentHash, /^[0-9a-f]{64}$/);
});

test("maps disabled customers to inactive and rejects a list-detail identity mismatch", () => {
  const disabled = rawCustomer("900653156");
  disabled.list.status = "Inhabilitado";
  disabled.detail.identification = "900653156 - ";
  assert.equal(normalizeAvansatCustomer(disabled, capturedAt).customer.status, "inactive");

  const mismatch = rawCustomer("900653156");
  mismatch.detail.identification = "900000000 - ";
  assert.throws(() => normalizeAvansatCustomer(mismatch, capturedAt), /identificación/i);
});

test("certifies exact unique coverage and creates a stable manifest", () => {
  const second = rawCustomer("900345431");
  second.detail.identification = "900345431 - ";
  second.detail.name = "AGROPAISA S.AS.";
  second.list.name = "AGROPAISA S.AS.";
  const artifact = { capturedAt, expectedTotal: 2, customers: [rawCustomer(), second] };
  const first = certifyAvansatCustomerArtifact(artifact);
  const reordered = certifyAvansatCustomerArtifact({ ...artifact, customers: [...artifact.customers].reverse() });

  assert.deepEqual(first.stats, { total: 2, active: 2, inactive: 0, withEmail: 2, withLocation: 2 });
  assert.equal(first.manifestHash, reordered.manifestHash);
  assert.equal(deterministicAvansatCustomerRunId(first.manifestHash), deterministicAvansatCustomerRunId(reordered.manifestHash));
});

test("rejects incomplete and duplicate customer artifacts", () => {
  const single = rawCustomer();
  assert.throws(
    () => certifyAvansatCustomerArtifact({ capturedAt, expectedTotal: 2, customers: [single] }),
    /esperaban 2/i
  );
  assert.throws(
    () => certifyAvansatCustomerArtifact({ capturedAt, expectedTotal: 2, customers: [single, single] }),
    /duplicada/i
  );
});

test("splits prepared customers into bounded batches", () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({ index }));
  assert.deepEqual(chunkAvansatCustomers(rows, 50).map((batch) => batch.length), [50, 50, 1]);
  assert.throws(() => chunkAvansatCustomers(rows, 201), /entre 1 y 200/i);
});

test("hashes batches deterministically and verifies stored customer state", () => {
  const prepared = normalizeAvansatCustomer(rawCustomer(), capturedAt);
  assert.match(hashAvansatCustomerBatch(0, [prepared]), /^[0-9a-f]{64}$/);
  const verification = verifyAvansatCustomerReadback([prepared], [{
    document: prepared.customer.identificationNumber,
    code: prepared.customer.code,
    name: prepared.customer.name,
    identificationType: prepared.customer.identificationType,
    email: prepared.customer.email,
    phone: prepared.customer.phone,
    status: prepared.customer.status,
    sourceContentHash: prepared.contentHash,
    sourceCapturedAt: capturedAt,
    location: prepared.location ?? null
  }]);

  assert.deepEqual(verification, { expected: 1, stored: 1, matched: 1, extras: 0 });
  assert.throws(() => verifyAvansatCustomerReadback([prepared], [{
    document: prepared.customer.identificationNumber,
    code: prepared.customer.code,
    name: "DIFFERENT",
    identificationType: prepared.customer.identificationType,
    email: prepared.customer.email,
    phone: prepared.customer.phone,
    status: prepared.customer.status,
    sourceContentHash: prepared.contentHash,
    sourceCapturedAt: capturedAt,
    location: prepared.location ?? null
  }]), /diferente/i);
});

test("ignores duplicate legacy identifiers that are outside the certified Avansat set", () => {
  const prepared = normalizeAvansatCustomer(rawCustomer(), capturedAt);
  const expectedStored = {
    document: prepared.customer.identificationNumber,
    code: prepared.customer.code,
    name: prepared.customer.name,
    identificationType: prepared.customer.identificationType,
    email: prepared.customer.email,
    phone: prepared.customer.phone,
    status: prepared.customer.status,
    sourceContentHash: prepared.contentHash,
    sourceCapturedAt: capturedAt,
    location: prepared.location ?? null
  };
  const legacy = { ...expectedStored, document: "8320041044", code: "CLI-DEMO", sourceContentHash: undefined, sourceCapturedAt: undefined };
  const verification = verifyAvansatCustomerReadback([prepared], [expectedStored, legacy, legacy]);
  assert.deepEqual(verification, { expected: 1, stored: 3, matched: 1, extras: 2 });
});

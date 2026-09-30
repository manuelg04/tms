import assert from "node:assert/strict";
import test from "node:test";
import { trackingFixture } from "../testing/tracking-fixtures";

test("mirror publishes whole batches atomically, retries idempotently and retains historical records", async () => {
  process.env.RNDC_INGEST_KEY = "isolated-mirror-key";
  const f = await trackingFixture(),
    serviceKey = "isolated-mirror-key";
  const evidenceId = await f.t.run((ctx) =>
    ctx.storage.store(new Blob(["isolated evidence"])),
  );
  const start = {
    serviceKey,
    companyRndcNit: "9000000011",
    process: 4,
    from: "2026-09-01",
    to: "2026-09-29",
    externalId: "query-1",
    startedAt: "2026-09-29T00:00:00Z",
    finishedAt: "2026-09-29T00:00:01Z",
    evidenceId,
  };
  const runId = await f.admin.mutation(f.api.mirror.startRun, start);
  const record = {
    radicado: "1001",
    date: "2026-09-29",
    documentDate: "2026-09-29",
    manifest: "44",
    remesa: "",
    plate: "TST001",
    fields: {
      INGRESOID: "1001",
      NUMMANIFIESTOCARGA: "000044",
      FECHAING: "29/09/2026 11:00",
    },
  };
  await f.admin.mutation(f.api.mirror.ingest, {
    serviceKey,
    runId,
    records: [record],
  });
  await f.admin.mutation(f.api.mirror.ingest, {
    serviceKey,
    runId,
    records: [record],
  });
  const listArgs = { process: 4, from: start.from, to: start.to, search: "" };
  assert.equal(
    (await f.admin.query(f.api.mirror.list, listArgs)).records.length,
    0,
  );
  await assert.rejects(() =>
    f.admin.mutation(f.api.mirror.finishRun, { serviceKey, runId, count: 2 }),
  );
  await f.admin.mutation(f.api.mirror.finishRun, {
    serviceKey,
    runId,
    count: 1,
  });
  await f.admin.mutation(f.api.mirror.finishRun, {
    serviceKey,
    runId,
    count: 1,
  });
  assert.equal(
    (await f.admin.query(f.api.mirror.list, listArgs)).records.length,
    1,
  );
  assert.equal(await f.admin.mutation(f.api.mirror.startRun, start), runId);
  const empty = await f.admin.mutation(f.api.mirror.startRun, {
    ...start,
    externalId: "query-empty",
  });
  await f.admin.mutation(f.api.mirror.finishRun, {
    serviceKey,
    runId: empty,
    count: 0,
  });
  assert.equal(
    (await f.admin.query(f.api.mirror.list, listArgs)).records.length,
    1,
  );
  const remesaRun = await f.admin.mutation(f.api.mirror.startRun, {
    ...start,
    process: 3,
    externalId: "query-remesa",
  });
  const remesa = {
    ...record,
    radicado: "2001",
    remesa: "55",
    fields: { ...record.fields, INGRESOID: "2001", CONSECUTIVOREMESA: "55" },
  };
  await f.admin.mutation(f.api.mirror.ingest, {
    serviceKey,
    runId: remesaRun,
    records: [remesa],
  });
  await f.admin.mutation(f.api.mirror.finishRun, {
    serviceKey,
    runId: remesaRun,
    count: 1,
  });
  const item = (await f.admin.query(f.api.mirror.list, listArgs)).records[0];
  const detail = await f.auditor.query(f.api.mirror.related, {
    recordId: item._id,
  });
  assert.equal(detail.manifestRecords.length, 2);
  assert.ok(detail.evidenceUrl);
  await assert.rejects(() =>
    f.auditor.mutation(f.api.mirror.startRun, {
      ...start,
      externalId: "forbidden",
    }),
  );
  await assert.rejects(() =>
    f.admin.mutation(f.api.mirror.startRun, { ...start, serviceKey: "wrong" }),
  );
  await f.t.run(async (ctx) => {
    const other = await ctx.db.insert("organizations", {
      name: "Otra",
      slug: "other",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.patch("rndcMirrorRecords", item._id, {
      organizationId: other,
    });
  });
  await assert.rejects(() =>
    f.admin.query(f.api.mirror.related, { recordId: item._id }),
  );
});

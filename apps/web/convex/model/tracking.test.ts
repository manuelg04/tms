import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { trackingFixture } from "../../testing/tracking-fixtures";
import { trackingWorkbook } from "../../app/control/components/tracking-excel";
import {
  filterTracking,
  sortTracking,
  queueColumns,
  normalizeAlarm,
  validateRequestedTime,
} from "./tracking";

test("tracking filters compose, searches stay local, and signed times sort numerically", async () => {
  const { admin, api } = await trackingFixture();
  const { rows } = await admin.query(api.tracking.board, {});
  assert.equal(
    filterTracking(rows, { origin: "santa", destination: "giron" }).length,
    2,
  );
  assert.equal(filterTracking(rows, { plate: "TST001" }).length, 1);
  assert.equal(filterTracking(rows, {}, "no-match").length, 0);
  assert.deepEqual(
    sortTracking(rows, { key: "time", direction: "asc" }).map(
      (r) => r.externalCode,
    ),
    ["70001", "70002", "70003"],
  );
  assert.deepEqual(
    sortTracking(rows, { key: "time", direction: "desc" }).map(
      (r) => r.externalCode,
    ),
    ["70002", "70001", "70003"],
  );
  assert.equal(queueColumns("en_route").length, 19);
  assert.equal(queueColumns("pending_arrival").length, 17);
});

test("Excel preserves leading zeroes, order, blanks, and all columns even with zero rows", async () => {
  const { admin, api } = await trackingFixture();
  const { rows } = await admin.query(api.tracking.board, {});
  for (const queue of ["en_route", "pending_arrival"] as const) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      (
        await trackingWorkbook(
          rows.filter((r) => r.queue === queue),
          queue,
        )
      ).bytes.buffer,
    );
    assert.equal(
      workbook.worksheets[0].getRow(1).cellCount,
      queue === "en_route" ? 19 : 17,
    );
    const index = queue === "en_route" ? 4 : 2;
    assert.match(
      String(workbook.worksheets[0].getCell(2, index).value),
      /^00000/,
    );
    const empty = new ExcelJS.Workbook();
    await empty.xlsx.load((await trackingWorkbook([], queue)).bytes.buffer);
    assert.equal(empty.worksheets[0].rowCount, 1);
    assert.equal(
      empty.worksheets[0].getRow(1).cellCount,
      queue === "en_route" ? 19 : 17,
    );
  }
});

test("a report persists once, creates a separate note, leaves repeated checkpoint names intact, and cannot be replayed with changed data", async () => {
  const { t, operator, api, ids } = await trackingFixture();
  const before = await operator.query(api.tracking.detail, {
    dispatchId: ids[0],
  });
  assert.equal(before.reports[0].position, undefined);
  const input = {
    dispatchId: ids[0],
    checkpointId: before.checkpoints[0]._id,
    incidentCode: "3",
    position: "A" as const,
    site: "CIENAGA",
    observation: "Seguimiento nuevo",
    requestedAt: "2026-09-05 05:00",
    requestKey: "request-1",
    expectedRevision: before.dispatch.revision,
  };
  const first = await operator.mutation(api.tracking.reportCheckpoint, input);
  assert.equal(
    await operator.mutation(api.tracking.reportCheckpoint, input),
    first,
  );
  const after = await operator.query(api.tracking.detail, {
    dispatchId: ids[0],
  });
  assert.equal(after.reports.length, before.reports.length + 1);
  assert.equal(after.notes.length, before.notes.length + 1);
  assert.equal(
    after.checkpoints.filter((c) => c.label === "CIENAGA" && !c.completed)
      .length,
    2,
  );
  assert.equal(after.dispatch.summary.time, undefined);
  assert.equal(after.dispatch.summary.alarmCode, undefined);
  assert.equal(after.dispatch.revision, 1);
  await assert.rejects(
    () =>
      operator.mutation(api.tracking.reportCheckpoint, {
        ...input,
        observation: "Otra cosa",
      }),
    /otros datos/,
  );
  await assert.rejects(
    () =>
      operator.mutation(api.tracking.reportCheckpoint, {
        ...input,
        requestKey: "request-2",
      }),
    /cambió/,
  );
  assert.equal(
    await t.run(
      async (ctx) => (await ctx.db.query("documents").collect()).length,
    ),
    0,
  );
  assert.equal(
    await t.run(
      async (ctx) => (await ctx.db.query("rndcOperations").collect()).length,
    ),
    0,
  );
});

test("report validation rejects time mismatches, oversized notes and cross-dispatch checkpoints before writing", async () => {
  const { operator, api, ids } = await trackingFixture();
  const before = await operator.query(api.tracking.detail, {
    dispatchId: ids[0],
  });
  const input = {
    dispatchId: ids[0],
    checkpointId: before.checkpoints[0]._id,
    incidentCode: "2",
    position: "A" as const,
    site: "CIENAGA",
    observation: "",
    requestKey: "validate",
    expectedRevision: 0,
  };
  await assert.rejects(
    () =>
      operator.mutation(api.tracking.reportCheckpoint, {
        ...input,
        observation: "a".repeat(501),
      }),
    /500/,
  );
  await assert.rejects(
    () =>
      operator.mutation(api.tracking.reportCheckpoint, {
        ...input,
        incidentCode: "1004",
      }),
    /fecha y hora/,
  );
  await assert.rejects(
    () =>
      operator.mutation(api.tracking.reportCheckpoint, {
        ...input,
        requestedAt: "2026-09-05 05:00",
      }),
    /no solicita/,
  );
  await assert.rejects(
    () =>
      operator.mutation(api.tracking.reportCheckpoint, {
        ...input,
        dispatchId: ids[1],
      }),
    /punto de control/,
  );
  const after = await operator.query(api.tracking.detail, {
    dispatchId: ids[0],
  });
  assert.equal(after.reports.length, before.reports.length);
});

test("delivery requires the fixed site and stays pending arrival without an official fulfillment", async () => {
  const { operator, api, ids } = await trackingFixture();
  const detail = await operator.query(api.tracking.detail, {
    dispatchId: ids[0],
  });
  const input = {
    dispatchId: ids[0],
    checkpointId: detail.checkpoints[3]._id,
    incidentCode: "2",
    position: "A" as const,
    site: "Lugar Entrega",
    observation: "",
    requestKey: "delivery",
    expectedRevision: 0,
  };
  await assert.rejects(
    () => operator.mutation(api.tracking.reportCheckpoint, input),
    /lugar de entrega/,
  );
  await operator.mutation(api.tracking.reportCheckpoint, {
    ...input,
    position: "S",
  });
  const after = await operator.query(api.tracking.detail, {
    dispatchId: ids[0],
  });
  assert.equal(after.dispatch.queue, "pending_arrival");
  assert.equal(after.checkpoints[3].completed, true);
});

test("roles and organization boundaries protect reads, reports and alarm changes", async () => {
  const { t, admin, auditor, operator, api, ids } = await trackingFixture();
  await assert.rejects(() => t.query(api.tracking.board, {}), /UNAUTHORIZED/);
  assert.equal(
    (await auditor.query(api.tracking.detail, { dispatchId: ids[0] }))
      .canReport,
    false,
  );
  const detail = await admin.query(api.tracking.detail, { dispatchId: ids[0] });
  const report = {
    dispatchId: ids[0],
    checkpointId: detail.checkpoints[0]._id,
    incidentCode: "2",
    position: "A" as const,
    site: "CIENAGA",
    observation: "",
    requestKey: "protected",
    expectedRevision: 0,
  };
  await assert.rejects(
    () => auditor.mutation(api.tracking.reportCheckpoint, report),
    /permiso/,
  );
  await assert.rejects(
    () =>
      operator.mutation(api.tracking.saveAlarm, {
        name: "Test",
        minutes: "10",
        color: "FF0000",
      }),
    /FORBIDDEN/,
  );
  await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Otra",
      slug: "other",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("users", {
      organizationId,
      actorToken: "foreign",
      authSubject: "foreign",
      name: "Otro",
      email: "other@test.invalid",
      roles: ["admin"],
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
  });
  const foreign = t.withIdentity({ subject: "foreign" });
  assert.equal((await foreign.query(api.tracking.board, {})).rows.length, 0);
  await assert.rejects(
    () => foreign.query(api.tracking.detail, { dispatchId: ids[0] }),
    /another organization/,
  );
  await assert.rejects(
    () => foreign.mutation(api.tracking.reportCheckpoint, report),
    /another organization/,
  );
  const alarm = (await admin.query(api.tracking.alarms, {})).alarms[0];
  await assert.rejects(
    () =>
      foreign.mutation(api.tracking.deleteAlarm, {
        alarmId: alarm._id,
        expectedRevision: alarm.revision,
      }),
    /another organization/,
  );
});

test("alarm edits reach the board, stale writes are rejected, deletion stays deleted after catalogue replay", async () => {
  const { t, admin, api, internal, organizationId } = await trackingFixture();
  const before = (await admin.query(api.tracking.alarms, {})).alarms;
  const alarm = before[0];
  await admin.mutation(api.tracking.saveAlarm, {
    alarmId: alarm._id,
    expectedRevision: 0,
    name: "Salida",
    minutes: "2",
    color: "#112233",
  });
  assert.equal(
    (await admin.query(api.tracking.board, {})).alarms.find(
      (a) => a._id === alarm._id,
    )?.color,
    "112233",
  );
  await assert.rejects(
    () =>
      admin.mutation(api.tracking.deleteAlarm, {
        alarmId: alarm._id,
        expectedRevision: 0,
      }),
    /cambió/,
  );
  for (const item of (await admin.query(api.tracking.alarms, {})).alarms)
    await admin.mutation(api.tracking.deleteAlarm, {
      alarmId: item._id,
      expectedRevision: item.revision,
    });
  assert.deepEqual((await admin.query(api.tracking.alarms, {})).alarms, []);
  assert.deepEqual(
    await t.mutation(internal.trackingImport.installReferenceCatalogues, {
      organizationId,
    }),
    { incidents: 0, alarms: 0 },
  );
  assert.deepEqual((await admin.query(api.tracking.board, {})).alarms, []);
  const created = await admin.mutation(api.tracking.saveAlarm, {
    name: "Nueva",
    minutes: "60",
    color: "FF0000",
  });
  assert.equal(
    (await admin.query(api.tracking.alarms, {})).alarms[0]._id,
    created,
  );
});

test("locations match after five characters, retain duplicate descriptions, and respect case", async () => {
  const { admin, api } = await trackingFixture();
  assert.deepEqual(
    await admin.query(api.tracking.locations, { search: "cien" }),
    [],
  );
  const lower = await admin.query(api.tracking.locations, { search: "ciena" });
  assert.equal(lower.length, 3);
  assert.deepEqual(
    await admin.query(api.tracking.locations, { search: "CIENA" }),
    lower,
  );
  assert.notEqual(lower[0].key, lower[2].key);
});

test("alarm and date validation rejects invalid values without silently rewriting them", () => {
  for (const minutes of ["-1", "1.5", "1000", "", "1e2"])
    assert.throws(() =>
      normalizeAlarm({ name: "Test", minutes, color: "FF0000" }),
    );
  assert.throws(() =>
    normalizeAlarm({ name: "Long alarm name", minutes: "10", color: "FF0000" }),
  );
  assert.throws(() => validateRequestedTime("2026-02-30 10:00"));
  assert.throws(() => validateRequestedTime("2026-09-05 25:00"));
  validateRequestedTime("2026-09-05 05:00");
});

test("concurrent controllers cannot overwrite each other and concurrent retries write once", async () => {
  const { admin, operator, api, ids } = await trackingFixture();
  const detail = await admin.query(api.tracking.detail, { dispatchId: ids[0] });
  const input = {
    dispatchId: ids[0],
    checkpointId: detail.checkpoints[0]._id,
    incidentCode: "2",
    position: "A" as const,
    site: "CIENAGA",
    observation: "Prueba simultánea",
    requestKey: "concurrent-1",
    expectedRevision: 0,
  };
  const result = await Promise.allSettled([
    admin.mutation(api.tracking.reportCheckpoint, input),
    operator.mutation(api.tracking.reportCheckpoint, {
      ...input,
      requestKey: "concurrent-2",
    }),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(result.filter((r) => r.status === "rejected").length, 1);
  const after = await admin.query(api.tracking.detail, { dispatchId: ids[0] });
  assert.equal(after.reports.length, detail.reports.length + 1);
  const retryInput = {
    ...input,
    requestKey: "concurrent-retry",
    expectedRevision: after.dispatch.revision,
  };
  const retries = await Promise.all([
    admin.mutation(api.tracking.reportCheckpoint, retryInput),
    admin.mutation(api.tracking.reportCheckpoint, retryInput),
  ]);
  assert.equal(retries[0], retries[1]);
  assert.equal(
    (await admin.query(api.tracking.detail, { dispatchId: ids[0] })).reports
      .length,
    after.reports.length + 1,
  );
});

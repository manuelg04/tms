import assert from "node:assert/strict";
import test from "node:test";
import { trackingFixture } from "../../testing/tracking-fixtures";
import { mirrorIntegration } from "../../testing/mirror-integration";

test("SOAP, gateway orchestration, evidence storage and Convex mirror form a consistent read-only flow", async () => {
  const fixture = await trackingFixture(),
    integration = await mirrorIntegration(fixture);
  const period = { from: "2026-09-01", to: "2026-09-29" };
  try {
    for (const processId of [4, 3, 6, 5, 32, 9, 29, 28])
      await integration.refresh({ ...period, process: processId });
    const list = await fixture.admin.query(fixture.api.mirror.list, {
      ...period,
      process: 4,
      search: "",
    });
    assert.equal(list.records.length, 1);
    assert.equal(list.runs.filter((r) => r.completed).length, 8);
    const detail = await fixture.admin.query(fixture.api.mirror.related, {
      recordId: list.records[0]._id,
    });
    assert.equal(detail.manifestRecords.length, 4);
    assert.ok(detail.evidenceUrl);
    await integration.refresh({ ...period, process: 4 });
    assert.equal(
      (
        await fixture.admin.query(fixture.api.mirror.list, {
          ...period,
          process: 4,
          search: "",
        })
      ).records.length,
      1,
    );
    integration.fail();
    await assert.rejects(() => integration.refresh({ ...period, process: 4 }));
    assert.equal(
      (
        await fixture.admin.query(fixture.api.mirror.list, {
          ...period,
          process: 4,
          search: "",
        })
      ).records.length,
      1,
    );
    assert.ok(
      integration.calls.every((body) =>
        body.includes("&lt;tipo&gt;3&lt;/tipo&gt;"),
      ),
    );
  } finally {
    await integration.close();
  }
});

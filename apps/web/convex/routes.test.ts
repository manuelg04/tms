import assert from "node:assert/strict";
import test from "node:test";
import { trackingFixture } from "../testing/tracking-fixtures";
import {
  operationalRouteStops,
  routeSchedule,
  validateRouteStops,
} from "./model/routes";

export const pointFixture = {
  code: "74",
  name: "BARRANQUILLA",
  city: "BARRANQUILLA",
  cityCode: "8001000",
  controller: "Controlador",
  address: "Llamada al conductor",
  phone: "",
  virtual: true,
  active: true,
  source: "avansat" as const,
  expectedRevision: 0,
};
export const routeFixture = {
  code: "803",
  origin: "BARRANQUILLA",
  originCode: "8001000",
  destination: "GIRON",
  destinationCode: "68307000",
  via: "SAN ALBERTO",
  active: true,
  source: "avansat" as const,
  expectedRevision: 0,
  stops: [
    { key: "first", pointCode: "74", minutes: 40 },
    { key: "second", pointCode: "74", minutes: 80 },
    { key: "delivery", pointCode: "9999", minutes: 1700 },
  ],
};

test("legacy route data survives import while scheduling requires usable times", async () => {
  const f = await trackingFixture();
  await f.admin.mutation(f.api.routes.savePoint, {
    ...pointFixture,
    longitude: "-74.1",
    name: " BARRANQUILLA ",
  });
  const stops = [
    {
      key: "old-0",
      pointCode: "74",
      minutes: "",
      kilometers: "",
      active: false,
      assigned: false,
    },
    {
      key: "old-1",
      pointCode: "9999",
      minutes: "",
      active: true,
      assigned: true,
    },
  ];
  await f.admin.mutation(f.api.routes.saveRoute, {
    ...routeFixture,
    originCode: "",
    stops,
  });
  const catalogue = await f.admin.query(f.api.routes.catalogue, {});
  assert.deepEqual(catalogue.routes[0].stops, stops);
  assert.equal(catalogue.points[0].longitude, "-74.1");
  assert.equal(catalogue.points[0].name, " BARRANQUILLA ");
  assert.throws(() => operationalRouteStops(stops));
  assert.deepEqual(
    operationalRouteStops([
      { key: "disabled", pointCode: "74", minutes: "", active: false },
      { key: "delivery", pointCode: "9999", minutes: "1700" },
    ]).map((s) => s.minutes),
    [1700],
  );
  assert.throws(() => validateRouteStops(stops));
});

test("routes preserve repeated points, immutable assigned revisions and report history", async () => {
  const f = await trackingFixture();
  await f.t.run(async (ctx) => {
    const dispatch = await ctx.db.get("trackingDispatches", f.ids[0]);
    await ctx.db.patch("trackingDispatches", f.ids[0], {
      summary: { ...dispatch!.summary, origin: "BARRANQUILLA" },
    });
  });
  await f.admin.mutation(f.api.routes.savePoint, pointFixture);
  const routeId = await f.admin.mutation(f.api.routes.saveRoute, routeFixture);
  const initial = await f.admin.query(f.api.tracking.detail, {
    dispatchId: f.ids[0],
  });
  const input = {
    dispatchId: f.ids[0],
    routeId,
    departureAt: "2026-09-29T22:30",
    expectedRevision: initial.dispatch.revision,
    expectedRouteRevision: 1,
    requestKey: "assignment-1",
  };
  const id = await f.operator.mutation(f.api.routes.assignPlan, input);
  assert.equal(await f.operator.mutation(f.api.routes.assignPlan, input), id);
  await assert.rejects(() =>
    f.operator.mutation(f.api.routes.assignPlan, {
      ...input,
      departureAt: "2026-09-29T22:31",
    }),
  );
  const after = await f.admin.query(f.api.tracking.detail, {
    dispatchId: f.ids[0],
  });
  assert.equal(after.checkpoints.length, 3);
  assert.equal(after.reports.length, initial.reports.length);
  assert.equal(after.checkpoints.at(-1)?.scheduledAt, "2026-10-01 02:50");
  assert.deepEqual(
    after.checkpoints.slice(0, 2).map((p) => p.code),
    ["74", "74"],
  );
  await f.admin.mutation(f.api.routes.saveRoute, {
    ...routeFixture,
    expectedRevision: 1,
    via: "OTRA VIA",
  });
  assert.equal(
    (await f.admin.query(f.api.routes.plan, { dispatchId: f.ids[0] }))?.via,
    "SAN ALBERTO",
  );
  await assert.rejects(() =>
    f.admin.mutation(f.api.routes.saveRoute, {
      ...routeFixture,
      expectedRevision: 1,
    }),
  );
  await f.t.run(async (ctx) => {
    await ctx.db.patch("trackingCheckpoints", after.checkpoints[0]._id, {
      completed: true,
    });
  });
  await assert.rejects(() =>
    f.admin.mutation(f.api.routes.assignPlan, {
      ...input,
      expectedRevision: after.dispatch.revision,
      expectedRouteRevision: 2,
      requestKey: "assignment-2",
    }),
  );
  assert.equal(
    (await f.admin.query(f.api.tracking.detail, { dispatchId: f.ids[0] }))
      .checkpoints[0]._id,
    after.checkpoints[0]._id,
  );
});
test("routes isolate organizations, enforce roles and validate planning before replacing checkpoints", async () => {
  const f = await trackingFixture();
  await f.t.run(async (ctx) => {
    const dispatch = await ctx.db.get("trackingDispatches", f.ids[0]);
    await ctx.db.patch("trackingDispatches", f.ids[0], {
      summary: { ...dispatch!.summary, origin: "BARRANQUILLA" },
    });
  });
  await assert.rejects(() =>
    f.auditor.mutation(f.api.routes.savePoint, pointFixture),
  );
  await assert.rejects(() => f.t.query(f.api.routes.catalogue, {}));
  await assert.rejects(() =>
    f.admin.mutation(f.api.routes.savePoint, {
      ...pointFixture,
      latitude: 99,
      longitude: 0,
    }),
  );
  await f.admin.mutation(f.api.routes.savePoint, pointFixture);
  await f.admin.mutation(f.api.routes.savePoint, {
    ...pointFixture,
    code: "10089",
  });
  assert.equal(
    (await f.auditor.query(f.api.routes.catalogue, {})).points.length,
    2,
  );
  await assert.rejects(() =>
    f.admin.mutation(f.api.routes.saveRoute, {
      ...routeFixture,
      stops: [
        { key: "x", pointCode: "no", minutes: 0 },
        { key: "d", pointCode: "9999", minutes: 5 },
      ],
    }),
  );
  const routeId = await f.admin.mutation(f.api.routes.saveRoute, routeFixture);
  const dispatch = await f.admin.query(f.api.tracking.detail, {
    dispatchId: f.ids[0],
  });
  await assert.rejects(() =>
    f.admin.mutation(f.api.routes.assignPlan, {
      dispatchId: f.ids[0],
      routeId,
      departureAt: "2026-02-30T08:00",
      expectedRevision: dispatch.dispatch.revision,
      expectedRouteRevision: 1,
      requestKey: "invalid-date",
    }),
  );
  assert.deepEqual(
    (await f.admin.query(f.api.tracking.detail, { dispatchId: f.ids[0] }))
      .checkpoints,
    dispatch.checkpoints,
  );
  await f.t.run(async (ctx) => {
    const org = await ctx.db.insert("organizations", {
      name: "Otra",
      slug: "other",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.patch("operationalRoutes", routeId, { organizationId: org });
  });
  await assert.rejects(() =>
    f.admin.mutation(f.api.routes.assignPlan, {
      dispatchId: f.ids[0],
      routeId,
      departureAt: "2026-09-29T08:00",
      expectedRevision: dispatch.dispatch.revision,
      expectedRouteRevision: 1,
      requestKey: "cross-org",
    }),
  );
});
test("route scheduling uses Bogotá and cumulative minutes across month and year boundaries", () => {
  assert.equal(routeSchedule("2026-12-31T23:30", 90), "2027-01-01 01:00");
  assert.throws(() => routeSchedule("2026-02-30T08:00", 0));
  assert.throws(() =>
    validateRouteStops([
      { key: "a", pointCode: "74", minutes: 100 },
      { key: "b", pointCode: "9999", minutes: 50 },
    ]),
  );
});
test("Avansat point import preserves legacy coordinates without accepting them for new TMS points", async () => {
  const f = await trackingFixture();
  await f.admin.mutation(f.api.routes.savePoint, {
    ...pointFixture,
    latitude: "a",
    longitude: "a",
    temperature: "aq",
    altitude: "a",
  });
  const catalogue = await f.admin.query(f.api.routes.catalogue, {});
  assert.equal(catalogue.points[0].latitude, "a");
  assert.equal(catalogue.points[0].temperature, "aq");
  await assert.rejects(() =>
    f.admin.mutation(f.api.routes.savePoint, {
      ...pointFixture,
      code: "new",
      source: "tms",
      latitude: "a",
    }),
  );
});

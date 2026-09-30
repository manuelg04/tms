import assert from "node:assert/strict";
import test from "node:test";
import { parseCatalogueImport, sameCatalogueRecord } from "./catalogue-import";

test("catalogue import preserves identities and rejects ambiguous or malformed source records", () => {
  const point = {
    code: "74",
    name: "BARRANQUILLA",
    city: "",
    cityCode: "",
    controller: "",
    address: "Llamada",
    phone: "",
    virtual: true,
    active: true,
  };
  const route = {
    code: "803",
    origin: "BARRANQUILLA",
    originCode: "8001000",
    destination: "GIRON",
    destinationCode: "68307000",
    via: "SAN ALBERTO",
    active: true,
    stops: [
      { key: "74-1", pointCode: "74", minutes: 40 },
      { key: "74-2", pointCode: "74", minutes: 100 },
      { key: "delivery", pointCode: "9999", minutes: 1700 },
    ],
  };
  const input = {
    version: 1,
    points: [point, { ...point, code: "10089" }],
    routes: [route],
  };
  assert.equal(parseCatalogueImport(JSON.stringify(input)).points.length, 2);
  assert.ok(sameCatalogueRecord({ ...point, revision: 9 }, point));
  assert.ok(
    sameCatalogueRecord(
      {
        ...route,
        stops: route.stops.map((s) => ({
          minutes: s.minutes,
          pointCode: s.pointCode,
          key: s.key,
        })),
      },
      route,
    ),
  );
  assert.throws(() =>
    parseCatalogueImport(JSON.stringify({ ...input, points: [point, point] })),
  );
  assert.throws(() =>
    parseCatalogueImport(
      JSON.stringify({
        ...input,
        routes: [
          {
            ...route,
            stops: [
              { key: "delivery", pointCode: "9999", minutes: 1700 },
              { key: "delivery", pointCode: "74", minutes: 2000 },
            ],
          },
        ],
      }),
    ),
  );
});

test("catalogue keeps incomplete legacy times, coordinates and per-position states", () => {
  const input = {
    version: 1,
    points: [
      {
        code: "1",
        name: "Origen",
        city: "",
        cityCode: "",
        controller: "",
        address: "",
        phone: "",
        virtual: true,
        active: true,
        longitude: "-74.1",
      },
    ],
    routes: [
      {
        code: "1",
        origin: "Origen",
        originCode: "",
        destination: "Destino",
        destinationCode: "",
        via: "",
        active: true,
        stops: [
          {
            key: "legacy-0",
            pointCode: "1",
            minutes: "",
            kilometers: "",
            active: false,
            assigned: false,
          },
          {
            key: "legacy-1",
            pointCode: "9999",
            minutes: "",
            active: true,
            assigned: true,
          },
        ],
      },
    ],
  };
  assert.deepEqual(parseCatalogueImport(JSON.stringify(input)), input);
});

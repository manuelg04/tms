import assert from "node:assert/strict";
import test from "node:test";
import { parsePartySitesLookup } from "./rndc-party-sites";

function lookup(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    fetchedAt: "2026-11-14T19:00:00.000Z",
    mode: "live",
    environment: "primary",
    results: [
      {
        idType: "N",
        id: "9001234567",
        ok: true,
        sites: [
          { idType: "N", id: "9001234567", siteCode: "26", siteName: "PLANTA", address: "KM 7", cityCode: "68547000", latitude: "6.995415", longitude: "-73.071613" },
          { idType: "N", id: "9001234567", siteCode: "6", address: "CALLE 1", cityCode: "68547000" },
          { idType: "N", id: "9001234567", siteCode: "7", siteName: "MEDIA", latitude: "7.1" }
        ]
      },
      { idType: "N", id: "800111222", ok: true, sites: [] },
      { idType: "N", id: "800333444", ok: false, error: "timeout", sites: [] }
    ],
    ...overrides
  });
}

test("convierte la consulta de sedes del RNDC en sedes para cargar", () => {
  const { sites, summary } = parsePartySitesLookup(lookup());
  assert.deepEqual(sites, [
    { document: "9001234567", siteCode: "26", siteName: "PLANTA", address: "KM 7", cityCode: "68547000", latitude: "6.995415", longitude: "-73.071613" },
    { document: "9001234567", siteCode: "6", siteName: "CALLE 1", address: "CALLE 1", cityCode: "68547000", latitude: undefined, longitude: undefined },
    { document: "9001234567", siteCode: "7", siteName: "MEDIA", address: undefined, cityCode: undefined, latitude: undefined, longitude: undefined }
  ]);
  assert.deepEqual(summary, { parties: 3, partiesWithoutSites: ["800111222"], failedLookups: ["800333444"], sites: 3, withCoordinates: 1, withoutCoordinates: 2 });
});

test("no carga archivos que no vienen del RNDC real", () => {
  assert.throws(() => parsePartySitesLookup(lookup({ mode: "dry-run" })), /no viene del RNDC real/);
  assert.throws(() => parsePartySitesLookup(lookup({ environment: "test" })), /no viene del RNDC real/);
  assert.throws(() => parsePartySitesLookup(JSON.stringify({ mode: "live", environment: "primary" })), /no es un resultado/);
});

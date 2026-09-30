import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMirrorQuery,
  mirrorDate,
  mirrorWindow,
  readMirrorResponse,
} from "../rndc/mirror.js";
import type { RndcMessageResponse } from "../rndc/types.js";

test("mirror uses only document queries, bounded inclusive days and explicit variables", () => {
  for (const processId of [3, 4, 5, 6, 9, 32, 28, 29]) {
    const request = buildMirrorQuery(
      "9000000011",
      processId,
      "2026-09-01",
      "2026-09-29",
    );
    assert.equal(request.tipo, 3);
    assert.equal(request.procesoId, processId);
    assert.equal(request.documentorango?.finFECHAING, "'2026/09/30'");
    assert.notEqual(request.variables, "*");
  }
  assert.throws(() =>
    buildMirrorQuery("9000000011", 1, "2026-09-01", "2026-09-29"),
  );
  assert.throws(() => mirrorWindow("2026-09-31", "2026-10-01"));
  assert.throws(() => mirrorWindow("2026-08-01", "2026-09-29"));
});
test("mirror retains Colombian ingress dates and excludes the next day", () => {
  assert.equal(mirrorDate("07/09/2026 11:33:17 a. m."), "2026-09-07");
  assert.equal(mirrorDate("2026/09/29 15:00:00"), "2026-09-29");
  assert.equal(mirrorDate("31/09/2026"), "");
  const response = {
    status: 200,
    ok: true,
    parsed: {
      root: {
        documento: [
          { INGRESOID: "1", FECHAING: "29/09/2026 11:00" },
          { INGRESOID: "2", FECHAING: "30/09/2026 00:00" },
        ],
      },
    },
  } as RndcMessageResponse;
  assert.equal(
    readMirrorResponse(response, "2026-09-01", "2026-09-29").length,
    1,
  );
  assert.throws(() =>
    readMirrorResponse(
      { ...response, status: 500 },
      "2026-09-01",
      "2026-09-29",
    ),
  );
  assert.deepEqual(
    readMirrorResponse(
      {
        ...response,
        ok: false,
        errorText: "Error RNDC11: Documento no encontrado. Tipo:3 Proceso:32",
      },
      "2026-09-01",
      "2026-09-29",
    ),
    [],
  );
  assert.throws(() =>
    readMirrorResponse(
      { ...response, ok: false, errorText: "Error RNDC027: No tiene permisos" },
      "2026-09-01",
      "2026-09-29",
    ),
  );
});

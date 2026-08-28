import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCatalogArgs } from "./rndc-catalog-cli.js";

test("catalog ingestion is dry-run unless apply is explicit", () => {
  const result = parseCatalogArgs([
    "--vehicle-lines", "lines.xls",
    "--insurers", "insurers.xls",
    "--packages", "packages.xls",
    "--body-types", "body-types.xls"
  ]);

  assert.deepEqual(result, {
    vehicleLinesPath: "lines.xls",
    insurersPath: "insurers.xls",
    packagesPath: "packages.xls",
    bodyTypesPath: "body-types.xls",
    apply: false
  });
});

test("catalog ingestion enables remote writes only with apply", () => {
  const result = parseCatalogArgs([
    "--vehicle-lines", "lines.xls",
    "--insurers", "insurers.xls",
    "--packages", "packages.xls",
    "--body-types", "body-types.xls",
    "--apply"
  ]);

  assert.equal(result.apply, true);
});

test("catalog ingestion requires every source path", () => {
  assert.throws(
    () => parseCatalogArgs(["--vehicle-lines", "lines.xls"]),
    /Faltan rutas obligatorias/
  );
});

test("catalog ingestion rejects unknown arguments", () => {
  assert.throws(
    () => parseCatalogArgs([
      "--vehicle-lines", "lines.xls",
      "--insurers", "insurers.xls",
      "--packages", "packages.xls",
      "--body-types", "body-types.xls",
      "--force"
    ]),
    /Argumento desconocido: --force/
  );
});

test("catalog ingestion rejects duplicate source flags", () => {
  assert.throws(
    () => parseCatalogArgs([
      "--vehicle-lines", "lines-a.xls",
      "--vehicle-lines", "lines-b.xls",
      "--insurers", "insurers.xls",
      "--packages", "packages.xls",
      "--body-types", "body-types.xls"
    ]),
    /Ruta repetida: --vehicle-lines/
  );
});

test("catalog ingestion rejects one file reused for different catalogs", () => {
  assert.throws(
    () => parseCatalogArgs([
      "--vehicle-lines", "shared.xls",
      "--insurers", "shared.xls",
      "--packages", "packages.xls",
      "--body-types", "body-types.xls"
    ]),
    /Cada catálogo requiere un archivo diferente/
  );
});

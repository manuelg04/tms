import test from "node:test";
import assert from "node:assert/strict";
import { readPath, setPath } from "./form-state";
import { initialForm } from "./operations-config";

test("readPath lee rutas anidadas", () => {
  assert.equal(readPath(initialForm, "vehicle.plate"), "JVK276");
  assert.equal(readPath(initialForm, "cargo.quantityKg"), "34000");
  assert.equal(readPath(initialForm, "noexiste.tampoco"), "");
});

test("setPath es inmutable y no altera hermanos", () => {
  const next = setPath(initialForm, "vehicle.plate", "ABC123");
  assert.equal(readPath(next, "vehicle.plate"), "ABC123");
  assert.equal(readPath(initialForm, "vehicle.plate"), "JVK276");
  assert.equal(readPath(next, "vehicle.trailerPlate"), "R41537");
});

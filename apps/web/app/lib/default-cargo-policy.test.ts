import assert from "node:assert/strict";
import { test } from "node:test";
import { cargoPolicyDefaults } from "./default-cargo-policy";

test("offers the company cargo policy only while it is complete and current", () => {
  const raw = { insurerNit: "860.028.415-5", number: " AB002905 ", expiresOn: "2027-04-09" };
  assert.deepEqual(cargoPolicyDefaults(raw, "2026-11-14"), { insurerNit: "8600284155", number: "AB002905", expiresOn: "2027-04-09" });
  assert.deepEqual(cargoPolicyDefaults(raw, "2027-04-10"), { insurerNit: "", number: "", expiresOn: "" });
  assert.deepEqual(cargoPolicyDefaults({ ...raw, number: "" }, "2026-11-14"), { insurerNit: "", number: "", expiresOn: "" });
  assert.deepEqual(cargoPolicyDefaults({ ...raw, expiresOn: "09/04/2027" }, "2026-11-14"), { insurerNit: "", number: "", expiresOn: "" });
  assert.deepEqual(cargoPolicyDefaults({}, "2026-11-14"), { insurerNit: "", number: "", expiresOn: "" });
});

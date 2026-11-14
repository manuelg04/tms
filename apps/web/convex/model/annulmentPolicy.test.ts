import assert from "node:assert/strict";
import { test } from "node:test";
import { ANNULMENT_POLICY, canAnnulOfficialDocuments } from "./annulmentPolicy";

test("the screen and the server share one rule about who can annul", () => {
  assert.deepEqual(ANNULMENT_POLICY, { roles: ["admin"], jobTitles: ["jefe_seguridad"] });
  assert.equal(canAnnulOfficialDocuments({ roles: ["admin"] }), true);
  assert.equal(canAnnulOfficialDocuments({ roles: ["operator"], jobTitle: "jefe_seguridad" }), true);
  assert.equal(canAnnulOfficialDocuments({ roles: ["operator"], jobTitle: "auxiliar_seguridad" }), false);
  assert.equal(canAnnulOfficialDocuments({ roles: ["operator"] }), false);
  assert.equal(canAnnulOfficialDocuments({ roles: ["auditor"] }), false);
  assert.equal(canAnnulOfficialDocuments(null), false);
});

test("the rule can be narrowed again without touching the callers", () => {
  const policy = { roles: ["admin"], jobTitles: [] };
  assert.equal(canAnnulOfficialDocuments({ roles: ["operator"], jobTitle: "jefe_seguridad" }, policy), false);
  assert.equal(canAnnulOfficialDocuments({ roles: ["admin"], jobTitle: "administrador" }, policy), true);
});

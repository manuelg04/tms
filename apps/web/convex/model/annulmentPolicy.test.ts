import assert from "node:assert/strict";
import { test } from "node:test";
import { ANNULMENT_POLICY, canAnnulOfficialDocuments } from "./annulmentPolicy";

test("the screen and the server share one rule about who can annul", () => {
  assert.deepEqual(ANNULMENT_POLICY, { roles: ["admin"], jobTitles: [] });
  assert.equal(canAnnulOfficialDocuments({ roles: ["admin"] }), true);
  assert.equal(canAnnulOfficialDocuments({ roles: ["operator"], jobTitle: "jefe_seguridad" }), false);
  assert.equal(canAnnulOfficialDocuments({ roles: ["auditor"] }), false);
  assert.equal(canAnnulOfficialDocuments(null), false);
});

test("the rule can be opened to a job title without touching the callers", () => {
  const policy = { roles: ["admin"], jobTitles: ["jefe_seguridad"] };
  assert.equal(canAnnulOfficialDocuments({ roles: ["operator"], jobTitle: "jefe_seguridad" }, policy), true);
  assert.equal(canAnnulOfficialDocuments({ roles: ["operator"], jobTitle: "auxiliar_seguridad" }, policy), false);
});

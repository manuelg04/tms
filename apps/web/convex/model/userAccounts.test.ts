import assert from "node:assert/strict";
import test from "node:test";
import { assertPasswordHash, isJobTitle, normalizeEmail, normalizeName, rolesForJobTitle, validatePasswordStrength } from "./userAccounts.js";

test("maps job titles to internal roles", () => {
  assert.deepEqual(rolesForJobTitle("administrador"), ["admin"]);
  assert.deepEqual(rolesForJobTitle("jefe_seguridad"), ["operator"]);
  assert.deepEqual(rolesForJobTitle("auxiliar_seguridad"), ["operator"]);
  assert.equal(isJobTitle("jefe_seguridad"), true);
  assert.equal(isJobTitle("gerente"), false);
});

test("normalizes and validates email and name", () => {
  assert.equal(normalizeEmail("  Jefe@MTM.com.co "), "jefe@mtm.com.co");
  assert.throws(() => normalizeEmail("sin-arroba"), /correo/);
  assert.equal(normalizeName("  Juan   Pérez "), "Juan Pérez");
  assert.throws(() => normalizeName("Jo"), /nombre/);
});

test("validates password strength and hash shape", () => {
  assert.equal(validatePasswordStrength("Piloto-MTM-2026"), null);
  assert.match(validatePasswordStrength("corta1") ?? "", /10 caracteres/);
  assert.match(validatePasswordStrength("sinnumeros-aqui") ?? "", /letras y números/);
  assert.doesNotThrow(() => assertPasswordHash("scrypt$16384$8$1$c2FsdA==$aGFzaA=="));
  assert.throws(() => assertPasswordHash("Piloto-MTM-2026"), /protegida/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "./password.js";

test("hashes and verifies a password with a fresh salt", async () => {
  const first = await hashPassword("Clave-segura-2026");
  const second = await hashPassword("Clave-segura-2026");

  assert.match(first, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("Clave-segura-2026", first), true);
  assert.equal(await verifyPassword("Clave-segura-2026", second), true);
});

test("rejects wrong passwords and malformed hashes", async () => {
  const stored = await hashPassword("Clave-segura-2026");

  assert.equal(await verifyPassword("clave-segura-2026", stored), false);
  assert.equal(await verifyPassword("Clave-segura-2026", undefined), false);
  assert.equal(await verifyPassword("Clave-segura-2026", "plain-text"), false);
  assert.equal(await verifyPassword("Clave-segura-2026", "scrypt$1$1$1$abc"), false);
});

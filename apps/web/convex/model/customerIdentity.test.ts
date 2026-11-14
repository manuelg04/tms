import assert from "node:assert/strict";
import test from "node:test";
import { customerIdentityCandidates, isNitType, nitCheckDigit } from "./customerIdentity.js";

test("calculates the NIT check digit", () => {
  assert.equal(nitCheckDigit("900226684"), "3");
  assert.equal(nitCheckDigit("805021435"), "0");
});

test("treats N and NIT as the same document type", () => {
  assert.equal(isNitType("N"), true);
  assert.equal(isNitType(" nit "), true);
  assert.equal(isNitType("C.C"), false);
  assert.equal(isNitType(undefined), false);
});

test("matches a NIT with check digit against the same NIT without it", () => {
  assert.deepEqual(customerIdentityCandidates("N", "9002266843"), { exact: ["9002266843"], nitVariants: ["900226684"] });
  assert.deepEqual(customerIdentityCandidates("NIT", "900226684"), { exact: ["900226684"], nitVariants: ["9002266843"] });
});

test("does not strip a digit when the check digit does not match", () => {
  assert.deepEqual(customerIdentityCandidates("NIT", "8000235551"), { exact: ["8000235551"], nitVariants: [] });
});

test("keeps personal documents as exact matches only", () => {
  assert.deepEqual(customerIdentityCandidates("C", "9002266843"), { exact: ["9002266843"], nitVariants: [] });
  assert.deepEqual(customerIdentityCandidates(undefined, "900226684"), { exact: ["900226684"], nitVariants: [] });
});

test("accepts formatted numbers and ignores empty ones", () => {
  assert.deepEqual(customerIdentityCandidates("N", " 900.226.684-3 "), { exact: ["900.226.684-3", "9002266843"], nitVariants: ["900226684"] });
  assert.deepEqual(customerIdentityCandidates("N", "  "), { exact: [], nitVariants: [] });
});

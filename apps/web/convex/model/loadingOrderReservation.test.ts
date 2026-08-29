import test from "node:test";
import assert from "node:assert/strict";
import { formatLoadingOrderNumber, normalizeLoadingOrderReservationToken, resolveLoadingOrderReservation } from "./loadingOrderReservation";

test("formats loading order numbers with the nine digits used by Avansat", () => {
  assert.equal(formatLoadingOrderNumber("0000047"), "000000047");
  assert.equal(formatLoadingOrderNumber("000046449"), "000046449");
});

test("normalizes a valid loading order reservation token", () => {
  assert.equal(normalizeLoadingOrderReservationToken("  form-12345678  "), "form-12345678");
});

test("rejects a loading order reservation token that cannot identify a form", () => {
  assert.throws(() => normalizeLoadingOrderReservationToken("short"), /token de reserva/i);
});

test("returns the reserved number to the same operator and form", () => {
  const result = resolveLoadingOrderReservation({
    organizationId: "org-1",
    reservedBy: "user-1",
    token: "form-12345678",
    number: "000044650",
    status: "reserved"
  }, {
    organizationId: "org-1",
    actorId: "user-1",
    token: "form-12345678"
  });

  assert.deepEqual(result, { kind: "available", number: "000044650" });
});

test("returns the existing dispatch when a consumed reservation is retried", () => {
  const result = resolveLoadingOrderReservation({
    organizationId: "org-1",
    reservedBy: "user-1",
    token: "form-12345678",
    number: "000044650",
    status: "consumed",
    expedienteId: "dispatch-1"
  }, {
    organizationId: "org-1",
    actorId: "user-1",
    token: "form-12345678"
  });

  assert.deepEqual(result, { kind: "consumed", number: "000044650", expedienteId: "dispatch-1" });
});

test("rejects a reservation from another organization or operator", () => {
  const reservation = {
    organizationId: "org-1",
    reservedBy: "user-1",
    token: "form-12345678",
    number: "000044650",
    status: "reserved" as const
  };

  assert.throws(() => resolveLoadingOrderReservation(reservation, {
    organizationId: "org-2",
    actorId: "user-1",
    token: "form-12345678"
  }), /no pertenece/i);
  assert.throws(() => resolveLoadingOrderReservation(reservation, {
    organizationId: "org-1",
    actorId: "user-2",
    token: "form-12345678"
  }), /no pertenece/i);
});

test("rejects a consumed reservation without its dispatch", () => {
  assert.throws(() => resolveLoadingOrderReservation({
    organizationId: "org-1",
    reservedBy: "user-1",
    token: "form-12345678",
    number: "000044650",
    status: "consumed"
  }, {
    organizationId: "org-1",
    actorId: "user-1",
    token: "form-12345678"
  }), /reserva consumida/i);
});

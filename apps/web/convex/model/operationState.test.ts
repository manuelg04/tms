import test from "node:test";
import assert from "node:assert/strict";

type OperationModule = {
  nextOperationState?: (status: string, event: string) => string;
  canClaimOperation?: (
    operation: { status: string; availableAt: number; leaseExpiresAt?: number },
    now: number
  ) => boolean;
  chooseExistingOperation?: (requestMatch?: string | null, businessMatch?: string | null) => string | null;
  blocksAnotherDocumentOperation?: (status: string) => boolean;
};

const modulePath = "./operationState";
const operationModule = (await import(modulePath).catch(() => ({}))) as OperationModule;
const nextOperationState = operationModule.nextOperationState ?? (() => "missing");
const canClaimOperation = operationModule.canClaimOperation ?? (() => false);
const chooseExistingOperation = operationModule.chooseExistingOperation ?? (() => null);
const blocksAnotherDocumentOperation = operationModule.blocksAnotherDocumentOperation ?? (() => false);

test("an uncertain operation must reconcile before it can finish", () => {
  assert.equal(nextOperationState("claimed", "mark_uncertain"), "uncertain");
  assert.equal(nextOperationState("uncertain", "begin_reconciliation"), "reconciling");
  assert.equal(nextOperationState("reconciling", "confirm_succeeded"), "succeeded");
});

test("a failed operation can only return to the queue through an explicit retry", () => {
  assert.equal(nextOperationState("claimed", "fail"), "failed");
  assert.equal(nextOperationState("failed", "retry"), "queued");
  assert.throws(() => nextOperationState("succeeded", "retry"), /invalid operation transition/i);
});

test("send claiming honors availability and quarantines expired leases", () => {
  assert.equal(canClaimOperation({ status: "queued", availableAt: 100 }, 99), false);
  assert.equal(canClaimOperation({ status: "queued", availableAt: 100 }, 100), true);
  assert.equal(canClaimOperation({ status: "claimed", availableAt: 0, leaseExpiresAt: 101 }, 100), false);
  assert.equal(canClaimOperation({ status: "claimed", availableAt: 0, leaseExpiresAt: 100 }, 100), false);
  assert.equal(canClaimOperation({ status: "uncertain", availableAt: 0 }, 100), false);
});

test("request and business idempotency keys converge on one operation", () => {
  assert.equal(chooseExistingOperation("op-1", null), "op-1");
  assert.equal(chooseExistingOperation(null, "op-1"), "op-1");
  assert.equal(chooseExistingOperation("op-1", "op-1"), "op-1");
  assert.equal(chooseExistingOperation(null, null), null);
  assert.throws(() => chooseExistingOperation("op-1", "op-2"), /idempotency conflict/i);
});

test("queued, claimed, uncertain, and reconciling operations lock the same document", () => {
  assert.equal(blocksAnotherDocumentOperation("queued"), true);
  assert.equal(blocksAnotherDocumentOperation("claimed"), true);
  assert.equal(blocksAnotherDocumentOperation("uncertain"), true);
  assert.equal(blocksAnotherDocumentOperation("reconciling"), true);
  assert.equal(blocksAnotherDocumentOperation("failed"), false);
  assert.equal(blocksAnotherDocumentOperation("succeeded"), false);
  assert.equal(blocksAnotherDocumentOperation("cancelled"), false);
});

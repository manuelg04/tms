import assert from "node:assert/strict";
import { test } from "node:test";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { hasOpenRejection } from "./openRejection";
import { reopenRejectedDocument } from "./rejectionReopen";

type Row = Record<string, unknown> & { _id: string };

function harness(seed: Record<string, Row[]>) {
  const tables = new Map<string, Row[]>(Object.entries(seed));
  const rows = (table: string) => tables.get(table) ?? [];
  const ctx = {
    db: {
      async get(table: string, id: string) {
        return rows(table).find((row) => row._id === id) ?? null;
      },
      async patch(table: string, id: string, fields: Record<string, unknown>) {
        Object.assign(rows(table).find((row) => row._id === id) ?? {}, fields);
      },
      async insert(table: string, fields: Record<string, unknown>) {
        const row = { _id: `${table}-${rows(table).length + 1}`, ...fields };
        tables.set(table, [...rows(table), row]);
        return row._id;
      },
      query(table: string) {
        const filters: Record<string, unknown> = {};
        const chain = {
          withIndex(_name: string, apply: (query: { eq: (key: string, value: unknown) => unknown }) => unknown) {
            const query = { eq(key: string, value: unknown) { filters[key] = value; return query; } };
            apply(query);
            return chain;
          },
          async collect() {
            return rows(table).filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value));
          }
        };
        return chain;
      }
    }
  } as unknown as MutationCtx;
  return { ctx, rows };
}

function seed(overrides: { resultJson?: string; status?: string } = {}) {
  return {
    rndcOperations: [{
      _id: "op1",
      organizationId: "org1",
      expedienteId: "exp1",
      documentId: "doc1",
      expedienteRemesaId: "rem1",
      operationType: "emit_remesa",
      status: overrides.status ?? "failed",
      mode: "live",
      requestKey: "emit-exp1-remesa:90001",
      businessKey: "emit:exp1:remesa:90001",
      resultJson: overrides.resultJson ?? JSON.stringify({ ok: false, steps: [{ accepted: false, errorText: "Error REM502" }] })
    }],
    rndcRequestKeys: [{ _id: "key1", organizationId: "org1", requestKey: "emit-exp1-remesa:90001", operationId: "op1" }],
    expedienteRemesas: [{ _id: "rem1", number: "90001", officialState: "pending", documentId: "doc1", updatedBy: "user1" }],
    documents: [{ _id: "doc1", number: "90001", officialState: "pending", status: "rejected", errorText: "Error REM502" }],
    auditEvents: [] as Row[]
  };
}

test("a fully rejected remesa goes back to draft and frees its business key for a new attempt", async () => {
  const { ctx, rows } = harness(seed());
  const operation = { ...rows("rndcOperations")[0] } as unknown as Doc<"rndcOperations">;
  const result = await reopenRejectedDocument(ctx, operation, { type: "service" });

  assert.equal(result.reopened, true);
  assert.equal(rows("expedienteRemesas")[0].officialState, "draft");
  assert.equal(rows("documents")[0].officialState, "draft");
  assert.equal(rows("documents")[0].errorText, "Error REM502");
  assert.equal(rows("rndcOperations")[0].businessKey, "emit:exp1:remesa:90001:rechazada:op1");
  assert.equal(rows("rndcOperations")[0].status, "failed");
  assert.equal(rows("rndcRequestKeys")[0].requestKey, "emit-exp1-remesa:90001:rechazada:op1");
  assert.equal(rows("expedienteRemesas")[0].updatedBy, "user1");
  assert.equal(
    hasOpenRejection(
      rows("rndcOperations") as unknown as Array<{ status: string; businessKey: string; documentId: string }>,
      rows("documents") as unknown as Array<{ _id: string; officialState: string; errorText: string }>
    ),
    true
  );
});

test("uncertain or partially accepted attempts stay locked", async () => {
  const uncertain = harness(seed({ status: "uncertain" }));
  const first = await reopenRejectedDocument(uncertain.ctx, { ...uncertain.rows("rndcOperations")[0] } as unknown as Doc<"rndcOperations">, { type: "service" });
  assert.equal(first.reopened, false);
  assert.equal(uncertain.rows("documents")[0].officialState, "pending");
  assert.equal(uncertain.rows("rndcOperations")[0].businessKey, "emit:exp1:remesa:90001");

  const partial = harness(seed({ resultJson: JSON.stringify({ ok: false, steps: [{ accepted: true }, { accepted: false }] }) }));
  const second = await reopenRejectedDocument(partial.ctx, { ...partial.rows("rndcOperations")[0] } as unknown as Doc<"rndcOperations">, { type: "service" });
  assert.equal(second.reopened, false);
  assert.equal(partial.rows("expedienteRemesas")[0].officialState, "pending");

  const noAnswer = harness(seed({ resultJson: JSON.stringify({ error: "timeout" }) }));
  const third = await reopenRejectedDocument(noAnswer.ctx, { ...noAnswer.rows("rndcOperations")[0] } as unknown as Doc<"rndcOperations">, { type: "service" });
  assert.equal(third.reopened, false);
});

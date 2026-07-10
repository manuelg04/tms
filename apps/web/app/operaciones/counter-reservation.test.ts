import assert from "node:assert/strict";
import test from "node:test";
import { initialForm } from "./operations-config.js";
import { reserveSuggestedCounters } from "./counter-reservation.js";

test("reserves the visible suggested counter before returning a form payload", async () => {
  const payload = await reserveSuggestedCounters({
    form: initialForm,
    operation: "remesa",
    suggestions: { remesa: initialForm.remesaNumber },
    reserve: async () => 43001
  });

  assert.equal(payload.remesaNumber, "43001");
});

test("fails closed when a suggested counter cannot be reserved", async () => {
  await assert.rejects(
    reserveSuggestedCounters({
      form: initialForm,
      operation: "remesa",
      suggestions: { remesa: initialForm.remesaNumber },
      reserve: async () => {
        throw new Error("counter unavailable");
      }
    }),
    /counter unavailable/
  );
});

test("claims a manually entered numeric consecutive before returning it", async () => {
  let claimed: number | undefined;
  const form = { ...initialForm, remesaNumber: "43005" };
  const payload = await reserveSuggestedCounters({
    form,
    operation: "remesa",
    suggestions: { remesa: "42197" },
    reserve: async () => 43001,
    claim: async (_type, value) => {
      claimed = value;
      return value;
    }
  });

  assert.equal(payload.remesaNumber, "43005");
  assert.equal(claimed, 43005);
});

test("fails closed when a stale suggested value cannot be claimed", async () => {
  const form = { ...initialForm, remesaNumber: "42196" };

  await assert.rejects(reserveSuggestedCounters({
    form,
    operation: "remesa",
    suggestions: { remesa: "42197" },
    reserve: async () => 43001,
    claim: async () => {
      throw new Error("counter already consumed");
    }
  }), /counter already consumed/);
});

test("rejects non-numeric manual document numbers in the technical console", async () => {
  const form = { ...initialForm, remesaNumber: "MANUAL-77" };

  await assert.rejects(reserveSuggestedCounters({
    form,
    operation: "remesa",
    suggestions: { remesa: "42197" },
    reserve: async () => 43001,
    claim: async (_type, value) => value
  }), /must be numeric/);
});

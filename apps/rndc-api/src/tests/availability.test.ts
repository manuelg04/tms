import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "@tms/rndc-core";
import type { RndcConfig } from "@tms/rndc-core";
import { createAvailabilityChecker } from "../availability.js";

const liveConfig = (): RndcConfig => loadConfig({ mode: "live", username: "U", password: "P", companyNit: "900773684", companyDv: "9", companyRndcNit: "9007736849" });

test("dry-run reports the RNDC as available without contacting it", async () => {
  let probes = 0;
  const check = createAvailabilityChecker(() => loadConfig({ mode: "dry-run" }), async () => {
    probes += 1;
    return { ok: true, text: "AtenderMensajeRNDC", status: 200 };
  });
  const result = await check();
  assert.equal(result.available, true);
  assert.equal(result.mode, "dry-run");
  assert.equal(probes, 0);
});

test("live availability follows the RNDC service description and is cached briefly", async () => {
  let probes = 0;
  let clock = 1_000;
  let up = true;
  const check = createAvailabilityChecker(liveConfig, async (url) => {
    probes += 1;
    assert.equal(url.endsWith("/ws"), true);
    if (!up) throw new Error("connect ECONNREFUSED");
    return { ok: true, text: "<wsdl>AtenderMensajeRNDC</wsdl>", status: 200 };
  }, () => clock);

  assert.equal((await check()).available, true);
  up = false;
  assert.equal((await check()).available, true);
  assert.equal(probes, 1);
  clock += 16_000;
  const down = await check();
  assert.equal(down.available, false);
  assert.equal(down.detail, "connect ECONNREFUSED");
  assert.equal(probes, 2);
});

test("a reachable server without the RNDC operation counts as unavailable", async () => {
  const check = createAvailabilityChecker(liveConfig, async () => ({ ok: true, text: "<html>Mantenimiento</html>", status: 200 }));
  const result = await check();
  assert.equal(result.available, false);
});

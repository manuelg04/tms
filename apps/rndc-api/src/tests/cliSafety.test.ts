import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "@tms/rndc-core";
import { assertLegacyCliCommandAllowed } from "../cliSafety.js";

test("legacy CLI document commands refuse live mode", () => {
  const config = loadConfig({
    mode: "live",
    username: "LIVE_USER",
    password: "LIVE_PASSWORD",
    companyNit: "900773684",
    companyDv: "9",
    companyRndcNit: "9007736849"
  });

  for (const command of ["flow", "mtm-prod-flow", "prepare-ops", "loading-order", "fulfill", "resend", "annul"]) {
    assert.throws(() => assertLegacyCliCommandAllowed(config, command), /durable request context/i);
  }
});

test("legacy CLI document commands remain available in dry-run mode", () => {
  const config = loadConfig({ mode: "dry-run" });

  for (const command of ["flow", "mtm-prod-flow", "prepare-ops", "loading-order", "fulfill", "resend", "annul"]) {
    assert.doesNotThrow(() => assertLegacyCliCommandAllowed(config, command));
  }
});

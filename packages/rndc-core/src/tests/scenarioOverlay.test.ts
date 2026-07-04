import assert from "node:assert/strict";
import test from "node:test";
import { buildMtmProductionScenario } from "../data/demoScenario.js";
import { applyScenarioOverlay } from "../data/scenarioOverlay.js";
import { loadConfig } from "../rndc/config.js";
import type { DemoScenario } from "../rndc/types.js";

test("deep merges nested scenario fields while preserving unspecified fields", () => {
  const scenario = buildMtmProductionScenario(loadConfig());
  const result = applyScenarioOverlay(scenario, {
    driver: {
      phone: "3000000000"
    },
    vehicle: {
      plate: "ABC123"
    }
  });

  assert.equal(result.driver.phone, "3000000000");
  assert.equal(result.driver.id, scenario.driver.id);
  assert.equal(result.driver.firstName, scenario.driver.firstName);
  assert.equal(result.vehicle.plate, "ABC123");
  assert.equal(result.vehicle.brand, scenario.vehicle.brand);
  assert.equal(result.sender.name, scenario.sender.name);
});

test("replaces arrays instead of merging them", () => {
  const scenario = buildMtmProductionScenario(loadConfig()) as DemoScenario & { stops: string[] };
  scenario.stops = ["LANDAZURI", "MINGUEO"];

  const result = applyScenarioOverlay(scenario, {
    stops: ["BUCARAMANGA"]
  }) as DemoScenario & { stops: string[] };

  assert.deepEqual(result.stops, ["BUCARAMANGA"]);
});

test("rejects non-object overlays", () => {
  const scenario = buildMtmProductionScenario(loadConfig());

  assert.throws(() => applyScenarioOverlay(scenario, null), /plain object/);
  assert.throws(() => applyScenarioOverlay(scenario, []), /plain object/);
});

test("buildMtmProductionScenario derives loading appointment from loading date and time", () => {
  const previousLoadingDate = process.env.RNDC_LOADING_DATE;
  const previousLoadingTime = process.env.RNDC_LOADING_TIME;

  process.env.RNDC_LOADING_DATE = "15/08/2026";
  process.env.RNDC_LOADING_TIME = "07:45";

  try {
    const scenario = buildMtmProductionScenario(loadConfig());

    assert.equal(scenario.loadingAppointment, "2026-08-15 07:45:00");
    assert.equal(scenario.loadingAppointmentDate, "15/08/2026");
    assert.equal(scenario.loadingAppointmentTime, "07:45");
  } finally {
    if (previousLoadingDate === undefined) {
      delete process.env.RNDC_LOADING_DATE;
    } else {
      process.env.RNDC_LOADING_DATE = previousLoadingDate;
    }

    if (previousLoadingTime === undefined) {
      delete process.env.RNDC_LOADING_TIME;
    } else {
      process.env.RNDC_LOADING_TIME = previousLoadingTime;
    }
  }
});

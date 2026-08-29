import assert from "node:assert/strict";
import test from "node:test";

test("selects the only linked driver when a vehicle is picked", async () => {
  const assignmentState = await import("./vehicle-assignment-state").catch(() => null);
  assert.notEqual(assignmentState, null, "vehicle assignment state helper should exist");
  const driver = { _id: "driver-1", document: "80756632", name: "FONSECA LUIS GERMAN" };
  const vehicle = { _id: "vehicle-1", plate: "JVK276", drivers: [driver] };

  assert.deepEqual(assignmentState!.assignmentAfterVehiclePick(null, vehicle), { vehicle, driver });
});

test("keeps an existing driver when that driver is linked to the new vehicle", async () => {
  const { assignmentAfterVehiclePick } = await import("./vehicle-assignment-state");
  const currentDriver = { _id: "driver-2", document: "10000002", name: "CONDUCTOR DOS" };
  const vehicle = {
    _id: "vehicle-2",
    plate: "ABC123",
    drivers: [
      { _id: "driver-1", document: "10000001", name: "CONDUCTOR UNO" },
      currentDriver
    ]
  };

  assert.deepEqual(assignmentAfterVehiclePick(currentDriver, vehicle), { vehicle, driver: currentDriver });
});

test("rejects an incomplete vehicle and driver assignment", async () => {
  const assignmentState = await import("./vehicle-assignment-state") as Record<string, unknown>;
  assert.equal(typeof assignmentState.requiredAssignmentIds, "function", "assignment validation should exist");
  const requiredAssignmentIds = assignmentState.requiredAssignmentIds as (value: unknown) => unknown;

  assert.throws(
    () => requiredAssignmentIds({ vehicle: { _id: "vehicle-1", plate: "JVK276", drivers: [] }, driver: null }),
    /Selecciona un conductor/
  );
});

test("requires the driver freight shown as mandatory in the loading order", async () => {
  const assignmentState = await import("./vehicle-assignment-state") as Record<string, unknown>;
  assert.equal(typeof assignmentState.requiredDriverFreight, "function", "driver freight validation should exist");
  const requiredDriverFreight = assignmentState.requiredDriverFreight as (value: string | undefined) => string;

  assert.throws(() => requiredDriverFreight(undefined), /Flete conductor/);
  assert.equal(requiredDriverFreight("2500000"), "2500000");
});

test("shows the verified RNDC vehicle color name without hiding its code", async () => {
  const { vehicleColorLabel } = await import("./vehicle-assignment-state");

  assert.equal(vehicleColorLabel("8"), "BLANCO (RNDC 8)");
  assert.equal(vehicleColorLabel("999"), "999");
  assert.equal(vehicleColorLabel(undefined), "—");
});

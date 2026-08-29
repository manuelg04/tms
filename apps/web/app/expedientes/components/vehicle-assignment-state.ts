export type AssignmentDriver = {
  _id: string;
  document: string;
  name?: string;
  phone?: string;
  licenseCategory?: string;
  licenseExpiresAt?: string;
};

export type AssignmentVehicle = {
  _id: string;
  plate: string;
  drivers: AssignmentDriver[];
};

export function assignmentAfterVehiclePick<Driver extends AssignmentDriver, Vehicle extends AssignmentVehicle & { drivers: Driver[] }>(currentDriver: Driver | null, vehicle: Vehicle) {
  return {
    vehicle,
    driver: vehicle.drivers.length === 1
      ? vehicle.drivers[0]
      : currentDriver && vehicle.drivers.some((driver) => driver._id === currentDriver._id)
        ? currentDriver
        : null
  };
}

export function requiredAssignmentIds<DriverId extends string, VehicleId extends string>(assignment: { vehicle: { _id: VehicleId } | null; driver: { _id: DriverId } | null }): { vehicleId: VehicleId; driverId: DriverId } {
  if (!assignment.vehicle || !assignment.driver) {
    throw new Error("Selecciona un conductor y un vehículo existentes en maestros.");
  }
  return { vehicleId: assignment.vehicle._id, driverId: assignment.driver._id };
}

export function requiredDriverFreight(value: string | undefined): string {
  const freight = value?.trim();
  if (!freight) throw new Error("Completa el campo Flete conductor.");
  return freight;
}

export function vehicleColorLabel(value: string | undefined): string {
  if (!value) return "—";
  if (value === "8") return "BLANCO (RNDC 8)";
  return value;
}

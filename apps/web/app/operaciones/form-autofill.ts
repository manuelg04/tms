import type { FormState } from "./operations-config";
import { setPath } from "./form-state";

export type VehicleAutofillSource = {
  plate: string;
  make?: string;
  modelYear?: string;
  configuration?: string;
  trailer?: string;
  capacityTn?: string;
  emptyWeightTn?: string;
  ownerDocument?: string;
  ownerName?: string;
  ownerCellphone?: string;
  ownerPhone?: string;
  possessorDocument?: string;
  possessorName?: string;
  possessorCellphone?: string;
  possessorPhone?: string;
};

export type DriverAutofillSource = {
  document: string;
  documentType?: string;
  name?: string;
  address?: string;
  city?: string;
  phone1?: string;
  cellphone?: string;
  licenseNumber?: string;
  licenseCategory?: string;
  licenseExpiresAt?: string;
};

export function tonsToKg(value?: string): string {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? String(Math.round(parsed * 1000)) : "";
}

function push(patches: [string, string][], path: string, value?: string) {
  if (value !== undefined && value.trim() !== "") {
    patches.push([path, value.trim()]);
  }
}

export function vehiclePatches(vehicle: VehicleAutofillSource): [string, string][] {
  const patches: [string, string][] = [];
  push(patches, "vehicle.plate", vehicle.plate);
  push(patches, "vehicle.trailerPlate", vehicle.trailer);
  push(patches, "vehicle.brand", vehicle.make);
  push(patches, "vehicle.configuration", vehicle.configuration);
  push(patches, "vehicle.modelYear", vehicle.modelYear);
  push(patches, "vehicle.capacityKg", tonsToKg(vehicle.capacityTn));
  push(patches, "vehicle.emptyWeightKg", tonsToKg(vehicle.emptyWeightTn));
  push(patches, "vehicleOwner.id", vehicle.ownerDocument);
  push(patches, "vehicleOwner.fullName", vehicle.ownerName);
  push(patches, "vehicleOwner.phone", vehicle.ownerCellphone ?? vehicle.ownerPhone);
  push(patches, "vehicleHolder.id", vehicle.possessorDocument);
  push(patches, "vehicleHolder.fullName", vehicle.possessorName);
  push(patches, "vehicleHolder.phone", vehicle.possessorCellphone ?? vehicle.possessorPhone);
  return patches;
}

export function driverPatches(driver: DriverAutofillSource): [string, string][] {
  const patches: [string, string][] = [];
  push(patches, "driver.id", driver.document);
  push(patches, "driver.fullName", driver.name);
  push(patches, "driver.phone", driver.cellphone ?? driver.phone1);
  push(patches, "driver.address", driver.address);
  push(patches, "driver.cityName", driver.city);
  push(patches, "driver.licenseNumber", driver.licenseNumber);
  push(patches, "driver.licenseCategory", driver.licenseCategory);
  push(patches, "driver.licenseExpirationDate", driver.licenseExpiresAt);
  return patches;
}

export function applyPatches(form: FormState, patches: [string, string][]): FormState {
  return patches.reduce((current, [path, value]) => setPath(current, path, value), form);
}

type PayloadContract = {
  strings: string[];
  numbers: string[];
};

export type DurablePayloadPreflight = {
  ok: boolean;
  missingFields: string[];
  invalidFields: string[];
};

const contracts: Record<string, PayloadContract> = {
  emit_cargo: {
    strings: [
      "cargoNumber",
      "loadingAppointmentDate",
      "loadingAppointmentTime",
      "unloadingAppointmentDate",
      "unloadingAppointmentTime",
      "sender.idType",
      "sender.id",
      "sender.siteCode",
      "sender.cityCode",
      "recipient.idType",
      "recipient.id",
      "recipient.siteCode",
      "recipient.cityCode",
      "cargo.shortDescription",
      "cargo.merchandiseCode",
      "cargo.packageCode",
      "cargo.natureCode"
    ],
    numbers: ["cargo.quantityKg"]
  },
  emit_remesa: {
    strings: [
      "remesaNumber",
      "cargoNumber",
      "loadingAppointmentDate",
      "loadingAppointmentTime",
      "unloadingAppointmentDate",
      "unloadingAppointmentTime",
      "sender.idType",
      "sender.id",
      "sender.siteCode",
      "recipient.idType",
      "recipient.id",
      "recipient.siteCode",
      "cargo.shortDescription",
      "cargo.merchandiseCode",
      "cargo.packageCode",
      "cargo.natureCode",
      "cargoPolicy.number",
      "cargoPolicy.expirationDate",
      "cargoPolicy.insurerNit"
    ],
    numbers: ["cargo.quantityKg"]
  },
  emit_trip: {
    strings: [
      "tripNumber",
      "cargoNumber",
      "driver.idType",
      "driver.id",
      "vehicle.plate",
      "sender.cityCode",
      "recipient.cityCode"
    ],
    numbers: ["money.freightValue"]
  },
  emit_manifest: {
    strings: [
      "manifestNumber",
      "tripNumber",
      "remesaNumber",
      "cargoNumber",
      "expeditionDate",
      "balancePaymentDate",
      "driver.idType",
      "driver.id",
      "vehicle.plate",
      "vehicleHolder.idType",
      "vehicleHolder.id",
      "sender.cityCode",
      "recipient.cityCode"
    ],
    numbers: ["money.freightValue", "money.advanceValue", "money.icaRetentionPerMille"]
  },
  fulfill_remesa: {
    strings: [
      "remesaNumber",
      "manifestNumber",
      "compliance.remesaType",
      "compliance.loadingArrivalDate",
      "compliance.loadingArrivalTime",
      "compliance.loadingEntryDate",
      "compliance.loadingEntryTime",
      "compliance.loadingExitDate",
      "compliance.loadingExitTime"
    ],
    numbers: ["compliance.loadedQuantityKg", "compliance.unitCode"]
  },
  fulfill_manifest: {
    strings: ["manifestNumber", "compliance.manifestType", "compliance.documentsDeliveryDate"],
    numbers: [
      "money.freightValue",
      "compliance.additionalLoadHoursValue",
      "compliance.additionalUnloadHoursValue",
      "compliance.additionalFreightValue",
      "compliance.freightDiscountValue",
      "compliance.overAdvanceValue"
    ]
  }
};

export function validateDurableActionPayload(
  operationType: string,
  payload: Record<string, unknown>
): DurablePayloadPreflight {
  const contract = contracts[operationType];

  if (!contract) {
    return { ok: true, missingFields: [], invalidFields: [] };
  }

  const workflowVariant = readPath(payload, "workflowVariant");
  const optional = new Set<string>();
  if (operationType === "emit_remesa" && workflowVariant === "remesa_without_order") optional.add("cargoNumber");
  if (operationType === "emit_manifest" && workflowVariant === "remesa_without_order") {
    optional.add("tripNumber");
    optional.add("cargoNumber");
  }
  if (operationType === "emit_manifest" && workflowVariant === "empty_manifest") {
    optional.add("tripNumber");
    optional.add("remesaNumber");
    optional.add("cargoNumber");
  }
  const missingFields = contract.strings.filter((field) => !optional.has(field) && !hasRequiredString(payload, field));
  const invalidFields: string[] = [];

  for (const field of contract.numbers) {
    requireFiniteNumber(payload, field, missingFields, invalidFields);
  }

  if (operationType === "fulfill_remesa") {
    const remesaType = readPath(payload, "compliance.remesaType");

    if (remesaType === "C") {
      requireFiniteNumber(payload, "compliance.deliveredQuantityKg", missingFields, invalidFields);
      for (const field of [
        "compliance.unloadingArrivalDate",
        "compliance.unloadingArrivalTime",
        "compliance.unloadingEntryDate",
        "compliance.unloadingEntryTime",
        "compliance.unloadingExitDate",
        "compliance.unloadingExitTime"
      ]) {
        requireString(payload, field, missingFields);
      }
    } else if (remesaType === "S") {
      requireString(payload, "compliance.remesaSuspensionReason", missingFields);
    } else if (remesaType !== undefined && remesaType !== null && remesaType !== "") {
      invalidFields.push("compliance.remesaType");
    }
  }

  if (operationType === "fulfill_manifest") {
    const manifestType = readPath(payload, "compliance.manifestType");

    if (manifestType === "S") {
      requireString(payload, "compliance.manifestSuspensionReason", missingFields);
      requireString(payload, "compliance.suspensionConsequence", missingFields);
    } else if (manifestType !== "C" && manifestType !== undefined && manifestType !== null && manifestType !== "") {
      invalidFields.push("compliance.manifestType");
    }

    if (positiveNumber(payload, "compliance.additionalFreightValue")) {
      requireString(payload, "compliance.additionalValueReason", missingFields);
    }

    if (positiveNumber(payload, "compliance.freightDiscountValue")) {
      requireString(payload, "compliance.discountReason", missingFields);
    }
  }

  return {
    ok: missingFields.length === 0 && invalidFields.length === 0,
    missingFields,
    invalidFields
  };
}

export function durablePreflightMessage(result: DurablePayloadPreflight): string {
  const parts = [];

  if (result.missingFields.length > 0) {
    parts.push(`Campos faltantes: ${result.missingFields.join(", ")}`);
  }

  if (result.invalidFields.length > 0) {
    parts.push(`Valores inválidos: ${result.invalidFields.join(", ")}`);
  }

  return `Completa la información obligatoria antes de enviar a RNDC. ${parts.join(". ")}`;
}

function hasRequiredString(payload: Record<string, unknown>, path: string): boolean {
  const value = readPath(payload, path);
  return typeof value === "string" && value.trim().length > 0;
}

function requireString(payload: Record<string, unknown>, path: string, missingFields: string[]): void {
  if (!hasRequiredString(payload, path) && !missingFields.includes(path)) {
    missingFields.push(path);
  }
}

function requireFiniteNumber(
  payload: Record<string, unknown>,
  path: string,
  missingFields: string[],
  invalidFields: string[]
): void {
  const value = readPath(payload, path);

  if (value === undefined || value === null || value === "") {
    if (!missingFields.includes(path)) {
      missingFields.push(path);
    }
  } else if ((typeof value !== "number" || !Number.isFinite(value)) && !invalidFields.includes(path)) {
    invalidFields.push(path);
  }
}

function positiveNumber(payload: Record<string, unknown>, path: string): boolean {
  const value = readPath(payload, path);
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function readPath(payload: Record<string, unknown>, path: string): unknown {
  let current: unknown = payload;

  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

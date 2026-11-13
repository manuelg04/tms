import { buildMtmReferenceScenario } from "@tms/rndc-core";
import type {
  CargoData,
  CompanyParty,
  ComplianceData,
  DemoScenario,
  MoneyData,
  PersonData,
  RndcConfig,
  VehicleData
} from "@tms/rndc-core";

export function buildScenarioFromForm(config: RndcConfig, payload: unknown, allowReferenceDefaults: boolean): DemoScenario {
  const scenario = allowReferenceDefaults ? buildMtmReferenceScenario(config) : buildBlankScenario(config);
  const record = isRecord(payload) ? payload : {};

  scenario.seed = readString(record, "seed", scenario.seed);
  const workflowVariant = readString(record, "workflowVariant", "");
  if (workflowVariant === "standard" || workflowVariant === "remesa_without_order" || workflowVariant === "empty_manifest" || workflowVariant === "transshipment") {
    scenario.workflowVariant = workflowVariant;
  }
  scenario.manifestType = readOptionalString(record, "manifestType", scenario.manifestType);
  scenario.sourceManifestNumber = readOptionalString(record, "sourceManifestNumber", scenario.sourceManifestNumber);
  scenario.monitoringCompanyNit = monitoringNit(readOptionalString(record, "monitoringCompanyNit", scenario.monitoringCompanyNit));
  scenario.cargoNumber = readString(record, "cargoNumber", scenario.cargoNumber);
  scenario.tripNumber = readString(record, "tripNumber", scenario.tripNumber);
  scenario.remesaNumber = readString(record, "remesaNumber", scenario.remesaNumber);
  scenario.manifestNumber = readString(record, "manifestNumber", scenario.manifestNumber);
  scenario.expeditionDate = readDate(record, "expeditionDate", scenario.expeditionDate);
  scenario.loadingAppointmentDate = readDate(record, "loadingAppointmentDate", scenario.loadingAppointmentDate);
  scenario.loadingAppointmentTime = readString(record, "loadingAppointmentTime", scenario.loadingAppointmentTime);
  scenario.loadingAgreedHours = readNumber(record, "loadingAgreedHours", scenario.loadingAgreedHours);
  scenario.loadingAgreedMinutes = readNumber(record, "loadingAgreedMinutes", scenario.loadingAgreedMinutes);
  scenario.unloadingAppointmentDate = readDate(record, "unloadingAppointmentDate", scenario.unloadingAppointmentDate);
  scenario.unloadingAppointmentTime = readString(record, "unloadingAppointmentTime", scenario.unloadingAppointmentTime);
  scenario.unloadingAgreedHours = readNumber(record, "unloadingAgreedHours", scenario.unloadingAgreedHours);
  scenario.unloadingAgreedMinutes = readNumber(record, "unloadingAgreedMinutes", scenario.unloadingAgreedMinutes);
  scenario.balancePaymentDate = readDate(record, "balancePaymentDate", scenario.balancePaymentDate);
  scenario.loadingAppointment = appointment(scenario.loadingAppointmentDate, scenario.loadingAppointmentTime);
  scenario.unloadingAppointment = appointment(scenario.unloadingAppointmentDate, scenario.unloadingAppointmentTime);
  scenario.observations = readString(record, "observations", scenario.observations);
  scenario.remissionNumber = readOptionalString(record, "remissionNumber", scenario.remissionNumber);
  scenario.seals = readOptionalString(record, "seals", scenario.seals);
  scenario.preparedBy = readOptionalString(record, "preparedBy", scenario.preparedBy);

  applyPerson(scenario.driver, child(record, "driver"));
  applyPerson(scenario.vehicleOwner, child(record, "vehicleOwner"));
  applyPerson(scenario.vehicleHolder, child(record, "vehicleHolder"));
  applyParty(scenario.sender, child(record, "sender"));
  applyParty(scenario.recipient, child(record, "recipient"));
  applyVehicle(scenario.vehicle, child(record, "vehicle"));
  applyCargo(scenario.cargo, child(record, "cargo"));
  applyCargoPolicy(scenario.cargoPolicy, child(record, "cargoPolicy"));
  applyMoney(scenario.money, child(record, "money"));
  applyCompliance(scenario.compliance, child(record, "compliance"));
  applyManifestRemesas(scenario, record);

  return scenario;
}

export function buildBlankScenario(config: RndcConfig): DemoScenario {
  const person = (): PersonData => ({
    idType: "",
    id: "",
    firstName: "",
    firstLastName: "",
    secondLastName: "",
    fullName: "",
    phone: "",
    address: "",
    cityName: "",
    cityCode: ""
  });
  const party = (): CompanyParty => ({
    idType: "",
    id: "",
    siteCode: "",
    siteName: "",
    name: "",
    address: "",
    cityName: "",
    cityCode: "",
    latitude: "",
    longitude: ""
  });

  return {
    seed: "",
    company: {
      nit: config.companyNit,
      dv: config.companyDv,
      rndcNit: config.companyRndcNit,
      name: "TRANSPORTES MTM SERVICIOS TERCERIZADOS SAS",
      address: "CALLE 16 Nº 24 - 35 EDIFICIO MAQROLL OFI 401 BR SAN FRANCISCO",
      phone: "6076040133",
      cityName: "BUCARAMANGA - Santander"
    },
    driver: person(),
    vehicleOwner: person(),
    vehicleHolder: person(),
    sender: party(),
    recipient: party(),
    vehicle: {
      plate: "",
      trailerPlate: "",
      brand: "",
      configuration: "",
      rndcConfigurationCode: "",
      rndcMakeCode: "",
      rndcFuelCode: "",
      rndcBodyTypeCode: "",
      lineCode: "",
      colorCode: "",
      modelYear: "",
      emptyWeightKg: 0,
      capacityKg: 0,
      soatNumber: "",
      soatExpirationDate: "",
      insurerNit: ""
    },
    cargo: {
      productName: "",
      shortDescription: "",
      merchandiseCode: "",
      packageName: "",
      packageCode: "",
      nature: "",
      natureCode: "",
      quantityKg: 0,
      declaredValue: 0
    },
    cargoPolicy: {
      number: "",
      expirationDate: "",
      insurerNit: ""
    },
    money: {
      freightValue: 0,
      advanceValue: 0,
      sourceRetention: 0,
      icaRetention: 0,
      icaRetentionPerMille: 0,
      fopatRetention: 0
    },
    cargoNumber: "",
    tripNumber: "",
    remesaNumber: "",
    manifestNumber: "",
    expeditionDate: "",
    loadingAppointment: "",
    loadingAppointmentDate: "",
    loadingAppointmentTime: "",
    loadingAgreedHours: 1,
    loadingAgreedMinutes: 0,
    unloadingAppointment: "",
    unloadingAppointmentDate: "",
    unloadingAppointmentTime: "",
    unloadingAgreedHours: 2,
    unloadingAgreedMinutes: 0,
    balancePaymentDate: "",
    observations: "",
    compliance: {
      remesaType: "",
      manifestType: "",
      loadedQuantityKg: 0,
      deliveredQuantityKg: 0,
      unitCode: 0,
      loadingArrivalDate: "",
      loadingArrivalTime: "",
      loadingEntryDate: "",
      loadingEntryTime: "",
      loadingExitDate: "",
      loadingExitTime: "",
      unloadingArrivalDate: "",
      unloadingArrivalTime: "",
      unloadingEntryDate: "",
      unloadingEntryTime: "",
      unloadingExitDate: "",
      unloadingExitTime: "",
      documentsDeliveryDate: "",
      additionalLoadHoursValue: 0,
      additionalUnloadHoursValue: 0,
      additionalFreightValue: 0,
      freightDiscountValue: 0,
      overAdvanceValue: 0,
      observations: ""
    }
  };
}

export function scenarioToForm(scenario: DemoScenario): Record<string, unknown> {
  return {
    seed: scenario.seed,
    cargoNumber: scenario.cargoNumber,
    tripNumber: scenario.tripNumber,
    remesaNumber: scenario.remesaNumber,
    manifestNumber: scenario.manifestNumber,
    expeditionDate: scenario.expeditionDate,
    loadingAppointmentDate: scenario.loadingAppointmentDate,
    loadingAppointmentTime: scenario.loadingAppointmentTime,
    loadingAgreedHours: scenario.loadingAgreedHours,
    loadingAgreedMinutes: scenario.loadingAgreedMinutes,
    unloadingAppointmentDate: scenario.unloadingAppointmentDate,
    unloadingAppointmentTime: scenario.unloadingAppointmentTime,
    unloadingAgreedHours: scenario.unloadingAgreedHours,
    unloadingAgreedMinutes: scenario.unloadingAgreedMinutes,
    balancePaymentDate: scenario.balancePaymentDate,
    observations: scenario.observations,
    driver: scenario.driver,
    vehicleOwner: scenario.vehicleOwner,
    vehicleHolder: scenario.vehicleHolder,
    sender: scenario.sender,
    recipient: scenario.recipient,
    vehicle: scenario.vehicle,
    cargo: scenario.cargo,
    cargoPolicy: scenario.cargoPolicy,
    money: scenario.money,
    compliance: scenario.compliance
  };
}

export function applyPerson(target: PersonData, record: Record<string, unknown>): void {
  target.idType = readString(record, "idType", target.idType);
  target.id = readString(record, "id", target.id);
  target.firstName = readString(record, "firstName", target.firstName);
  target.firstLastName = readString(record, "firstLastName", target.firstLastName);
  target.secondLastName = readString(record, "secondLastName", target.secondLastName);
  target.fullName = readString(record, "fullName", target.fullName);
  target.phone = readString(record, "phone", target.phone);
  target.address = readString(record, "address", target.address);
  target.cityName = readString(record, "cityName", target.cityName);
  target.cityCode = readString(record, "cityCode", target.cityCode);
  target.licenseCategory = readOptionalString(record, "licenseCategory", target.licenseCategory);
  target.licenseNumber = readOptionalString(record, "licenseNumber", target.licenseNumber);
  target.licenseExpirationDate = readOptionalDate(record, "licenseExpirationDate", target.licenseExpirationDate);
}

export function applyParty(target: CompanyParty, record: Record<string, unknown>): void {
  target.idType = readString(record, "idType", target.idType);
  target.id = readString(record, "id", target.id);
  target.siteCode = readString(record, "siteCode", target.siteCode);
  target.siteName = readString(record, "siteName", target.siteName);
  target.name = readString(record, "name", target.name);
  target.address = readString(record, "address", target.address);
  target.cityName = readString(record, "cityName", target.cityName);
  target.cityCode = readString(record, "cityCode", target.cityCode);
  target.latitude = readString(record, "latitude", target.latitude);
  target.longitude = readString(record, "longitude", target.longitude);
  target.phone = readOptionalString(record, "phone", target.phone);
}

export function applyVehicle(target: VehicleData, record: Record<string, unknown>): void {
  target.plate = readString(record, "plate", target.plate).toUpperCase();
  target.trailerPlate = readString(record, "trailerPlate", target.trailerPlate).toUpperCase();
  target.brand = readString(record, "brand", target.brand);
  target.configuration = readString(record, "configuration", target.configuration);
  target.rndcConfigurationCode = readString(record, "rndcConfigurationCode", target.rndcConfigurationCode);
  target.rndcMakeCode = readString(record, "rndcMakeCode", target.rndcMakeCode);
  target.rndcFuelCode = readString(record, "rndcFuelCode", target.rndcFuelCode);
  target.rndcBodyTypeCode = readString(record, "rndcBodyTypeCode", target.rndcBodyTypeCode);
  target.lineCode = readString(record, "lineCode", target.lineCode);
  target.colorCode = readString(record, "colorCode", target.colorCode);
  target.modelYear = readString(record, "modelYear", target.modelYear);
  target.emptyWeightKg = readNumber(record, "emptyWeightKg", target.emptyWeightKg);
  target.capacityKg = readNumber(record, "capacityKg", target.capacityKg);
  target.soatNumber = readString(record, "soatNumber", target.soatNumber);
  target.soatExpirationDate = readDate(record, "soatExpirationDate", target.soatExpirationDate);
  target.insurerNit = readString(record, "insurerNit", target.insurerNit);
  target.insurerName = readOptionalString(record, "insurerName", target.insurerName);
}

export function applyCargo(target: CargoData, record: Record<string, unknown>): void {
  target.productName = readString(record, "productName", target.productName);
  target.shortDescription = readString(record, "shortDescription", target.shortDescription);
  target.merchandiseCode = readString(record, "merchandiseCode", target.merchandiseCode);
  target.packageName = readString(record, "packageName", target.packageName);
  target.packageCode = readString(record, "packageCode", target.packageCode);
  target.nature = readString(record, "nature", target.nature);
  target.natureCode = readString(record, "natureCode", target.natureCode);
  target.quantityKg = readNumber(record, "quantityKg", target.quantityKg);
  target.declaredValue = readNumber(record, "declaredValue", target.declaredValue);
  target.quantity = optionalNumberValue(record, "quantity") ?? target.quantity;
  target.volumeM3 = optionalNumberValue(record, "volumeM3") ?? target.volumeM3;
}

export function applyCargoPolicy(target: DemoScenario["cargoPolicy"], record: Record<string, unknown>): void {
  target.number = readString(record, "number", target.number);
  target.expirationDate = readDate(record, "expirationDate", target.expirationDate);
  target.insurerNit = readString(record, "insurerNit", target.insurerNit);
}

export function applyMoney(target: MoneyData, record: Record<string, unknown>): void {
  target.freightValue = readNumber(record, "freightValue", target.freightValue);
  target.advanceValue = readNumber(record, "advanceValue", target.advanceValue);
  target.sourceRetention = readNumber(record, "sourceRetention", target.sourceRetention);
  target.icaRetention = readNumber(record, "icaRetention", target.icaRetention);
  target.icaRetentionPerMille = readNumber(record, "icaRetentionPerMille", target.icaRetentionPerMille);
  target.fopatRetention = readNumber(record, "fopatRetention", target.fopatRetention);
}

function monitoringNit(value: string | undefined): string | undefined {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 12 ? digits : undefined;
}

export function applyCompliance(target: ComplianceData, record: Record<string, unknown>): void {
  target.remesaType = readString(record, "remesaType", target.remesaType);
  target.manifestType = readString(record, "manifestType", target.manifestType);
  target.remesaSuspensionReason = readOptionalString(record, "remesaSuspensionReason", target.remesaSuspensionReason);
  target.manifestSuspensionReason = readOptionalString(record, "manifestSuspensionReason", target.manifestSuspensionReason);
  target.suspensionConsequence = readOptionalString(record, "suspensionConsequence", target.suspensionConsequence);
  target.loadedQuantityKg = readNumber(record, "loadedQuantityKg", target.loadedQuantityKg);
  target.deliveredQuantityKg = readNumber(record, "deliveredQuantityKg", target.deliveredQuantityKg);
  target.unitCode = readNumber(record, "unitCode", target.unitCode);
  target.loadingArrivalDate = readDate(record, "loadingArrivalDate", "");
  target.loadingArrivalTime = readString(record, "loadingArrivalTime", "");
  target.loadingEntryDate = readDate(record, "loadingEntryDate", target.loadingEntryDate);
  target.loadingEntryTime = readString(record, "loadingEntryTime", target.loadingEntryTime);
  target.loadingExitDate = readDate(record, "loadingExitDate", "");
  target.loadingExitTime = readString(record, "loadingExitTime", "");
  target.unloadingArrivalDate = readDate(record, "unloadingArrivalDate", "");
  target.unloadingArrivalTime = readString(record, "unloadingArrivalTime", "");
  target.unloadingEntryDate = readDate(record, "unloadingEntryDate", target.unloadingEntryDate);
  target.unloadingEntryTime = readString(record, "unloadingEntryTime", target.unloadingEntryTime);
  target.unloadingExitDate = readDate(record, "unloadingExitDate", "");
  target.unloadingExitTime = readString(record, "unloadingExitTime", "");
  target.documentsDeliveryDate = readDate(record, "documentsDeliveryDate", target.documentsDeliveryDate);
  target.additionalLoadHoursValue = readNumber(record, "additionalLoadHoursValue", target.additionalLoadHoursValue);
  target.additionalUnloadHoursValue = readNumber(record, "additionalUnloadHoursValue", target.additionalUnloadHoursValue);
  target.additionalFreightValue = readNumber(record, "additionalFreightValue", target.additionalFreightValue);
  target.additionalValueReason = readOptionalString(record, "additionalValueReason", target.additionalValueReason);
  target.freightDiscountValue = readNumber(record, "freightDiscountValue", target.freightDiscountValue);
  target.discountReason = readOptionalString(record, "discountReason", target.discountReason);
  target.overAdvanceValue = readNumber(record, "overAdvanceValue", target.overAdvanceValue);
  target.observations = readString(record, "observations", target.observations);
}

export function applyManifestRemesas(scenario: DemoScenario, record: Record<string, unknown>): void {
  const value = record.manifestRemesas;

  if (!Array.isArray(value)) {
    return;
  }

  const remesas = value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const number = readOptionalString(item, "number", undefined);
    if (!number) {
      return [];
    }

    return [{
      number,
      quantityKg: optionalNumberValue(item, "quantityKg"),
      nature: readOptionalString(item, "nature", undefined),
      productName: readOptionalString(item, "productName", undefined),
      packageName: readOptionalString(item, "packageName", undefined),
      senderName: readOptionalString(item, "senderName", undefined),
      recipientName: readOptionalString(item, "recipientName", undefined)
    }];
  });

  if (remesas.length > 0) {
    scenario.manifestRemesas = remesas;
  }
}

export function optionalNumberValue(record: Record<string, unknown>, name: string): number | undefined {
  const value = record[name];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function child(record: Record<string, unknown>, name: string): Record<string, unknown> {
  const value = record[name];
  return isRecord(value) ? value : {};
}

export function readString(record: Record<string, unknown>, name: string, fallback: string): string {
  const value = record[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

export function readOptionalString(record: Record<string, unknown>, name: string, fallback: string | undefined): string | undefined {
  const value = record[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

export function readNumber(record: Record<string, unknown>, name: string, fallback: number): number {
  const value = record[name];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value.replaceAll(",", "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function readDate(record: Record<string, unknown>, name: string, fallback: string): string {
  return normalizeDate(readString(record, name, fallback));
}

export function readOptionalDate(record: Record<string, unknown>, name: string, fallback: string | undefined): string | undefined {
  const value = readOptionalString(record, name, fallback);
  return value ? normalizeDate(value) : value;
}

export function normalizeDate(value: string): string {
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (iso) {
    return `${iso[3]}/${iso[2]}/${iso[1]}`;
  }

  return trimmed;
}

export function appointment(date: string, time: string): string {
  const parts = date.split("/");

  if (parts.length !== 3) {
    return `${date} ${time}`;
  }

  return `${parts[2]}-${parts[1]}-${parts[0]} ${time}:00`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

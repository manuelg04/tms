import type { DemoScenario, RndcConfig } from "../rndc/types.js";

export function buildDemoScenario(config: RndcConfig): DemoScenario {
  const seed = makeNumericSeed();
  const remesaNumber = seed.slice(-5).padStart(5, "0");
  const manifestNumber = seed.slice(-7).padStart(7, "0");
  const today = new Date();
  const loadingDate = formatDate(today);
  const unloadingDate = formatDate(addDays(today, 3));
  const balancePaymentDate = formatDate(addDays(today, 8));

  return {
    seed,
    company: {
      nit: config.companyNit,
      dv: config.companyDv,
      rndcNit: config.companyRndcNit,
      name: "TRANSPORTES MTM SAS",
      address: "CALLE 16 No 24 - 35 EDIFICIO MAQROLL OFI 401",
      phone: "6076040133",
      cityName: "BUCARAMANGA - Santander"
    },
    driver: {
      idType: "C",
      id: "80756632",
      firstName: "LUIS GERMAN",
      firstLastName: "FONSECA",
      secondLastName: "GUTIERREZ",
      fullName: "FONSECA GUTIERREZ LUIS GERMAN",
      phone: "3118980752",
      address: "CALLE 19 22 - 26",
      cityName: "PAIPA - Boyaca",
      cityCode: "15516000",
      licenseCategory: "C3",
      licenseNumber: "80756632",
      licenseExpirationDate: formatDate(addDays(today, 730))
    },
    vehicleOwner: {
      idType: "C",
      id: "74322799",
      firstName: "GONZALO",
      firstLastName: "FONSECA",
      secondLastName: "",
      fullName: "FONSECA GONZALO",
      phone: "3118980752",
      address: "CL 19 22 - 26",
      cityName: "PAIPA - Boyaca",
      cityCode: "15516000"
    },
    vehicleHolder: {
      idType: "C",
      id: "74322799",
      firstName: "GONZALO",
      firstLastName: "FONSECA",
      secondLastName: "",
      fullName: "FONSECA GONZALO",
      phone: "3118980752",
      address: "CL 19 22 - 26",
      cityName: "PAIPA - Boyaca",
      cityCode: "15516000"
    },
    sender: {
      idType: "C",
      id: "19258361",
      siteCode: "0",
      siteName: "CALI",
      name: "REMITENTE DEMO RNDC",
      address: "CRA 20 CALLE 40",
      cityName: "CALI",
      cityCode: "76001000",
      latitude: "3.4516",
      longitude: "-76.5320"
    },
    recipient: {
      idType: "C",
      id: "19258361",
      siteCode: "1",
      siteName: "BOGOTA",
      name: "DESTINATARIO DEMO RNDC",
      address: "AV CALLE 26 68 - 50",
      cityName: "BOGOTA",
      cityCode: "11001000",
      latitude: "4.7110",
      longitude: "-74.0721"
    },
    vehicle: {
      plate: "JVK276",
      trailerPlate: "R41537",
      brand: "FREIGHTLINER",
      configuration: "3S2",
      rndcConfigurationCode: "55",
      lineCode: "373",
      colorCode: "1",
      modelYear: "2020",
      emptyWeightKg: 7000,
      capacityKg: 34000,
      soatNumber: "4356454300",
      soatExpirationDate: "23/03/2027",
      insurerNit: "8110191907"
    },
    cargo: {
      productName: "CARBON",
      shortDescription: "CARBON",
      merchandiseCode: "001504",
      packageName: "Granel Solido",
      packageCode: "10",
      nature: "Carga Normal",
      natureCode: "1",
      quantityKg: 34000,
      declaredValue: 40000000
    },
    money: {
      freightValue: 4760000,
      advanceValue: 3808000,
      sourceRetention: 0,
      icaRetention: 0,
      icaRetentionPerMille: 3,
      fopatRetention: 4760
    },
    cargoNumber: `IC${seed.slice(-6)}`,
    tripNumber: `IV${seed.slice(-6)}`,
    remesaNumber,
    manifestNumber,
    expeditionDate: loadingDate,
    loadingAppointment: `${formatIsoDate(today)} 11:02:00`,
    loadingAppointmentDate: loadingDate,
    loadingAppointmentTime: "11:02",
    unloadingAppointment: `${formatIsoDate(addDays(today, 3))} 12:06:00`,
    unloadingAppointmentDate: unloadingDate,
    unloadingAppointmentTime: "12:06",
    balancePaymentDate,
    observations: "VIAJE DUMMY PARA AMBIENTE DE PRUEBAS RNDC",
    compliance: buildComplianceData({
      quantityKg: 34000,
      loadingDate,
      unloadingDate,
      documentsDeliveryDate: balancePaymentDate,
      observations: "CUMPLIDO DUMMY PARA AMBIENTE DE PRUEBAS RNDC"
    })
  };
}

export function buildMtmProductionScenario(config: RndcConfig): DemoScenario {
  const seed = process.env.RNDC_SCENARIO_SEED ?? makeNumericSeed();
  const remesaNumber = seed.slice(-5).padStart(5, "0");
  const manifestNumber = seed.slice(-7).padStart(7, "0");
  const loadingDate = readEnv("RNDC_LOADING_DATE", "29/06/2026");
  const unloadingDate = readEnv("RNDC_UNLOADING_DATE", "02/07/2026");
  const loadingAppointmentTime = readEnv("RNDC_LOADING_TIME", "11:02");
  const unloadingAppointmentTime = readEnv("RNDC_UNLOADING_TIME", "12:06");
  const balancePaymentDate = readEnv("RNDC_BALANCE_PAYMENT_DATE", "07/07/2026");

  return {
    seed,
    company: {
      nit: config.companyNit,
      dv: config.companyDv,
      rndcNit: config.companyRndcNit,
      name: "TRANSPORTES MTM SERVICIOS TERCERIZADOS SAS",
      address: "CALLE 16 No 24 - 35 EDIFICIO MAQROLL OFI 401",
      phone: "6076040133",
      cityName: "BUCARAMANGA - Santander"
    },
    driver: {
      idType: "C",
      id: "80756632",
      firstName: "LUIS GERMAN",
      firstLastName: "FONSECA",
      secondLastName: "GUTIERREZ",
      fullName: "FONSECA GUTIERREZ LUIS GERMAN",
      phone: "3118980752",
      address: "CALLE 19 22 - 26",
      cityName: "PAIPA - Boyaca",
      cityCode: "15516000",
      licenseCategory: "C3",
      licenseNumber: "80756632",
      licenseExpirationDate: "23/06/2028"
    },
    vehicleOwner: {
      idType: "C",
      id: "74322799",
      firstName: "GONZALO",
      firstLastName: "FONSECA",
      secondLastName: "",
      fullName: "FONSECA GONZALO",
      phone: "7852586",
      address: "CL 19 22 - 26",
      cityName: "PAIPA - Boyaca",
      cityCode: "15516000"
    },
    vehicleHolder: {
      idType: "C",
      id: "74322799",
      firstName: "GONZALO",
      firstLastName: "FONSECA",
      secondLastName: "",
      fullName: "FONSECA GONZALO",
      phone: "7852586",
      address: "CL 19 22 - 26",
      cityName: "PAIPA - Boyaca",
      cityCode: "15516000"
    },
    sender: {
      idType: "N",
      id: "9002266843",
      siteCode: "0",
      siteName: "LANDAZURI",
      name: "C.I BULKTRADIN - LANDAZURI",
      address: "LANDAZURI",
      cityName: "LANDAZURI",
      cityCode: "68385000",
      latitude: "6.219438",
      longitude: "-73.810492"
    },
    recipient: {
      idType: "N",
      id: "9002266843",
      siteCode: "1",
      siteName: "MINGUEO",
      name: "C.I BULKTRADIN-MINGUEO",
      address: "MINGUEO",
      cityName: "MINGUEO",
      cityCode: "44090003",
      latitude: "11.2171951",
      longitude: "-73.3983323"
    },
    vehicle: {
      plate: "JVK276",
      trailerPlate: "R41537",
      brand: "FREIGHTLINER",
      configuration: "3S2",
      rndcConfigurationCode: "55",
      lineCode: "373",
      colorCode: "1",
      modelYear: "2020",
      emptyWeightKg: 7000,
      capacityKg: 34000,
      soatNumber: "4356454300",
      soatExpirationDate: "23/03/2027",
      insurerNit: "8110191907"
    },
    cargo: {
      productName: "CARBON",
      shortDescription: "CARBON",
      merchandiseCode: "001504",
      packageName: "Granel Solido",
      packageCode: "10",
      nature: "Carga Normal",
      natureCode: "1",
      quantityKg: 34000,
      declaredValue: 40000000
    },
    money: {
      freightValue: 4760000,
      advanceValue: 3808000,
      sourceRetention: 0,
      icaRetention: 0,
      icaRetentionPerMille: 3,
      fopatRetention: 4760
    },
    cargoNumber: `IC${seed.slice(-6)}`,
    tripNumber: `IV${seed.slice(-6)}`,
    remesaNumber,
    manifestNumber,
    expeditionDate: loadingDate,
    loadingAppointment: `${toIsoDate(loadingDate)} ${loadingAppointmentTime}:00`,
    loadingAppointmentDate: loadingDate,
    loadingAppointmentTime,
    unloadingAppointment: `${toIsoDate(unloadingDate)} ${unloadingAppointmentTime}:00`,
    unloadingAppointmentDate: unloadingDate,
    unloadingAppointmentTime,
    balancePaymentDate,
    observations: "CARGAMENTO ENTREGADO EN BUEN ESTADO Y COMPLETO",
    compliance: buildComplianceData({
      quantityKg: 34000,
      loadingDate,
      unloadingDate,
      documentsDeliveryDate: balancePaymentDate,
      observations: "CARGAMENTO ENTREGADO EN BUEN ESTADO Y COMPLETO"
    })
  };
}

export function buildMtmReferenceScenario(config: RndcConfig): DemoScenario {
  const seed = process.env.RNDC_SCENARIO_SEED ?? "421960041464";
  const remesaNumber = readEnv("RNDC_REMESA_NUMBER", "42196");
  const manifestNumber = readEnv("RNDC_MANIFEST_NUMBER", "0041464");
  const cargoNumber = readEnv("RNDC_CARGO_NUMBER", "000044579");
  const tripNumber = readEnv("RNDC_TRIP_NUMBER", "IV42196");
  const loadingDate = readEnv("RNDC_LOADING_DATE", "22/06/2026");
  const unloadingDate = readEnv("RNDC_UNLOADING_DATE", "25/06/2026");
  const balancePaymentDate = readEnv("RNDC_BALANCE_PAYMENT_DATE", "30/06/2026");

  return {
    seed,
    company: {
      nit: config.companyNit,
      dv: config.companyDv,
      rndcNit: config.companyRndcNit,
      name: "TRANSPORTES MTM SERVICIOS TERCERIZADOS SAS",
      address: "CALLE 16 No 24 - 35 EDIFICIO MAQROLL OFI 401",
      phone: "6076040133",
      cityName: "BUCARAMANGA - Santander"
    },
    driver: {
      idType: "C",
      id: "80756632",
      firstName: "LUIS GERMAN",
      firstLastName: "FONSECA",
      secondLastName: "GUTIERREZ",
      fullName: "FONSECA GUTIERREZ LUIS GERMAN",
      phone: "3118980752",
      address: "CALLE 19 22 - 26",
      cityName: "PAIPA - Boyaca",
      cityCode: "15516000",
      licenseCategory: "C3",
      licenseNumber: "80756632",
      licenseExpirationDate: "23/06/2028"
    },
    vehicleOwner: {
      idType: "C",
      id: "74322799",
      firstName: "GONZALO",
      firstLastName: "FONSECA",
      secondLastName: "",
      fullName: "FONSECA GONZALO",
      phone: "7852586",
      address: "CL 19 22 - 26",
      cityName: "PAIPA - Boyaca",
      cityCode: "15516000"
    },
    vehicleHolder: {
      idType: "C",
      id: "74322799",
      firstName: "GONZALO",
      firstLastName: "FONSECA",
      secondLastName: "",
      fullName: "FONSECA GONZALO",
      phone: "7852586",
      address: "CL 19 22 - 26",
      cityName: "PAIPA - Boyaca",
      cityCode: "15516000"
    },
    sender: {
      idType: "N",
      id: "9002266843",
      siteCode: "0",
      siteName: "LANDAZURI",
      name: "C.I BULKTRADIN - LANDAZURI",
      address: "LANDAZURI",
      cityName: "LANDAZURI",
      cityCode: "68385000",
      latitude: "6.316071",
      longitude: "-73.949992"
    },
    recipient: {
      idType: "N",
      id: "9002266843",
      siteCode: "1",
      siteName: "MINGUEO",
      name: "C.I BULKTRADIN-MINGUEO",
      address: "MINGUEO",
      cityName: "MINGUEO",
      cityCode: "44090003",
      latitude: "11.2171951",
      longitude: "-73.3983323"
    },
    vehicle: {
      plate: "JVK276",
      trailerPlate: "R41537",
      brand: "FREIGHTLINER",
      configuration: "3S2",
      rndcConfigurationCode: "55",
      lineCode: "373",
      colorCode: "1",
      modelYear: "2020",
      emptyWeightKg: 7000,
      capacityKg: 34000,
      soatNumber: "4356454300",
      soatExpirationDate: "23/03/2027",
      insurerNit: "8110191907"
    },
    cargo: {
      productName: "CARBON",
      shortDescription: "CARBON",
      merchandiseCode: "002803",
      packageName: "Granel Solido",
      packageCode: "10",
      nature: "Carga Normal",
      natureCode: "1",
      quantityKg: 34000,
      declaredValue: 40000000
    },
    money: {
      freightValue: 4760000,
      advanceValue: 3808000,
      sourceRetention: 0,
      icaRetention: 0,
      icaRetentionPerMille: 3,
      fopatRetention: 4760
    },
    cargoNumber,
    tripNumber,
    remesaNumber,
    manifestNumber,
    expeditionDate: loadingDate,
    loadingAppointment: "2026-06-22 11:02:00",
    loadingAppointmentDate: loadingDate,
    loadingAppointmentTime: "11:02",
    unloadingAppointment: "2026-06-25 12:06:00",
    unloadingAppointmentDate: unloadingDate,
    unloadingAppointmentTime: "12:06",
    balancePaymentDate,
    observations: "CARGAMENTO ENTREGADO EN BUEN ESTADO Y COMPLETO",
    compliance: buildComplianceData({
      quantityKg: 34000,
      loadingDate,
      unloadingDate,
      documentsDeliveryDate: balancePaymentDate,
      observations: "CARGAMENTO ENTREGADO EN BUEN ESTADO Y COMPLETO"
    })
  };
}

function makeNumericSeed(): string {
  return String(Date.now()).slice(-10);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function toIsoDate(ddmmyyyy: string): string {
  const [day, month, year] = ddmmyyyy.split("/");
  return `${year}-${month}-${day}`;
}

function readEnv(name: string, fallback: string): string {
  return process.env[name] && process.env[name] !== "" ? process.env[name] : fallback;
}

function buildComplianceData(input: {
  quantityKg: number;
  loadingDate: string;
  unloadingDate: string;
  documentsDeliveryDate: string;
  observations: string;
}): DemoScenario["compliance"] {
  return {
    remesaType: readEnv("RNDC_REMESA_COMPLIANCE_TYPE", "C"),
    manifestType: readEnv("RNDC_MANIFEST_COMPLIANCE_TYPE", "C"),
    remesaSuspensionReason: "",
    manifestSuspensionReason: "",
    suspensionConsequence: "",
    loadedQuantityKg: Number(process.env.RNDC_LOADED_QUANTITY_KG ?? input.quantityKg),
    deliveredQuantityKg: Number(process.env.RNDC_DELIVERED_QUANTITY_KG ?? input.quantityKg),
    unitCode: Number(process.env.RNDC_CAPACITY_UNIT_CODE ?? 1),
    loadingArrivalDate: readEnv("RNDC_LOADING_ARRIVAL_DATE", input.loadingDate),
    loadingArrivalTime: readEnv("RNDC_LOADING_ARRIVAL_TIME", "11:02"),
    loadingEntryDate: readEnv("RNDC_LOADING_ENTRY_DATE", input.loadingDate),
    loadingEntryTime: readEnv("RNDC_LOADING_ENTRY_TIME", "11:32"),
    loadingExitDate: readEnv("RNDC_LOADING_EXIT_DATE", input.loadingDate),
    loadingExitTime: readEnv("RNDC_LOADING_EXIT_TIME", "12:02"),
    unloadingArrivalDate: readEnv("RNDC_UNLOADING_ARRIVAL_DATE", input.unloadingDate),
    unloadingArrivalTime: readEnv("RNDC_UNLOADING_ARRIVAL_TIME", "12:06"),
    unloadingEntryDate: readEnv("RNDC_UNLOADING_ENTRY_DATE", input.unloadingDate),
    unloadingEntryTime: readEnv("RNDC_UNLOADING_ENTRY_TIME", "12:36"),
    unloadingExitDate: readEnv("RNDC_UNLOADING_EXIT_DATE", input.unloadingDate),
    unloadingExitTime: readEnv("RNDC_UNLOADING_EXIT_TIME", "14:06"),
    documentsDeliveryDate: readEnv("RNDC_DOCUMENTS_DELIVERY_DATE", input.documentsDeliveryDate),
    additionalLoadHoursValue: Number(process.env.RNDC_ADDITIONAL_LOAD_HOURS_VALUE ?? 0),
    additionalUnloadHoursValue: Number(process.env.RNDC_ADDITIONAL_UNLOAD_HOURS_VALUE ?? 0),
    additionalFreightValue: Number(process.env.RNDC_ADDITIONAL_FREIGHT_VALUE ?? 0),
    additionalValueReason: "",
    freightDiscountValue: Number(process.env.RNDC_FREIGHT_DISCOUNT_VALUE ?? 0),
    discountReason: "",
    overAdvanceValue: Number(process.env.RNDC_OVER_ADVANCE_VALUE ?? 0),
    observations: readEnv("RNDC_COMPLIANCE_OBSERVATIONS", input.observations)
  };
}

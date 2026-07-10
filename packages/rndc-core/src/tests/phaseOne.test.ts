import assert from "node:assert/strict";
import test from "node:test";
import * as core from "../index.js";
import { buildMtmReferenceScenario } from "../data/demoScenario.js";
import { loadConfig } from "../rndc/config.js";
import { buildManifestMessages } from "../rndc/messages.js";
import type { RndcMessageRequest, RndcXmlRecord } from "../rndc/types.js";
import { parseXml } from "../rndc/xml.js";

type UnknownFunction = (...args: never[]) => unknown;

function requireApi<T extends UnknownFunction>(name: string): T {
  const value = (core as unknown as Record<string, unknown>)[name];
  assert.equal(typeof value, "function", `${name} must be exported by @tms/rndc-core`);
  return value as T;
}

test("calculates FOPAT as 0.1 percent rounded to the nearest peso", () => {
  const calculateFopat = requireApi<(input: {
    valueToPay: number;
    operationType: string;
    isOwnFleet: boolean;
    grossVehicleWeightKg: number;
    vehicleConfigurationEligible: boolean;
  }) => unknown>("calculateFopat");

  assert.deepEqual(calculateFopat({
    valueToPay: 4_760_500,
    operationType: "G",
    isOwnFleet: false,
    grossVehicleWeightKg: 41_000,
    vehicleConfigurationEligible: true
  }), {
    status: "applicable",
    amount: 4761,
    basis: 4_760_500,
    rate: 0.001
  });
});

test("returns zero FOPAT for every official applicability exception", () => {
  const calculateFopat = requireApi<(input: Record<string, unknown>) => unknown>("calculateFopat");
  const base = {
    valueToPay: 4_760_000,
    operationType: "G",
    isOwnFleet: false,
    grossVehicleWeightKg: 41_000,
    vehicleConfigurationEligible: true
  };

  assert.deepEqual(calculateFopat({ ...base, operationType: "U" }), {
    status: "not-applicable",
    amount: 0,
    reason: "municipal-operation"
  });
  assert.deepEqual(calculateFopat({ ...base, isOwnFleet: true }), {
    status: "not-applicable",
    amount: 0,
    reason: "own-fleet"
  });
  assert.deepEqual(calculateFopat({ ...base, grossVehicleWeightKg: 10_500 }), {
    status: "not-applicable",
    amount: 0,
    reason: "gross-weight-at-or-below-10500"
  });
  assert.deepEqual(calculateFopat({ ...base, vehicleConfigurationEligible: false }), {
    status: "not-applicable",
    amount: 0,
    reason: "vehicle-configuration"
  });
});

test("fails closed when FOPAT applicability cannot be established", () => {
  const calculateFopat = requireApi<(input: Record<string, unknown>) => unknown>("calculateFopat");

  assert.deepEqual(calculateFopat({
    valueToPay: 4_760_000,
    operationType: "G",
    isOwnFleet: false,
    grossVehicleWeightKg: 41_000
  }), {
    status: "review-required",
    amount: null,
    reason: "missing-vehicle-configuration-eligibility"
  });
});

test("builds process 38 loading appointment correction with only official variables", () => {
  const buildRemesaCorrectionMessage = requireApi<(input: Record<string, unknown>) => { request: RndcMessageRequest }>("buildRemesaCorrectionMessage");
  const message = buildRemesaCorrectionMessage({
    remesaNumber: "97102",
    reasonCode: 1,
    change: {
      code: 1,
      appointmentDate: "10/07/2026",
      appointmentTime: "14:30"
    }
  });
  const variables = message.request.variables as RndcXmlRecord;

  assert.equal(message.request.tipo, 1);
  assert.equal(message.request.procesoId, 38);
  assert.deepEqual(variables, {
    CONSECUTIVOREMESA: "97102",
    MOTIVOCAMBIO: 1,
    CODIGOCAMBIO: 1,
    FECHACITAPACTADACARGUE: "10/07/2026",
    HORACITAPACTADACARGUE: "14:30"
  });
});

test("builds process 38 destination and generator corrections from its 13-variable dictionary", () => {
  const buildRemesaCorrectionMessage = requireApi<(input: Record<string, unknown>) => { request: RndcMessageRequest }>("buildRemesaCorrectionMessage");
  const officialVariables = (core as unknown as Record<string, unknown>).PROCESS_38_OFFICIAL_VARIABLES;
  assert.deepEqual(officialVariables, [
    "HORACITAPACTADADESCARGUE",
    "HORACITAPACTADACARGUE",
    "FECHACITAPACTADADESCARGUE",
    "FECHACITAPACTADACARGUE",
    "CODSEDEPROPIETARIO",
    "NUMIDPROPIETARIO",
    "CODTIPOIDPROPIETARIO",
    "CODSEDEDESTINATARIO",
    "NUMIDDESTINATARIO",
    "CODTIPOIDDESTINATARIO",
    "CONSECUTIVOREMESA",
    "MOTIVOCAMBIO",
    "CODIGOCAMBIO"
  ]);

  const destination = buildRemesaCorrectionMessage({
    remesaNumber: "97102",
    reasonCode: 2,
    change: { code: 3, idType: "N", id: "9002266843", siteCode: "2" }
  }).request.variables as RndcXmlRecord;
  const generator = buildRemesaCorrectionMessage({
    remesaNumber: "97102",
    reasonCode: 3,
    change: { code: 4, idType: "N", id: "9012345678", siteCode: "1" }
  }).request.variables as RndcXmlRecord;

  assert.deepEqual(destination, {
    CONSECUTIVOREMESA: "97102",
    MOTIVOCAMBIO: 2,
    CODIGOCAMBIO: 3,
    CODTIPOIDDESTINATARIO: "N",
    NUMIDDESTINATARIO: "9002266843",
    CODSEDEDESTINATARIO: "2"
  });
  assert.deepEqual(generator, {
    CONSECUTIVOREMESA: "97102",
    MOTIVOCAMBIO: 3,
    CODIGOCAMBIO: 4,
    CODTIPOIDPROPIETARIO: "N",
    NUMIDPROPIETARIO: "9012345678",
    CODSEDEPROPIETARIO: "1"
  });
});

test("builds one targeted annulment without adding a reverse chain", () => {
  const buildTargetedAnnulmentMessage = requireApi<(input: Record<string, unknown>) => { name: string; request: RndcMessageRequest }>("buildTargetedAnnulmentMessage");
  const message = buildTargetedAnnulmentMessage({
    target: "manifest",
    companyRndcNit: "9007736849",
    manifestNumber: "9702001",
    reasonCode: "S",
    observations: "ANULACION AUTORIZADA POR OPERACIONES"
  });

  assert.equal(message.name, "annul-manifest");
  assert.equal(message.request.procesoId, 32);
  assert.deepEqual(message.request.variables, {
    NUMNITEMPRESATRANSPORTE: "9007736849",
    NUMMANIFIESTOCARGA: "9702001",
    MOTIVOANULACIONMANIFIESTO: "S",
    OBSERVACIONES: "ANULACION AUTORIZADA POR OPERACIONES"
  });
});

test("builds type 3 document and acceptance reconciliation queries", () => {
  const buildRndcDocumentQuery = requireApi<(input: Record<string, unknown>) => RndcMessageRequest>("buildRndcDocumentQuery");
  const buildAcceptanceQuery = requireApi<(input: Record<string, unknown>) => RndcMessageRequest>("buildAcceptanceQuery");

  assert.deepEqual(buildRndcDocumentQuery({
    companyRndcNit: "9007736849",
    processId: 4,
    variables: ["INGRESOID", "FECHAING", "NUMMANIFIESTOCARGA"],
    filters: { NUMMANIFIESTOCARGA: "M321" }
  }), {
    tipo: 3,
    procesoId: 4,
    variables: "INGRESOID,FECHAING,NUMMANIFIESTOCARGA",
    documento: {
      NUMNITEMPRESATRANSPORTE: "9007736849",
      NUMMANIFIESTOCARGA: "'M321'"
    }
  });

  assert.deepEqual(buildAcceptanceQuery({
    companyRndcNit: "9007736849",
    manifestRadicado: "48043700",
    from: "2026/07/01",
    to: "2026/07/09"
  }), {
    tipo: 3,
    procesoId: 73,
    variables: "INGRESOID,FECHAING,INGRESOIDMANIFIESTO,TIPO,CODIDCONDUCTOR,NUMIDCONDUCTOR,OBSERVACION",
    documento: {
      NUMNITEMPRESATRANSPORTE: "9007736849",
      INGRESOIDMANIFIESTO: "48043700"
    },
    documentorango: {
      iniFECHAING: "'2026/07/01'",
      finFECHAING: "'2026/07/09'"
    }
  });
});

test("builds the official pending electronic acceptance query", () => {
  const buildPendingAcceptanceQuery = requireApi<(input: Record<string, unknown>) => RndcMessageRequest>("buildPendingAcceptanceQuery");

  assert.deepEqual(buildPendingAcceptanceQuery({
    companyRndcNit: "9007736849",
    from: "2026/07/01",
    to: "2026/07/09"
  }), {
    tipo: 3,
    procesoId: 4,
    variables: "INGRESOID,FECHAING,NUMMANIFIESTOCARGA,NUMIDTITULARMANIFIESTO,NUMPLACA,NUMIDCONDUCTOR",
    documento: {
      NUMNITEMPRESATRANSPORTE: "9007736849",
      ACEPTACIONELECTRONICA: "NULL"
    },
    documentorango: {
      iniFECHAING: "'2026/07/01'",
      finFECHAING: "'2026/07/09'"
    }
  });
});

test("normalizes RNDC type 3 records and electronic acceptances", () => {
  const normalizeRndcQueryRecords = requireApi<(parsed: unknown) => Record<string, string>[]>("normalizeRndcQueryRecords");
  const normalizeManifestAcceptances = requireApi<(parsed: unknown) => unknown[]>("normalizeManifestAcceptances");
  const parsed = parseXml([
    "<root>",
    "<documento>",
    "<ingresoid>15</ingresoid>",
    "<fechaing>28/03/2020 9:44:52 a. m.</fechaing>",
    "<ingresoidmanifiesto>48043700</ingresoidmanifiesto>",
    "<tipo>C</tipo>",
    "<codidconductor>C</codidconductor>",
    "<numidconductor>80387330</numidconductor>",
    "<observacion>Celular 3103040052</observacion>",
    "</documento>",
    "</root>"
  ].join(""));

  assert.deepEqual(normalizeRndcQueryRecords(parsed), [{
    INGRESOID: "15",
    FECHAING: "28/03/2020 9:44:52 a. m.",
    INGRESOIDMANIFIESTO: "48043700",
    TIPO: "C",
    CODIDCONDUCTOR: "C",
    NUMIDCONDUCTOR: "80387330",
    OBSERVACION: "Celular 3103040052"
  }]);
  assert.deepEqual(normalizeManifestAcceptances(parsed), [{
    id: "15",
    manifestRadicado: "48043700",
    type: "C",
    acceptedAt: "28/03/2020 9:44:52 a. m.",
    actorIdType: "C",
    actorId: "80387330",
    observation: "Celular 3103040052"
  }]);
});

test("classifies official FOPAT, correction, acceptance and unknown errors", () => {
  const classifyRndcError = requireApi<(value: string) => unknown>("classifyRndcError");

  assert.deepEqual(classifyRndcError("Error CMA271: La Empresa de Transporte debe diligenciar RETENCIONFOPAT"), {
    code: "CMA271",
    known: true,
    processId: 6,
    category: "fopat",
    variable: "RETENCIONFOPAT",
    action: "correct-request"
  });
  assert.deepEqual(classifyRndcError("Error REC022: Falta el Consecutivo de Remesa"), {
    code: "REC022",
    known: true,
    processId: 38,
    category: "correction",
    variable: "CONSECUTIVOREMESA",
    action: "correct-request"
  });
  assert.deepEqual(classifyRndcError("Error ACE005: El manifiesto ya tiene una aceptacion"), {
    code: "ACE005",
    known: true,
    processId: 73,
    category: "acceptance",
    variable: "INGRESOIDMANIFIESTO",
    action: "reconcile"
  });
  assert.deepEqual(classifyRndcError("Error XYZ999: inesperado"), {
    code: "XYZ999",
    known: false,
    category: "unknown",
    action: "manual-review"
  });
});

test("associates multiple remesas in manifest XML while keeping one-remesa scenarios compatible", () => {
  const scenario = buildMtmReferenceScenario(loadConfig());
  Object.assign(scenario, {
    manifestRemesas: [
      { number: "97102" },
      { number: "97103" }
    ]
  });
  const variables = buildManifestMessages(scenario)[1].request.variables as RndcXmlRecord;
  const association = variables.REMESASMAN as { kind: "rawXml"; xml: string };

  assert.match(association.xml, /<CONSECUTIVOREMESA>97102<\/CONSECUTIVOREMESA>/);
  assert.match(association.xml, /<CONSECUTIVOREMESA>97103<\/CONSECUTIVOREMESA>/);
  assert.equal((association.xml.match(/<REMESA>/g) ?? []).length, 2);

  delete (scenario as unknown as { manifestRemesas?: unknown }).manifestRemesas;
  const legacy = (buildManifestMessages(scenario)[1].request.variables as RndcXmlRecord).REMESASMAN as { xml: string };
  assert.equal((legacy.xml.match(/<REMESA>/g) ?? []).length, 1);
  assert.match(legacy.xml, /<CONSECUTIVOREMESA>42196<\/CONSECUTIVOREMESA>/);
});

test("escapes remesa identifiers inside the raw manifest association XML", () => {
  const scenario = buildMtmReferenceScenario(loadConfig());
  Object.assign(scenario, {
    manifestRemesas: [{ number: "REM&A<1>" }]
  });
  const variables = buildManifestMessages(scenario)[1].request.variables as RndcXmlRecord;
  const association = variables.REMESASMAN as { xml: string };

  assert.match(association.xml, /<CONSECUTIVOREMESA>REM&amp;A&lt;1&gt;<\/CONSECUTIVOREMESA>/);
  assert.doesNotMatch(association.xml, /REM&A<1>/);
});

test("prepares multiple remesa rows and acceptance text for the manifest PDF", () => {
  const resolveManifestRemesas = requireApi<(scenario: unknown) => unknown[]>("resolveManifestRemesas");
  const formatManifestAcceptances = requireApi<(acceptances: unknown[]) => string>("formatManifestAcceptances");
  const documentFooterText = requireApi<(mode: "dry-run" | "live") => string>("documentFooterText");
  const scenario = buildMtmReferenceScenario(loadConfig());
  Object.assign(scenario, {
    manifestRemesas: [
      { number: "97102", quantityKg: 20_000, productName: "CARBON TERMICO" },
      { number: "97103", quantityKg: 14_000, productName: "CARBON METALURGICO" }
    ]
  });

  assert.deepEqual(resolveManifestRemesas(scenario), [
    {
      number: "97102",
      quantityKg: 20_000,
      nature: "Carga Normal",
      productName: "CARBON TERMICO",
      packageName: "Granel Solido",
      senderName: "C.I BULKTRADIN - LANDAZURI",
      recipientName: "C.I BULKTRADIN-MINGUEO"
    },
    {
      number: "97103",
      quantityKg: 14_000,
      nature: "Carga Normal",
      productName: "CARBON METALURGICO",
      packageName: "Granel Solido",
      senderName: "C.I BULKTRADIN - LANDAZURI",
      recipientName: "C.I BULKTRADIN-MINGUEO"
    }
  ]);
  assert.equal(formatManifestAcceptances([{
    id: "15",
    manifestRadicado: "48043700",
    type: "C",
    acceptedAt: "09/07/2026 14:30",
    actorIdType: "C",
    actorId: "80387330",
    observation: "Celular 3103040052"
  }]), "Conductor C 80387330 - 09/07/2026 14:30 - Celular 3103040052");
  assert.match(documentFooterText("dry-run"), /MODO PRUEBA/);
  assert.doesNotMatch(documentFooterText("live"), /demo|prueba/i);
});

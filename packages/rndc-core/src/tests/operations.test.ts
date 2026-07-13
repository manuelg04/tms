import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildMtmReferenceScenario } from "../data/demoScenario.js";
import { loadConfig } from "../rndc/config.js";
import { buildAnnulmentMessages, buildComplianceMessages, buildDriverVehicleMessages, buildFulfillManifestMessages, buildFulfillRemesaMessages, buildLoadingOrderMessages, buildManifestIssueMessages, buildManifestMessages, buildRemesaMessages, prepareOperationRequests } from "../rndc/messages.js";
import type { RndcXmlRecord } from "../rndc/types.js";

test("builds loading order as RNDC cargo information", () => {
  const scenario = buildMtmReferenceScenario(loadConfig());
  const messages = buildLoadingOrderMessages(scenario);
  const variables = messages[0].request.variables as RndcXmlRecord;

  assert.deepEqual(messages.map((message) => [message.name, message.request.procesoId]), [
    ["issue-loading-order", 1]
  ]);
  assert.equal(variables.NUMNITEMPRESATRANSPORTE, "9007736849");
  assert.equal(variables.CONSECUTIVOINFORMACIONCARGA, "000044579");
  assert.equal(variables.CODOPERACIONTRANSPORTE, "G");
  assert.equal(variables.MERCANCIAINFORMACIONCARGA, "002803");
  assert.equal(variables.CANTIDADINFORMACIONCARGA, 34000);
  assert.equal(variables.CODTIPOIDREMITENTE, "N");
  assert.equal(variables.NUMIDREMITENTE, "9002266843");
  assert.equal(variables.CODSEDEDESTINATARIO, "1");
  assert.equal(variables.FECHACITAPACTADACARGUE, "22/06/2026");
  assert.equal(variables.HORACITAPACTADADESCARGUEREMESA, "12:06");
});

test("builds a remesa without inventing loading-order ancestry", () => {
  const scenario = buildMtmReferenceScenario(loadConfig());
  scenario.workflowVariant = "remesa_without_order";
  scenario.cargoNumber = "";
  const variables = buildRemesaMessages(scenario)[0].request.variables as RndcXmlRecord;

  assert.equal(variables.CONSECUTIVOINFORMACIONCARGA, undefined);
  assert.equal(variables.CONSECUTIVOREMESA, scenario.remesaNumber);
});

test("builds a Viaje Vacío manifest without remesas trip or tracking fields", () => {
  const scenario = buildMtmReferenceScenario(loadConfig());
  scenario.workflowVariant = "empty_manifest";
  scenario.manifestType = "W";
  scenario.tripNumber = "";
  scenario.cargoNumber = "";
  scenario.remesaNumber = "";
  scenario.manifestRemesas = [];
  const variables = buildManifestIssueMessages(scenario)[0].request.variables as RndcXmlRecord;

  assert.equal(variables.CODOPERACIONTRANSPORTE, "W");
  assert.equal(variables.CONSECUTIVOINFORMACIONVIAJE, undefined);
  assert.equal(variables.REMESASMAN, undefined);
  assert.equal(variables.NITMONITOREOFLOTA, undefined);
});

test("links a transshipment manifest to the prior RNDC manifest", () => {
  const scenario = buildMtmReferenceScenario(loadConfig());
  scenario.workflowVariant = "transshipment";
  scenario.sourceManifestNumber = "0041463";
  const variables = buildManifestIssueMessages(scenario)[0].request.variables as RndcXmlRecord;

  assert.equal(variables.MANNROMANIFIESTOTRANSBORDO, "0041463");
});

test("builds driver vehicle registration with separate owner holder and driver roles", () => {
  const scenario = buildMtmReferenceScenario(loadConfig());
  scenario.vehicleHolder = {
    idType: "C",
    id: "11111111",
    firstName: "TENEDOR",
    firstLastName: "OPERADOR",
    secondLastName: "",
    fullName: "TENEDOR OPERADOR",
    phone: "3001111111",
    address: "CL 1 2 3",
    cityName: "BOGOTA",
    cityCode: "11001000"
  };

  const messages = buildDriverVehicleMessages(scenario);
  const vehicle = messages.at(-1)?.request.variables as RndcXmlRecord;

  assert.deepEqual(messages.map((message) => [message.name, message.request.procesoId]), [
    ["driver", 11],
    ["owner", 11],
    ["holder", 11],
    ["vehicle", 12]
  ]);
  assert.equal(vehicle.CODTIPOIDPROPIETARIO, "C");
  assert.equal(vehicle.NUMIDPROPIETARIO, "74322799");
  assert.equal(vehicle.CODTIPOIDTENEDOR, "C");
  assert.equal(vehicle.NUMIDTENEDOR, "11111111");
  assert.equal(vehicle.NUMPLACA, "JVK276");
});

test("does not duplicate third party registration when one person has multiple vehicle roles", () => {
  const scenario = buildMtmReferenceScenario(loadConfig());
  scenario.vehicleOwner = { ...scenario.driver };
  scenario.vehicleHolder = { ...scenario.driver };

  const messages = buildDriverVehicleMessages(scenario);

  assert.deepEqual(messages.map((message) => [message.name, message.request.procesoId]), [
    ["driver", 11],
    ["vehicle", 12]
  ]);
});

test("builds remesa and manifest form operations from RNDC process messages", () => {
  const scenario = buildMtmReferenceScenario(loadConfig());
  const remesa = buildRemesaMessages(scenario);
  const manifest = buildManifestMessages(scenario);
  const remesaVariables = remesa[0].request.variables as RndcXmlRecord;
  const tripVariables = manifest[0].request.variables as RndcXmlRecord;
  const manifestVariables = manifest[1].request.variables as RndcXmlRecord;

  assert.deepEqual(remesa.map((message) => [message.name, message.request.procesoId]), [
    ["issue-remesa", 3]
  ]);
  assert.deepEqual(manifest.map((message) => [message.name, message.request.procesoId]), [
    ["register-trip", 2],
    ["issue-manifest", 4]
  ]);
  assert.equal(remesaVariables.CONSECUTIVOREMESA, "42196");
  assert.equal(remesaVariables.CONSECUTIVOINFORMACIONCARGA, "000044579");
  assert.equal(tripVariables.CONSECUTIVOINFORMACIONVIAJE, "IV42196");
  assert.equal(tripVariables.NUMIDCONDUCTOR, "80756632");
  assert.equal(manifestVariables.NUMMANIFIESTOCARGA, "0041464");
  assert.equal(manifestVariables.NUMIDTITULARMANIFIESTO, "74322799");
  assert.equal(manifestVariables.RETENCIONICAMANIFIESTOCARGA, 3);
});

test("uses the scenario ICA per-mille rate in the manifest message", () => {
  const scenario = buildMtmReferenceScenario(loadConfig());
  scenario.money.icaRetentionPerMille = 5;

  const manifest = buildManifestMessages(scenario);
  const manifestVariables = manifest[1].request.variables as RndcXmlRecord;

  assert.equal(manifestVariables.RETENCIONICAMANIFIESTOCARGA, 5);
});

test("escapes the cargo number embedded in the trip remesa XML", () => {
  const scenario = buildMtmReferenceScenario(loadConfig());
  scenario.cargoNumber = "CARGO<&9001";

  const manifest = buildManifestMessages(scenario);
  const tripVariables = manifest[0].request.variables as RndcXmlRecord;
  const preremesa = tripVariables.PREREMESAS as { kind: string; xml: string };

  assert.match(preremesa.xml, /CARGO&lt;&amp;9001/);
  assert.doesNotMatch(preremesa.xml, /CARGO<&9001/);
});

test("builds compliance messages for remesa before manifest", () => {
  const scenario = buildMtmReferenceScenario(loadConfig());
  const messages = buildComplianceMessages(scenario);
  const remesaVariables = messages[0].request.variables as RndcXmlRecord;
  const manifestVariables = messages[1].request.variables as RndcXmlRecord;

  assert.deepEqual(messages.map((message) => [message.name, message.request.procesoId]), [
    ["fulfill-remesa", 5],
    ["fulfill-manifest", 6]
  ]);
  assert.equal(remesaVariables.NUMNITEMPRESATRANSPORTE, "9007736849");
  assert.equal(remesaVariables.CONSECUTIVOREMESA, "42196");
  assert.equal(remesaVariables.TIPOCUMPLIDOREMESA, "C");
  assert.equal(remesaVariables.CANTIDADCARGADA, 34000);
  assert.equal(remesaVariables.CANTIDADENTREGADA, 34000);
  assert.equal(remesaVariables.FECHALLEGADADESCARGUE, "25/06/2026");
  assert.equal(manifestVariables.NUMMANIFIESTOCARGA, "0041464");
  assert.equal(manifestVariables.TIPOCUMPLIDOMANIFIESTO, "C");
  assert.equal(manifestVariables.FECHAENTREGADOCUMENTOS, "30/06/2026");
});

test("builds fulfill remesa with manifest control and normal delivery fields", () => {
  const scenario = buildMtmReferenceScenario(loadConfig());
  const messages = buildFulfillRemesaMessages(scenario);
  const variables = messages[0].request.variables as RndcXmlRecord;

  assert.deepEqual(messages.map((message) => [message.name, message.request.procesoId]), [
    ["fulfill-remesa", 5]
  ]);
  assert.equal(variables.CONSECUTIVOREMESA, "42196");
  assert.equal(variables.NUMMANIFIESTOCARGA, "0041464");
  assert.equal(variables.TIPOCUMPLIDOREMESA, "C");
  assert.equal(variables.CANTIDADENTREGADA, 34000);
  assert.equal(variables.FECHALLEGADADESCARGUE, "25/06/2026");
  assert.equal(variables.HORASALIDADESCARGUECUMPLIDO, "14:06");
});

test("omits delivered quantity and unloading times when fulfill remesa is suspended", () => {
  const scenario = buildMtmReferenceScenario(loadConfig());
  scenario.compliance.remesaType = "S";
  scenario.compliance.remesaSuspensionReason = "V";
  const variables = buildFulfillRemesaMessages(scenario)[0].request.variables as RndcXmlRecord;

  assert.equal(variables.TIPOCUMPLIDOREMESA, "S");
  assert.equal(variables.MOTIVOSUSPENSIONREMESA, "V");
  assert.equal(variables.CANTIDADENTREGADA, undefined);
  assert.equal(variables.FECHALLEGADADESCARGUE, undefined);
  assert.equal(variables.HORALLEGADADESCARGUECUMPLIDO, undefined);
  assert.equal(variables.FECHAENTRADADESCARGUE, undefined);
  assert.equal(variables.HORAENTRADADESCARGUECUMPLIDO, undefined);
  assert.equal(variables.FECHASALIDADESCARGUE, undefined);
  assert.equal(variables.HORASALIDADESCARGUECUMPLIDO, undefined);
});

test("builds fulfill manifest suspension and value reason fields conditionally", () => {
  const scenario = buildMtmReferenceScenario(loadConfig());
  scenario.compliance.manifestType = "S";
  scenario.compliance.manifestSuspensionReason = "A";
  scenario.compliance.suspensionConsequence = "T";
  scenario.compliance.additionalFreightValue = 250000;
  scenario.compliance.additionalValueReason = "R";
  scenario.compliance.freightDiscountValue = 120000;
  scenario.compliance.discountReason = "F";
  const messages = buildFulfillManifestMessages(scenario);
  const variables = messages[0].request.variables as RndcXmlRecord;

  assert.deepEqual(messages.map((message) => [message.name, message.request.procesoId]), [
    ["fulfill-manifest", 6]
  ]);
  assert.equal(variables.TIPOCUMPLIDOMANIFIESTO, "S");
  assert.equal(variables.MOTIVOSUSPENSIONMANIFIESTO, "A");
  assert.equal(variables.CONSECUENCIASUSPENSION, "T");
  assert.equal(variables.VALORADICIONALFLETE, 250000);
  assert.equal(variables.MOTIVOVALORADICIONAL, "R");
  assert.equal(variables.VALORDESCUENTOFLETE, 120000);
  assert.equal(variables.MOTIVOVALORDESCUENTOMANIFIESTO, "F");
});

test("builds an annulment chain that reverses fulfilled documents first", () => {
  const scenario = buildMtmReferenceScenario(loadConfig());
  const messages = buildAnnulmentMessages(scenario);

  assert.deepEqual(messages.map((message) => [message.name, message.request.procesoId]), [
    ["annul-manifest-compliance", 29],
    ["annul-remesa-compliance", 28],
    ["annul-manifest", 32],
    ["annul-remesa", 9],
    ["annul-trip-information", 8],
    ["annul-cargo-information", 7]
  ]);

  const tripAnnulmentVariables = messages[4].request.variables as RndcXmlRecord;
  const cargoAnnulmentVariables = messages[5].request.variables as RndcXmlRecord;
  assert.equal(tripAnnulmentVariables.NUMNITEMPRESATRANSPORTE, "9007736849");
  assert.equal(tripAnnulmentVariables.CONSECUTIVOINFORMACIONVIAJE, "IV42196");
  assert.equal(tripAnnulmentVariables.MOTIVOANULACIONINFOVIAJE, "S");
  assert.equal(cargoAnnulmentVariables.NUMNITEMPRESATRANSPORTE, "9007736849");
  assert.equal(cargoAnnulmentVariables.CONSECUTIVOINFORMACIONCARGA, "000044579");
  assert.equal(cargoAnnulmentVariables.MOTIVOANULACIONINFOCARGA, "S");
});

test("prepares masked XML files for the requested RNDC operations", async () => {
  const base = await mkdtemp(join(tmpdir(), "tms-demo-rndc-ops-"));
  const config = loadConfig({
    outputDir: join(base, "runs"),
    username: "TEST_USER",
    password: "TEST_PASSWORD",
    companyNit: "900773684",
    companyDv: "9",
    companyRndcNit: "9007736849"
  });

  const result = await prepareOperationRequests(config, buildMtmReferenceScenario(config));

  assert.equal(result.ok, true);
  assert.deepEqual(result.requests.map((request) => request.name), [
    "issue-loading-order",
    "issue-remesa",
    "issue-manifest",
    "fulfill-remesa",
    "fulfill-manifest",
    "annul-manifest-compliance",
    "annul-remesa-compliance",
    "annul-manifest",
    "annul-remesa",
    "annul-trip-information",
    "annul-cargo-information"
  ]);
  assert.ok(existsSync(result.resultPath));

  const loadingOrder = result.requests.find((request) => request.name === "issue-loading-order");
  assert.ok(loadingOrder?.path);
  const xml = await readFile(loadingOrder.path, "utf8");
  assert.match(xml, /<procesoid>1<\/procesoid>/);
  assert.match(xml, /<CONSECUTIVOINFORMACIONCARGA>000044579<\/CONSECUTIVOINFORMACIONCARGA>/);
  assert.match(xml, /<password>\*\*\*<\/password>/);
  assert.doesNotMatch(xml, /TEST_PASSWORD/);

  const tripAnnulment = result.requests.find((request) => request.name === "annul-trip-information");
  const cargoAnnulment = result.requests.find((request) => request.name === "annul-cargo-information");
  assert.ok(tripAnnulment?.path);
  assert.ok(cargoAnnulment?.path);
  assert.match(await readFile(tripAnnulment.path, "utf8"), /<MOTIVOANULACIONINFOVIAJE>S<\/MOTIVOANULACIONINFOVIAJE>/);
  assert.match(await readFile(cargoAnnulment.path, "utf8"), /<MOTIVOANULACIONINFOCARGA>S<\/MOTIVOANULACIONINFOCARGA>/);
});

test("splits trip registration and manifest issuance into separate durable messages", async () => {
  const { buildManifestIssueMessages, buildTripMessages } = await import("../rndc/messages.js");
  const scenario = buildMtmReferenceScenario(loadConfig());
  const trip = buildTripMessages(scenario);
  const manifest = buildManifestIssueMessages(scenario);

  assert.deepEqual(trip.map((message) => [message.name, message.request.procesoId]), [["register-trip", 2]]);
  assert.deepEqual(manifest.map((message) => [message.name, message.request.procesoId]), [["issue-manifest", 4]]);

  const tripVariables = trip[0].request.variables as RndcXmlRecord;
  assert.equal(tripVariables.CONSECUTIVOINFORMACIONVIAJE, scenario.tripNumber);
  assert.equal(tripVariables.NUMPLACA, scenario.vehicle.plate);

  const manifestVariables = manifest[0].request.variables as RndcXmlRecord;
  assert.equal(manifestVariables.NUMMANIFIESTOCARGA, scenario.manifestNumber);
});

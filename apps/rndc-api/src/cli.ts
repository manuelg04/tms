import { applyScenarioOverlay, buildAnnulmentMessages, buildComplianceMessages, buildDriverMasterQuery, buildLoadingOrderMessages, buildMtmProductionScenario, buildThirdPartyMasterQuery, buildVehicleMasterQuery, endpointFor, endpointTargetFor, endpointUrlFor, generateLoadingOrderDocument, loadConfig, loadScenarioOverlay, normalizeDriverMaster, normalizeThirdPartyMaster, normalizeVehicleMaster, prepareOperationRequests, RndcClient, RndcFlowError, runDemoFlow, runMtmProductionFlow, saveLocalMasterSnapshot, saveLocalOwnerVehicleSnapshot } from "@tms/rndc-core";
import type { DemoScenario, RndcConfig, RndcDriverMaster, RndcMessageResponse, RndcThirdPartyMaster, RndcVehicleMaster } from "@tms/rndc-core";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const command = process.argv[2] ?? "flow";

type PartyVehicleLookupInput = {
  idType: string;
  id: string;
  plate: string;
};

if (command === "ping") {
  await runSafely(ping);
} else if (command === "flow") {
  await runSafely(flow);
} else if (command === "mtm-prod-flow") {
  await runSafely(mtmProdFlow);
} else if (command === "prepare-ops") {
  await runSafely(prepareOps);
} else if (command === "loading-order") {
  await runSafely(loadingOrder);
} else if (command === "fulfill") {
  await runSafely(fulfill);
} else if (command === "resend") {
  await runSafely(resend);
} else if (command === "annul") {
  await runSafely(annul);
} else if (command === "lookup-pair") {
  await runSafely(lookupPair);
} else if (command === "lookup-pairs") {
  await runSafely(lookupPairs);
} else if (command === "lookup-owner-vehicle") {
  await runSafely(lookupOwnerVehicle);
} else if (command === "lookup-owner-vehicles") {
  await runSafely(lookupOwnerVehicles);
} else {
  console.error(JSON.stringify({ ok: false, error: `Unknown command: ${command}` }, null, 2));
  process.exit(1);
}

async function ping(): Promise<void> {
  const config = loadConfig();
  const request = process.argv[3] ? { tipo: 1, procesoId: Number(process.argv[3]) } : undefined;
  const endpointUrl = request ? endpointUrlFor(config, request) : config.endpointUrl;
  const wsdlUrl = endpointUrl.replace("/soap/IBPMServices", "/ws");
  const response = await fetch(wsdlUrl, { signal: AbortSignal.timeout(config.timeoutMs) });
  const text = await response.text();
  const ok = response.ok && text.includes("AtenderMensajeRNDC");
  console.log(JSON.stringify({
    ok,
    mode: config.mode,
    transport: config.transport,
    environment: config.environment,
    endpointTarget: request ? endpointTargetFor(config, request) : undefined,
    processId: request?.procesoId,
    endpointUrl,
    wsdlUrl,
    configuredTestWsdl: endpointFor("test").replace("/soap/IBPMServices", "/ws"),
    status: response.status,
    hasAtenderMensajeRNDC: text.includes("AtenderMensajeRNDC")
  }, null, 2));
  process.exit(ok ? 0 : 1);
}

async function flow(): Promise<void> {
  try {
    const result = await runDemoFlow(loadConfig());
    console.log(JSON.stringify(summarizeFlow(result), null, 2));
  } catch (error) {
    if (error instanceof RndcFlowError) {
      console.error(JSON.stringify({
        ok: false,
        failedStep: error.failedStep,
        evidencePath: error.result.evidencePath,
        steps: error.result.steps.map(summarizeStep)
      }, null, 2));
      process.exit(1);
    }

    throw error;
  }
}

async function mtmProdFlow(): Promise<void> {
  try {
    const config = loadConfig();
    const result = await runMtmProductionFlow(config, await buildScenario(config));
    console.log(JSON.stringify(summarizeFlow(result), null, 2));
  } catch (error) {
    if (error instanceof RndcFlowError) {
      console.error(JSON.stringify({
        ok: false,
        failedStep: error.failedStep,
        evidencePath: error.result.evidencePath,
        steps: error.result.steps.map(summarizeStep)
      }, null, 2));
      process.exit(1);
    }

    throw error;
  }
}

async function prepareOps(): Promise<void> {
  const config = loadConfig();
  const result = await prepareOperationRequests(config, await buildScenario(config));
  console.log(JSON.stringify({
    ok: true,
    runDirectory: result.runDirectory,
    resultPath: result.resultPath,
    requests: result.requests
  }, null, 2));
}

async function loadingOrder(): Promise<void> {
  const config = loadConfig();
  const scenario = await buildScenario(config);
  const runDirectory = join(config.outputDir, `${new Date().toISOString().replaceAll(":", "-")}-${scenario.seed}-loading-order`);
  const result = await sendMessageSet(config, buildLoadingOrderMessages(scenario), runDirectory, "loading-order");
  const first = result.responses[0];
  const documents = result.ok && first ? [await generateLoadingOrderDocument(scenario, first.radicado ?? "PENDIENTE", config.pdfDir)] : [];
  console.log(JSON.stringify({ ...result, documents }, null, 2));
  process.exit(result.ok ? 0 : 1);
}

async function fulfill(): Promise<void> {
  const config = loadConfig();
  const evidencePath = process.argv[3] ? resolve(process.argv[3]) : undefined;
  const scenario = await buildScenario(config);
  const runDirectory = evidencePath ? await applyEvidenceToScenario(evidencePath, scenario) : join(config.outputDir, `${new Date().toISOString().replaceAll(":", "-")}-${scenario.seed}-fulfillment`);
  const result = await sendMessageSet(config, buildComplianceMessages(scenario), runDirectory, "fulfillment");
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

async function resend(): Promise<void> {
  const config = loadConfig();
  const requestPath = resolve(process.argv[3] ?? await latestManifestRequest(config.outputDir));
  const requestXml = await readFile(requestPath, "utf8");
  const procesoId = readProcesoId(requestXml);
  const client = new RndcClient(config);
  const response = await client.sendRawXml(requestXml, procesoId);
  const responsePath = responseFilePath(requestPath);
  await mkdir(dirname(responsePath), { recursive: true });
  await writeFile(responsePath, `${response.rndcResponseXml}\n`, "utf8");

  console.log(JSON.stringify({
    ok: response.ok,
    requestPath,
    responsePath,
    procesoId,
    status: response.status,
    radicado: response.radicado,
    seguridadQr: response.seguridadQr,
    observacionesQr: response.observacionesQr,
    errorText: response.errorText
  }, null, 2));

  process.exit(response.ok ? 0 : 1);
}

async function annul(): Promise<void> {
  const config = loadConfig();
  const evidencePath = resolve(process.argv[3] ?? await latestEvidencePath(config.outputDir));
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const scenario = await buildScenario(config);
  const cargoNumber = evidence.cargoNumber ?? process.env.RNDC_CARGO_NUMBER ?? (config.mode === "dry-run" ? scenario.cargoNumber : undefined);
  const tripNumber = evidence.tripNumber ?? process.env.RNDC_TRIP_NUMBER ?? (config.mode === "dry-run" ? scenario.tripNumber : undefined);

  if (!cargoNumber || !tripNumber) {
    throw new Error("Annulment evidence must include cargoNumber and tripNumber, or set RNDC_CARGO_NUMBER and RNDC_TRIP_NUMBER");
  }

  const runDirectory = evidence.runDirectory ?? dirname(evidencePath);
  const messages = buildAnnulmentMessages({
    company: { rndcNit: evidence.companyRndcNit ?? scenario.company.rndcNit },
    cargoNumber,
    tripNumber,
    remesaNumber: evidence.remesaNumber,
    manifestNumber: evidence.manifestNumber
  });
  const result = await sendMessageSet(config, messages, runDirectory, "annulment", evidencePath);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

async function lookupPair(): Promise<void> {
  const config = loadConfig();
  const input = readLookupArgs(process.argv.slice(3), "Usage: npm run rndc:lookup-pair -- <driver-id-type> <driver-id> <vehicle-plate>");
  const result = await lookupAndSavePair(config, input);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

async function buildScenario(config: RndcConfig): Promise<DemoScenario> {
  const scenario = buildMtmProductionScenario(config);
  const overlay = await loadScenarioOverlay();
  return overlay === undefined ? scenario : applyScenarioOverlay(scenario, overlay);
}

async function lookupPairs(): Promise<void> {
  const config = loadConfig();
  const filePath = process.argv[3];

  if (!filePath) {
    throw new Error("Usage: npm run rndc:lookup-pairs -- <pairs-json-file>");
  }

  const values = JSON.parse(await readFile(resolveInputPath(filePath), "utf8"));

  if (!Array.isArray(values)) {
    throw new Error("The pairs file must contain a JSON array");
  }

  const results = [];

  for (const value of values) {
    results.push(await lookupAndSavePair(config, readLookupRecord(value)));
  }

  const ok = results.every((result) => result.ok);

  console.log(JSON.stringify({
    ok,
    mode: config.mode,
    transport: config.transport,
    environment: config.environment,
    storeDir: config.localDataDir,
    count: results.length,
    readyCount: results.filter((result) => result.readyForDocuments).length,
    results
  }, null, 2));
  process.exit(ok ? 0 : 1);
}

async function lookupOwnerVehicle(): Promise<void> {
  const config = loadConfig();
  const input = readLookupArgs(process.argv.slice(3), "Usage: npm run rndc:lookup-owner-vehicle -- <owner-id-type> <owner-id> <vehicle-plate>");
  const result = await lookupAndSaveOwnerVehicle(config, input);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

async function lookupOwnerVehicles(): Promise<void> {
  const config = loadConfig();
  const filePath = process.argv[3];

  if (!filePath) {
    throw new Error("Usage: npm run rndc:lookup-owner-vehicles -- <owner-vehicles-json-file>");
  }

  const values = JSON.parse(await readFile(resolveInputPath(filePath), "utf8"));

  if (!Array.isArray(values)) {
    throw new Error("The owner vehicles file must contain a JSON array");
  }

  const results = [];

  for (const value of values) {
    results.push(await lookupAndSaveOwnerVehicle(config, readLookupRecord(value)));
  }

  const ok = results.every((result) => result.ok);

  console.log(JSON.stringify({
    ok,
    mode: config.mode,
    transport: config.transport,
    environment: config.environment,
    storeDir: config.localDataDir,
    count: results.length,
    readyCount: results.filter((result) => result.readyForDocuments).length,
    ownerMatchCount: results.filter((result) => result.ownerMatchesVehicle).length,
    results
  }, null, 2));
  process.exit(ok ? 0 : 1);
}

async function lookupAndSavePair(config: RndcConfig, input: PartyVehicleLookupInput): Promise<{
  ok: boolean;
  readyForDocuments: boolean;
  storeDir: string;
  pairPath: string;
  driverPath: string;
  vehiclePath: string;
  reviewReasons: string[];
  driver?: RndcDriverMaster;
  vehicle?: RndcVehicleMaster;
  responses: {
    driver: ReturnType<typeof summarizeMasterResponse>;
    vehicle: ReturnType<typeof summarizeMasterResponse>;
  };
}> {
  const client = new RndcClient(config);
  const driverResponse = await client.sendMessage(buildDriverMasterQuery({
    companyRndcNit: config.companyRndcNit,
    idType: input.idType,
    id: input.id
  }));
  const vehicleResponse = await client.sendMessage(buildVehicleMasterQuery({
    companyRndcNit: config.companyRndcNit,
    plate: input.plate
  }));
  const now = new Date();
  const driver = normalizeDriverMaster(driverResponse.parsed, now);
  const vehicle = normalizeVehicleMaster(vehicleResponse.parsed, now);
  const saved = await saveLocalMasterSnapshot({
    storeDir: config.localDataDir,
    fetchedAt: now.toISOString(),
    driver,
    vehicle,
    driverRequestXml: driverResponse.requestXml,
    vehicleRequestXml: vehicleResponse.requestXml,
    driverResponseXml: driverResponse.rndcResponseXml,
    vehicleResponseXml: vehicleResponse.rndcResponseXml
  });

  return {
    ok: driverResponse.ok && vehicleResponse.ok,
    readyForDocuments: saved.readyForDocuments,
    storeDir: config.localDataDir,
    pairPath: saved.pairPath,
    driverPath: saved.driverPath,
    vehiclePath: saved.vehiclePath,
    reviewReasons: saved.reviewReasons,
    driver,
    vehicle,
    responses: {
      driver: summarizeMasterResponse(driverResponse),
      vehicle: summarizeMasterResponse(vehicleResponse)
    }
  };
}

async function lookupAndSaveOwnerVehicle(config: RndcConfig, input: PartyVehicleLookupInput): Promise<{
  ok: boolean;
  readyForDocuments: boolean;
  ownerMatchesVehicle: boolean;
  storeDir: string;
  ownerVehiclePath: string;
  ownerPath: string;
  vehiclePath: string;
  reviewReasons: string[];
  owner?: RndcThirdPartyMaster;
  vehicle?: RndcVehicleMaster;
  responses: {
    owner: ReturnType<typeof summarizeMasterResponse>;
    vehicle: ReturnType<typeof summarizeMasterResponse>;
  };
}> {
  const client = new RndcClient(config);
  const ownerResponse = await client.sendMessage(buildThirdPartyMasterQuery({
    companyRndcNit: config.companyRndcNit,
    idType: input.idType,
    id: input.id
  }));
  const vehicleResponse = await client.sendMessage(buildVehicleMasterQuery({
    companyRndcNit: config.companyRndcNit,
    plate: input.plate
  }));
  const now = new Date();
  const owner = normalizeThirdPartyMaster(ownerResponse.parsed);
  const vehicle = normalizeVehicleMaster(vehicleResponse.parsed, now);
  const saved = await saveLocalOwnerVehicleSnapshot({
    storeDir: config.localDataDir,
    fetchedAt: now.toISOString(),
    owner,
    vehicle,
    ownerRequestXml: ownerResponse.requestXml,
    vehicleRequestXml: vehicleResponse.requestXml,
    ownerResponseXml: ownerResponse.rndcResponseXml,
    vehicleResponseXml: vehicleResponse.rndcResponseXml
  });

  return {
    ok: ownerResponse.ok && vehicleResponse.ok,
    readyForDocuments: saved.readyForDocuments,
    ownerMatchesVehicle: saved.ownerMatchesVehicle,
    storeDir: config.localDataDir,
    ownerVehiclePath: saved.ownerVehiclePath,
    ownerPath: saved.ownerPath,
    vehiclePath: saved.vehiclePath,
    reviewReasons: saved.reviewReasons,
    owner,
    vehicle,
    responses: {
      owner: summarizeMasterResponse(ownerResponse),
      vehicle: summarizeMasterResponse(vehicleResponse)
    }
  };
}

async function runSafely(task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error(JSON.stringify({ ok: false, error: message }, null, 2));
    process.exit(1);
  }
}

function summarizeFlow(result: Awaited<ReturnType<typeof runDemoFlow>>) {
  return {
    ok: result.ok,
    mode: result.mode,
    transport: result.transport,
    environment: result.environment,
    endpointUrl: result.endpointUrl,
    cargoNumber: result.cargoNumber,
    tripNumber: result.tripNumber,
    remesaNumber: result.remesaNumber,
    manifestNumber: result.manifestNumber,
    remesaAuthorization: result.remesaAuthorization,
    manifestAuthorization: result.manifestAuthorization,
    seguridadQr: result.seguridadQr,
    observacionesQr: result.observacionesQr,
    evidencePath: result.evidencePath,
    documents: result.documents,
    steps: result.steps.map(summarizeStep)
  };
}

async function latestManifestRequest(outputDir: string): Promise<string> {
  const entries = await readdir(outputDir, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();

  for (const directory of directories) {
    const requestPath = join(outputDir, directory, "requests", "04-manifest.xml");
    try {
      await readFile(requestPath, "utf8");
      return requestPath;
    } catch {}
  }

  throw new Error(`No saved manifest request found under ${outputDir}`);
}

async function latestEvidencePath(outputDir: string): Promise<string> {
  const entries = await readdir(outputDir, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();

  for (const directory of directories) {
    const evidencePath = join(outputDir, directory, "evidence.json");
    try {
      await readFile(evidencePath, "utf8");
      return evidencePath;
    } catch {}
  }

  throw new Error(`No saved evidence.json found under ${outputDir}`);
}

function readProcesoId(requestXml: string): number {
  const value = requestXml.match(/<procesoid>(\d+)<\/procesoid>/i)?.[1];

  if (!value) {
    throw new Error("The request XML does not include <procesoid>");
  }

  return Number(value);
}

function responseFilePath(requestPath: string): string {
  return join(dirname(dirname(requestPath)), "responses", `${basename(requestPath, ".xml")}.resend.xml`);
}

function summarizeStep(step: Awaited<ReturnType<typeof runDemoFlow>>["steps"][number]) {
  return {
    name: step.name,
    title: step.title,
    accepted: step.accepted,
    status: step.response.status,
    radicado: step.response.radicado,
    errorText: step.response.errorText
  };
}

function summarizeMasterResponse(response: RndcMessageResponse) {
  return {
    ok: response.ok,
    endpointUrl: response.endpointUrl,
    status: response.status,
    errorText: response.errorText
  };
}

function readLookupArgs(values: string[], usage: string): PartyVehicleLookupInput {
  const [idType, id, plate] = values;

  if (!idType || !id || !plate) {
    throw new Error(usage);
  }

  return {
    idType,
    id,
    plate
  };
}

function readLookupRecord(value: unknown): PartyVehicleLookupInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Each lookup entry must be an object with idType, id, and plate");
  }

  const record = value as Record<string, unknown>;
  return {
    idType: readRequiredString(record, "idType"),
    id: readRequiredString(record, "id"),
    plate: readRequiredString(record, "plate")
  };
}

function readRequiredString(record: Record<string, unknown>, name: string): string {
  const value = record[name];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Pair field ${name} must be a non-empty string`);
  }

  return value.trim();
}

function resolveInputPath(value: string): string {
  return resolve(process.env.INIT_CWD ?? process.cwd(), value);
}

async function applyEvidenceToScenario(evidencePath: string, scenario: DemoScenario): Promise<string> {
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  scenario.company.rndcNit = evidence.companyRndcNit ?? scenario.company.rndcNit;
  scenario.cargoNumber = evidence.cargoNumber ?? scenario.cargoNumber;
  scenario.tripNumber = evidence.tripNumber ?? scenario.tripNumber;
  scenario.remesaNumber = evidence.remesaNumber ?? scenario.remesaNumber;
  scenario.manifestNumber = evidence.manifestNumber ?? scenario.manifestNumber;
  return evidence.runDirectory ?? dirname(evidencePath);
}

async function sendMessageSet(
  config: ReturnType<typeof loadConfig>,
  messages: { name: string; title: string; request: Parameters<RndcClient["sendMessage"]>[0]; optional?: boolean }[],
  runDirectory: string,
  folder: string,
  evidencePath?: string
): Promise<{
  ok: boolean;
  evidencePath?: string;
  outputPath: string;
  responses: {
    name: string;
    title: string;
    requestPath: string;
    responsePath: string;
    status: number;
    ok: boolean;
    optional: boolean;
    radicado?: string;
    errorText?: string;
  }[];
}> {
  const client = new RndcClient(config);
  const responses = [];

  await mkdir(join(runDirectory, folder, "requests"), { recursive: true });
  await mkdir(join(runDirectory, folder, "responses"), { recursive: true });

  for (const message of messages) {
    const response = await client.sendMessage(message.request);
    const safeName = `${String(message.request.procesoId).padStart(2, "0")}-${message.name}`;
    const requestPath = join(runDirectory, folder, "requests", `${safeName}.xml`);
    const responsePath = join(runDirectory, folder, "responses", `${safeName}.xml`);
    await writeFile(requestPath, `${response.requestXml}\n`, "utf8");
    await writeFile(responsePath, `${response.rndcResponseXml}\n`, "utf8");
    responses.push({
      name: message.name,
      title: message.title,
      requestPath,
      responsePath,
      status: response.status,
      ok: response.ok,
      optional: message.optional ?? false,
      radicado: response.radicado,
      errorText: response.errorText
    });

    if (!response.ok && !message.optional) {
      break;
    }
  }

  const ok = responses.filter((response) => !response.optional).every((response) => response.ok);
  const outputPath = join(runDirectory, folder, "result.json");
  await writeFile(outputPath, `${JSON.stringify({ ok, evidencePath, outputPath, responses }, null, 2)}\n`, "utf8");
  return { ok, evidencePath, outputPath, responses };
}

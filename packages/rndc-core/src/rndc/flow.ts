import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildDemoScenario, buildMtmProductionScenario } from "../data/demoScenario.js";
import { generateDocuments } from "../documents/pdf.js";
import { buildFailureResponse, RndcClient } from "./client.js";
import { buildFlowMessages, buildMtmProductionFlowMessages } from "./messages.js";
import type { DemoScenario, FlowStepName, RndcConfig, RndcFlowResult, RndcFlowStep, RndcMessageRequest, RndcMessageResponse } from "./types.js";

export async function runDemoFlow(config: RndcConfig): Promise<RndcFlowResult> {
  assertScenarioFlowMode(config);
  return runFlow(config, buildDemoScenario(config), buildFlowMessages);
}

export async function runMtmProductionFlow(config: RndcConfig, scenario?: DemoScenario): Promise<RndcFlowResult> {
  assertScenarioFlowMode(config);
  return runFlow(config, scenario ?? buildMtmProductionScenario(config), buildMtmProductionFlowMessages);
}

function assertScenarioFlowMode(config: RndcConfig): void {
  if (config.mode === "live") {
    throw new Error("Legacy RNDC scenario flows are disabled in live mode; official writes require a durable request context");
  }
}

async function runFlow(
  config: RndcConfig,
  scenario: DemoScenario,
  buildMessages: (scenario: DemoScenario) => { name: string; title: string; request: RndcMessageRequest }[]
): Promise<RndcFlowResult> {
  const client = new RndcClient(config);
  const startedAt = new Date().toISOString();
  const runDirectory = join(config.outputDir, `${startedAt.replaceAll(":", "-")}-${scenario.seed}`);
  await mkdir(join(runDirectory, "requests"), { recursive: true });
  await mkdir(join(runDirectory, "responses"), { recursive: true });

  const steps: RndcFlowStep[] = [];

  for (const message of buildMessages(scenario)) {
    const response = await sendStep(client, config, message.request);
    const accepted = response.ok || isAlreadyRegistered(response.errorText);
    const step: RndcFlowStep = {
      name: message.name as FlowStepName,
      title: message.title,
      tipo: Number(message.request.tipo),
      procesoId: Number(message.request.procesoId),
      response,
      accepted
    };
    await saveStepEvidence(runDirectory, step);
    steps.push(step);

    if (!accepted) {
      const result = assembleResult(config, scenario, startedAt, runDirectory, steps, []);
      result.evidencePath = await saveResult(result, runDirectory);
      throw new RndcFlowError(step.title, result);
    }
  }

  const documents = await generateDocuments(scenario, steps, config.pdfDir, config.mode);
  const result = assembleResult(config, scenario, startedAt, runDirectory, steps, documents);
  result.evidencePath = await saveResult(result, runDirectory);
  return result;
}

async function sendStep(client: RndcClient, config: RndcConfig, request: RndcMessageRequest): Promise<RndcMessageResponse> {
  try {
    return await client.sendMessage(request);
  } catch (error) {
    return buildFailureResponse(config, request, error);
  }
}

async function saveStepEvidence(runDirectory: string, step: RndcFlowStep): Promise<void> {
  const safeName = `${String(step.procesoId).padStart(2, "0")}-${step.name}`;
  const requestPath = join(runDirectory, "requests", `${safeName}.xml`);
  const responsePath = join(runDirectory, "responses", `${safeName}.xml`);
  await writeFile(requestPath, `${step.response.requestXml}\n`, "utf8");
  await writeFile(responsePath, `${step.response.rndcResponseXml}\n`, "utf8");
  step.requestPath = requestPath;
  step.responsePath = responsePath;
}

function assembleResult(
  config: RndcConfig,
  scenario: DemoScenario,
  startedAt: string,
  runDirectory: string,
  steps: RndcFlowStep[],
  documents: RndcFlowResult["documents"]
): RndcFlowResult {
  const remesa = steps.find((step) => step.name === "remesa");
  const manifest = steps.find((step) => step.name === "manifest");

  return {
    ok: steps.every((step) => step.accepted),
    mode: config.mode,
    transport: config.transport,
    environment: config.environment,
    endpointUrl: config.endpointUrl,
    seed: scenario.seed,
    startedAt,
    finishedAt: new Date().toISOString(),
    companyNit: config.companyNit,
    companyDv: config.companyDv,
    companyRndcNit: config.companyRndcNit,
    cargoNumber: scenario.cargoNumber,
    tripNumber: scenario.tripNumber,
    remesaNumber: scenario.remesaNumber,
    manifestNumber: scenario.manifestNumber,
    remesaAuthorization: remesa?.response.radicado,
    manifestAuthorization: manifest?.response.radicado,
    seguridadQr: manifest?.response.seguridadQr,
    observacionesQr: manifest?.response.observacionesQr,
    runDirectory,
    documents,
    steps
  };
}

async function saveResult(result: RndcFlowResult, runDirectory: string): Promise<string> {
  const evidencePath = join(runDirectory, "evidence.json");
  result.evidencePath = evidencePath;
  await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return evidencePath;
}

function isAlreadyRegistered(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return normalized.includes("ya existe") || normalized.includes("ya fue registrado") || normalized.includes("informacion coincide");
}

export class RndcFlowError extends Error {
  constructor(public readonly failedStep: string, public readonly result: RndcFlowResult) {
    super(`RNDC flow failed at step: ${failedStep}`);
  }
}

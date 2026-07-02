import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { DemoScenario } from "@tms/rndc-core";

export type ConvexSyncStatus = {
  synced: boolean;
  reason?: string;
};

export type SyncableStep = {
  name: string;
  title: string;
  procesoId: number;
  accepted: boolean;
  radicado?: string;
  errorText?: string;
  requestPath: string;
  responsePath: string;
};

export type SyncableResult = {
  ok: boolean;
  operation: "loading-order" | "remesa" | "manifest" | "driver-vehicle";
  mode: "dry-run" | "live";
  startedAt: string;
  finishedAt: string;
  evidencePath: string;
  numbers: {
    loadingOrder: string;
    trip: string;
    remesa: string;
    manifest: string;
    plate: string;
  };
  documents: { kind: string; number: string; urlPath: string }[];
  steps: SyncableStep[];
};

export type OperationRecord = {
  operation: SyncableResult["operation"];
  mode: SyncableResult["mode"];
  ok: boolean;
  trip: {
    code: string;
    originCity?: string;
    destinationCity?: string;
    vehiclePlate?: string;
    driverName?: string;
  };
  documents: { kind: string; number: string; urlPath?: string; radicado?: string }[];
  steps: {
    name: string;
    title: string;
    procesoId: number;
    accepted: boolean;
    radicado?: string;
    errorText?: string;
    requestPath?: string;
    responsePath?: string;
  }[];
  errorText?: string;
  evidencePath?: string;
  startedAt: string;
  finishedAt: string;
};

const documentPlans: Record<SyncableResult["operation"], { kind: string; numberKey: keyof SyncableResult["numbers"]; stepName: string } | undefined> = {
  "loading-order": { kind: "orden_cargue", numberKey: "loadingOrder", stepName: "issue-loading-order" },
  remesa: { kind: "remesa", numberKey: "remesa", stepName: "issue-remesa" },
  manifest: { kind: "manifiesto", numberKey: "manifest", stepName: "issue-manifest" },
  "driver-vehicle": undefined
};

export function buildOperationRecord(result: SyncableResult, scenario: DemoScenario): OperationRecord {
  const plan = documentPlans[result.operation];
  const documents = [];

  if (plan) {
    const issueStep = result.steps.find((step) => step.name === plan.stepName);
    const generated = result.documents[0];
    documents.push({
      kind: plan.kind,
      number: result.numbers[plan.numberKey],
      urlPath: generated?.urlPath,
      radicado: issueStep?.radicado
    });
  }

  return {
    operation: result.operation,
    mode: result.mode,
    ok: result.ok,
    trip: {
      code: result.numbers.trip,
      originCity: scenario.sender.cityName,
      destinationCity: scenario.recipient.cityName,
      vehiclePlate: result.numbers.plate,
      driverName: scenario.driver.fullName
    },
    documents,
    steps: result.steps.map((step) => ({
      name: step.name,
      title: step.title,
      procesoId: step.procesoId,
      accepted: step.accepted,
      radicado: step.radicado,
      errorText: step.errorText,
      requestPath: step.requestPath,
      responsePath: step.responsePath
    })),
    errorText: result.steps.find((step) => !step.accepted)?.errorText,
    evidencePath: result.evidencePath,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt
  };
}

export async function syncOperationToConvex(result: SyncableResult, scenario: DemoScenario): Promise<ConvexSyncStatus> {
  const convexUrl = process.env.CONVEX_URL;
  const ingestKey = process.env.RNDC_INGEST_KEY;

  if (!convexUrl || !ingestKey) {
    return { synced: false, reason: "Convex sync not configured (CONVEX_URL, RNDC_INGEST_KEY)" };
  }

  try {
    const client = new ConvexHttpClient(convexUrl);
    const record = buildOperationRecord(result, scenario);
    await client.mutation(anyApi.rndc.recordOperation, { ...record, ingestKey });
    return { synced: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unexpected Convex sync failure";
    return { synced: false, reason };
  }
}

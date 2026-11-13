import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { DemoUser } from "./auth";
import { createConvexToken, getAuthSettings } from "./auth-server";
import {
  OperacionesUnavailableError,
  operacionesSettings,
  sendOperacionesDelivery,
  type OperacionesDeliveryOutcome,
  type OperacionesDeliveryPayload
} from "./operaciones-client";

type PlanItem = {
  kind: OperacionesDeliveryPayload["kind"];
  deliveryKey: string;
  label: string;
  number?: string;
  manifestNumber?: string;
  remesaNumber?: string;
  fileName?: string;
  artifactId?: Id<"evidenceArtifacts">;
  settled: boolean;
};

export type DeliveryPlan = { code: string; operacionesExpedienteId: string; items: PlanItem[] };

export type SyncItemResult = {
  kind: PlanItem["kind"];
  label: string;
  number?: string;
  status: "applied" | "pending" | "failed" | "skipped";
  message: string;
};

export type SyncResult =
  | { linked: false }
  | { linked: true; configured: boolean; items: SyncItemResult[] };

export type SyncRuntime = {
  configured: () => boolean;
  loadPlan: (expedienteId: Id<"expedientes">) => Promise<DeliveryPlan | null>;
  loadPdf: (artifactId: Id<"evidenceArtifacts">) => Promise<Uint8Array | null>;
  send: (payload: OperacionesDeliveryPayload) => Promise<OperacionesDeliveryOutcome>;
  record: (input: {
    expedienteId: Id<"expedientes">;
    kind: PlanItem["kind"];
    deliveryKey: string;
    number?: string;
    status: "applied" | "pending" | "failed";
    message: string;
  }) => Promise<void>;
};

export async function syncOperacionesDeliveries(
  expedienteId: Id<"expedientes">,
  actorName: string,
  runtime: SyncRuntime,
  options: { force?: boolean } = {}
): Promise<SyncResult> {
  const plan = await runtime.loadPlan(expedienteId);

  if (!plan) {
    return { linked: false };
  }

  if (!runtime.configured()) {
    return { linked: true, configured: false, items: [] };
  }

  const items: SyncItemResult[] = [];

  for (const item of plan.items) {
    const base = { kind: item.kind, label: item.label, number: item.number };

    if (item.settled && !options.force) {
      items.push({ ...base, status: "skipped", message: "Ya estaba en Operaciones" });
      continue;
    }

    const payload: OperacionesDeliveryPayload = {
      expedienteId: plan.operacionesExpedienteId,
      kind: item.kind,
      deliveryKey: item.deliveryKey,
      tmsDispatchCode: plan.code,
      actorName
    };

    if (item.kind === "manifest_numbers") {
      payload.manifestNumber = item.manifestNumber;
      payload.remesaNumber = item.remesaNumber;
    } else {
      const pdf = item.artifactId ? await runtime.loadPdf(item.artifactId) : null;

      if (!pdf) {
        items.push({ ...base, status: "failed", message: "El PDF todavía no está disponible en el TMS" });
        continue;
      }

      payload.fileName = item.fileName;
      payload.pdfBase64 = Buffer.from(pdf).toString("base64");
    }

    let status: "applied" | "pending" | "failed";
    let message: string;

    try {
      const outcome = await runtime.send(payload);
      status = outcome.ok ? (outcome.outcome === "pending" ? "pending" : "applied") : "failed";
      message = outcome.ok ? outcome.message : outcome.error;
    } catch (error) {
      status = "failed";
      message = error instanceof OperacionesUnavailableError ? error.message : "No fue posible enviar el documento a Operaciones";
    }

    await runtime.record({ expedienteId, kind: item.kind, deliveryKey: item.deliveryKey, number: item.number, status, message }).catch(() => undefined);
    items.push({ ...base, status, message });
  }

  return { linked: true, configured: true, items };
}

export function createSyncRuntime(user: DemoUser): SyncRuntime | null {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;

  if (!convexUrl) {
    return null;
  }

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(createConvexToken(user, getAuthSettings()));

  return {
    configured: () => operacionesSettings() !== null,
    loadPlan: (expedienteId) => client.query(api.operaciones.deliveryPlan, { expedienteId }),
    loadPdf: async (artifactId) => {
      const result = await client.query(api.evidence.getProtected, { artifactId });
      if (!result?.url) return null;
      const stored = await fetch(result.url, { cache: "no-store" });
      return stored.ok ? new Uint8Array(await stored.arrayBuffer()) : null;
    },
    send: (payload) => sendOperacionesDelivery(payload),
    record: async (input) => {
      await client.mutation(api.operaciones.recordDelivery, input);
    }
  };
}

export async function syncAfterEmission(user: DemoUser, expedienteId: string): Promise<SyncResult | null> {
  try {
    const runtime = createSyncRuntime(user);
    if (!runtime) return null;
    return await syncOperacionesDeliveries(expedienteId as Id<"expedientes">, user.name, runtime);
  } catch {
    return null;
  }
}

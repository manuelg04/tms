import { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { bogotaDateTimeParts, buildFulfillmentPlan, deriveOperationTimes } from "../../../../../../convex/model/fulfillmentWorkflow";
import { effectiveConsignment, type ConsignmentDraft, type LoadingOrderDraft } from "../../../../../../convex/model/dispatchWorkflow";
import { getAuthSettings, createConvexToken, jsonResponse } from "../../../../../lib/auth-server";
import { authorizeGatewayRequest } from "../../../../../lib/rndc-gateway";
import { POST as runRndcAction } from "../../../actions/[action]/route";

type Detail = NonNullable<FunctionReturnType<typeof api.expedientes.detail>>;

export async function POST(
  request: Request,
  context: { params: Promise<{ expedienteId: string }> }
): Promise<Response> {
  const authorization = authorizeGatewayRequest(request, "submit_rndc");

  if (authorization instanceof Response) {
    return authorization;
  }

  const rawBody = await request.text();
  let scope: "remesas" | "manifiesto" | "all" = "all";

  if (rawBody.trim()) {
    const parsed = safeParse(rawBody);

    if (!isRecord(parsed) || Object.keys(parsed).some((key) => key !== "scope")) {
      return jsonResponse({ error: "El navegador no puede aportar datos de cumplido; se usarán únicamente los datos guardados en el despacho" }, 400);
    }

    if (parsed.scope !== undefined && parsed.scope !== "remesas" && parsed.scope !== "manifiesto" && parsed.scope !== "all") {
      return jsonResponse({ error: "El alcance del cumplido no es válido" }, 400);
    }

    scope = parsed.scope ?? "all";
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;

  if (!convexUrl || !process.env.RNDC_INGEST_KEY) {
    return jsonResponse({ error: "Durable RNDC operations are not configured" }, 503);
  }

  const { expedienteId } = await context.params;
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(createConvexToken(authorization, getAuthSettings()));
  const detail = await client.query(api.expedientes.detail, {
    expedienteId: expedienteId as Id<"expedientes">
  });

  if (!detail) {
    return jsonResponse({ error: "Despacho no encontrado" }, 404);
  }

  const manifest = detail.documents.find((document) => document.kind === "manifiesto");

  if (!manifest || manifest.officialState !== "authorized") {
    return jsonResponse({ error: "El manifiesto debe estar autorizado antes del cumplido" }, 409);
  }

  const consignmentDocuments = detail.remesas.map((remesa) => ({
    remesa,
    document: detail.documents.find((document) => document._id === remesa.documentId)
  }));

  if (consignmentDocuments.some(({ document }) => !document || document.officialState !== "authorized")) {
    return jsonResponse({ error: "Todas las remesas deben estar autorizadas antes del cumplido" }, 409);
  }

  let plan = buildFulfillmentPlan({
    consignments: consignmentDocuments.map(({ document }) => ({
      id: document!._id,
      fulfillmentState: document!.fulfillmentState ?? "not_requested"
    })),
    manifest: { id: manifest._id, fulfillmentState: manifest.fulfillmentState ?? "not_requested" },
    allowEmptyManifest: detail.expediente.workflowVariant === "empty_manifest"
  });

  if (scope === "remesas") {
    plan = plan.filter((step) => step.kind === "remesa");
  }

  if (scope === "manifiesto") {
    if (consignmentDocuments.some(({ document }) => document?.fulfillmentState !== "fulfilled")) {
      return jsonResponse({ error: "Cumple todas las remesas antes de cerrar el manifiesto" }, 409);
    }
    plan = plan.filter((step) => step.kind === "manifiesto");
  }

  if (plan.length === 0) {
    const complete = manifest.fulfillmentState === "fulfilled"
      && consignmentDocuments.every(({ document }) => document?.fulfillmentState === "fulfilled");
    return jsonResponse(
      complete
        ? { ok: true, completed: true, steps: [] }
        : { ok: false, completed: false, error: "Existe un cumplido en curso o rechazado que requiere revisión" },
      complete ? 200 : 409
    );
  }

  const steps: Array<{ kind: "remesa" | "manifiesto"; documentId: string; outcome: string; error?: string }> = [];

  for (const step of plan) {
    const isManifest = step.kind === "manifiesto";
    const remesaRow = isManifest
      ? undefined
      : consignmentDocuments.find(({ document }) => document?._id === step.id)?.remesa;

    if (!isManifest && !remesaRow?.fulfillmentDraft?.deliveredQuantity) {
      return jsonResponse({
        error: `Completa las cantidades reales de la remesa ${remesaRow?.number ?? "pendiente"} antes de cumplirla`,
        nextAction: "completar_cumplido"
      }, 409);
    }

    const action = isManifest ? "fulfill_manifest" : "fulfill_remesa";
    const result = await executeStep(request, {
      action,
      organizationId: detail.expediente.organizationId,
      expedienteId,
      documentId: step.id,
      remesaId: remesaRow?._id,
      businessKey: `${action}:${step.id}`,
      payload: isManifest ? manifestPayload(detail, authorization.name) : consignmentPayload(detail, remesaRow!, authorization.name)
    });
    steps.push({ kind: step.kind, documentId: step.id, outcome: result.outcome, error: result.error });

    if (result.outcome !== "fulfilled") {
      return jsonResponse({
        ok: false,
        completed: false,
        steps,
        nextAction: result.outcome === "uncertain" ? "conciliar" : "revisar_rechazo"
      }, result.status);
    }
  }

  const completed = scope !== "remesas";

  if (completed) {
    await client.mutation(api.expedientes.update, {
      expedienteId: expedienteId as Id<"expedientes">,
      status: "completed",
      completedAt: Date.now(),
      reason: "Cumplido final completado"
    });
  }

  return jsonResponse({ ok: true, completed, steps }, 200);
}

async function executeStep(
  request: Request,
  input: {
    action: string;
    organizationId: string;
    expedienteId: string;
    documentId: string;
    remesaId?: string;
    businessKey: string;
    payload: Record<string, unknown>;
  }
): Promise<{ outcome: "fulfilled" | "uncertain" | "rejected"; status: number; error?: string }> {
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");
  headers.delete("content-length");
  const response = await runRndcAction(
    new Request(new URL(`/api/rndc/actions/${input.action}`, request.url), {
      method: "POST",
      headers,
      body: JSON.stringify({
        organizationId: input.organizationId,
        expedienteId: input.expedienteId,
        documentId: input.documentId,
        expedienteRemesaId: input.remesaId,
        requestKey: `${input.businessKey}:${crypto.randomUUID()}`,
        businessKey: input.businessKey,
        payload: input.payload
      })
    }),
    { params: Promise.resolve({ action: input.action }) }
  );
  const parsed = safeParse(await response.text());
  const record = isRecord(parsed) ? parsed : {};
  const status = typeof record.status === "string" ? record.status : "";
  const error = typeof record.error === "string" ? record.error : undefined;

  if (response.ok && record.ok === true && record.evidenceStored === true) {
    return { outcome: "fulfilled", status: response.status };
  }

  if (response.status === 202 || status === "uncertain") {
    return { outcome: "uncertain", status: 409, error };
  }

  return { outcome: "rejected", status: response.status >= 400 ? response.status : 422, error };
}

function operationTimesPayload(detail: Detail, remesa: Detail["remesas"][number]): Record<string, string> {
  const effective = effectiveConsignment((remesa.draft ?? {}) as ConsignmentDraft, (detail.expediente.loadingOrderDraft ?? null) as LoadingOrderDraft | null);
  const loadingAt = detail.serviceOrder.scheduledLoadingAt ?? detail.expediente.createdAt;
  const times = deriveOperationTimes(
    {
      loadingAppointmentAt: effective.loading?.appointmentAt,
      loadingAgreedHours: effective.loading?.agreedHours,
      unloadingAppointmentAt: effective.unloading?.appointmentAt,
      unloadingAgreedHours: effective.unloading?.agreedHours
    },
    remesa.fulfillmentDraft,
    { loadingAt, unloadingAt: detail.serviceOrder.scheduledUnloadingAt ?? loadingAt }
  );
  const loadingArrival = bogotaDateTimeParts(times.loadingArrivalAt);
  const loadingEntry = bogotaDateTimeParts(times.loadingEntryAt);
  const loadingExit = bogotaDateTimeParts(times.loadingExitAt);
  const unloadingArrival = bogotaDateTimeParts(times.unloadingArrivalAt);
  const unloadingEntry = bogotaDateTimeParts(times.unloadingEntryAt);
  const unloadingExit = bogotaDateTimeParts(times.unloadingExitAt);
  return {
    loadingArrivalDate: loadingArrival.date,
    loadingArrivalTime: loadingArrival.time,
    loadingEntryDate: loadingEntry.date,
    loadingEntryTime: loadingEntry.time,
    loadingExitDate: loadingExit.date,
    loadingExitTime: loadingExit.time,
    unloadingArrivalDate: unloadingArrival.date,
    unloadingArrivalTime: unloadingArrival.time,
    unloadingEntryDate: unloadingEntry.date,
    unloadingEntryTime: unloadingEntry.time,
    unloadingExitDate: unloadingExit.date,
    unloadingExitTime: unloadingExit.time
  };
}

function consignmentPayload(detail: Detail, remesa: Detail["remesas"][number], preparedBy: string): Record<string, unknown> {
  return {
    ...basePayload(detail, remesa, preparedBy),
    compliance: {
      ...operationTimesPayload(detail, remesa),
      remesaType: remesa.fulfillmentDraft?.suspended ? "S" : "C",
      unitCode: 1,
      loadedQuantityKg: Number(remesa.fulfillmentDraft?.deliveredQuantity ?? "0"),
      deliveredQuantityKg: Number(remesa.fulfillmentDraft?.deliveredQuantity ?? "0"),
      missingQuantityKg: Number(remesa.fulfillmentDraft?.missingQuantity ?? "0"),
      surplusQuantityKg: Number(remesa.fulfillmentDraft?.surplusQuantity ?? "0"),
      returnedQuantityKg: Number(remesa.fulfillmentDraft?.returnedQuantity ?? "0"),
      reasonCode: remesa.fulfillmentDraft?.reasonCode,
      observations: remesa.fulfillmentDraft?.observation
    }
  };
}

function manifestPayload(detail: Detail, preparedBy: string): Record<string, unknown> {
  return {
    ...basePayload(detail, detail.remesas[0], preparedBy),
    manifestRemesas: detail.remesas.map((remesa) => ({
      number: remesa.number,
      quantityKg: remesa.cargoWeightKg,
      productName: remesa.cargoDescription,
      senderName: detail.customer.name,
      recipientName: remesa.consigneeName ?? detail.customer.name
    })),
    compliance: {
      manifestType: "C",
      documentsDeliveryDate: slashDate(detail.expediente.manifestFulfillmentDraft?.documentsDeliveryDate)
        ?? formatDate(Date.now()),
      observations: detail.expediente.manifestFulfillmentDraft?.observation
    }
  };
}

function basePayload(detail: Detail, remesa: Detail["remesas"][number] | undefined, preparedBy?: string): Record<string, unknown> {
  const loadingDate = detail.serviceOrder.scheduledLoadingAt ?? detail.expediente.createdAt;
  const unloadingDate = detail.serviceOrder.scheduledUnloadingAt ?? loadingDate;
  return {
    seed: detail.expediente.code,
    cargoNumber: detail.expediente.cargoNumber,
    tripNumber: detail.expediente.tripNumber,
    remesaNumber: remesa?.number,
    manifestNumber: detail.expediente.manifestNumber,
    expeditionDate: formatDate(detail.expediente.createdAt),
    loadingAppointmentDate: formatDate(loadingDate),
    loadingAppointmentTime: formatTime(loadingDate),
    unloadingAppointmentDate: formatDate(unloadingDate),
    unloadingAppointmentTime: formatTime(unloadingDate),
    balancePaymentDate: formatDate(Date.now()),
    driver: { id: detail.driver?.document, fullName: detail.driver?.name, phone: detail.driver?.phone },
    vehicle: { plate: detail.vehicle?.plate, trailerPlate: detail.trailer?.plate, brand: detail.vehicle?.make, modelYear: detail.vehicle?.modelYear },
    vehicleHolder: {
      id: detail.vehicle?.possessorDocument ?? detail.vehicle?.ownerDocument,
      fullName: detail.vehicle?.possessorName ?? detail.vehicle?.ownerName
    },
    sender: { name: detail.customer.name, cityName: detail.loadingLocation.city, address: detail.loadingLocation.address },
    recipient: { name: remesa?.consigneeName ?? detail.customer.name, cityName: detail.unloadingLocation.city, address: detail.unloadingLocation.address },
    cargo: {
      productName: remesa?.cargoDescription ?? detail.serviceOrder.cargoDescription,
      shortDescription: remesa?.cargoDescription ?? detail.serviceOrder.cargoDescription,
      quantityKg: remesa?.cargoWeightKg ?? detail.serviceOrder.cargoWeightKg
    },
    money: { freightValue: detail.serviceOrder.agreedRate, advanceValue: 0 },
    fopat: { operationType: detail.loadingLocation.city === detail.unloadingLocation.city ? "municipal" : "intermunicipal" },
    preparedBy
  };
}

function formatDate(value: number): string {
  const date = new Date(value);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function formatTime(value: number): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function slashDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : undefined;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

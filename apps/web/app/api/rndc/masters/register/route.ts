import { randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { buildMasterRegistrationPayload } from "../../../../../convex/model/masterData";
import { createConvexToken, getAuthSettings, jsonResponse } from "../../../../lib/auth-server";
import { authorizeGatewayRequest, buildDurableEvidenceHeaders, durableEvidenceWasStored, forwardRndcRequest, safeRndcMode } from "../../../../lib/rndc-gateway";
import { resolveActionOutcome } from "../../../../lib/rndc-action-outcome";

type MasterBundle = {
  organizationId: string;
  version: number;
  driver: Record<string, unknown>;
  vehicle: Record<string, unknown>;
  owner: Record<string, unknown>;
  possessor: Record<string, unknown>;
};

export async function POST(request: Request): Promise<Response> {
  const authorization = authorizeGatewayRequest(request, "submit_rndc");
  if (authorization instanceof Response) return authorization;
  const body = await request.json().catch(() => null);
  if (!isRecord(body)) return jsonResponse({ error: "Solicitud inválida" }, 400);
  const allowed = new Set(["driverDocument", "vehiclePlate"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return jsonResponse({ error: "El navegador sólo puede seleccionar conductor y vehículo persistidos" }, 400);
  if (typeof body.driverDocument !== "string" || !body.driverDocument.trim() || typeof body.vehiclePlate !== "string" || !body.vehiclePlate.trim()) {
    return jsonResponse({ error: "Conductor y vehículo son obligatorios" }, 400);
  }
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  const serviceKey = process.env.RNDC_INGEST_KEY;
  if (!convexUrl || !serviceKey) return jsonResponse({ error: "Las operaciones RNDC durables no están configuradas" }, 503);

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(createConvexToken(authorization, getAuthSettings()));
  const bundle = await client.query(api.fleet.registrationBundle, {
    driverDocument: body.driverDocument,
    vehiclePlate: body.vehiclePlate
  }) as MasterBundle | null;
  if (!bundle) return jsonResponse({ error: "Completa conductor, vehículo, propietario y poseedor antes de preparar RNDC" }, 409);

  let payload: ReturnType<typeof buildMasterRegistrationPayload>;
  try {
    payload = buildMasterRegistrationPayload({
      driver: {
        documentType: text(bundle.driver.documentType, "tipo de identificación del conductor"),
        document: text(bundle.driver.document, "identificación del conductor"),
        name: text(bundle.driver.name, "nombre del conductor"),
        phone: text(bundle.driver.cellphone ?? bundle.driver.phone1, "teléfono del conductor"),
        address: text(bundle.driver.address, "dirección del conductor"),
        cityCode: text(bundle.driver.cityCode, "municipio del conductor"),
        licenseCategory: text(bundle.driver.licenseCategory, "categoría de licencia"),
        licenseNumber: text(bundle.driver.licenseNumber, "licencia"),
        licenseExpiresAt: text(bundle.driver.licenseExpiresAt, "vencimiento de licencia")
      },
      owner: party(bundle.owner, "propietario"),
      possessor: party(bundle.possessor, "poseedor"),
      vehicle: {
        plate: text(bundle.vehicle.plate, "placa"),
        configuration: text(bundle.vehicle.configuration, "configuración RNDC"),
        line: text(bundle.vehicle.line, "línea RNDC"),
        modelYear: text(bundle.vehicle.modelYear, "modelo"),
        emptyWeightTn: text(bundle.vehicle.emptyWeightTn, "peso vacío"),
        capacityTn: text(bundle.vehicle.capacityTn, "capacidad"),
        color: text(bundle.vehicle.color, "color RNDC"),
        insurerNit: text(bundle.vehicle.insurerNit, "aseguradora SOAT"),
        soatExpiresAt: text(bundle.vehicle.soatExpiresAt, "vencimiento SOAT"),
        soatNumber: text(bundle.vehicle.soatNumber, "número SOAT")
      }
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Maestros incompletos" }, 409);
  }

  const requestKey = `master-${randomUUID()}`;
  const payloadJson = JSON.stringify(payload);
  const queued = await client.mutation(api.rndcOperations.enqueue, {
    organizationId: bundle.organizationId as Id<"organizations">,
    operationType: "upsert_vehicle",
    procesoId: 12,
    mode: safeRndcMode(),
    requestKey,
    businessKey: `master:${body.driverDocument.trim()}:${body.vehiclePlate.trim().toUpperCase()}:${bundle.version}`,
    payloadJson,
    maxAttempts: 3
  });
  const existing = await client.query(api.rndcOperations.get, { operationId: queued.operationId });
  if (!existing || existing.payloadJson !== payloadJson || existing.operationType !== "upsert_vehicle") {
    return jsonResponse({ error: "La operación RNDC persistida no coincide con los maestros seleccionados" }, 409);
  }
  if (!queued.created && existing.status !== "queued") {
    const evidence = existing.status === "succeeded" ? await client.query(api.evidence.listForOperation, { operationId: queued.operationId }) : [];
    return jsonResponse({ ok: existing.status === "succeeded", operationId: queued.operationId, status: existing.status, evidenceStored: evidence.length > 0, idempotentReplay: true }, existing.status === "succeeded" ? 200 : 409);
  }

  const workerId = `web-master-${randomUUID()}`;
  const claimed = await client.mutation(api.rndcOperations.claimById, { serviceKey, operationId: queued.operationId, workerId, leaseMs: 60_000 });
  if (!claimed) return jsonResponse({ error: "La operación RNDC no pudo iniciarse", operationId: queued.operationId }, 409);
  const backendResponse = await forwardRndcRequest("/rndc/forms/driver-vehicle", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": requestKey,
      "X-Correlation-Id": queued.operationId,
      ...buildDurableEvidenceHeaders({ organizationId: bundle.organizationId, operationId: queued.operationId, operationType: "upsert_vehicle", leaseOwner: workerId })
    },
    body: payloadJson
  });
  const rawResult = await backendResponse.text();
  const result = parseJson(rawResult) ?? { error: rawResult || "La operación RNDC falló" };
  const evidenceStored = durableEvidenceWasStored(result);
  const outcome = resolveActionOutcome({ backendOk: backendResponse.ok, backendStatus: backendResponse.status, evidenceStored });
  const errorText = outcome.errorText ?? (!backendResponse.ok && isRecord(result) && typeof result.error === "string" ? result.error : undefined);
  const finalStatus = await client.mutation(api.rndcOperations.finish, {
    serviceKey,
    operationId: queued.operationId,
    workerId,
    outcome: outcome.operationOutcome,
    radicado: lastRadicado(result),
    resultJson: JSON.stringify(result),
    errorText
  });
  return jsonResponse({ ok: outcome.lifecycleAccepted, operationId: queued.operationId, status: finalStatus, evidenceStored, result }, outcome.responseStatus);
}

function party(value: Record<string, unknown>, label: string) {
  return {
    documentType: text(value.documentType, `tipo de identificación del ${label}`),
    document: text(value.document, `identificación del ${label}`),
    name: text(value.name, `nombre del ${label}`),
    phone: text(value.phone, `teléfono del ${label}`),
    address: text(value.address, `dirección del ${label}`),
    cityCode: text(value.cityCode, `municipio del ${label}`)
  };
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} es obligatorio`);
  return value.trim();
}

function lastRadicado(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.steps)) return undefined;
  return value.steps.flatMap((step) => isRecord(step) && typeof step.radicado === "string" ? [step.radicado] : []).at(-1);
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

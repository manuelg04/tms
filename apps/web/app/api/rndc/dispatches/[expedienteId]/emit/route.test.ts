import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { createSessionToken, demoUsers } from "../../../../../lib/auth.js";
import type { Id } from "../../../../../../convex/_generated/dataModel.js";
import { handleEmitWithRuntime, type EmissionInputs, type EmitRuntime } from "./handler.js";
import { POST } from "./route.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const sessionSecret = "emit-route-session-secret-with-more-than-thirty-two-characters";

beforeEach(() => {
  process.env.AUTH_MODE = "demo";
  process.env.DEMO_AUTH_PASSWORD = "unused-password";
  process.env.AUTH_SESSION_SECRET = sessionSecret;
  process.env.AUTH_JWT_PRIVATE_KEY = "unused";
  process.env.AUTH_JWT_PUBLIC_KEY = "unused";
  process.env.AUTH_JWT_ISSUER = "http://localhost:3000";
  process.env.RNDC_MODE = "dry-run";
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.CONVEX_URL;
  delete process.env.RNDC_INGEST_KEY;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

test("rejects an unauthenticated emission request", async () => {
  const response = await POST(
    new Request("http://localhost/api/rndc/dispatches/exp-1/emit", { method: "POST" }),
    emitContext("exp-1")
  );

  assert.equal(response.status, 401);
});

test("rejects a session without RNDC submission permission", async () => {
  const auditor = demoUsers.find((candidate) => candidate.role === "auditor");
  assert.ok(auditor);
  const token = createSessionToken(auditor, sessionSecret, Date.now(), 3_600);
  const response = await POST(
    new Request("http://localhost/api/rndc/dispatches/exp-1/emit", {
      method: "POST",
      headers: { cookie: `tms_session=${encodeURIComponent(token)}` }
    }),
    emitContext("exp-1")
  );

  assert.equal(response.status, 403);
});

test("rejects any browser-provided RNDC fields before touching Convex", async () => {
  let backendCalls = 0;
  globalThis.fetch = async () => {
    backendCalls += 1;
    return Response.json({ ok: true });
  };

  const response = await POST(
    emitRequest("exp-1", { payload: { manifestNumber: "HACKED" } }),
    emitContext("exp-1")
  );
  const body = (await response.json()) as { error?: string };

  assert.equal(response.status, 400);
  assert.match(body.error ?? "", /no puede aportar campos RNDC/);
  assert.equal(backendCalls, 0);
});

test("fails closed when durable storage is not configured", async () => {
  const response = await POST(emitRequest("exp-1"), emitContext("exp-1"));

  assert.equal(response.status, 503);
});

test("emits only the loading order when scope is orden", async () => {
  const preparedScopes: string[] = [];
  const executedActions: string[] = [];
  const response = await handleEmitWithRuntime(
    emitRequest("exp-1", { scope: "orden" }),
    emitContext("exp-1"),
    emissionRuntime(orderOnlyInputs(), preparedScopes, executedActions)
  );
  const body = await response.json() as { scope?: string; steps?: Array<{ action: string }> };

  assert.equal(response.status, 200);
  assert.equal(body.scope, "orden");
  assert.deepEqual(preparedScopes, ["orden"]);
  assert.deepEqual(executedActions, ["emit_loading_order"]);
  assert.deepEqual(body.steps?.map((step) => step.action), ["emit_loading_order"]);
});

test("returns a clear blocker when remesa scope has no authorized loading order", async () => {
  const inputs = fullInputs();
  inputs.order.officialState = "draft";
  const response = await handleEmitWithRuntime(
    emitRequest("exp-1", { scope: "remesas" }),
    emitContext("exp-1"),
    emissionRuntime(inputs, [], [])
  );
  const body = await response.json() as { blockers?: string[] };

  assert.equal(response.status, 409);
  assert.match(body.blockers?.join(" ") ?? "", /orden de cargue autorizada/i);
});

test("keeps the complete dry-run sequence compatible when scope is omitted", async () => {
  const preparedScopes: string[] = [];
  const executedActions: string[] = [];
  const response = await handleEmitWithRuntime(
    emitRequest("exp-1"),
    emitContext("exp-1"),
    emissionRuntime(fullInputs(), preparedScopes, executedActions)
  );
  const body = await response.json() as { mode?: string; scope?: string; completed?: boolean };

  assert.equal(response.status, 200);
  assert.equal(body.mode, "dry-run");
  assert.equal(body.scope, "todo");
  assert.equal(body.completed, true);
  assert.deepEqual(preparedScopes, ["todo"]);
  assert.deepEqual(executedActions, ["emit_loading_order", "emit_remesa", "register_trip", "issue_manifest"]);
});

test("rejects an unknown emission scope before loading dispatch data", async () => {
  let loaded = false;
  const runtime = emissionRuntime(orderOnlyInputs(), [], []);
  const response = await handleEmitWithRuntime(
    emitRequest("exp-1", { scope: "cadena_completa" }),
    emitContext("exp-1"),
    {
      ...runtime,
      loadInputs: async () => {
        loaded = true;
        return orderOnlyInputs();
      }
    }
  );

  assert.equal(response.status, 400);
  assert.equal(loaded, false);
});

function emissionRuntime(
  inputs: ReturnType<typeof fullInputs>,
  preparedScopes: string[],
  executedActions: string[]
): EmitRuntime {
  return {
    loadInputs: async () => inputs,
    prepareForEmission: async (_expedienteId, scope) => {
      preparedScopes.push(scope);
    },
    ensureOfficialDocuments: async () => ({
      order: "doc-order",
      manifest: "doc-manifest",
      byRemesa: new Map([["rem-1", "doc-remesa"]])
    }),
    executeStep: async (_request, _expedienteId, _organizationId, step) => {
      executedActions.push(step.action);
      return {
        key: step.key,
        action: step.action,
        documentNumber: step.documentNumber,
        outcome: "authorized"
      };
    }
  };
}

function orderOnlyInputs(): EmissionInputs {
  return {
    ...fullInputs(),
    consignments: [],
    manifest: { number: undefined, payloadJson: undefined, documentId: undefined, officialState: "draft" },
    tripNumber: undefined
  };
}

function fullInputs(): EmissionInputs {
  const order = {
    orderNumber: "0000001",
    expeditionDate: "2026-07-13",
    customerId: "customer-1",
    sender: {
      name: "REMITENTE",
      identificationType: "NIT",
      identificationNumber: "900100200",
      municipalityCode: "11001000",
      siteCode: "01"
    },
    recipient: {
      name: "DESTINATARIO",
      identificationType: "NIT",
      identificationNumber: "900300400",
      municipalityCode: "05001000",
      siteCode: "01"
    },
    loading: { address: "ORIGEN", cityName: "BOGOTA", municipalityCode: "11001000", appointmentAt: 1783900000000 },
    unloading: { address: "DESTINO", cityName: "MEDELLIN", municipalityCode: "05001000", appointmentAt: 1783986400000 },
    cargoDescription: "MAQUINARIA",
    weightTons: "20",
    packagingCode: "0",
    merchandiseCode: "009980",
    natureOfCargo: "1"
  };
  const remesa = {
    expeditionDate: "2026-07-13",
    consignmentClass: "terrestre_carga",
    declaredValue: "100000000",
    sender: order.sender,
    recipient: order.recipient,
    loading: order.loading,
    unloading: order.unloading,
    remissions: [{ quantity: "1", description: "MAQUINARIA", weightTons: "20", packagingClass: "0" }],
    packagingCode: "0",
    merchandiseCode: "009980",
    natureOfCargo: "1",
    policyNumber: "POL-1",
    policyExpiresOn: "2027-07-13",
    insurerNit: "860000000"
  };
  const manifest = {
    manifestNumber: "0000001",
    issueDate: "2026-07-13",
    estimatedDeliveryDate: "2026-07-14",
    operationScope: "intermunicipal",
    manifestType: "GENERAL",
    originMunicipalityCode: "11001000",
    destinationMunicipalityCode: "05001000",
    freightTotal: "5000000",
    advance: "1000000",
    withholdingIca: "0",
    paymentDate: "2026-07-20",
    paymentResponsible: "EMPRESA"
  };
  const assignment = {
    driver: { document: "10000001", documentType: "C.C", name: "CONDUCTOR" },
    secondDriver: null,
    vehicle: { plate: "ABC123", possessorDocument: "900500600" },
    trailer: null
  };
  return {
    organizationId: "org-1" as Id<"organizations">,
    workflowVariant: "standard" as const,
    code: "DSP-000001",
    status: "in_progress",
    tripNumber: "0000001",
    tripEmitted: false,
    order: { number: "0000001", payloadJson: snapshot(order), documentId: undefined, officialState: "draft" },
    consignments: [{ remesaId: "rem-1" as Id<"expedienteRemesas">, number: "00001", payloadJson: snapshot(remesa), documentId: undefined, officialState: "draft" }],
    manifest: { number: "0000001", payloadJson: snapshot(manifest), documentId: undefined, officialState: "draft" },
    assignmentJson: snapshot(assignment),
    operations: []
  };
}

function snapshot(data: Record<string, unknown>): string {
  return JSON.stringify({ data });
}

function emitRequest(expedienteId: string, body?: Record<string, unknown>): Request {
  const user = demoUsers.find((candidate) => candidate.role === "operator");

  if (!user) {
    throw new Error("Demo operator not found");
  }

  const token = createSessionToken(user, sessionSecret, Date.now(), 3_600);
  return new Request(`http://localhost/api/rndc/dispatches/${expedienteId}/emit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: `tms_session=${encodeURIComponent(token)}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

function emitContext(expedienteId: string): { params: Promise<{ expedienteId: string }> } {
  return { params: Promise.resolve({ expedienteId }) };
}

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { demoUsers, signConvexAccessToken } from "../app/lib/auth.js";

const webRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(webRoot, "../..");
const webEnv = parseEnv(await readFile(resolve(webRoot, ".env.local"), "utf8"));
const backendEnv = parseEnv(await readFile(resolve(repoRoot, ".env"), "utf8"));
const convexUrl = required(webEnv.NEXT_PUBLIC_CONVEX_URL ?? backendEnv.CONVEX_URL, "NEXT_PUBLIC_CONVEX_URL");
const serviceKey = required(webEnv.RNDC_INGEST_KEY ?? backendEnv.RNDC_INGEST_KEY, "RNDC_INGEST_KEY");
const privateKey = Buffer.from(required(webEnv.AUTH_JWT_PRIVATE_KEY_BASE64, "AUTH_JWT_PRIVATE_KEY_BASE64"), "base64").toString("utf8");
const issuer = required(webEnv.AUTH_JWT_ISSUER, "AUTH_JWT_ISSUER");
const audience = webEnv.AUTH_JWT_AUDIENCE ?? "tms-demo";
const keyId = required(webEnv.AUTH_JWT_KEY_ID, "AUTH_JWT_KEY_ID");
const client = new ConvexHttpClient(convexUrl);
let organizationId;

for (const user of demoUsers) {
  const result = await client.mutation(api.access.bootstrapOrganization, {
    serviceKey,
    organization: { slug: "transportes-mtm", name: "Transportes MTM" },
    actor: {
      externalId: user.id,
      authSubject: user.id,
      actorToken: createHash("sha256").update(`${serviceKey}:${user.id}`).digest("hex"),
      name: user.name,
      email: user.email,
      roles: [user.role]
    }
  });
  organizationId = result.organizationId;
}

if (!organizationId) {
  throw new Error("Demo organization could not be created");
}

await client.mutation(api.fleet.upsertFleetBatch, {
  ingestKey: serviceKey,
  organizationId,
  drivers: [{
    document: "1000000001",
    documentType: "C",
    name: "CONDUCTOR DEMO",
    status: "ACTIVO",
    city: "BOGOTA D.C.",
    cellphone: "3000000000",
    licenseNumber: "1000000001",
    licenseCategory: "C3",
    licenseExpiresAt: "31/12/2028"
  }],
  vehicles: [{
    plate: "DEM001",
    make: "VEHICULO",
    line: "DEMO",
    modelYear: "2024",
    configuration: "3S2",
    capacityTn: "34",
    emptyWeightTn: "10",
    ownerDocument: "0000000000",
    ownerName: "PROPIETARIO DEMO"
  }],
  relations: [{ driverDocument: "1000000001", vehiclePlate: "DEM001", matchConfidence: "demo", roles: ["principal"] }]
});

const operator = demoUsers.find((user) => user.role === "operator");
if (!operator) {
  throw new Error("Demo operator not found");
}

client.setAuth(signConvexAccessToken({
  user: operator,
  privateKey,
  issuer,
  audience,
  keyId,
  nowMs: Date.now(),
  ttlSeconds: 600
}));
const me = await client.query(api.access.me, {});
const customerId = await client.mutation(api.masterData.upsertCustomer, {
  organizationId: me.organizationId,
  code: "CLI-DEMO",
  name: "CLIENTE DE PRUEBA MTM",
  identificationType: "N",
  identificationNumber: "0000000000",
  phone: "3000000000",
  status: "active"
});
const loadingLocationId = await client.mutation(api.masterData.upsertCustomerLocation, {
  customerId,
  code: "CLI-DEMO-ORI",
  name: "PLANTA DE PRUEBA",
  kind: "loading",
  address: "DIRECCION DE PRUEBA 1",
  city: "BOGOTA D.C.",
  municipalityCode: "11001000",
  status: "active"
});
const unloadingLocationId = await client.mutation(api.masterData.upsertCustomerLocation, {
  customerId,
  code: "CLI-DEMO-DES",
  name: "BODEGA DE PRUEBA",
  kind: "unloading",
  address: "DIRECCION DE PRUEBA 2",
  city: "MEDELLIN",
  municipalityCode: "05001000",
  status: "active"
});
const loadingAt = new Date("2026-07-15T08:00:00-05:00").getTime();
const unloadingAt = new Date("2026-07-16T14:00:00-05:00").getTime();
const serviceOrderId = await client.mutation(api.masterData.upsertServiceOrder, {
  organizationId: me.organizationId,
  code: "OS-DEMO-001",
  customerId,
  loadingLocationId,
  unloadingLocationId,
  status: "confirmed",
  customerReference: "PEDIDO-DEMO-001",
  cargoDescription: "CARGA GENERAL DE PRUEBA",
  cargoQuantity: 34_000,
  cargoUnit: "kg",
  cargoWeightKg: 34_000,
  agreedRate: 4_760_000,
  currency: "COP",
  scheduledLoadingAt: loadingAt,
  scheduledUnloadingAt: unloadingAt,
  notes: "Expediente local para verificar las fases 1 a 3 sin envios reales"
});
const expedienteId = await client.mutation(api.expedientes.create, {
  organizationId: me.organizationId,
  serviceOrderId,
  code: "EXP-DEMO-001",
  notes: "Flujo controlado en modo de prueba"
});
const driver = await client.query(api.fleet.driverByDocument, { document: "1000000001" });
const vehicle = await client.query(api.fleet.vehicleByPlate, { plate: "DEM001" });
const trailerId = await client.mutation(api.masterData.upsertTrailer, {
  organizationId: me.organizationId,
  plate: "TRL001",
  trailerType: "SEMIRREMOLQUE",
  configuration: "3S2",
  capacityKg: 34_000,
  ownerDocument: "0000000000",
  status: "available"
});
await client.mutation(api.expedientes.update, {
  expedienteId,
  status: "ready",
  driverId: driver?._id,
  vehicleId: vehicle?._id,
  trailerId,
  cargoNumber: "770001",
  tripNumber: "660001",
  manifestNumber: "880001",
  reason: "Asignacion inicial del espacio de prueba"
});
const firstRemesaId = await client.mutation(api.expedientes.upsertRemesa, {
  expedienteId,
  sequence: 1,
  number: "990001",
  cargoDescription: "CARGA GENERAL A",
  cargoQuantity: 17_000,
  cargoUnit: "kg",
  cargoWeightKg: 17_000,
  consigneeName: "DESTINATARIO DEMO A",
  consigneeDocument: "0000000001"
});
const secondRemesaId = await client.mutation(api.expedientes.upsertRemesa, {
  expedienteId,
  sequence: 2,
  number: "990002",
  cargoDescription: "CARGA GENERAL B",
  cargoQuantity: 17_000,
  cargoUnit: "kg",
  cargoWeightKg: 17_000,
  consigneeName: "DESTINATARIO DEMO B",
  consigneeDocument: "0000000002"
});
await client.mutation(api.officialDocuments.createDraft, { expedienteId, expedienteRemesaId: firstRemesaId, kind: "remesa", number: "990001", mode: "dry-run" });
await client.mutation(api.officialDocuments.createDraft, { expedienteId, expedienteRemesaId: secondRemesaId, kind: "remesa", number: "990002", mode: "dry-run" });
await client.mutation(api.officialDocuments.createDraft, { expedienteId, kind: "manifiesto", number: "880001", mode: "dry-run" });
const current = await client.query(api.expedientes.detail, { expedienteId });

if (current && current.complianceChecks.length === 0 && driver && vehicle) {
  await Promise.all([
    client.mutation(api.expedientes.recordComplianceCheck, { expedienteId, subjectType: "driver", subjectId: driver._id, checkType: "licencia", status: "passed", expiresAt: new Date("2028-12-31T23:59:59-05:00").getTime(), details: "Vigencia de prueba" }),
    client.mutation(api.expedientes.recordComplianceCheck, { expedienteId, subjectType: "vehicle", subjectId: vehicle._id, checkType: "registro_flota", status: "passed", details: "Vehiculo de prueba disponible" }),
    client.mutation(api.expedientes.recordComplianceCheck, { expedienteId, subjectType: "trailer", subjectId: trailerId, checkType: "asignacion", status: "passed", details: "Remolque de prueba disponible" })
  ]);
}

process.stdout.write(`Demo workspace ready: ${expedienteId}\n`);

function parseEnv(source: string): Record<string, string> {
  return Object.fromEntries(source.split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf("=");
    return separator > 0 ? [[line.slice(0, separator), line.slice(separator + 1)]] : [];
  }));
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

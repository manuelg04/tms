import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import ExcelJS from "exceljs";
import { createSessionToken, demoUsers } from "../../../lib/auth.js";
import type { DispatchExportRecord } from "../../../lib/exportSchemas.js";
import { GET, handleDispatchExport } from "./route.js";

const originalEnv = { ...process.env };
const sessionSecret = "export-route-session-secret-with-more-than-thirty-two-characters";

beforeEach(() => {
  process.env.AUTH_MODE = "demo";
  process.env.DEMO_AUTH_PASSWORD = "unused-password";
  process.env.AUTH_SESSION_SECRET = sessionSecret;
  process.env.AUTH_JWT_PRIVATE_KEY = "unused";
  process.env.AUTH_JWT_PUBLIC_KEY = "unused";
  process.env.AUTH_JWT_ISSUER = "http://localhost:3000";
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.CONVEX_URL;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

test("rejects an unauthenticated dispatch export", async () => {
  const response = await GET(new Request("http://localhost/api/exports/dispatches?kind=orders"));

  assert.equal(response.status, 401);
});

test("passes the visible filters to the server loader and returns an Excel workbook", async () => {
  const operator = demoUsers.find((candidate) => candidate.role === "operator");
  assert.ok(operator);
  const token = createSessionToken(operator, sessionSecret, Date.now(), 3_600);
  let received: Record<string, string | undefined> | undefined;
  const response = await handleDispatchExport(
    new Request("http://localhost/api/exports/dispatches?kind=orders&q=EXP-0007&stage=envio_rndc&from=2026-07-01", {
      headers: { cookie: `tms_session=${encodeURIComponent(token)}` }
    }),
    async (filters) => {
      received = filters;
      return [record];
    }
  );
  const bytes = await response.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.worksheets[0];

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /spreadsheetml/);
  assert.deepEqual(received, { search: "EXP-0007", stage: "envio_rndc", from: "2026-07-01" });
  assert.equal(sheet.getCell("B2").value, "00001234");
  assert.equal(sheet.getCell("B2").numFmt, "@");
});

test("rejects unknown export types before loading data", async () => {
  const admin = demoUsers.find((candidate) => candidate.role === "admin");
  assert.ok(admin);
  const token = createSessionToken(admin, sessionSecret, Date.now(), 3_600);
  let loaded = false;
  const response = await handleDispatchExport(
    new Request("http://localhost/api/exports/dispatches?kind=everything", {
      headers: { cookie: `tms_session=${encodeURIComponent(token)}` }
    }),
    async () => {
      loaded = true;
      return [];
    }
  );

  assert.equal(response.status, 400);
  assert.equal(loaded, false);
});

const record: DispatchExportRecord = {
  dispatchCode: "EXP-0007",
  updatedAt: Date.UTC(2026, 6, 10),
  customerName: "Cliente Uno",
  originCity: "Bogotá",
  destinationCity: "Cali",
  agencyCode: "001",
  order: {
    number: "00001234",
    issuedAt: "2026-07-10",
    vehiclePlate: "ABC012",
    agencyCity: "Bogotá",
    senderName: "Remitente",
    cargoDescription: "Café",
    localStatus: "Autorizado",
    printStatus: "Impreso",
    createdAt: "2026-07-10",
    annulledAt: ""
  },
  consignments: []
};

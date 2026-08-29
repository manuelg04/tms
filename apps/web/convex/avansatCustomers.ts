import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { appendAudit } from "./model/access";
import {
  canonicalizeAvansatCustomerBatch,
  canonicalizeAvansatCustomerPayload,
  decideAvansatCustomerRecordWrite
} from "./model/avansatCustomers";

const MAX_BATCH_ROWS = 100;
const MAX_SOURCE_JSON_LENGTH = 50_000;

const activeStatusValidator = v.union(v.literal("active"), v.literal("inactive"));
const importStatusValidator = v.union(v.literal("running"), v.literal("completed"), v.literal("failed"));

const totalsFields = {
  batchesApplied: v.number(),
  customersInserted: v.number(),
  customersUpdated: v.number(),
  customersUnchanged: v.number(),
  locationsInserted: v.number(),
  locationsUpdated: v.number(),
  locationsUnchanged: v.number(),
  snapshotsInserted: v.number()
};

const totalsValidator = v.object(totalsFields);

const customerInputValidator = v.object({
  code: v.string(),
  name: v.string(),
  identificationType: v.string(),
  identificationNumber: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  status: activeStatusValidator
});

const locationInputValidator = v.object({
  code: v.string(),
  name: v.string(),
  kind: v.literal("both"),
  address: v.string(),
  city: v.string(),
  contactName: v.optional(v.string()),
  contactPhone: v.optional(v.string()),
  status: activeStatusValidator
});

const customerRowValidator = v.object({
  customer: customerInputValidator,
  location: v.optional(locationInputValidator),
  capturedAt: v.string(),
  contentHash: v.string(),
  sourceJson: v.string()
});

const importRunValidator = v.object({
  _id: v.id("avansatCustomerImportRuns"),
  _creationTime: v.number(),
  organizationId: v.id("organizations"),
  clientRunId: v.string(),
  manifestHash: v.string(),
  capturedAt: v.string(),
  expectedTotal: v.number(),
  batchCount: v.number(),
  status: importStatusValidator,
  totals: totalsValidator,
  certifiedAt: v.optional(v.number()),
  startedAt: v.number(),
  updatedAt: v.number(),
  finishedAt: v.optional(v.number())
});

const verificationItemValidator = v.object({
  document: v.string(),
  code: v.string(),
  name: v.string(),
  identificationType: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  status: activeStatusValidator,
  sourceContentHash: v.optional(v.string()),
  sourceCapturedAt: v.optional(v.string()),
  location: v.union(
    v.null(),
    v.object({
      code: v.string(),
      name: v.string(),
      kind: v.union(v.literal("loading"), v.literal("unloading"), v.literal("both")),
      address: v.string(),
      city: v.string(),
      contactName: v.optional(v.string()),
      contactPhone: v.optional(v.string()),
      status: activeStatusValidator
    })
  )
});

type CustomerInput = {
  code: string;
  name: string;
  identificationType: string;
  identificationNumber: string;
  email?: string;
  phone?: string;
  status: "active" | "inactive";
};

type LocationInput = {
  code: string;
  name: string;
  kind: "both";
  address: string;
  city: string;
  contactName?: string;
  contactPhone?: string;
  status: "active" | "inactive";
};

type CustomerRow = {
  customer: CustomerInput;
  location?: LocationInput;
  capturedAt: string;
  contentHash: string;
  sourceJson: string;
};

type ImportTotals = {
  batchesApplied: number;
  customersInserted: number;
  customersUpdated: number;
  customersUnchanged: number;
  locationsInserted: number;
  locationsUpdated: number;
  locationsUnchanged: number;
  snapshotsInserted: number;
};

export const beginImport = mutation({
  args: {
    ingestKey: v.string(),
    organizationId: v.id("organizations"),
    clientRunId: v.string(),
    manifestHash: v.string(),
    capturedAt: v.string(),
    expectedTotal: v.number(),
    batchCount: v.number()
  },
  returns: v.object({ importRunId: v.id("avansatCustomerImportRuns"), status: importStatusValidator, replayed: v.boolean() }),
  handler: async (ctx, args) => {
    requireImportKey(args.ingestKey);
    assertHash(args.manifestHash, "manifest hash");
    assertClientRunId(args.clientRunId);
    assertCapturedAt(args.capturedAt);
    assertPositiveInteger(args.expectedTotal, "expected total");
    assertPositiveInteger(args.batchCount, "batch count");
    const organization = await ctx.db.get("organizations", args.organizationId);
    if (!organization || organization.status !== "active") throw notFound("Organization not found or inactive");
    const existing = await ctx.db
      .query("avansatCustomerImportRuns")
      .withIndex("by_client_run_id", (q) => q.eq("clientRunId", args.clientRunId))
      .unique();
    if (existing) {
      if (
        existing.organizationId !== args.organizationId ||
        existing.manifestHash !== args.manifestHash ||
        existing.capturedAt !== args.capturedAt ||
        existing.expectedTotal !== args.expectedTotal ||
        existing.batchCount !== args.batchCount
      ) {
        throw conflict("The import run identifier is already bound to different customer data");
      }
      return { importRunId: existing._id, status: existing.status, replayed: true };
    }
    const now = Date.now();
    const importRunId = await ctx.db.insert("avansatCustomerImportRuns", {
      organizationId: args.organizationId,
      clientRunId: args.clientRunId,
      manifestHash: args.manifestHash,
      capturedAt: args.capturedAt,
      expectedTotal: args.expectedTotal,
      batchCount: args.batchCount,
      status: "running",
      totals: emptyTotals(),
      startedAt: now,
      updatedAt: now
    });
    return { importRunId, status: "running" as const, replayed: false };
  }
});

export const upsertBatch = mutation({
  args: {
    ingestKey: v.string(),
    importRunId: v.id("avansatCustomerImportRuns"),
    batchIndex: v.number(),
    batchHash: v.string(),
    rows: v.array(customerRowValidator)
  },
  returns: v.object({ ...totalsFields, replayed: v.boolean() }),
  handler: async (ctx, args) => {
    requireImportKey(args.ingestKey);
    assertNonNegativeInteger(args.batchIndex, "batch index");
    await assertBatch(args.rows, args.batchIndex, args.batchHash);
    const run = await ctx.db.get("avansatCustomerImportRuns", args.importRunId);
    if (!run) throw notFound("Import run not found");
    if (args.batchIndex >= run.batchCount) throw invalidInput("Batch index exceeds the declared batch count");
    const existingReceipt = await ctx.db
      .query("avansatCustomerImportBatches")
      .withIndex("by_run_and_batch", (q) => q.eq("importRunId", run._id).eq("batchIndex", args.batchIndex))
      .unique();
    if (existingReceipt) {
      if (existingReceipt.batchHash !== args.batchHash || existingReceipt.rowCount !== args.rows.length) {
        throw conflict("The batch position is already bound to different customer data");
      }
      return { batchesApplied: 1, ...receiptTotals(existingReceipt), replayed: true };
    }
    if (run.status !== "running") throw invalidState("Only a running import can accept customer batches");
    const actor = await importActor(ctx, run.organizationId);
    const now = Date.now();
    await reserveDocuments(ctx, run._id, args.rows, args.batchIndex, now);
    const totals = emptyTotals();
    totals.batchesApplied = 1;
    for (const row of args.rows) {
      const existingByIdentification = await ctx.db
        .query("customers")
        .withIndex("by_organization_and_identification", (q) =>
          q.eq("organizationId", run.organizationId).eq("identificationNumber", row.customer.identificationNumber)
        )
        .unique();
      const existingByCode = await ctx.db
        .query("customers")
        .withIndex("by_organization_and_code", (q) => q.eq("organizationId", run.organizationId).eq("code", row.customer.code))
        .unique();
      if (existingByIdentification && existingByCode && existingByIdentification._id !== existingByCode._id) {
        throw conflict(`Customer code and identification belong to different records for ${row.customer.identificationNumber}`);
      }
      const existing = existingByIdentification ?? existingByCode;
      const decision = decideAvansatCustomerRecordWrite(
        Boolean(existing),
        existing?.sourceContentHash,
        row.contentHash,
        existing ? customerMatches(existing, row.customer) : false
      );
      let customerId: Id<"customers">;
      if (!existing) {
        customerId = await ctx.db.insert("customers", {
          organizationId: run.organizationId,
          ...row.customer,
          source: "avansat",
          sourceContentHash: row.contentHash,
          sourceCapturedAt: row.capturedAt,
          sourceImportRunId: run._id,
          createdBy: actor._id,
          updatedBy: actor._id,
          createdAt: now,
          updatedAt: now
        });
        totals.customersInserted += 1;
      } else if (decision === "update") {
        customerId = existing._id;
        await ctx.db.patch("customers", existing._id, {
          ...row.customer,
          source: "avansat",
          sourceContentHash: row.contentHash,
          sourceCapturedAt: row.capturedAt,
          sourceImportRunId: run._id,
          updatedBy: actor._id,
          updatedAt: now
        });
        totals.customersUpdated += 1;
      } else {
        customerId = existing._id;
        totals.customersUnchanged += 1;
      }
      if (row.location) {
        const existingLocation = await ctx.db
          .query("customerLocations")
          .withIndex("by_customer_and_code", (q) => q.eq("customerId", customerId).eq("code", row.location!.code))
          .unique();
        if (!existingLocation) {
          await ctx.db.insert("customerLocations", {
            organizationId: run.organizationId,
            customerId,
            ...row.location,
            createdBy: actor._id,
            updatedBy: actor._id,
            createdAt: now,
            updatedAt: now
          });
          totals.locationsInserted += 1;
        } else if (!locationMatches(existingLocation, row.location)) {
          await ctx.db.patch("customerLocations", existingLocation._id, { ...row.location, updatedBy: actor._id, updatedAt: now });
          totals.locationsUpdated += 1;
        } else {
          totals.locationsUnchanged += 1;
        }
      }
      if (decision !== "unchanged") {
        await ctx.db.insert("avansatCustomerSnapshots", {
          organizationId: run.organizationId,
          customerId,
          importRunId: run._id,
          document: row.customer.identificationNumber,
          contentHash: row.contentHash,
          capturedAt: row.capturedAt,
          sourceJson: row.sourceJson,
          createdAt: now
        });
        totals.snapshotsInserted += 1;
        await appendAudit(ctx, {
          organizationId: run.organizationId,
          actorType: "service",
          actorId: actor._id,
          action: decision === "insert" ? "customer.avansat_created" : "customer.avansat_updated",
          entityType: "customer",
          entityId: customerId,
          detailsJson: JSON.stringify({ importRunId: run._id, contentHash: row.contentHash }),
          createdAt: now
        });
      }
    }
    await ctx.db.insert("avansatCustomerImportBatches", {
      importRunId: run._id,
      batchIndex: args.batchIndex,
      batchHash: args.batchHash,
      rowCount: args.rows.length,
      ...withoutBatches(totals),
      createdAt: now
    });
    const nextTotals = addTotals(run.totals, totals);
    await ctx.db.patch("avansatCustomerImportRuns", run._id, { totals: nextTotals, updatedAt: now });
    return { ...totals, replayed: false };
  }
});

export const completeImport = mutation({
  args: { ingestKey: v.string(), importRunId: v.id("avansatCustomerImportRuns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireImportKey(args.ingestKey);
    const run = await ctx.db.get("avansatCustomerImportRuns", args.importRunId);
    if (!run) throw notFound("Import run not found");
    if (run.status === "failed") throw invalidState("A failed import cannot be completed");
    const receipts = await ctx.db
      .query("avansatCustomerImportBatches")
      .withIndex("by_run_and_batch", (q) => q.eq("importRunId", run._id))
      .collect();
    receipts.sort((left, right) => left.batchIndex - right.batchIndex);
    if (receipts.length !== run.batchCount || receipts.some((receipt, index) => receipt.batchIndex !== index)) {
      throw invalidState("The customer import does not contain every declared batch");
    }
    if (receipts.reduce((sum, receipt) => sum + receipt.rowCount, 0) !== run.expectedTotal) {
      throw invalidState("The customer import row count does not match the declared total");
    }
    const certifiedTotals = receipts.reduce<ImportTotals>((total, receipt) => addTotals(total, { batchesApplied: 1, ...receiptTotals(receipt) }), emptyTotals());
    if (!sameTotals(run.totals, certifiedTotals)) throw invalidState("The customer import totals do not match the batch receipts");
    if (run.status === "completed") return null;
    const now = Date.now();
    await ctx.db.patch("avansatCustomerImportRuns", run._id, {
      status: "completed",
      certifiedAt: now,
      updatedAt: now,
      finishedAt: now
    });
    return null;
  }
});

export const failImport = mutation({
  args: { ingestKey: v.string(), importRunId: v.id("avansatCustomerImportRuns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireImportKey(args.ingestKey);
    const run = await ctx.db.get("avansatCustomerImportRuns", args.importRunId);
    if (!run) throw notFound("Import run not found");
    if (run.status === "completed") throw invalidState("A completed import cannot be failed");
    if (run.status === "failed") return null;
    const now = Date.now();
    await ctx.db.patch("avansatCustomerImportRuns", run._id, { status: "failed", updatedAt: now, finishedAt: now });
    return null;
  }
});

export const getImport = query({
  args: { ingestKey: v.string(), importRunId: v.id("avansatCustomerImportRuns") },
  returns: v.union(importRunValidator, v.null()),
  handler: async (ctx, args) => {
    requireImportKey(args.ingestKey);
    return await ctx.db.get("avansatCustomerImportRuns", args.importRunId);
  }
});

export const verificationPage = query({
  args: {
    ingestKey: v.string(),
    organizationId: v.id("organizations"),
    cursor: v.union(v.string(), v.null()),
    limit: v.number()
  },
  returns: v.object({ items: v.array(verificationItemValidator), nextCursor: v.union(v.string(), v.null()), done: v.boolean() }),
  handler: async (ctx, args) => {
    requireImportKey(args.ingestKey);
    const limit = Math.max(1, Math.min(200, Math.floor(args.limit)));
    const result = await ctx.db
      .query("customers")
      .withIndex("by_organization_and_identification", (q) => q.eq("organizationId", args.organizationId))
      .paginate({ cursor: args.cursor, numItems: limit });
    const items = await Promise.all(result.page.map(async (customer) => {
      const location = await ctx.db
        .query("customerLocations")
        .withIndex("by_customer_and_code", (q) => q.eq("customerId", customer._id).eq("code", "PRINCIPAL"))
        .unique();
      return {
        document: customer.identificationNumber ?? customer.code,
        code: customer.code,
        name: customer.name,
        identificationType: customer.identificationType,
        email: customer.email,
        phone: customer.phone,
        status: customer.status,
        sourceContentHash: customer.sourceContentHash,
        sourceCapturedAt: customer.sourceCapturedAt,
        location: location ? {
          code: location.code,
          name: location.name,
          kind: location.kind,
          address: location.address,
          city: location.city,
          contactName: location.contactName,
          contactPhone: location.contactPhone,
          status: location.status
        } : null
      };
    }));
    return { items, nextCursor: result.isDone ? null : result.continueCursor, done: result.isDone };
  }
});

async function assertBatch(rows: CustomerRow[], batchIndex: number, batchHash: string): Promise<void> {
  assertHash(batchHash, "batch hash");
  if (rows.length < 1 || rows.length > MAX_BATCH_ROWS) throw invalidInput(`A customer batch must contain between 1 and ${MAX_BATCH_ROWS} rows`);
  const documents = new Set<string>();
  for (const row of rows) {
    assertCustomerRow(row);
    const document = row.customer.identificationNumber;
    if (documents.has(document)) throw conflict(`Duplicate customer identification inside batch: ${document}`);
    documents.add(document);
    const expectedContentHash = await sha256Hex(canonicalizeAvansatCustomerPayload({
      customer: row.customer,
      location: row.location ?? null,
      source: { sourceJson: row.sourceJson }
    }));
    if (row.contentHash !== expectedContentHash) throw invalidInput(`Customer content hash does not match the canonical payload for ${document}`);
  }
  const expectedBatchHash = await sha256Hex(canonicalizeAvansatCustomerBatch(
    batchIndex,
    rows.map((row) => ({ document: row.customer.identificationNumber, contentHash: row.contentHash }))
  ));
  if (batchHash !== expectedBatchHash) throw invalidInput("Customer batch hash does not match its canonical payload");
}

function assertCustomerRow(row: CustomerRow): void {
  assertCapturedAt(row.capturedAt);
  assertHash(row.contentHash, "content hash");
  requiredNormalized(row.customer.code, "customer code", 80);
  requiredNormalized(row.customer.identificationNumber, "customer identification", 80);
  if (row.customer.code !== row.customer.identificationNumber) throw invalidInput("Customer code must equal its identification");
  requiredNormalized(row.customer.name, "customer name", 300);
  requiredNormalized(row.customer.identificationType, "customer identification type", 40);
  optionalNormalized(row.customer.email, "customer email", 320);
  optionalNormalized(row.customer.phone, "customer phone", 80);
  if (row.location) {
    requiredNormalized(row.location.code, "location code", 80);
    requiredNormalized(row.location.name, "location name", 300);
    requiredNormalized(row.location.address, "location address", 500);
    requiredNormalized(row.location.city, "location city", 200);
    optionalNormalized(row.location.contactName, "location contact name", 300);
    optionalNormalized(row.location.contactPhone, "location contact phone", 80);
  }
  if (row.sourceJson.length < 2 || row.sourceJson.length > MAX_SOURCE_JSON_LENGTH) throw invalidInput("Customer source JSON is empty or too large");
  try {
    JSON.parse(row.sourceJson);
  } catch {
    throw invalidInput("Customer source JSON is invalid");
  }
}

async function reserveDocuments(
  ctx: MutationCtx,
  importRunId: Id<"avansatCustomerImportRuns">,
  rows: CustomerRow[],
  batchIndex: number,
  now: number
): Promise<void> {
  for (const row of rows) {
    const existing = await ctx.db
      .query("avansatCustomerImportKeys")
      .withIndex("by_run_and_document", (q) => q.eq("importRunId", importRunId).eq("document", row.customer.identificationNumber))
      .unique();
    if (existing) throw conflict(`Customer identification already appeared in this import: ${row.customer.identificationNumber}`);
  }
  for (const row of rows) {
    await ctx.db.insert("avansatCustomerImportKeys", {
      importRunId,
      document: row.customer.identificationNumber,
      batchIndex,
      contentHash: row.contentHash,
      createdAt: now
    });
  }
}

async function importActor(ctx: MutationCtx, organizationId: Id<"organizations">): Promise<Doc<"users">> {
  const users = await ctx.db
    .query("users")
    .withIndex("by_organization_and_email", (q) => q.eq("organizationId", organizationId))
    .take(250);
  const actor = users.find((user) => user.status === "active" && user.roles.includes("admin"))
    ?? users.find((user) => user.status === "active" && user.roles.includes("operator"));
  if (!actor) throw invalidState("The organization has no active admin or operator for customer import attribution");
  return actor;
}

function customerMatches(existing: Doc<"customers">, incoming: CustomerInput): boolean {
  return existing.code === incoming.code
    && existing.name === incoming.name
    && existing.identificationType === incoming.identificationType
    && existing.identificationNumber === incoming.identificationNumber
    && existing.email === incoming.email
    && existing.phone === incoming.phone
    && existing.status === incoming.status;
}

function locationMatches(existing: Doc<"customerLocations">, incoming: LocationInput): boolean {
  return existing.code === incoming.code
    && existing.name === incoming.name
    && existing.kind === incoming.kind
    && existing.address === incoming.address
    && existing.city === incoming.city
    && existing.contactName === incoming.contactName
    && existing.contactPhone === incoming.contactPhone
    && existing.status === incoming.status;
}

function emptyTotals(): ImportTotals {
  return {
    batchesApplied: 0,
    customersInserted: 0,
    customersUpdated: 0,
    customersUnchanged: 0,
    locationsInserted: 0,
    locationsUpdated: 0,
    locationsUnchanged: 0,
    snapshotsInserted: 0
  };
}

function addTotals(left: ImportTotals, right: ImportTotals): ImportTotals {
  return {
    batchesApplied: left.batchesApplied + right.batchesApplied,
    customersInserted: left.customersInserted + right.customersInserted,
    customersUpdated: left.customersUpdated + right.customersUpdated,
    customersUnchanged: left.customersUnchanged + right.customersUnchanged,
    locationsInserted: left.locationsInserted + right.locationsInserted,
    locationsUpdated: left.locationsUpdated + right.locationsUpdated,
    locationsUnchanged: left.locationsUnchanged + right.locationsUnchanged,
    snapshotsInserted: left.snapshotsInserted + right.snapshotsInserted
  };
}

function withoutBatches(totals: ImportTotals) {
  return {
    customersInserted: totals.customersInserted,
    customersUpdated: totals.customersUpdated,
    customersUnchanged: totals.customersUnchanged,
    locationsInserted: totals.locationsInserted,
    locationsUpdated: totals.locationsUpdated,
    locationsUnchanged: totals.locationsUnchanged,
    snapshotsInserted: totals.snapshotsInserted
  };
}

function receiptTotals(receipt: Doc<"avansatCustomerImportBatches">) {
  return {
    customersInserted: receipt.customersInserted,
    customersUpdated: receipt.customersUpdated,
    customersUnchanged: receipt.customersUnchanged,
    locationsInserted: receipt.locationsInserted,
    locationsUpdated: receipt.locationsUpdated,
    locationsUnchanged: receipt.locationsUnchanged,
    snapshotsInserted: receipt.snapshotsInserted
  };
}

function sameTotals(left: ImportTotals, right: ImportTotals): boolean {
  return Object.keys(left).every((key) => left[key as keyof ImportTotals] === right[key as keyof ImportTotals]);
}

function requireImportKey(value: string): void {
  const expected = process.env.RNDC_INGEST_KEY;
  const enabled = process.env.AVANSAT_CUSTOMER_IMPORT_ENABLED === "development-only";
  if (!enabled || !expected || value !== expected) throw new ConvexError({ code: "UNAUTHORIZED", message: "Invalid ingest key" });
}

function assertClientRunId(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw invalidInput("Client run identifier is invalid");
  }
}

function assertCapturedAt(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw invalidInput("Capture timestamp is invalid");
  }
}

function assertHash(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw invalidInput(`${label} is invalid`);
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) throw invalidInput(`${label} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) throw invalidInput(`${label} must be a non-negative integer`);
}

function requiredNormalized(value: string, label: string, maximumLength: number): void {
  if (!value || value !== value.trim().replace(/[\s\u00a0]+/g, " ")) throw invalidInput(`${label} must be normalized`);
  if (value.length > maximumLength) throw invalidInput(`${label} exceeds ${maximumLength} characters`);
}

function optionalNormalized(value: string | undefined, label: string, maximumLength: number): void {
  if (value === undefined) return;
  requiredNormalized(value, label, maximumLength);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function invalidInput(message: string) {
  return new ConvexError({ code: "INVALID_INPUT", message });
}

function invalidState(message: string) {
  return new ConvexError({ code: "INVALID_STATE", message });
}

function conflict(message: string) {
  return new ConvexError({ code: "CONFLICT", message });
}

function notFound(message: string) {
  return new ConvexError({ code: "NOT_FOUND", message });
}

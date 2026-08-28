import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireActor } from "./model/access";
import {
  canonicalizeRndcCatalogPayload,
  cleanRndcReference,
  decideRndcCatalogWrite,
  type RndcCatalogPayload
} from "./model/rndcCatalogs";

const MAX_BATCH_ROWS = 200;

const catalogKindValidator = v.union(
  v.literal("vehicle_line"),
  v.literal("insurer"),
  v.literal("packaging"),
  v.literal("body_type")
);

const importStatusValidator = v.union(
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed")
);

const failureCodeValidator = v.union(
  v.literal("SOURCE_VALIDATION_FAILED"),
  v.literal("BATCH_APPLY_FAILED"),
  v.literal("VERIFICATION_FAILED"),
  v.literal("IMPORT_INTERRUPTED"),
  v.literal("INTERNAL_ERROR")
);

const failureMessageValidator = v.union(
  v.literal("The RNDC catalog source could not be validated"),
  v.literal("An RNDC catalog batch could not be applied"),
  v.literal("The RNDC catalog import could not be verified"),
  v.literal("The RNDC catalog import was interrupted"),
  v.literal("The RNDC catalog import failed")
);

const fileSummaryValidator = v.object({
  fileName: v.string(),
  sha256: v.string(),
  catalogDigest: v.string(),
  rowsRead: v.number(),
  normalizedRows: v.number(),
  historicalRows: v.number(),
  batchCount: v.number()
});

const storedFileSummaryValidator = v.object({
  fileName: v.string(),
  sha256: v.string(),
  catalogDigest: v.optional(v.string()),
  rowsRead: v.number(),
  normalizedRows: v.number(),
  historicalRows: v.number(),
  batchCount: v.number()
});

const importFilesValidator = v.object({
  vehicleLines: fileSummaryValidator,
  insurers: fileSummaryValidator,
  packages: fileSummaryValidator,
  bodyTypes: fileSummaryValidator
});

const outcomeValidator = v.object({
  batchesApplied: v.number(),
  inserted: v.number(),
  updated: v.number(),
  unchanged: v.number(),
  outdated: v.number()
});

const importTotalsValidator = v.object({
  vehicleLines: outcomeValidator,
  insurers: outcomeValidator,
  packages: outcomeValidator,
  bodyTypes: outcomeValidator
});

const certificationValidator = v.object({
  totals: importTotalsValidator,
  certifiedAt: v.number()
});

const vehicleLineInputValidator = v.object({
  makeCode: v.string(),
  makeName: v.optional(v.string()),
  lineCode: v.string(),
  lineName: v.optional(v.string()),
  grossWeightKg: v.number(),
  sourceRegisteredAt: v.string(),
  contentHash: v.string()
});

const insurerInputValidator = v.object({
  insurerNit: v.string(),
  name: v.string(),
  insurerType: v.optional(v.string()),
  sourceRegisteredAt: v.string(),
  contentHash: v.string()
});

const packagingInputValidator = v.object({
  code: v.string(),
  description: v.string(),
  fullDescription: v.string(),
  definition: v.string(),
  minimumEmptyWeightKg: v.number(),
  maximumEmptyWeightKg: v.number(),
  hazardous: v.optional(v.boolean()),
  packageTypeCode: v.optional(v.string()),
  packageTypeName: v.optional(v.string()),
  materialCode: v.optional(v.string()),
  materialName: v.optional(v.string()),
  operationType: v.string(),
  sourceRegisteredAt: v.string(),
  contentHash: v.string()
});

const bodyTypeInputValidator = v.object({
  code: v.string(),
  description: v.string(),
  sourceRegisteredAt: v.string(),
  contentHash: v.string()
});

const batchPayloadValidator = v.union(
  v.object({ catalog: v.literal("vehicle_line"), rows: v.array(vehicleLineInputValidator) }),
  v.object({ catalog: v.literal("insurer"), rows: v.array(insurerInputValidator) }),
  v.object({ catalog: v.literal("packaging"), rows: v.array(packagingInputValidator) }),
  v.object({ catalog: v.literal("body_type"), rows: v.array(bodyTypeInputValidator) })
);

const importRunValidator = v.object({
  _id: v.id("rndcReferenceImportRuns"),
  _creationTime: v.number(),
  clientRunId: v.string(),
  status: importStatusValidator,
  files: v.object({
    vehicleLines: storedFileSummaryValidator,
    insurers: storedFileSummaryValidator,
    packages: storedFileSummaryValidator,
    bodyTypes: storedFileSummaryValidator
  }),
  totals: importTotalsValidator,
  certification: v.optional(certificationValidator),
  failureCode: v.optional(failureCodeValidator),
  failureMessage: v.optional(failureMessageValidator),
  startedAt: v.number(),
  updatedAt: v.number(),
  finishedAt: v.optional(v.number())
});

const vehicleLineValidator = v.object({
  _id: v.id("rndcVehicleLines"),
  _creationTime: v.number(),
  makeCode: v.string(),
  makeName: v.optional(v.string()),
  lineCode: v.string(),
  lineName: v.optional(v.string()),
  grossWeightKg: v.number(),
  sourceRegisteredAt: v.string(),
  contentHash: v.string(),
  sourceImportRunId: v.id("rndcReferenceImportRuns"),
  createdAt: v.number(),
  updatedAt: v.number()
});

const insurerValidator = v.object({
  _id: v.id("rndcInsurers"),
  _creationTime: v.number(),
  insurerNit: v.string(),
  name: v.string(),
  insurerType: v.optional(v.string()),
  sourceRegisteredAt: v.string(),
  contentHash: v.string(),
  sourceImportRunId: v.id("rndcReferenceImportRuns"),
  createdAt: v.number(),
  updatedAt: v.number()
});

const packagingValidator = v.object({
  _id: v.id("rndcPackaging"),
  _creationTime: v.number(),
  code: v.string(),
  description: v.string(),
  fullDescription: v.string(),
  definition: v.string(),
  minimumEmptyWeightKg: v.number(),
  maximumEmptyWeightKg: v.number(),
  hazardous: v.optional(v.boolean()),
  packageTypeCode: v.optional(v.string()),
  packageTypeName: v.optional(v.string()),
  materialCode: v.optional(v.string()),
  materialName: v.optional(v.string()),
  operationType: v.string(),
  sourceRegisteredAt: v.string(),
  contentHash: v.string(),
  sourceImportRunId: v.id("rndcReferenceImportRuns"),
  createdAt: v.number(),
  updatedAt: v.number()
});

const bodyTypeValidator = v.object({
  _id: v.id("rndcBodyTypes"),
  _creationTime: v.number(),
  code: v.string(),
  description: v.string(),
  sourceRegisteredAt: v.string(),
  contentHash: v.string(),
  sourceImportRunId: v.id("rndcReferenceImportRuns"),
  createdAt: v.number(),
  updatedAt: v.number()
});

const pageItemValidator = v.object({
  catalog: catalogKindValidator,
  key: v.string(),
  secondaryKey: v.optional(v.string()),
  label: v.optional(v.string()),
  sourceRegisteredAt: v.string(),
  contentHash: v.string(),
  sourceImportRunId: v.id("rndcReferenceImportRuns")
});

const coverageResultValidator = v.object({
  withReference: v.number(),
  resolved: v.number(),
  unresolved: v.number(),
  missingReference: v.number(),
  unresolvedReferences: v.array(v.string())
});

type CatalogKind = "vehicle_line" | "insurer" | "packaging" | "body_type";
type FileSummary = {
  fileName: string;
  sha256: string;
  catalogDigest?: string;
  rowsRead: number;
  normalizedRows: number;
  historicalRows: number;
  batchCount: number;
};
type ImportFiles = {
  vehicleLines: FileSummary;
  insurers: FileSummary;
  packages: FileSummary;
  bodyTypes: FileSummary;
};
type BatchOutcome = {
  inserted: number;
  updated: number;
  unchanged: number;
  outdated: number;
};
type CatalogOutcome = BatchOutcome & { batchesApplied: number };
type ImportTotals = {
  vehicleLines: CatalogOutcome;
  insurers: CatalogOutcome;
  packages: CatalogOutcome;
  bodyTypes: CatalogOutcome;
};
type VehicleLineInput = {
  makeCode: string;
  makeName?: string;
  lineCode: string;
  lineName?: string;
  grossWeightKg: number;
  sourceRegisteredAt: string;
  contentHash: string;
};
type InsurerInput = {
  insurerNit: string;
  name: string;
  insurerType?: string;
  sourceRegisteredAt: string;
  contentHash: string;
};
type PackagingInput = {
  code: string;
  description: string;
  fullDescription: string;
  definition: string;
  minimumEmptyWeightKg: number;
  maximumEmptyWeightKg: number;
  hazardous?: boolean;
  packageTypeCode?: string;
  packageTypeName?: string;
  materialCode?: string;
  materialName?: string;
  operationType: string;
  sourceRegisteredAt: string;
  contentHash: string;
};
type BodyTypeInput = {
  code: string;
  description: string;
  sourceRegisteredAt: string;
  contentHash: string;
};
type BatchPayload =
  | { catalog: "vehicle_line"; rows: VehicleLineInput[] }
  | { catalog: "insurer"; rows: InsurerInput[] }
  | { catalog: "packaging"; rows: PackagingInput[] }
  | { catalog: "body_type"; rows: BodyTypeInput[] };
type ImportFailureCode =
  | "SOURCE_VALIDATION_FAILED"
  | "BATCH_APPLY_FAILED"
  | "VERIFICATION_FAILED"
  | "IMPORT_INTERRUPTED"
  | "INTERNAL_ERROR";
type ImportFailureMessage =
  | "The RNDC catalog source could not be validated"
  | "An RNDC catalog batch could not be applied"
  | "The RNDC catalog import could not be verified"
  | "The RNDC catalog import was interrupted"
  | "The RNDC catalog import failed";
type KeyClaim = {
  naturalKey: string;
  contentHash: string;
};
type CoverageCounts = {
  withReference: number;
  resolved: number;
  unresolved: number;
  missingReference: number;
};
type CoverageResult = CoverageCounts & {
  unresolvedReferences: string[];
};

const catalogFileLimits = {
  vehicle_line: { minimumNormalizedRows: 18_000, maximumNormalizedRows: 50_000, maximumBatches: 500 },
  insurer: { minimumNormalizedRows: 100, maximumNormalizedRows: 50_000, maximumBatches: 500 },
  packaging: { minimumNormalizedRows: 25, maximumNormalizedRows: 50_000, maximumBatches: 500 },
  body_type: { minimumNormalizedRows: 90, maximumNormalizedRows: 50_000, maximumBatches: 500 }
} satisfies Record<CatalogKind, { minimumNormalizedRows: number; maximumNormalizedRows: number; maximumBatches: number }>;

const failureMessages = {
  SOURCE_VALIDATION_FAILED: "The RNDC catalog source could not be validated",
  BATCH_APPLY_FAILED: "An RNDC catalog batch could not be applied",
  VERIFICATION_FAILED: "The RNDC catalog import could not be verified",
  IMPORT_INTERRUPTED: "The RNDC catalog import was interrupted",
  INTERNAL_ERROR: "The RNDC catalog import failed"
} satisfies Record<ImportFailureCode, ImportFailureMessage>;

const emptyOutcome = (): CatalogOutcome => ({
  batchesApplied: 0,
  inserted: 0,
  updated: 0,
  unchanged: 0,
  outdated: 0
});

export const beginImport = mutation({
  args: {
    ingestKey: v.string(),
    clientRunId: v.string(),
    files: importFilesValidator
  },
  returns: v.object({
    importRunId: v.id("rndcReferenceImportRuns"),
    status: importStatusValidator,
    replayed: v.boolean()
  }),
  handler: async (ctx, args) => {
    requireIngestKey(args.ingestKey);
    assertClientRunId(args.clientRunId);
    assertImportFiles(args.files);
    const existing = await ctx.db
      .query("rndcReferenceImportRuns")
      .withIndex("by_client_run_id", (q) => q.eq("clientRunId", args.clientRunId))
      .unique();
    if (existing) {
      if (!sameFiles(existing.files, args.files)) {
        throw conflict("The import run identifier is already bound to different files");
      }
      return { importRunId: existing._id, status: existing.status, replayed: true };
    }
    const now = Date.now();
    const importRunId = await ctx.db.insert("rndcReferenceImportRuns", {
      clientRunId: args.clientRunId,
      status: "running",
      files: args.files,
      totals: {
        vehicleLines: emptyOutcome(),
        insurers: emptyOutcome(),
        packages: emptyOutcome(),
        bodyTypes: emptyOutcome()
      },
      startedAt: now,
      updatedAt: now
    });
    return { importRunId, status: "running" as const, replayed: false };
  }
});

export const upsertBatch = mutation({
  args: {
    ingestKey: v.string(),
    importRunId: v.id("rndcReferenceImportRuns"),
    batchIndex: v.number(),
    batchHash: v.string(),
    payload: batchPayloadValidator
  },
  returns: v.object({
    receiptId: v.id("rndcReferenceImportBatches"),
    catalog: catalogKindValidator,
    batchIndex: v.number(),
    inserted: v.number(),
    updated: v.number(),
    unchanged: v.number(),
    outdated: v.number(),
    replayed: v.boolean()
  }),
  handler: async (ctx, args) => {
    requireIngestKey(args.ingestKey);
    assertNonNegativeInteger(args.batchIndex, "batch index");
    await assertBatch(args.payload, args.batchHash);
    const run = await ctx.db.get("rndcReferenceImportRuns", args.importRunId);
    if (!run) {
      throw notFound("Import run not found");
    }
    const file = fileForCatalog(run.files, args.payload.catalog);
    if (args.batchIndex >= file.batchCount) {
      throw invalidInput("Batch index exceeds the declared file batch count");
    }
    const existingReceipt = await ctx.db
      .query("rndcReferenceImportBatches")
      .withIndex("by_run_catalog_and_batch", (q) =>
        q.eq("importRunId", args.importRunId).eq("catalog", args.payload.catalog).eq("batchIndex", args.batchIndex)
      )
      .unique();
    if (existingReceipt) {
      if (existingReceipt.batchHash !== args.batchHash || existingReceipt.rowCount !== args.payload.rows.length) {
        throw conflict("The batch position is already bound to different content");
      }
      return {
        receiptId: existingReceipt._id,
        catalog: existingReceipt.catalog,
        batchIndex: existingReceipt.batchIndex,
        inserted: existingReceipt.inserted,
        updated: existingReceipt.updated,
        unchanged: existingReceipt.unchanged,
        outdated: existingReceipt.outdated,
        replayed: true
      };
    }
    if (run.status !== "running") {
      throw invalidState("Only a running import can accept new batches");
    }
    const now = Date.now();
    await reserveNaturalKeys(ctx, args.importRunId, args.payload, args.batchIndex, now);
    let outcome: BatchOutcome;
    if (args.payload.catalog === "vehicle_line") {
      outcome = await applyVehicleLines(ctx, args.importRunId, args.payload.rows, now);
    } else if (args.payload.catalog === "insurer") {
      outcome = await applyInsurers(ctx, args.importRunId, args.payload.rows, now);
    } else if (args.payload.catalog === "packaging") {
      outcome = await applyPackaging(ctx, args.importRunId, args.payload.rows, now);
    } else {
      outcome = await applyBodyTypes(ctx, args.importRunId, args.payload.rows, now);
    }
    const receiptId = await ctx.db.insert("rndcReferenceImportBatches", {
      importRunId: args.importRunId,
      catalog: args.payload.catalog,
      batchIndex: args.batchIndex,
      batchHash: args.batchHash,
      rowCount: args.payload.rows.length,
      ...outcome,
      createdAt: now
    });
    const totals = addBatchOutcome(run.totals, args.payload.catalog, outcome);
    await ctx.db.patch("rndcReferenceImportRuns", run._id, { totals, updatedAt: now });
    return {
      receiptId,
      catalog: args.payload.catalog,
      batchIndex: args.batchIndex,
      ...outcome,
      replayed: false
    };
  }
});

export const completeImport = mutation({
  args: {
    ingestKey: v.string(),
    importRunId: v.id("rndcReferenceImportRuns")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireIngestKey(args.ingestKey);
    const run = await ctx.db.get("rndcReferenceImportRuns", args.importRunId);
    if (!run) {
      throw notFound("Import run not found");
    }
    if (run.status === "failed") {
      throw invalidState("A failed import cannot be completed");
    }
    const digestState = catalogDigestState(run.files);
    if (run.status === "completed" && digestState === "missing") {
      if (!run.certification || !sameTotals(run.certification.totals, run.totals)) {
        throw invalidState("The legacy completed import has invalid server certification");
      }
      return null;
    }
    if (digestState === "partial") {
      throw invalidState("Import catalog digests are incomplete");
    }
    assertImportFiles(run.files);
    const certifiedTotals = await totalsFromBatchReceipts(ctx, run);
    assertImportComplete(run, certifiedTotals);
    if (run.status === "completed") {
      if (!run.certification || !sameTotals(run.certification.totals, certifiedTotals)) throw invalidState("The completed import has invalid server certification");
      return null;
    }
    const now = Date.now();
    await ctx.db.patch("rndcReferenceImportRuns", run._id, {
      status: "completed",
      certification: { totals: certifiedTotals, certifiedAt: now },
      updatedAt: now,
      finishedAt: now
    });
    return null;
  }
});

export const failImport = mutation({
  args: {
    ingestKey: v.string(),
    importRunId: v.id("rndcReferenceImportRuns"),
    failureCode: failureCodeValidator
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireIngestKey(args.ingestKey);
    const failureMessage = failureMessages[args.failureCode];
    const run = await ctx.db.get("rndcReferenceImportRuns", args.importRunId);
    if (!run) {
      throw notFound("Import run not found");
    }
    if (run.status === "completed") {
      throw invalidState("A completed import cannot be failed");
    }
    if (run.status === "failed") {
      if (run.failureCode !== args.failureCode || run.failureMessage !== failureMessage) {
        throw conflict("The import was already failed with a different reason");
      }
      return null;
    }
    const now = Date.now();
    await ctx.db.patch("rndcReferenceImportRuns", run._id, {
      status: "failed",
      failureCode: args.failureCode,
      failureMessage,
      updatedAt: now,
      finishedAt: now
    });
    return null;
  }
});

export const getImport = query({
  args: {
    ingestKey: v.string(),
    importRunId: v.id("rndcReferenceImportRuns")
  },
  returns: v.union(importRunValidator, v.null()),
  handler: async (ctx, args) => {
    requireIngestKey(args.ingestKey);
    return await ctx.db.get("rndcReferenceImportRuns", args.importRunId);
  }
});

export const catalogVerificationPage = query({
  args: {
    ingestKey: v.string(),
    catalog: catalogKindValidator,
    cursor: v.union(v.string(), v.null()),
    limit: v.number()
  },
  returns: v.object({
    items: v.array(pageItemValidator),
    nextCursor: v.union(v.string(), v.null()),
    done: v.boolean()
  }),
  handler: async (ctx, args) => {
    requireIngestKey(args.ingestKey);
    const limit = boundedLimit(args.limit, 200);
    if (args.catalog === "vehicle_line") {
      const result = await ctx.db.query("rndcVehicleLines").withIndex("by_make_and_line").paginate({ cursor: args.cursor, numItems: limit });
      return pageResult(result, (row) => ({
        catalog: "vehicle_line" as const,
        key: row.makeCode,
        secondaryKey: row.lineCode,
        label: row.lineName ?? row.makeName,
        sourceRegisteredAt: row.sourceRegisteredAt,
        contentHash: row.contentHash,
        sourceImportRunId: row.sourceImportRunId
      }));
    }
    if (args.catalog === "insurer") {
      const result = await ctx.db.query("rndcInsurers").withIndex("by_nit").paginate({ cursor: args.cursor, numItems: limit });
      return pageResult(result, (row) => ({
        catalog: "insurer" as const,
        key: row.insurerNit,
        label: row.name,
        sourceRegisteredAt: row.sourceRegisteredAt,
        contentHash: row.contentHash,
        sourceImportRunId: row.sourceImportRunId
      }));
    }
    if (args.catalog === "packaging") {
      const result = await ctx.db.query("rndcPackaging").withIndex("by_code").paginate({ cursor: args.cursor, numItems: limit });
      return pageResult(result, (row) => ({
        catalog: "packaging" as const,
        key: row.code,
        label: row.description,
        sourceRegisteredAt: row.sourceRegisteredAt,
        contentHash: row.contentHash,
        sourceImportRunId: row.sourceImportRunId
      }));
    }
    const result = await ctx.db.query("rndcBodyTypes").withIndex("by_code").paginate({ cursor: args.cursor, numItems: limit });
    return pageResult(result, (row) => ({
      catalog: "body_type" as const,
      key: row.code,
      label: row.description,
      sourceRegisteredAt: row.sourceRegisteredAt,
      contentHash: row.contentHash,
      sourceImportRunId: row.sourceImportRunId
    }));
  }
});

export const vehicleLineByCode = query({
  args: { actorToken: v.optional(v.string()), makeCode: v.string(), lineCode: v.string() },
  returns: v.union(vehicleLineValidator, v.null()),
  handler: async (ctx, args) => {
    await requireActor(ctx, args.actorToken);
    const makeCode = normalizedRequired(args.makeCode, "make code", 80);
    const lineCode = normalizedRequired(args.lineCode, "line code", 80);
    return await ctx.db.query("rndcVehicleLines").withIndex("by_make_and_line", (q) => q.eq("makeCode", makeCode).eq("lineCode", lineCode)).unique();
  }
});

export const insurerByNit = query({
  args: { actorToken: v.optional(v.string()), insurerNit: v.string() },
  returns: v.union(insurerValidator, v.null()),
  handler: async (ctx, args) => {
    await requireActor(ctx, args.actorToken);
    const insurerNit = normalizedRequired(args.insurerNit, "insurer NIT", 80);
    return await ctx.db.query("rndcInsurers").withIndex("by_nit", (q) => q.eq("insurerNit", insurerNit)).unique();
  }
});

export const packagingByCode = query({
  args: { actorToken: v.optional(v.string()), code: v.string() },
  returns: v.union(packagingValidator, v.null()),
  handler: async (ctx, args) => {
    await requireActor(ctx, args.actorToken);
    const code = normalizedRequired(args.code, "packaging code", 80);
    return await ctx.db.query("rndcPackaging").withIndex("by_code", (q) => q.eq("code", code)).unique();
  }
});

export const bodyTypeByCode = query({
  args: { actorToken: v.optional(v.string()), code: v.string() },
  returns: v.union(bodyTypeValidator, v.null()),
  handler: async (ctx, args) => {
    await requireActor(ctx, args.actorToken);
    const code = normalizedRequired(args.code, "body type code", 80);
    return await ctx.db.query("rndcBodyTypes").withIndex("by_code", (q) => q.eq("code", code)).unique();
  }
});

export const vehicleRelationshipCoveragePage = query({
  args: {
    ingestKey: v.string(),
    cursor: v.union(v.string(), v.null()),
    limit: v.number()
  },
  returns: v.object({
    vehiclesScanned: v.number(),
    vehicleLines: coverageResultValidator,
    bodyTypes: coverageResultValidator,
    insurers: coverageResultValidator,
    nextCursor: v.union(v.string(), v.null()),
    done: v.boolean()
  }),
  handler: async (ctx, args) => {
    requireIngestKey(args.ingestKey);
    const limit = boundedLimit(args.limit, 50);
    const page = await ctx.db.query("vehicles").withIndex("by_plate").paginate({ cursor: args.cursor, numItems: limit });
    const resolutions = await Promise.all(page.page.map(async (vehicle) => resolveVehicleReferences(ctx, vehicle)));
    const vehicleLines = emptyCoverageResult();
    const bodyTypes = emptyCoverageResult();
    const insurers = emptyCoverageResult();
    for (const resolution of resolutions) {
      addCoverage(vehicleLines, resolution.vehicleLine);
      addCoverage(bodyTypes, resolution.bodyType);
      addCoverage(insurers, resolution.insurer);
    }
    return {
      vehiclesScanned: page.page.length,
      vehicleLines,
      bodyTypes,
      insurers,
      nextCursor: page.isDone ? null : page.continueCursor,
      done: page.isDone
    };
  }
});

async function applyVehicleLines(ctx: MutationCtx, importRunId: Id<"rndcReferenceImportRuns">, rows: VehicleLineInput[], now: number): Promise<BatchOutcome> {
  const outcome = batchOutcome();
  for (const row of rows) {
    const existing = await ctx.db.query("rndcVehicleLines").withIndex("by_make_and_line", (q) => q.eq("makeCode", row.makeCode).eq("lineCode", row.lineCode)).unique();
    const decision = decideRndcCatalogWrite(
      existing ? { sourceRegisteredAt: existing.sourceRegisteredAt, payload: vehicleLinePayload(existing) } : null,
      { sourceRegisteredAt: row.sourceRegisteredAt, payload: vehicleLinePayload(row) }
    );
    if (decision === "conflict") throw catalogConflict("vehicle line", `${row.makeCode}:${row.lineCode}`);
    if (decision === "insert") {
      await ctx.db.insert("rndcVehicleLines", { ...row, sourceImportRunId: importRunId, createdAt: now, updatedAt: now });
    } else if (decision === "update" && existing) {
      await ctx.db.replace("rndcVehicleLines", existing._id, { ...row, sourceImportRunId: importRunId, createdAt: existing.createdAt, updatedAt: now });
    }
    recordDecision(outcome, decision);
  }
  return outcome;
}

async function applyInsurers(ctx: MutationCtx, importRunId: Id<"rndcReferenceImportRuns">, rows: InsurerInput[], now: number): Promise<BatchOutcome> {
  const outcome = batchOutcome();
  for (const row of rows) {
    const existing = await ctx.db.query("rndcInsurers").withIndex("by_nit", (q) => q.eq("insurerNit", row.insurerNit)).unique();
    const decision = decideRndcCatalogWrite(
      existing ? { sourceRegisteredAt: existing.sourceRegisteredAt, payload: insurerPayload(existing) } : null,
      { sourceRegisteredAt: row.sourceRegisteredAt, payload: insurerPayload(row) }
    );
    if (decision === "conflict") throw catalogConflict("insurer", row.insurerNit);
    if (decision === "insert") {
      await ctx.db.insert("rndcInsurers", { ...row, sourceImportRunId: importRunId, createdAt: now, updatedAt: now });
    } else if (decision === "update" && existing) {
      await ctx.db.replace("rndcInsurers", existing._id, { ...row, sourceImportRunId: importRunId, createdAt: existing.createdAt, updatedAt: now });
    }
    recordDecision(outcome, decision);
  }
  return outcome;
}

async function applyPackaging(ctx: MutationCtx, importRunId: Id<"rndcReferenceImportRuns">, rows: PackagingInput[], now: number): Promise<BatchOutcome> {
  const outcome = batchOutcome();
  for (const row of rows) {
    const existing = await ctx.db.query("rndcPackaging").withIndex("by_code", (q) => q.eq("code", row.code)).unique();
    const decision = decideRndcCatalogWrite(
      existing ? { sourceRegisteredAt: existing.sourceRegisteredAt, payload: packagingPayload(existing) } : null,
      { sourceRegisteredAt: row.sourceRegisteredAt, payload: packagingPayload(row) }
    );
    if (decision === "conflict") throw catalogConflict("packaging", row.code);
    if (decision === "insert") {
      await ctx.db.insert("rndcPackaging", { ...row, sourceImportRunId: importRunId, createdAt: now, updatedAt: now });
    } else if (decision === "update" && existing) {
      await ctx.db.replace("rndcPackaging", existing._id, { ...row, sourceImportRunId: importRunId, createdAt: existing.createdAt, updatedAt: now });
    }
    recordDecision(outcome, decision);
  }
  return outcome;
}

async function applyBodyTypes(ctx: MutationCtx, importRunId: Id<"rndcReferenceImportRuns">, rows: BodyTypeInput[], now: number): Promise<BatchOutcome> {
  const outcome = batchOutcome();
  for (const row of rows) {
    const existing = await ctx.db.query("rndcBodyTypes").withIndex("by_code", (q) => q.eq("code", row.code)).unique();
    const decision = decideRndcCatalogWrite(
      existing ? { sourceRegisteredAt: existing.sourceRegisteredAt, payload: bodyTypePayload(existing) } : null,
      { sourceRegisteredAt: row.sourceRegisteredAt, payload: bodyTypePayload(row) }
    );
    if (decision === "conflict") throw catalogConflict("body type", row.code);
    if (decision === "insert") {
      await ctx.db.insert("rndcBodyTypes", { ...row, sourceImportRunId: importRunId, createdAt: now, updatedAt: now });
    } else if (decision === "update" && existing) {
      await ctx.db.replace("rndcBodyTypes", existing._id, { ...row, sourceImportRunId: importRunId, createdAt: existing.createdAt, updatedAt: now });
    }
    recordDecision(outcome, decision);
  }
  return outcome;
}

function vehicleLinePayload(row: Pick<VehicleLineInput, "makeCode" | "makeName" | "lineCode" | "lineName" | "grossWeightKg">): RndcCatalogPayload {
  return { makeCode: row.makeCode, makeName: row.makeName ?? null, lineCode: row.lineCode, lineName: row.lineName ?? null, grossWeightKg: row.grossWeightKg };
}

function insurerPayload(row: Pick<InsurerInput, "insurerNit" | "name" | "insurerType">): RndcCatalogPayload {
  return { insurerNit: row.insurerNit, name: row.name, insurerType: row.insurerType ?? null };
}

function packagingPayload(row: Pick<PackagingInput, "code" | "description" | "fullDescription" | "definition" | "minimumEmptyWeightKg" | "maximumEmptyWeightKg" | "hazardous" | "packageTypeCode" | "packageTypeName" | "materialCode" | "materialName" | "operationType">): RndcCatalogPayload {
  return {
    code: row.code,
    description: row.description,
    fullDescription: row.fullDescription,
    definition: row.definition,
    minimumEmptyWeightKg: row.minimumEmptyWeightKg,
    maximumEmptyWeightKg: row.maximumEmptyWeightKg,
    hazardous: row.hazardous ?? null,
    packageTypeCode: row.packageTypeCode ?? null,
    packageTypeName: row.packageTypeName ?? null,
    materialCode: row.materialCode ?? null,
    materialName: row.materialName ?? null,
    operationType: row.operationType
  };
}

function bodyTypePayload(row: Pick<BodyTypeInput, "code" | "description">): RndcCatalogPayload {
  return { code: row.code, description: row.description };
}

async function reserveNaturalKeys(
  ctx: MutationCtx,
  importRunId: Id<"rndcReferenceImportRuns">,
  payload: BatchPayload,
  batchIndex: number,
  now: number
): Promise<void> {
  const claims = keyClaims(payload);
  const existing = await Promise.all(
    claims.map((claim) =>
      ctx.db
        .query("rndcReferenceImportKeys")
        .withIndex("by_run_catalog_and_key", (q) =>
          q.eq("importRunId", importRunId).eq("catalog", payload.catalog).eq("naturalKey", claim.naturalKey)
        )
        .unique()
    )
  );
  const duplicateIndex = existing.findIndex((claim) => claim !== null);
  if (duplicateIndex >= 0) throw conflict(`Natural key already appeared in this import run: ${claims[duplicateIndex].naturalKey}`);
  await Promise.all(
    claims.map((claim) =>
      ctx.db.insert("rndcReferenceImportKeys", {
        importRunId,
        catalog: payload.catalog,
        naturalKey: claim.naturalKey,
        batchIndex,
        contentHash: claim.contentHash,
        createdAt: now
      })
    )
  );
}

async function assertBatch(payload: BatchPayload, batchHash: string): Promise<void> {
  assertHash(batchHash, "batch hash");
  if (payload.rows.length < 1 || payload.rows.length > MAX_BATCH_ROWS) {
    throw invalidInput(`A catalog batch must contain between 1 and ${MAX_BATCH_ROWS} rows`);
  }
  if (payload.catalog === "vehicle_line") {
    for (const row of payload.rows) assertVehicleLineRow(row);
  } else if (payload.catalog === "insurer") {
    for (const row of payload.rows) assertInsurerRow(row);
  } else if (payload.catalog === "packaging") {
    for (const row of payload.rows) assertPackagingRow(row);
  } else {
    for (const row of payload.rows) assertBodyTypeRow(row);
  }
  const claims = keyClaims(payload);
  const keys = new Set<string>();
  for (const claim of claims) {
    if (keys.has(claim.naturalKey)) throw conflict(`Duplicate natural key inside ${payload.catalog} batch: ${claim.naturalKey}`);
    keys.add(claim.naturalKey);
  }
  const canonicalRows = canonicalBatchRows(payload);
  await Promise.all(
    canonicalRows.map(async (row) => {
      const expectedContentHash = await sha256Hex(row.canonicalPayload);
      if (row.contentHash !== expectedContentHash) throw invalidInput("Row content hash does not match its canonical payload");
    })
  );
  const canonicalBatch = JSON.stringify([
    payload.catalog,
    canonicalRows.map((row) => [row.sourceRegisteredAt, row.canonicalPayload, row.contentHash])
  ]);
  const expectedBatchHash = await sha256Hex(canonicalBatch);
  if (batchHash !== expectedBatchHash) throw invalidInput("Batch hash does not match its canonical payload");
}

function assertVehicleLineRow(row: VehicleLineInput): void {
  assertHash(row.contentHash, "content hash");
  assertSourceRegisteredAt(row.sourceRegisteredAt);
  assertNormalizedRequired(row.makeCode, "make code", 80);
  assertNumericKey(row.makeCode, "make code");
  assertNormalizedOptional(row.makeName, "make name", 300);
  assertNormalizedRequired(row.lineCode, "line code", 80);
  assertNumericKey(row.lineCode, "line code");
  assertNormalizedOptional(row.lineName, "line name", 300);
  assertNonNegativeNumber(row.grossWeightKg, "gross weight");
}

function assertInsurerRow(row: InsurerInput): void {
  assertHash(row.contentHash, "content hash");
  assertSourceRegisteredAt(row.sourceRegisteredAt);
  assertNormalizedRequired(row.insurerNit, "insurer NIT", 80);
  assertNumericKey(row.insurerNit, "insurer NIT");
  assertNormalizedRequired(row.name, "insurer name", 300);
  assertNormalizedOptional(row.insurerType, "insurer type", 120);
}

function assertPackagingRow(row: PackagingInput): void {
  assertHash(row.contentHash, "content hash");
  assertSourceRegisteredAt(row.sourceRegisteredAt);
  assertNormalizedRequired(row.code, "packaging code", 80);
  if (!/^[A-Z0-9]+$/.test(row.code)) throw invalidInput("packaging code must contain uppercase letters and digits only");
  assertNormalizedRequired(row.description, "packaging description", 1000);
  assertNormalizedRequired(row.fullDescription, "packaging full description", 2000);
  assertNormalizedRequired(row.definition, "packaging definition", 2000);
  assertNonNegativeNumber(row.minimumEmptyWeightKg, "minimum empty weight");
  assertNonNegativeNumber(row.maximumEmptyWeightKg, "maximum empty weight");
  if (row.minimumEmptyWeightKg > row.maximumEmptyWeightKg) throw invalidInput("Minimum empty weight exceeds maximum empty weight");
  assertNormalizedOptional(row.packageTypeCode, "package type code", 80);
  assertNormalizedOptional(row.packageTypeName, "package type name", 300);
  assertNormalizedOptional(row.materialCode, "material code", 80);
  assertNormalizedOptional(row.materialName, "material name", 300);
  assertNormalizedRequired(row.operationType, "operation type", 120);
}

function assertBodyTypeRow(row: BodyTypeInput): void {
  assertHash(row.contentHash, "content hash");
  assertSourceRegisteredAt(row.sourceRegisteredAt);
  assertNormalizedRequired(row.code, "body type code", 80);
  assertNumericKey(row.code, "body type code");
  assertNormalizedRequired(row.description, "body type description", 500);
}

function keyClaims(payload: BatchPayload): KeyClaim[] {
  if (payload.catalog === "vehicle_line") {
    return payload.rows.map((row) => ({ naturalKey: JSON.stringify([row.makeCode, row.lineCode]), contentHash: row.contentHash }));
  }
  if (payload.catalog === "insurer") {
    return payload.rows.map((row) => ({ naturalKey: row.insurerNit, contentHash: row.contentHash }));
  }
  return payload.rows.map((row) => ({ naturalKey: row.code, contentHash: row.contentHash }));
}

function canonicalBatchRows(payload: BatchPayload): Array<{ sourceRegisteredAt: string; canonicalPayload: string; contentHash: string }> {
  if (payload.catalog === "vehicle_line") {
    return payload.rows.map((row) => ({
      sourceRegisteredAt: row.sourceRegisteredAt,
      canonicalPayload: canonicalizeRndcCatalogPayload(vehicleLinePayload(row)),
      contentHash: row.contentHash
    }));
  }
  if (payload.catalog === "insurer") {
    return payload.rows.map((row) => ({
      sourceRegisteredAt: row.sourceRegisteredAt,
      canonicalPayload: canonicalizeRndcCatalogPayload(insurerPayload(row)),
      contentHash: row.contentHash
    }));
  }
  if (payload.catalog === "packaging") {
    return payload.rows.map((row) => ({
      sourceRegisteredAt: row.sourceRegisteredAt,
      canonicalPayload: canonicalizeRndcCatalogPayload(packagingPayload(row)),
      contentHash: row.contentHash
    }));
  }
  return payload.rows.map((row) => ({
    sourceRegisteredAt: row.sourceRegisteredAt,
    canonicalPayload: canonicalizeRndcCatalogPayload(bodyTypePayload(row)),
    contentHash: row.contentHash
  }));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertImportFiles(files: ImportFiles): void {
  assertFileSummary(files.vehicleLines, "vehicle_line");
  assertFileSummary(files.insurers, "insurer");
  assertFileSummary(files.packages, "packaging");
  assertFileSummary(files.bodyTypes, "body_type");
}

function catalogDigestState(files: ImportFiles): "complete" | "missing" | "partial" {
  const digests = [
    files.vehicleLines.catalogDigest,
    files.insurers.catalogDigest,
    files.packages.catalogDigest,
    files.bodyTypes.catalogDigest
  ];
  const present = digests.filter((digest) => digest !== undefined).length;
  if (present === digests.length) return "complete";
  return present === 0 ? "missing" : "partial";
}

function assertFileSummary(file: FileSummary, catalog: CatalogKind): void {
  assertNormalizedRequired(file.fileName, "file name", 255);
  if (file.fileName.includes("/") || file.fileName.includes("\\")) throw invalidInput("Import summaries may store file names only");
  assertHash(file.sha256, "file hash");
  if (!file.catalogDigest) throw invalidInput("catalog digest is required");
  assertHash(file.catalogDigest, "catalog digest");
  assertNonNegativeInteger(file.rowsRead, "rows read");
  assertNonNegativeInteger(file.normalizedRows, "normalized rows");
  assertNonNegativeInteger(file.historicalRows, "historical rows");
  assertNonNegativeInteger(file.batchCount, "batch count");
  const limits = catalogFileLimits[catalog];
  if (file.normalizedRows < limits.minimumNormalizedRows) throw invalidInput(`${catalog} catalog is below its required global minimum`);
  if (file.normalizedRows > limits.maximumNormalizedRows) throw invalidInput(`${catalog} catalog exceeds its normalized row limit`);
  if (file.batchCount > limits.maximumBatches) throw invalidInput(`${catalog} catalog exceeds its batch limit`);
  if (file.rowsRead !== file.normalizedRows + file.historicalRows) throw invalidInput("File row totals are inconsistent");
  if ((file.normalizedRows === 0) !== (file.batchCount === 0)) throw invalidInput("File batch count is inconsistent with normalized rows");
  if (file.batchCount > file.normalizedRows) throw invalidInput("File batch count exceeds normalized rows");
  if (file.batchCount < Math.ceil(file.normalizedRows / MAX_BATCH_ROWS)) throw invalidInput("File batch count cannot contain all normalized rows");
}

async function totalsFromBatchReceipts(ctx: MutationCtx, run: Doc<"rndcReferenceImportRuns">): Promise<ImportTotals> {
  const [vehicleLines, insurers, packages, bodyTypes] = await Promise.all([
    catalogTotalsFromBatchReceipts(ctx, run._id, "vehicle_line", run.files.vehicleLines),
    catalogTotalsFromBatchReceipts(ctx, run._id, "insurer", run.files.insurers),
    catalogTotalsFromBatchReceipts(ctx, run._id, "packaging", run.files.packages),
    catalogTotalsFromBatchReceipts(ctx, run._id, "body_type", run.files.bodyTypes)
  ]);
  return { vehicleLines, insurers, packages, bodyTypes };
}

async function catalogTotalsFromBatchReceipts(
  ctx: MutationCtx,
  importRunId: Id<"rndcReferenceImportRuns">,
  catalog: CatalogKind,
  file: FileSummary
): Promise<CatalogOutcome> {
  const receipts = await ctx.db
    .query("rndcReferenceImportBatches")
    .withIndex("by_run_catalog_and_batch", (q) => q.eq("importRunId", importRunId).eq("catalog", catalog))
    .order("asc")
    .take(file.batchCount + 1);
  if (receipts.length !== file.batchCount) throw invalidState("Catalog batch receipts do not match the declared batch count");
  const totals = emptyOutcome();
  for (let index = 0; index < receipts.length; index += 1) {
    const receipt = receipts[index];
    if (receipt.batchIndex !== index) throw invalidState("Catalog batch receipt indexes are not complete and unique");
    if (!Number.isInteger(receipt.rowCount) || receipt.rowCount < 1 || receipt.rowCount > MAX_BATCH_ROWS) {
      throw invalidState("Catalog batch receipt row count is invalid");
    }
    const outcomeValues = [receipt.inserted, receipt.updated, receipt.unchanged, receipt.outdated];
    if (outcomeValues.some((value) => !Number.isInteger(value) || value < 0)) throw invalidState("Catalog batch receipt outcomes are invalid");
    if (outcomeValues.reduce((sum, value) => sum + value, 0) !== receipt.rowCount) {
      throw invalidState("Catalog batch receipt outcomes do not match its row count");
    }
    totals.batchesApplied += 1;
    totals.inserted += receipt.inserted;
    totals.updated += receipt.updated;
    totals.unchanged += receipt.unchanged;
    totals.outdated += receipt.outdated;
  }
  const normalizedRows = totals.inserted + totals.updated + totals.unchanged + totals.outdated;
  if (normalizedRows !== file.normalizedRows) throw invalidState("Catalog batch receipts do not match normalized rows");
  const digest = await sha256Hex(JSON.stringify([catalog, receipts.map((receipt) => receipt.batchHash)]));
  if (digest !== file.catalogDigest) throw invalidState("Catalog batch receipts do not match the declared catalog digest");
  return totals;
}

function assertImportComplete(run: Doc<"rndcReferenceImportRuns">, certifiedTotals: ImportTotals): void {
  if (!sameTotals(run.totals, certifiedTotals)) throw invalidState("Import totals do not match server batch receipts");
  const checks: Array<[FileSummary, CatalogOutcome]> = [
    [run.files.vehicleLines, certifiedTotals.vehicleLines],
    [run.files.insurers, certifiedTotals.insurers],
    [run.files.packages, certifiedTotals.packages],
    [run.files.bodyTypes, certifiedTotals.bodyTypes]
  ];
  for (const [file, total] of checks) {
    if (total.batchesApplied !== file.batchCount) throw invalidState("Not all declared catalog batches were applied");
    if (total.inserted + total.updated + total.unchanged + total.outdated !== file.normalizedRows) {
      throw invalidState("Catalog outcome totals do not match normalized rows");
    }
  }
}

function addBatchOutcome(totals: ImportTotals, catalog: CatalogKind, outcome: BatchOutcome): ImportTotals {
  const key = totalsKey(catalog);
  const current = totals[key];
  return {
    ...totals,
    [key]: {
      batchesApplied: current.batchesApplied + 1,
      inserted: current.inserted + outcome.inserted,
      updated: current.updated + outcome.updated,
      unchanged: current.unchanged + outcome.unchanged,
      outdated: current.outdated + outcome.outdated
    }
  };
}

function fileForCatalog(files: ImportFiles, catalog: CatalogKind): FileSummary {
  return files[totalsKey(catalog)];
}

function totalsKey(catalog: CatalogKind): keyof ImportTotals {
  if (catalog === "vehicle_line") return "vehicleLines";
  if (catalog === "insurer") return "insurers";
  if (catalog === "packaging") return "packages";
  return "bodyTypes";
}

function batchOutcome(): BatchOutcome {
  return { inserted: 0, updated: 0, unchanged: 0, outdated: 0 };
}

function recordDecision(outcome: BatchOutcome, decision: "insert" | "update" | "unchanged" | "outdated"): void {
  if (decision === "insert") outcome.inserted += 1;
  else if (decision === "update") outcome.updated += 1;
  else if (decision === "unchanged") outcome.unchanged += 1;
  else outcome.outdated += 1;
}

function sameFiles(left: ImportFiles, right: ImportFiles): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameTotals(left: ImportTotals, right: ImportTotals): boolean {
  return (
    sameCatalogOutcome(left.vehicleLines, right.vehicleLines) &&
    sameCatalogOutcome(left.insurers, right.insurers) &&
    sameCatalogOutcome(left.packages, right.packages) &&
    sameCatalogOutcome(left.bodyTypes, right.bodyTypes)
  );
}

function sameCatalogOutcome(left: CatalogOutcome, right: CatalogOutcome): boolean {
  return (
    left.batchesApplied === right.batchesApplied &&
    left.inserted === right.inserted &&
    left.updated === right.updated &&
    left.unchanged === right.unchanged &&
    left.outdated === right.outdated
  );
}

function pageResult<T, U>(result: { page: T[]; isDone: boolean; continueCursor: string }, map: (row: T) => U) {
  return { items: result.page.map(map), nextCursor: result.isDone ? null : result.continueCursor, done: result.isDone };
}

async function resolveVehicleReferences(ctx: QueryCtx, vehicle: Doc<"vehicles">) {
  const makeCode = cleanRndcReference(vehicle.rndcMakeCode);
  const lineCode = cleanRndcReference(vehicle.line);
  const bodyTypeCode = cleanRndcReference(vehicle.rndcBodyTypeCode);
  const insurerNit = cleanRndcReference(vehicle.insurerNit);
  const [vehicleLine, bodyType, insurer] = await Promise.all([
    makeCode && lineCode
      ? ctx.db.query("rndcVehicleLines").withIndex("by_make_and_line", (q) => q.eq("makeCode", makeCode).eq("lineCode", lineCode)).unique()
      : null,
    bodyTypeCode
      ? ctx.db.query("rndcBodyTypes").withIndex("by_code", (q) => q.eq("code", bodyTypeCode)).unique()
      : null,
    insurerNit
      ? ctx.db.query("rndcInsurers").withIndex("by_nit", (q) => q.eq("insurerNit", insurerNit)).unique()
      : null
  ]);
  return {
    vehicleLine: makeCode && lineCode ? { reference: `${makeCode}:${lineCode}`, resolved: vehicleLine !== null } : null,
    bodyType: bodyTypeCode ? { reference: bodyTypeCode, resolved: bodyType !== null } : null,
    insurer: insurerNit ? { reference: insurerNit, resolved: insurer !== null } : null
  };
}

function emptyCoverageResult(): CoverageResult {
  return { withReference: 0, resolved: 0, unresolved: 0, missingReference: 0, unresolvedReferences: [] };
}

function addCoverage(target: CoverageResult, resolution: { reference: string; resolved: boolean } | null): void {
  if (!resolution) {
    target.missingReference += 1;
    return;
  }
  target.withReference += 1;
  if (resolution.resolved) {
    target.resolved += 1;
    return;
  }
  target.unresolved += 1;
  target.unresolvedReferences.push(resolution.reference);
}

function boundedLimit(value: number, maximum: number): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw invalidInput(`Page limit must be between 1 and ${maximum}`);
  return value;
}

function assertClientRunId(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw invalidInput("Client run identifier must be a UUID");
}

function assertHash(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw invalidInput(`${label} must be a lowercase SHA-256 value`);
}

function assertSourceRegisteredAt(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw invalidInput("Source registration date must use YYYY-MM-DDTHH:mm:ss");
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    throw invalidInput("Source registration date is invalid");
  }
}

function assertNormalizedRequired(value: string, label: string, maximumLength: number): void {
  normalizedRequired(value, label, maximumLength);
  if (value !== normalizeText(value)) throw invalidInput(`${label} is not normalized`);
}

function assertNormalizedOptional(value: string | undefined, label: string, maximumLength: number): void {
  if (value === undefined) return;
  assertNormalizedRequired(value, label, maximumLength);
}

function assertNumericKey(value: string, label: string): void {
  if (!/^\d+$/.test(value)) throw invalidInput(`${label} must contain digits only`);
}

function normalizedRequired(value: string, label: string, maximumLength: number): string {
  const normalized = normalizeText(value);
  if (!normalized) throw invalidInput(`${label} is required`);
  if (normalized.length > maximumLength) throw invalidInput(`${label} exceeds ${maximumLength} characters`);
  return normalized;
}

function normalizeText(value: string): string {
  return value.trim().replace(/[\s\u00a0]+/g, " ");
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) throw invalidInput(`${label} must be a non-negative integer`);
}

function assertNonNegativeNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw invalidInput(`${label} must be a non-negative number`);
}

function requireIngestKey(value: string): void {
  const expected = process.env.RNDC_INGEST_KEY;
  const enabled = process.env.RNDC_REFERENCE_CATALOG_IMPORT_ENABLED === "development-only";
  if (!enabled || !expected || value !== expected) throw new ConvexError({ code: "UNAUTHORIZED", message: "Invalid ingest key" });
}

function catalogConflict(label: string, key: string) {
  return new ConvexError({ code: "CATALOG_CONFLICT", message: `Conflicting ${label} for natural key ${key}` });
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

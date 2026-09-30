import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireActor } from "./model/access";
import {
  catalogKindValidator,
  importStatusValidator,
  failureCodeValidator,
  importFilesValidator,
  batchPayloadValidator,
  importRunValidator,
  packagingValidator,
  pageItemValidator,
  coverageResultValidator,
  failureMessages,
  emptyOutcome,
  applyVehicleLines,
  applyInsurers,
  applyPackaging,
  applyBodyTypes,
  reserveNaturalKeys,
  assertBatch,
  assertImportFiles,
  catalogDigestState,
  totalsFromBatchReceipts,
  assertImportComplete,
  addBatchOutcome,
  fileForCatalog,
  sameFiles,
  sameTotals,
  pageResult,
  resolveVehicleReferences,
  emptyCoverageResult,
  addCoverage,
  boundedLimit,
  assertClientRunId,
  normalizedRequired,
  assertNonNegativeInteger,
  requireIngestKey,
  invalidInput,
  invalidState,
  conflict,
  notFound
} from "./model/rndcReferenceCatalogRecords";
import type { BatchOutcome } from "./model/rndcReferenceCatalogRecords";

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

export const packagingByCode = query({
  args: { actorToken: v.optional(v.string()), code: v.string() },
  returns: v.union(packagingValidator, v.null()),
  handler: async (ctx, args) => {
    await requireActor(ctx, args.actorToken);
    const code = normalizedRequired(args.code, "packaging code", 80);
    return await ctx.db.query("rndcPackaging").withIndex("by_code", (q) => q.eq("code", code)).unique();
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

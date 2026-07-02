import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

const documentStatusValidator = v.union(
  v.literal("draft"),
  v.literal("pending"),
  v.literal("sent"),
  v.literal("authorized"),
  v.literal("rejected"),
  v.literal("fulfilled"),
  v.literal("annulled")
);

const documentKindValidator = v.union(
  v.literal("orden_cargue"),
  v.literal("remesa"),
  v.literal("manifiesto"),
  v.literal("cumplido"),
  v.literal("anulacion")
);

const documentRowValidator = v.object({
  _id: v.id("documents"),
  _creationTime: v.number(),
  kind: documentKindValidator,
  status: documentStatusValidator,
  number: v.optional(v.string()),
  rndcRadicado: v.optional(v.string()),
  mode: v.optional(v.union(v.literal("dry-run"), v.literal("live"))),
  pdfUrlPath: v.optional(v.string()),
  errorText: v.optional(v.string()),
  updatedAt: v.number(),
  trip: v.union(
    v.object({
      _id: v.id("trips"),
      code: v.string(),
      status: v.string(),
      originCity: v.optional(v.string()),
      destinationCity: v.optional(v.string()),
      vehiclePlate: v.optional(v.string()),
      driverName: v.optional(v.string())
    }),
    v.null()
  )
});

export const overview = query({
  args: {},
  returns: v.object({
    totalDocuments: v.number(),
    totalTrips: v.number(),
    authorized: v.number(),
    rejected: v.number(),
    fulfilled: v.number(),
    annulled: v.number(),
    inProgress: v.number(),
    lastActivity: v.union(v.number(), v.null())
  }),
  handler: async (ctx) => {
    const documents = await ctx.db.query("documents").order("desc").take(1000);
    const trips = await ctx.db.query("trips").order("desc").take(1000);

    const countByStatus = (status: Doc<"documents">["status"]) =>
      documents.filter((document) => document.status === status).length;

    return {
      totalDocuments: documents.length,
      totalTrips: trips.length,
      authorized: countByStatus("authorized"),
      rejected: countByStatus("rejected"),
      fulfilled: countByStatus("fulfilled"),
      annulled: countByStatus("annulled"),
      inProgress: countByStatus("draft") + countByStatus("pending") + countByStatus("sent"),
      lastActivity: documents[0]?.updatedAt ?? null
    };
  }
});

export const recentDocuments = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(documentRowValidator),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 15, 1), 50);
    const documents = await ctx.db.query("documents").order("desc").take(limit);
    return await Promise.all(documents.map((document) => toDocumentRow(ctx, document)));
  }
});

export const documentsPage = query({
  args: {
    paginationOpts: paginationOptsValidator,
    kind: v.optional(documentKindValidator),
    status: v.optional(documentStatusValidator)
  },
  returns: v.object({
    page: v.array(documentRowValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null()))
  }),
  handler: async (ctx, args) => {
    const { paginationOpts, kind, status } = args;
    const results = await buildDocumentsQuery(ctx, kind, status).paginate(paginationOpts);
    const page = await Promise.all(results.page.map((document) => toDocumentRow(ctx, document)));
    return { ...results, page };
  }
});

function buildDocumentsQuery(ctx: QueryCtx, kind: Doc<"documents">["kind"] | undefined, status: Doc<"documents">["status"] | undefined) {
  if (kind && status) {
    return ctx.db
      .query("documents")
      .withIndex("by_kind_and_status", (q) => q.eq("kind", kind).eq("status", status))
      .order("desc");
  }

  if (status) {
    return ctx.db
      .query("documents")
      .withIndex("by_status", (q) => q.eq("status", status))
      .order("desc");
  }

  if (kind) {
    return ctx.db
      .query("documents")
      .withIndex("by_kind", (q) => q.eq("kind", kind))
      .order("desc");
  }

  return ctx.db.query("documents").order("desc");
}

async function toDocumentRow(ctx: QueryCtx, document: Doc<"documents">) {
  const trip = await ctx.db.get(document.tripId as Id<"trips">);

  return {
    _id: document._id,
    _creationTime: document._creationTime,
    kind: document.kind,
    status: document.status,
    number: document.number,
    rndcRadicado: document.rndcRadicado,
    mode: document.mode,
    pdfUrlPath: document.pdfUrlPath,
    errorText: document.errorText,
    updatedAt: document.updatedAt,
    trip: trip
      ? {
          _id: trip._id,
          code: trip.code,
          status: trip.status,
          originCity: trip.originCity,
          destinationCity: trip.destinationCity,
          vehiclePlate: trip.vehiclePlate,
          driverName: trip.driverName
        }
      : null
  };
}

import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const peekAll = query({
  args: {},
  returns: v.array(v.object({ documentType: v.string(), lastValue: v.number() })),
  handler: async (ctx) => {
    const rows = await ctx.db.query("counters").collect();
    return rows.map((row) => ({ documentType: row.documentType, lastValue: row.lastValue }));
  }
});

export const next = mutation({
  args: { documentType: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("counters")
      .withIndex("by_document_type", (q) => q.eq("documentType", args.documentType))
      .unique();

    if (!row) {
      throw new ConvexError(`Contador sin sembrar: ${args.documentType}`);
    }

    const value = row.lastValue + 1;
    await ctx.db.patch(row._id, { lastValue: value, updatedAt: Date.now() });
    return value;
  }
});

export const ensureAtLeast = mutation({
  args: { documentType: v.string(), value: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("counters")
      .withIndex("by_document_type", (q) => q.eq("documentType", args.documentType))
      .unique();

    if (!row) {
      await ctx.db.insert("counters", { documentType: args.documentType, lastValue: args.value, updatedAt: Date.now() });
      return null;
    }

    if (args.value > row.lastValue) {
      await ctx.db.patch(row._id, { lastValue: args.value, updatedAt: Date.now() });
    }

    return null;
  }
});

export const seed = mutation({
  args: { documentType: v.string(), lastValue: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("counters")
      .withIndex("by_document_type", (q) => q.eq("documentType", args.documentType))
      .unique();

    if (row) {
      await ctx.db.patch(row._id, { lastValue: args.lastValue, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("counters", { documentType: args.documentType, lastValue: args.lastValue, updatedAt: Date.now() });
    }

    return null;
  }
});

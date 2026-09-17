import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const listCoordinates = internalQuery({
  args: { municipalitiesOnly: v.optional(v.boolean()) },
  returns: v.array(
    v.object({
      code: v.string(),
      municipalityCode: v.string(),
      name: v.string(),
      department: v.string(),
      isMunicipality: v.boolean(),
      latitude: v.optional(v.string()),
      longitude: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const rows =
      args.municipalitiesOnly === false
        ? await ctx.db.query("rndcDivisions").withIndex("by_is_municipality", (q) => q.eq("isMunicipality", false)).collect()
        : await ctx.db.query("rndcDivisions").withIndex("by_is_municipality", (q) => q.eq("isMunicipality", true)).collect();
    return rows.map((row) => ({
      code: row.code,
      municipalityCode: row.municipalityCode,
      name: row.name,
      department: row.departmentName,
      isMunicipality: row.isMunicipality,
      latitude: row.latitude,
      longitude: row.longitude,
    }));
  },
});

export const applyCoordinateFixes = internalMutation({
  args: { fixes: v.array(v.object({ code: v.string(), latitude: v.string(), longitude: v.string() })) },
  returns: v.object({ updated: v.number(), missing: v.array(v.string()) }),
  handler: async (ctx, args) => {
    let updated = 0;
    const missing: string[] = [];
    for (const fix of args.fixes) {
      const row = await ctx.db.query("rndcDivisions").withIndex("by_code", (q) => q.eq("code", fix.code)).unique();
      if (!row) {
        missing.push(fix.code);
        continue;
      }
      await ctx.db.patch("rndcDivisions", row._id, { latitude: fix.latitude, longitude: fix.longitude, updatedAt: Date.now() });
      updated++;
    }
    return { updated, missing };
  },
});

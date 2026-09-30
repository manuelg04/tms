import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  appendAudit,
  requireActor,
  requireSameOrganization,
  requireServiceKey,
} from "./model/access";
import {
  mirrorProcess,
  mirrorRecord,
  mirrorRecordDoc,
  mirrorRunDoc,
} from "./model/mirrorValidators";

const readers = ["admin", "operator", "auditor"] as const;
function numberKey(value: string) {
  return /^\d+$/.test(value) ? value.replace(/^0+(?=\d)/, "") : value.trim();
}
export const forDispatch = query({
  args: { dispatchId: v.id("trackingDispatches") },
  returns: v.array(mirrorRecordDoc),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...readers]),
      dispatch = await ctx.db.get("trackingDispatches", args.dispatchId);
    if (!dispatch) throw new ConvexError("Despacho no disponible.");
    requireSameOrganization(actor, dispatch.organizationId);
    const manifest = numberKey(dispatch.summary.manifest);
    return manifest
      ? await ctx.db
          .query("rndcMirrorRecords")
          .withIndex("by_org_manifest", (q) =>
            q
              .eq("organizationId", actor.organizationId)
              .eq("manifest", manifest),
          )
          .collect()
      : [];
  },
});
export const openTracking = mutation({
  args: { recordId: v.id("rndcMirrorRecords"), dispatchCode: v.string() },
  returns: v.id("trackingDispatches"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, ["admin", "operator"]),
      record = await ctx.db.get("rndcMirrorRecords", args.recordId);
    if (!record || record.process !== 4)
      throw new ConvexError("Selecciona un manifiesto consultado.");
    requireSameOrganization(actor, record.organizationId);
    const code = args.dispatchCode.trim();
    if (!code || code.length > 80)
      throw new ConvexError(
        "Indica un código de despacho de hasta 80 caracteres.",
      );
    const existing = await ctx.db
      .query("trackingDispatches")
      .withIndex("by_org_code", (q) =>
        q.eq("organizationId", actor.organizationId).eq("externalCode", code),
      )
      .unique();
    const sourceKey = `rndc:${record.companyRndcNit}:4:${record.radicado}`;
    const linked = await ctx.db
      .query("trackingDispatches")
      .withIndex("by_org_source", (q) =>
        q.eq("organizationId", actor.organizationId).eq("sourceKey", sourceKey),
      )
      .unique();
    if (linked) {
      if (linked.externalCode !== code)
        throw new ConvexError(
          `El manifiesto ya tiene seguimiento en el despacho ${linked.externalCode}.`,
        );
      return linked._id;
    }
    if (existing) {
      if (existing.sourceKey !== sourceKey)
        throw new ConvexError("Ese código ya identifica otro despacho.");
      return existing._id;
    }
    const id = await ctx.db.insert("trackingDispatches", {
      organizationId: actor.organizationId,
      externalCode: code,
      sourceKey,
      queue: "en_route",
      summary: {
        nem: record.radicado,
        manifest: record.fields.NUMMANIFIESTOCARGA ?? record.manifest,
        manifestType: "",
        origin: record.fields.CODMUNICIPIOORIGENMANIFIESTO ?? "",
        destination: record.fields.CODMUNICIPIODESTINOMANIFIESTO ?? "",
        plate: record.plate,
        cargo: "",
        affiliation: "",
        bodyType: "",
        departureDate: "",
        driver: record.fields.NUMIDCONDUCTOR ?? "",
        rating: "",
        customer: "",
        phone: "",
        lastReportedAt: "",
        lastCheckpoint: "",
        incident: "",
      },
      information: [
        { label: "Fuente", value: "RNDC" },
        { label: "Radicado manifiesto", value: record.radicado },
      ],
      observations: "",
      communications: "",
      protections: "",
      revision: 1,
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      organizationId: actor.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "rndc.mirror.tracking.opened",
      entityType: "trackingDispatches",
      entityId: id,
    });
    return id;
  },
});
export const scope = query({
  args: {},
  returns: v.id("organizations"),
  handler: async (ctx) =>
    (await requireActor(ctx, undefined, ["admin", "operator"])).organizationId,
});
export const uploadEvidence = mutation({
  args: { serviceKey: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    await requireActor(ctx, undefined, ["admin", "operator"]);
    return await ctx.storage.generateUploadUrl();
  },
});
export const startRun = mutation({
  args: {
    serviceKey: v.string(),
    companyRndcNit: v.string(),
    process: mirrorProcess,
    from: v.string(),
    to: v.string(),
    externalId: v.string(),
    startedAt: v.string(),
    finishedAt: v.string(),
    evidenceId: v.id("_storage"),
  },
  returns: v.id("rndcMirrorRuns"),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    const actor = await requireActor(ctx, undefined, ["admin", "operator"]);
    if (
      !/^\d{8,12}$/.test(args.companyRndcNit) ||
      !Number.isFinite(Date.parse(args.startedAt)) ||
      !Number.isFinite(Date.parse(args.finishedAt)) ||
      Date.parse(args.startedAt) > Date.parse(args.finishedAt) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(args.from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(args.to) ||
      args.from > args.to
    )
      throw new ConvexError("Identidad o fechas del espejo inválidas.");
    const existing = await ctx.db
      .query("rndcMirrorRuns")
      .withIndex("by_org_external", (q) =>
        q
          .eq("organizationId", actor.organizationId)
          .eq("externalId", args.externalId),
      )
      .unique();
    if (existing) {
      if (
        existing.process !== args.process ||
        existing.companyRndcNit !== args.companyRndcNit ||
        existing.from !== args.from ||
        existing.to !== args.to
      )
        throw new ConvexError("Identidad de consulta reutilizada.");
      return existing._id;
    }
    const { serviceKey, ...data } = args;
    return await ctx.db.insert("rndcMirrorRuns", {
      ...data,
      organizationId: actor.organizationId,
      createdAt: Date.now(),
      completed: false,
      count: 0,
    });
  },
});
export const ingest = mutation({
  args: {
    serviceKey: v.string(),
    runId: v.id("rndcMirrorRuns"),
    records: v.array(mirrorRecord),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    const actor = await requireActor(ctx, undefined, ["admin", "operator"]),
      run = await ctx.db.get("rndcMirrorRuns", args.runId);
    if (!run) throw new ConvexError("Consulta no disponible.");
    requireSameOrganization(actor, run.organizationId);
    if (args.records.length > 200)
      throw new ConvexError("El lote excede 200 registros.");
    if (run.completed) throw new ConvexError("La consulta ya está cerrada.");
    for (const record of args.records) {
      if (
        !record.radicado ||
        record.fields.INGRESOID !== record.radicado ||
        record.date < run.from ||
        record.date > run.to
      )
        throw new ConvexError("Registro fuera del alcance de la consulta.");
      const existing = await ctx.db
        .query("rndcMirrorPending")
        .withIndex("by_run_id", (q) =>
          q.eq("runId", run._id).eq("radicado", record.radicado),
        )
        .unique();
      if (existing && existing.companyRndcNit !== run.companyRndcNit)
        throw new ConvexError("El radicado pertenece a otra empresa RNDC.");
      const data = {
        ...record,
        organizationId: actor.organizationId,
        companyRndcNit: run.companyRndcNit,
        process: run.process,
        runId: run._id,
        queriedAt: Date.parse(run.finishedAt),
      };
      if (existing) {
        await ctx.db.replace("rndcMirrorPending", existing._id, data);
      } else await ctx.db.insert("rndcMirrorPending", data);
    }
    return null;
  },
});
export const finishRun = mutation({
  args: {
    serviceKey: v.string(),
    runId: v.id("rndcMirrorRuns"),
    count: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    const actor = await requireActor(ctx, undefined, ["admin", "operator"]),
      run = await ctx.db.get("rndcMirrorRuns", args.runId);
    if (!run) throw new ConvexError("Consulta no disponible.");
    requireSameOrganization(actor, run.organizationId);
    if (run.completed) return null;
    const pending = await ctx.db
      .query("rndcMirrorPending")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .collect();
    if (
      !Number.isSafeInteger(args.count) ||
      args.count < 0 ||
      args.count > 2000 ||
      pending.length !== args.count
    )
      throw new ConvexError(
        "El lote no está completo. Reduce el período si supera 2000 registros.",
      );
    for (const entry of pending) {
      const { _id, _creationTime, ...data } = entry;
      const existing = await ctx.db
        .query("rndcMirrorRecords")
        .withIndex("by_org_process_id", (q) =>
          q
            .eq("organizationId", actor.organizationId)
            .eq("process", run.process)
            .eq("radicado", entry.radicado),
        )
        .unique();
      if (existing && existing.companyRndcNit !== run.companyRndcNit)
        throw new ConvexError("El radicado pertenece a otra empresa RNDC.");
      if (!existing) await ctx.db.insert("rndcMirrorRecords", data);
      else if (existing.queriedAt <= Date.parse(run.finishedAt))
        await ctx.db.replace("rndcMirrorRecords", existing._id, data);
      await ctx.db.delete("rndcMirrorPending", _id);
    }
    await ctx.db.patch("rndcMirrorRuns", run._id, {
      completed: true,
      count: args.count,
    });
    await appendAudit(ctx, {
      organizationId: actor.organizationId,
      actorType: "service",
      actorId: actor._id,
      action: "rndc.mirror.completed",
      entityType: "rndcMirrorRuns",
      entityId: run._id,
      detailsJson: JSON.stringify({
        process: run.process,
        from: run.from,
        to: run.to,
        count: args.count,
      }),
    });
    return null;
  },
});
export const list = query({
  args: {
    process: mirrorProcess,
    from: v.string(),
    to: v.string(),
    search: v.string(),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    records: v.array(mirrorRecordDoc),
    runs: v.array(mirrorRunDoc),
    canRefresh: v.boolean(),
    nextCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...readers]);
    const result = await ctx.db
      .query("rndcMirrorRecords")
      .withIndex("by_org_process_date", (q) =>
        q
          .eq("organizationId", actor.organizationId)
          .eq("process", args.process)
          .gte("date", args.from)
          .lte("date", args.to),
      )
      .order("desc")
      .paginate({ numItems: 100, cursor: args.cursor ?? null });
    const runs = await ctx.db
      .query("rndcMirrorRuns")
      .withIndex("by_org_date", (q) =>
        q.eq("organizationId", actor.organizationId),
      )
      .order("desc")
      .take(30);
    const needle = args.search.trim().toUpperCase();
    return {
      records: result.page.filter(
        (r) =>
          !needle ||
          [r.manifest, r.remesa, r.plate, r.radicado].some((f) =>
            f.toUpperCase().includes(needle),
          ),
      ),
      runs,
      canRefresh: actor.roles.some((r) => r === "admin" || r === "operator"),
      nextCursor: result.isDone ? null : result.continueCursor,
    };
  },
});
export const related = query({
  args: { recordId: v.id("rndcMirrorRecords") },
  returns: v.object({
    record: mirrorRecordDoc,
    manifestRecords: v.array(mirrorRecordDoc),
    remesaRecords: v.array(mirrorRecordDoc),
    evidenceUrl: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...readers]),
      record = await ctx.db.get("rndcMirrorRecords", args.recordId);
    if (!record) throw new ConvexError("Documento no disponible.");
    requireSameOrganization(actor, record.organizationId);
    const manifestRecords = record.manifest
      ? await ctx.db
          .query("rndcMirrorRecords")
          .withIndex("by_org_manifest", (q) =>
            q
              .eq("organizationId", actor.organizationId)
              .eq("manifest", record.manifest),
          )
          .collect()
      : [];
    const remesaRecords = record.remesa
      ? await ctx.db
          .query("rndcMirrorRecords")
          .withIndex("by_org_remesa", (q) =>
            q
              .eq("organizationId", actor.organizationId)
              .eq("remesa", record.remesa),
          )
          .collect()
      : [];
    const run = await ctx.db.get("rndcMirrorRuns", record.runId);
    return {
      record,
      manifestRecords,
      remesaRecords,
      evidenceUrl: run ? await ctx.storage.getUrl(run.evidenceId) : null,
    };
  },
});

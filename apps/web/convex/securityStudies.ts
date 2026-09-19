import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { appendAudit, requireActor } from "./model/access";
import { driverDossierDoc, securityCheckResult, securityStudyDoc, securityStudyStatus } from "./model/securityStudyValidators";
import {
  buildDossierSearchText,
  formatStudyCode,
  initialChecks,
  normalizeDocument,
  validateDecision,
  validateDossierInput,
} from "./model/securityStudies";
import { resolveCustomer } from "./clientCompanies";

const readers = ["admin", "operator", "auditor", "client"] as const;
const writers = ["admin", "operator"] as const;

function isClient(actor: Doc<"users">): boolean {
  return actor.roles.includes("client");
}

function canSeeStudy(actor: Doc<"users">, study: Doc<"securityStudies">): boolean {
  if (study.organizationId !== actor.organizationId) return false;
  if (!isClient(actor)) return true;
  return Boolean(actor.customerId) && study.customerId === actor.customerId;
}

function canWrite(actor: Doc<"users">): boolean {
  return actor.roles.some((r) => r === "admin" || r === "operator");
}

const documentWithUrl = v.object({
  id: v.string(),
  kind: v.string(),
  fileName: v.string(),
  contentType: v.string(),
  note: v.optional(v.string()),
  uploadedAt: v.number(),
  uploadedByName: v.string(),
  url: v.union(v.string(), v.null()),
});

const studySummary = v.object({
  _id: v.id("securityStudies"),
  code: v.string(),
  status: securityStudyStatus,
  customer: v.string(),
  decidedAt: v.optional(v.number()),
  validUntil: v.optional(v.number()),
  decisionReason: v.optional(v.string()),
  createdAt: v.number(),
});

async function loadStudy(ctx: QueryCtx | MutationCtx, studyId: Id<"securityStudies">) {
  const actor = await requireActor(ctx, undefined, [...readers]);
  const study = await ctx.db.get("securityStudies", studyId);
  if (!study || !canSeeStudy(actor, study)) throw new ConvexError("El estudio no está disponible.");
  const dossier = await ctx.db.get("driverDossiers", study.dossierId);
  if (!dossier) throw new ConvexError("El expediente del conductor no está disponible.");
  return { actor, study, dossier };
}

export const board = query({
  args: {},
  returns: v.object({
    studies: v.array(securityStudyDoc),
    canManage: v.boolean(),
    isAdmin: v.boolean(),
    viewer: v.union(v.literal("staff"), v.literal("client")),
    customerName: v.optional(v.string()),
  }),
  handler: async (ctx) => {
    const actor = await requireActor(ctx, undefined, [...readers]);
    const client = isClient(actor);
    const studies = client
      ? actor.customerId
        ? await ctx.db
            .query("securityStudies")
            .withIndex("by_org_customer", (q) => q.eq("organizationId", actor.organizationId).eq("customerId", actor.customerId))
            .collect()
        : []
      : await ctx.db
          .query("securityStudies")
          .withIndex("by_org_status", (q) => q.eq("organizationId", actor.organizationId))
          .collect();
    const customer = client && actor.customerId ? await ctx.db.get("customers", actor.customerId) : null;
    studies.sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      studies,
      canManage: canWrite(actor),
      isAdmin: actor.roles.includes("admin"),
      viewer: client ? ("client" as const) : ("staff" as const),
      customerName: customer?.name,
    };
  },
});

export const detail = query({
  args: { studyId: v.id("securityStudies") },
  returns: v.union(
    v.object({
      study: securityStudyDoc,
      dossier: driverDossierDoc,
      documents: v.array(documentWithUrl),
      history: v.array(studySummary),
      canManage: v.boolean(),
      isAdmin: v.boolean(),
      viewer: v.union(v.literal("staff"), v.literal("client")),
      organizationName: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...readers]);
    const study = await ctx.db.get("securityStudies", args.studyId);
    if (!study || !canSeeStudy(actor, study)) return null;
    const dossier = await ctx.db.get("driverDossiers", study.dossierId);
    if (!dossier) return null;
    const organization = await ctx.db.get("organizations", study.organizationId);
    const client = isClient(actor);
    const documents = await Promise.all(
      dossier.documents.map(async (file) => ({
        id: file.id,
        kind: file.kind,
        fileName: file.fileName,
        contentType: file.contentType,
        note: file.note,
        uploadedAt: file.uploadedAt,
        uploadedByName: file.uploadedByName,
        url: client ? null : await ctx.storage.getUrl(file.storageId),
      })),
    );
    const others = await ctx.db
      .query("securityStudies")
      .withIndex("by_dossier", (q) => q.eq("dossierId", dossier._id))
      .collect();
    const history = others
      .filter((row) => row._id !== study._id && (!client || row.customerId === actor.customerId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((row) => ({
        _id: row._id,
        code: row.code,
        status: row.status,
        customer: row.customer,
        decidedAt: row.decidedAt,
        validUntil: row.validUntil,
        decisionReason: row.decisionReason,
        createdAt: row.createdAt,
      }));
    return {
      study,
      dossier,
      documents,
      history,
      canManage: canWrite(actor),
      isAdmin: actor.roles.includes("admin"),
      viewer: client ? ("client" as const) : ("staff" as const),
      organizationName: organization?.name ?? "",
    };
  },
});

export const dossierLookup = query({
  args: { term: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("driverDossiers"),
      document: v.string(),
      name: v.string(),
      phone: v.optional(v.string()),
      documentCount: v.number(),
      studies: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...writers]);
    const term = args.term.trim();
    if (term.length < 2) return [];
    const rows = await ctx.db
      .query("driverDossiers")
      .withSearchIndex("search_dossier", (q) => q.search("searchText", term).eq("organizationId", actor.organizationId))
      .take(8);
    return await Promise.all(
      rows.map(async (row) => ({
        _id: row._id,
        document: row.document,
        name: row.name,
        phone: row.phone,
        documentCount: row.documents.length,
        studies: (await ctx.db.query("securityStudies").withIndex("by_dossier", (q) => q.eq("dossierId", row._id)).collect()).length,
      })),
    );
  },
});

export const driverStatus = query({
  args: { document: v.string(), customerId: v.optional(v.id("customers")), customer: v.optional(v.string()) },
  returns: v.union(
    v.null(),
    v.object({
      dossierId: v.id("driverDossiers"),
      driverName: v.string(),
      forCustomer: v.union(v.null(), studySummary),
      approvedFor: v.array(v.string()),
      rejectedFor: v.array(v.string()),
      openCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...writers]);
    const document = normalizeDocument(args.document);
    if (document.length < 5) return null;
    const dossier = await ctx.db
      .query("driverDossiers")
      .withIndex("by_org_document", (q) => q.eq("organizationId", actor.organizationId).eq("document", document))
      .unique();
    if (!dossier) return null;
    const studies = await ctx.db.query("securityStudies").withIndex("by_dossier", (q) => q.eq("dossierId", dossier._id)).collect();
    const now = Date.now();
    const customerKey = args.customer?.trim().toLocaleLowerCase("es");
    const match = studies
      .filter((s) => (args.customerId ? s.customerId === args.customerId : customerKey ? s.customer.toLocaleLowerCase("es") === customerKey : false))
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    const summarize = (row: Doc<"securityStudies">) => ({
      _id: row._id,
      code: row.code,
      status: row.status,
      customer: row.customer,
      decidedAt: row.decidedAt,
      validUntil: row.validUntil,
      decisionReason: row.decisionReason,
      createdAt: row.createdAt,
    });
    return {
      dossierId: dossier._id,
      driverName: dossier.name,
      forCustomer: match ? summarize(match) : null,
      approvedFor: [...new Set(studies.filter((s) => s.status === "aprobado" && (!s.validUntil || s.validUntil > now)).map((s) => s.customer))],
      rejectedFor: [...new Set(studies.filter((s) => s.status === "rechazado").map((s) => s.customer))],
      openCount: studies.filter((s) => s.status === "pendiente" || s.status === "en_estudio").length,
    };
  },
});

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireActor(ctx, undefined, [...writers]);
    return await ctx.storage.generateUploadUrl();
  },
});

const dossierInput = {
  document: v.string(),
  documentType: v.optional(v.string()),
  name: v.string(),
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
  birthDate: v.optional(v.string()),
  city: v.optional(v.string()),
  licenseNumber: v.optional(v.string()),
  licenseCategory: v.optional(v.string()),
  licenseExpiresAt: v.optional(v.string()),
  notes: v.optional(v.string()),
};

async function upsertDossier(ctx: MutationCtx, actor: Doc<"users">, input: { [K in keyof typeof dossierInput]?: string } & { document: string; name: string }, now: number): Promise<Doc<"driverDossiers">> {
  try {
    validateDossierInput(input);
  } catch (error) {
    throw new ConvexError((error as Error).message);
  }
  const document = normalizeDocument(input.document);
  const clean = (value?: string) => value?.trim() || undefined;
  const fields = {
    documentType: clean(input.documentType) ?? "CC",
    name: input.name.trim().replace(/\s+/g, " "),
    phone: clean(input.phone),
    email: clean(input.email)?.toLowerCase(),
    birthDate: clean(input.birthDate),
    city: clean(input.city),
    licenseNumber: clean(input.licenseNumber),
    licenseCategory: clean(input.licenseCategory)?.toUpperCase(),
    licenseExpiresAt: clean(input.licenseExpiresAt),
    notes: clean(input.notes),
  };
  const existing = await ctx.db
    .query("driverDossiers")
    .withIndex("by_org_document", (q) => q.eq("organizationId", actor.organizationId).eq("document", document))
    .unique();
  const searchText = buildDossierSearchText({ document, name: fields.name, phone: fields.phone, licenseNumber: fields.licenseNumber });
  if (existing) {
    await ctx.db.patch("driverDossiers", existing._id, { ...fields, searchText, updatedAt: now });
    return (await ctx.db.get("driverDossiers", existing._id))!;
  }
  const id = await ctx.db.insert("driverDossiers", {
    organizationId: actor.organizationId,
    document,
    ...fields,
    documents: [],
    searchText,
    createdBy: actor._id,
    createdByName: actor.name,
    createdAt: now,
    updatedAt: now,
  });
  return (await ctx.db.get("driverDossiers", id))!;
}

export const createStudy = mutation({
  args: {
    ...dossierInput,
    customer: v.string(),
    customerId: v.optional(v.id("customers")),
    plate: v.optional(v.string()),
    requestedBy: v.optional(v.string()),
  },
  returns: v.id("securityStudies"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, undefined, [...writers]);
    const now = Date.now();
    const dossier = await upsertDossier(ctx, actor, args, now);
    const customer = await resolveCustomer(ctx, actor, { customerId: args.customerId, name: args.customer });
    const open = await ctx.db
      .query("securityStudies")
      .withIndex("by_dossier", (q) => q.eq("dossierId", dossier._id))
      .collect();
    const duplicate = open.find((s) => s.customerId === customer._id && (s.status === "pendiente" || s.status === "en_estudio"));
    if (duplicate) throw new ConvexError(`Ya existe el estudio ${duplicate.code} abierto para este conductor y ${customer.name}.`);
    const all = await ctx.db
      .query("securityStudies")
      .withIndex("by_org_code", (q) => q.eq("organizationId", actor.organizationId))
      .collect();
    const sequence = all.reduce((max, s) => Math.max(max, Number(s.code.replace(/\D/g, "")) || 0), 0) + 1;
    const id = await ctx.db.insert("securityStudies", {
      organizationId: actor.organizationId,
      dossierId: dossier._id,
      code: formatStudyCode(sequence),
      driverDocument: dossier.document,
      driverName: dossier.name,
      customerId: customer._id,
      customer: customer.name,
      plate: args.plate?.trim().toUpperCase() || undefined,
      requestedBy: args.requestedBy?.trim() || undefined,
      status: "pendiente",
      checks: initialChecks(),
      createdBy: actor._id,
      createdByName: actor.name,
      createdAt: now,
      updatedAt: now,
    });
    await appendAudit(ctx, {
      organizationId: actor.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "security.study.created",
      entityType: "securityStudy",
      entityId: id,
      detailsJson: JSON.stringify({ document: dossier.document, customer: customer.name }),
      createdAt: now,
    });
    return id;
  },
});

export const updateDossier = mutation({
  args: { studyId: v.id("securityStudies"), ...dossierInput },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { actor, study, dossier } = await loadStudy(ctx, args.studyId);
    if (!canWrite(actor)) throw new ConvexError("Tu cargo no permite editar el expediente.");
    if (normalizeDocument(args.document) !== dossier.document) throw new ConvexError("El documento del conductor no se puede cambiar; crea un estudio nuevo.");
    const now = Date.now();
    const updated = await upsertDossier(ctx, actor, args, now);
    await ctx.db.patch("securityStudies", study._id, { driverName: updated.name, updatedAt: now });
    return null;
  },
});

export const addDocument = mutation({
  args: {
    studyId: v.id("securityStudies"),
    kind: v.string(),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { actor, study, dossier } = await loadStudy(ctx, args.studyId);
    if (!canWrite(actor)) throw new ConvexError("Tu cargo no permite adjuntar documentos.");
    if (dossier.documents.length >= 30) throw new ConvexError("El expediente ya tiene el máximo de 30 documentos.");
    const now = Date.now();
    await ctx.db.patch("driverDossiers", dossier._id, {
      documents: [
        ...dossier.documents,
        {
          id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
          kind: args.kind.trim() || "Otro documento",
          storageId: args.storageId,
          fileName: args.fileName,
          contentType: args.contentType,
          note: args.note?.trim() || undefined,
          uploadedAt: now,
          uploadedByName: actor.name,
        },
      ],
      updatedAt: now,
    });
    if (study.status === "pendiente") await ctx.db.patch("securityStudies", study._id, { status: "en_estudio", updatedAt: now });
    else await ctx.db.patch("securityStudies", study._id, { updatedAt: now });
    return null;
  },
});

export const removeDocument = mutation({
  args: { studyId: v.id("securityStudies"), documentId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { actor, study, dossier } = await loadStudy(ctx, args.studyId);
    if (!canWrite(actor)) throw new ConvexError("Tu cargo no permite eliminar documentos.");
    if ((study.status === "aprobado" || study.status === "rechazado") && !actor.roles.includes("admin"))
      throw new ConvexError("El estudio ya fue decidido; solo un superadministrador puede modificar el expediente.");
    const file = dossier.documents.find((d) => d.id === args.documentId);
    if (!file) return null;
    await ctx.storage.delete(file.storageId);
    await ctx.db.patch("driverDossiers", dossier._id, { documents: dossier.documents.filter((d) => d.id !== args.documentId), updatedAt: Date.now() });
    return null;
  },
});

export const recordCheck = mutation({
  args: { studyId: v.id("securityStudies"), kind: v.string(), result: securityCheckResult, detail: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { actor, study } = await loadStudy(ctx, args.studyId);
    if (!canWrite(actor)) throw new ConvexError("Tu cargo no permite registrar consultas.");
    if (study.status === "aprobado" || study.status === "rechazado") throw new ConvexError("El estudio ya fue decidido. Reábrelo para modificar las consultas.");
    if ((args.detail ?? "").length > 600) throw new ConvexError("El detalle no puede superar 600 caracteres.");
    const now = Date.now();
    const exists = study.checks.some((c) => c.kind === args.kind);
    const checks = exists
      ? study.checks.map((c) => (c.kind === args.kind ? { kind: c.kind, result: args.result, detail: args.detail?.trim() || undefined, checkedAt: args.result === "sin_consultar" ? undefined : now, checkedByName: args.result === "sin_consultar" ? undefined : actor.name } : c))
      : [...study.checks, { kind: args.kind.trim(), result: args.result, detail: args.detail?.trim() || undefined, checkedAt: now, checkedByName: actor.name }];
    await ctx.db.patch("securityStudies", study._id, { checks, status: "en_estudio", updatedAt: now });
    return null;
  },
});

export const saveNotes = mutation({
  args: { studyId: v.id("securityStudies"), analystNotes: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { actor, study } = await loadStudy(ctx, args.studyId);
    if (!canWrite(actor)) throw new ConvexError("Tu cargo no permite editar el estudio.");
    if (args.analystNotes.length > 2000) throw new ConvexError("Las notas no pueden superar 2000 caracteres.");
    await ctx.db.patch("securityStudies", study._id, { analystNotes: args.analystNotes.trim() || undefined, updatedAt: Date.now() });
    return null;
  },
});

export const decide = mutation({
  args: {
    studyId: v.id("securityStudies"),
    outcome: v.union(v.literal("aprobado"), v.literal("rechazado")),
    reason: v.string(),
    validMonths: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { actor, study } = await loadStudy(ctx, args.studyId);
    if (!canWrite(actor)) throw new ConvexError("Tu cargo no permite aprobar o rechazar estudios.");
    if (study.status === "aprobado" || study.status === "rechazado") throw new ConvexError("El estudio ya fue decidido.");
    try {
      validateDecision({ outcome: args.outcome, reason: args.reason, checks: study.checks });
    } catch (error) {
      throw new ConvexError((error as Error).message);
    }
    const now = Date.now();
    const months = args.validMonths && args.validMonths > 0 ? Math.min(args.validMonths, 36) : undefined;
    const validUntil = args.outcome === "aprobado" && months ? new Date(now).setMonth(new Date(now).getMonth() + months) : undefined;
    await ctx.db.patch("securityStudies", study._id, {
      status: args.outcome,
      decisionReason: args.reason.trim() || undefined,
      decidedAt: now,
      decidedByName: actor.name,
      validUntil,
      updatedAt: now,
    });
    await appendAudit(ctx, {
      organizationId: study.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: `security.study.${args.outcome}`,
      entityType: "securityStudy",
      entityId: study._id,
      reason: args.reason.trim() || undefined,
      createdAt: now,
    });
    return null;
  },
});

export const reopen = mutation({
  args: { studyId: v.id("securityStudies"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { actor, study } = await loadStudy(ctx, args.studyId);
    if (!actor.roles.includes("admin")) throw new ConvexError("Solo un superadministrador puede reabrir un estudio decidido.");
    if (study.status !== "aprobado" && study.status !== "rechazado") throw new ConvexError("El estudio sigue abierto.");
    if (args.reason.trim().length < 10) throw new ConvexError("Explica por qué se reabre el estudio.");
    const now = Date.now();
    await ctx.db.patch("securityStudies", study._id, {
      status: "en_estudio",
      analystNotes: [study.analystNotes, `Reabierto por ${actor.name}: ${args.reason.trim()} (decisión anterior: ${study.status}${study.decisionReason ? ` · ${study.decisionReason}` : ""})`].filter(Boolean).join("\n\n"),
      decisionReason: undefined,
      decidedAt: undefined,
      decidedByName: undefined,
      validUntil: undefined,
      updatedAt: now,
    });
    await appendAudit(ctx, {
      organizationId: study.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "security.study.reopened",
      entityType: "securityStudy",
      entityId: study._id,
      reason: args.reason.trim(),
      createdAt: now,
    });
    return null;
  },
});

export const deleteStudy = mutation({
  args: { studyId: v.id("securityStudies") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { actor, study } = await loadStudy(ctx, args.studyId);
    if (!actor.roles.includes("admin")) throw new ConvexError("Solo un superadministrador puede eliminar un estudio.");
    await ctx.db.delete("securityStudies", study._id);
    await appendAudit(ctx, {
      organizationId: study.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "security.study.deleted",
      entityType: "securityStudy",
      entityId: study._id,
      reason: study.code,
    });
    return null;
  },
});

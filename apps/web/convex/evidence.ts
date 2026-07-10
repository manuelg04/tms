import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { appendAudit, requireActor, requireSameOrganization, requireServiceKey } from "./model/access";

const kindValidator = v.union(
  v.literal("request_xml"),
  v.literal("response_xml"),
  v.literal("pdf"),
  v.literal("photo"),
  v.literal("signature"),
  v.literal("pod"),
  v.literal("other")
);

const artifactValidator = v.object({
  _id: v.id("evidenceArtifacts"),
  _creationTime: v.number(),
  organizationId: v.id("organizations"),
  expedienteId: v.optional(v.id("expedientes")),
  documentId: v.optional(v.id("documents")),
  rndcOperationId: v.optional(v.id("rndcOperations")),
  storageId: v.id("_storage"),
  kind: kindValidator,
  fileName: v.string(),
  contentType: v.optional(v.string()),
  size: v.number(),
  sha256: v.string(),
  uploadedByType: v.union(v.literal("user"), v.literal("service")),
  uploadedByUserId: v.optional(v.id("users")),
  createdAt: v.number()
});

const finalizeInputValidator = {
  organizationId: v.id("organizations"),
  expedienteId: v.optional(v.id("expedientes")),
  documentId: v.optional(v.id("documents")),
  rndcOperationId: v.optional(v.id("rndcOperations")),
  storageId: v.id("_storage"),
  kind: kindValidator,
  fileName: v.string(),
  expectedSha256: v.optional(v.string())
};

type FinalizeInput = {
  organizationId: Id<"organizations">;
  expedienteId?: Id<"expedientes">;
  documentId?: Id<"documents">;
  rndcOperationId?: Id<"rndcOperations">;
  storageId: Id<"_storage">;
  kind: "request_xml" | "response_xml" | "pdf" | "photo" | "signature" | "pod" | "other";
  fileName: string;
  expectedSha256?: string;
};

export const generateUploadUrl = mutation({
  args: { actorToken: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    return await ctx.storage.generateUploadUrl();
  }
});

export const generateServiceUploadUrl = mutation({
  args: { serviceKey: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    return await ctx.storage.generateUploadUrl();
  }
});

export const finalizeUpload = mutation({
  args: { actorToken: v.optional(v.string()), ...finalizeInputValidator },
  returns: v.id("evidenceArtifacts"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    requireSameOrganization(actor, args.organizationId);
    const { actorToken: _actorToken, ...input } = args;
    return await finalizeArtifact(ctx, input, "user", actor._id);
  }
});

export const finalizeServiceUpload = mutation({
  args: {
    serviceKey: v.string(),
    uploadedByUserId: v.optional(v.id("users")),
    ...finalizeInputValidator
  },
  returns: v.id("evidenceArtifacts"),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);

    if (args.uploadedByUserId) {
      const user = await ctx.db.get("users", args.uploadedByUserId);
      if (!user || user.organizationId !== args.organizationId) {
        throw new ConvexError({ code: "FORBIDDEN", message: "Evidence actor belongs to another organization" });
      }
    }

    const { serviceKey: _serviceKey, uploadedByUserId, ...input } = args;
    return await finalizeArtifact(ctx, input, "service", uploadedByUserId);
  }
});

export const getProtected = query({
  args: { actorToken: v.optional(v.string()), artifactId: v.id("evidenceArtifacts") },
  returns: v.union(v.null(), v.object({ artifact: artifactValidator, url: v.union(v.string(), v.null()) })),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    const artifact = await ctx.db.get("evidenceArtifacts", args.artifactId);

    if (!artifact) {
      return null;
    }

    requireSameOrganization(actor, artifact.organizationId);
    const url = await ctx.storage.getUrl(artifact.storageId);
    return { artifact, url };
  }
});

export const getForService = query({
  args: { serviceKey: v.string(), artifactId: v.id("evidenceArtifacts") },
  returns: v.union(v.null(), v.object({ artifact: artifactValidator, url: v.union(v.string(), v.null()) })),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    const artifact = await ctx.db.get("evidenceArtifacts", args.artifactId);

    if (!artifact) {
      return null;
    }

    const url = await ctx.storage.getUrl(artifact.storageId);
    return { artifact, url };
  }
});

export const listForExpediente = query({
  args: { actorToken: v.optional(v.string()), expedienteId: v.id("expedientes"), limit: v.optional(v.number()) },
  returns: v.array(artifactValidator),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    const expediente = await ctx.db.get("expedientes", args.expedienteId);

    if (!expediente) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Expediente not found" });
    }

    requireSameOrganization(actor, expediente.organizationId);
    return await ctx.db
      .query("evidenceArtifacts")
      .withIndex("by_expediente_and_created_at", (q) => q.eq("expedienteId", expediente._id))
      .order("desc")
      .take(Math.min(Math.max(args.limit ?? 100, 1), 250));
  }
});

export const listForOperation = query({
  args: { actorToken: v.optional(v.string()), operationId: v.id("rndcOperations") },
  returns: v.array(artifactValidator),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    const operation = await ctx.db.get("rndcOperations", args.operationId);

    if (!operation) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Operation not found" });
    }

    requireSameOrganization(actor, operation.organizationId);
    return await ctx.db
      .query("evidenceArtifacts")
      .withIndex("by_rndc_operation", (q) => q.eq("rndcOperationId", operation._id))
      .order("desc")
      .take(100);
  }
});

export const listForOperationForService = query({
  args: { serviceKey: v.string(), operationId: v.id("rndcOperations") },
  returns: v.array(artifactValidator),
  handler: async (ctx, args) => {
    requireServiceKey(args.serviceKey);
    return await ctx.db
      .query("evidenceArtifacts")
      .withIndex("by_rndc_operation", (q) => q.eq("rndcOperationId", args.operationId))
      .order("desc")
      .take(100);
  }
});

async function finalizeArtifact(
  ctx: MutationCtx,
  input: FinalizeInput,
  uploadedByType: "user" | "service",
  uploadedByUserId?: Id<"users">
): Promise<Id<"evidenceArtifacts">> {
  const existing = await ctx.db
    .query("evidenceArtifacts")
    .withIndex("by_storage_id", (q) => q.eq("storageId", input.storageId))
    .unique();

  if (existing) {
    if (existing.organizationId !== input.organizationId) {
      throw new ConvexError({ code: "CONFLICT", message: "Storage object belongs to another organization" });
    }

    if (
      existing.kind !== input.kind ||
      existing.fileName !== input.fileName.trim() ||
      existing.expedienteId !== input.expedienteId ||
      existing.documentId !== input.documentId ||
      existing.rndcOperationId !== input.rndcOperationId
    ) {
      throw new ConvexError({ code: "CONFLICT", message: "Storage object was already finalized with other metadata" });
    }

    return existing._id;
  }

  const organization = await ctx.db.get("organizations", input.organizationId);

  if (!organization || organization.status !== "active") {
    throw new ConvexError({ code: "NOT_FOUND", message: "Active organization not found" });
  }

  await validateReferences(ctx, input);
  const metadata = await ctx.db.system.get(input.storageId);

  if (!metadata) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Uploaded storage object not found" });
  }

  if (input.expectedSha256 && input.expectedSha256 !== metadata.sha256) {
    throw new ConvexError({ code: "INTEGRITY_ERROR", message: "Uploaded evidence checksum does not match" });
  }

  const fileName = input.fileName.trim();

  if (!fileName) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "Evidence file name is required" });
  }

  const now = Date.now();
  const artifactId = await ctx.db.insert("evidenceArtifacts", {
    organizationId: input.organizationId,
    expedienteId: input.expedienteId,
    documentId: input.documentId,
    rndcOperationId: input.rndcOperationId,
    storageId: input.storageId,
    kind: input.kind,
    fileName,
    contentType: metadata.contentType,
    size: metadata.size,
    sha256: metadata.sha256,
    uploadedByType,
    uploadedByUserId,
    createdAt: now
  });
  await appendAudit(ctx, {
    organizationId: input.organizationId,
    actorType: uploadedByType,
    actorId: uploadedByUserId,
    action: "evidence.finalized",
    entityType: "evidence_artifact",
    entityId: artifactId,
    detailsJson: JSON.stringify({ kind: input.kind, sha256: metadata.sha256, size: metadata.size }),
    createdAt: now
  });
  return artifactId;
}

async function validateReferences(ctx: MutationCtx, input: FinalizeInput): Promise<void> {
  const references = await Promise.all([
    input.expedienteId ? ctx.db.get("expedientes", input.expedienteId) : null,
    input.documentId ? ctx.db.get("documents", input.documentId) : null,
    input.rndcOperationId ? ctx.db.get("rndcOperations", input.rndcOperationId) : null
  ]);

  if (
    (input.expedienteId && !references[0]) ||
    (input.documentId && !references[1]) ||
    (input.rndcOperationId && !references[2])
  ) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Evidence reference not found" });
  }

  for (const reference of references) {
    if (reference && reference.organizationId !== input.organizationId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Evidence reference belongs to another organization" });
    }
  }

  const [expediente, document, operation] = references;

  if (
    (expediente && document?.expedienteId && document.expedienteId !== expediente._id) ||
    (expediente && operation?.expedienteId && operation.expedienteId !== expediente._id) ||
    (document && operation?.documentId && operation.documentId !== document._id)
  ) {
    throw new ConvexError({ code: "CONFLICT", message: "Evidence references do not belong to the same operation" });
  }
}

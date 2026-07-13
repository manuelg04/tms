import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { appendAudit, requireActor, requireSameOrganization } from "./model/access";
import { actionableNotification } from "./model/actionableNotification";
import { refreshDispatchSearchText } from "./model/dispatchSearchProjection";
import {
  applyDocumentEvent,
  initialDocumentLifecycle,
  type DocumentEvent,
  type DocumentLifecycle
} from "./model/documentLifecycle";

const kindValidator = v.union(
  v.literal("orden_cargue"),
  v.literal("remesa"),
  v.literal("manifiesto"),
  v.literal("cumplido"),
  v.literal("anulacion")
);

const acceptanceStateValidator = v.union(
  v.literal("not_applicable"),
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("delegated"),
  v.literal("rejected")
);

const documentOutputValidator = v.object({
  _id: v.id("documents"),
  _creationTime: v.number(),
  organizationId: v.optional(v.id("organizations")),
  expedienteId: v.optional(v.id("expedientes")),
  expedienteRemesaId: v.optional(v.id("expedienteRemesas")),
  tripId: v.id("trips"),
  kind: kindValidator,
  status: v.string(),
  number: v.optional(v.string()),
  rndcRadicado: v.optional(v.string()),
  issuanceRadicado: v.optional(v.string()),
  mode: v.optional(v.union(v.literal("dry-run"), v.literal("live"))),
  pdfUrlPath: v.optional(v.string()),
  errorText: v.optional(v.string()),
  storageId: v.optional(v.id("_storage")),
  officialState: v.optional(v.string()),
  fulfillmentState: v.optional(v.string()),
  correctionState: v.optional(v.string()),
  annulmentState: v.optional(v.string()),
  reconciliationState: v.optional(v.string()),
  acceptanceState: v.optional(acceptanceStateValidator),
  acceptanceActorName: v.optional(v.string()),
  acceptanceActorDocument: v.optional(v.string()),
  acceptanceRecordedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number()
});

export const createDraft = mutation({
  args: {
    actorToken: v.optional(v.string()),
    expedienteId: v.id("expedientes"),
    expedienteRemesaId: v.optional(v.id("expedienteRemesas")),
    kind: kindValidator,
    number: v.optional(v.string()),
    mode: v.optional(v.union(v.literal("dry-run"), v.literal("live")))
  },
  returns: v.id("documents"),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken, ["admin", "operator"]);
    const expediente = await ctx.db.get("expedientes", args.expedienteId);

    if (!expediente || !expediente.tripId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Expediente with trip record not found" });
    }

    requireSameOrganization(actor, expediente.organizationId);
    const remesa = args.expedienteRemesaId
      ? await ctx.db.get("expedienteRemesas", args.expedienteRemesaId)
      : null;

    if (args.expedienteRemesaId && (!remesa || remesa.expedienteId !== expediente._id)) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Expediente remesa not found" });
    }

    if (args.kind === "remesa" && !remesa) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Remesa document requires an expediente remesa" });
    }

    if (args.kind === "remesa" && remesa?.documentId) {
      return remesa.documentId;
    }

    if (args.kind === "manifiesto" && expediente.manifestDocumentId) {
      return expediente.manifestDocumentId;
    }

    const number = args.number?.trim();
    const existing = number
      ? await ctx.db
          .query("documents")
          .withIndex("by_organization_kind_and_number", (q) =>
            q.eq("organizationId", expediente.organizationId).eq("kind", args.kind).eq("number", number)
          )
          .unique()
      : null;

    if (existing) {
      if (existing.expedienteId !== expediente._id) {
        throw new ConvexError({ code: "CONFLICT", message: "Document number belongs to another expediente" });
      }
      return existing._id;
    }

    const now = Date.now();
    const lifecycle = initialDocumentLifecycle();
    const documentId = await ctx.db.insert("documents", {
      organizationId: expediente.organizationId,
      expedienteId: expediente._id,
      expedienteRemesaId: remesa?._id,
      tripId: expediente.tripId,
      kind: args.kind,
      status: "draft",
      number,
      mode: args.mode ?? "dry-run",
      ...lifecycle,
      acceptanceState: args.kind === "manifiesto" ? "pending" : "not_applicable",
      createdAt: now,
      updatedAt: now
    });

    if (remesa) {
      await ctx.db.patch("expedienteRemesas", remesa._id, { documentId, updatedBy: actor._id, updatedAt: now });
    }

    if (args.kind === "manifiesto") {
      await ctx.db.patch("expedientes", expediente._id, {
        manifestDocumentId: documentId,
        updatedBy: actor._id,
        updatedAt: now
      });
    }

    await appendAudit(ctx, {
      organizationId: expediente.organizationId,
      actorType: "user",
      actorId: actor._id,
      action: "official_document.draft_created",
      entityType: "document",
      entityId: documentId,
      createdAt: now
    });
    await refreshDispatchSearchText(ctx, expediente._id);
    return documentId;
  }
});

export const listForExpediente = query({
  args: { actorToken: v.optional(v.string()), expedienteId: v.id("expedientes") },
  returns: v.array(documentOutputValidator),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    const expediente = await ctx.db.get("expedientes", args.expedienteId);

    if (!expediente) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Expediente not found" });
    }

    requireSameOrganization(actor, expediente.organizationId);
    return await ctx.db.query("documents").withIndex("by_expediente", (q) => q.eq("expedienteId", expediente._id)).collect();
  }
});

export async function recordAcceptance(
  ctx: MutationCtx,
  input: {
    documentId: Id<"documents">;
    rndcOperationId?: Id<"rndcOperations">;
    state: "not_applicable" | "pending" | "accepted" | "delegated" | "rejected";
    actorName?: string;
    actorDocument?: string;
    recordedAt?: number;
    detailsJson?: string;
  }
): Promise<Doc<"documents">> {
  const document = await ctx.db.get("documents", input.documentId);

  if (!document || !document.organizationId || document.kind !== "manifiesto") {
    throw new ConvexError({ code: "NOT_FOUND", message: "Scoped manifest document not found" });
  }

  if (input.rndcOperationId) {
    const operation = await ctx.db.get("rndcOperations", input.rndcOperationId);
    if (!operation || operation.documentId !== document._id || operation.organizationId !== document.organizationId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Acceptance operation does not belong to the manifest" });
    }
  }

  const recordedAt = input.recordedAt ?? Date.now();
  await ctx.db.patch("documents", document._id, {
    acceptanceState: input.state,
    acceptanceActorName: input.actorName,
    acceptanceActorDocument: input.actorDocument,
    acceptanceRecordedAt: recordedAt,
    updatedAt: recordedAt
  });

  if (document.expedienteId) {
    await ctx.db.insert("expedienteEvents", {
      organizationId: document.organizationId,
      expedienteId: document.expedienteId,
      eventType: "manifest_acceptance_updated",
      title: `Aceptación electrónica ${input.state}`,
      occurredAt: recordedAt
    });
  }

  await appendAudit(ctx, {
    organizationId: document.organizationId,
    actorType: "service",
    action: "official_document.acceptance_updated",
    entityType: "document",
    entityId: document._id,
    detailsJson: input.detailsJson,
    createdAt: recordedAt
  });
  if (document.expedienteId) {
    await refreshDispatchSearchText(ctx, document.expedienteId);
  }
  const updated = await ctx.db.get("documents", document._id);

  if (!updated) {
    throw new ConvexError({ code: "INTERNAL", message: "Manifest could not be reloaded" });
  }

  return updated;
}

export async function applyLifecycle(
  ctx: MutationCtx,
  input: {
    documentId: Id<"documents">;
    rndcOperationId?: Id<"rndcOperations">;
    event: DocumentEvent;
    radicado?: string;
    errorText?: string;
    reason?: string;
    detailsJson?: string;
    actorType: "user" | "service";
    actorId?: Id<"users">;
  }
): Promise<Doc<"documents">> {
  const document = await ctx.db.get("documents", input.documentId);

  if (!document || !document.organizationId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Scoped document not found" });
  }

  if (input.rndcOperationId) {
    const operation = await ctx.db.get("rndcOperations", input.rndcOperationId);

    if (!operation || operation.organizationId !== document.organizationId || operation.documentId !== document._id) {
      throw new ConvexError({ code: "FORBIDDEN", message: "RNDC operation does not belong to the document" });
    }
  }

  const current = lifecycleFromDocument(document);
  let lifecycle;

  try {
    lifecycle = applyDocumentEvent(current, input.event);
  } catch (error) {
    throw new ConvexError({ code: "INVALID_STATE", message: String(error) });
  }

  const now = Date.now();
  await ctx.db.patch("documents", document._id, {
    ...lifecycle,
    status: input.event === "attempt_rejected" ? "rejected" : lifecycle.officialState,
    rndcRadicado: input.radicado ?? document.rndcRadicado,
    issuanceRadicado: input.event === "submission_succeeded" && input.radicado
      ? input.radicado
      : document.issuanceRadicado,
    errorText: input.errorText,
    updatedAt: now
  });

  if (document.expedienteRemesaId) {
    const remesa = await ctx.db.get("expedienteRemesas", document.expedienteRemesaId);
    if (remesa) {
      await ctx.db.patch("expedienteRemesas", remesa._id, {
        ...lifecycle,
        updatedBy: input.actorId ?? remesa.updatedBy,
        updatedAt: now
      });
    }
  }

  if (document.expedienteId) {
      await ctx.db.insert("expedienteEvents", {
        organizationId: document.organizationId,
        expedienteId: document.expedienteId,
        eventType: `document_${input.event}`,
        title: lifecycleEventTitle(input.event),
      details: input.reason ?? input.errorText,
      occurredAt: now,
      actorId: input.actorId
    });
    const notificationEvent = input.errorText?.toLocaleLowerCase("es").includes("evidencia") ? "evidence_failed" : input.event;
    const notification = actionableNotification(notificationEvent, document.expedienteId);
    if (notification) {
      await ctx.db.insert("notifications", {
        organizationId: document.organizationId,
        title: notification.title,
        body: input.errorText ?? lifecycleEventTitle(input.event),
        status: "unread",
        relatedTripId: document.tripId,
        relatedDocumentId: document._id,
        category: notification.category,
        actionLabel: notification.actionLabel,
        actionHref: notification.actionHref,
        createdAt: now
      });
    }
  }

  await appendAudit(ctx, {
    organizationId: document.organizationId,
    actorType: input.actorType,
    actorId: input.actorId,
    action: `official_document.${input.event}`,
    entityType: "document",
    entityId: document._id,
    reason: input.reason,
    detailsJson: input.detailsJson,
    createdAt: now
  });
  if (document.expedienteId) {
    await refreshDispatchSearchText(ctx, document.expedienteId);
  }
  const updated = await ctx.db.get("documents", document._id);

  if (!updated) {
    throw new ConvexError({ code: "INTERNAL", message: "Document could not be reloaded" });
  }

  return updated;
}

function lifecycleFromDocument(document: Doc<"documents">): DocumentLifecycle {
  const initial = initialDocumentLifecycle();
  return {
    officialState: document.officialState ?? legacyOfficialState(document.status),
    fulfillmentState: document.fulfillmentState ?? initial.fulfillmentState,
    correctionState: document.correctionState ?? initial.correctionState,
    annulmentState: document.annulmentState ?? initial.annulmentState,
    reconciliationState: document.reconciliationState ?? initial.reconciliationState
  };
}

function legacyOfficialState(status: Doc<"documents">["status"]): DocumentLifecycle["officialState"] {
  if (status === "authorized" || status === "fulfilled" || status === "annulled" || status === "draft" || status === "pending") {
    return status;
  }

  return "pending";
}

function lifecycleEventTitle(event: DocumentEvent): string {
  const titles: Record<DocumentEvent, string> = {
    submission_started: "Envio RNDC iniciado",
    submission_succeeded: "Documento autorizado en modo de prueba",
    attempt_rejected: "Intento RNDC rechazado",
    submission_abandoned: "Simulacion RNDC descartada",
    fulfillment_started: "Cumplido RNDC iniciado",
    fulfillment_succeeded: "Documento cumplido en modo de prueba",
    fulfillment_rejected: "Cumplido RNDC rechazado",
    fulfillment_annulment_started: "Reversion de cumplido RNDC iniciada",
    fulfillment_annulment_succeeded: "Cumplido RNDC revertido",
    fulfillment_annulment_rejected: "Reversion de cumplido RNDC rechazada",
    correction_started: "Correccion de remesa iniciada",
    correction_succeeded: "Remesa corregida en modo de prueba",
    correction_rejected: "Correccion de remesa rechazada",
    annulment_started: "Anulacion RNDC iniciada",
    annulment_succeeded: "Documento anulado en modo de prueba",
    annulment_rejected: "Anulacion RNDC rechazada",
    reconciliation_started: "Conciliacion RNDC iniciada",
    reconciliation_confirmed: "Estado RNDC conciliado",
    reconciliation_mismatch: "Conciliacion con diferencias"
  };
  return titles[event];
}

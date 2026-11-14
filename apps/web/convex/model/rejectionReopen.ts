import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { appendAudit } from "./access";
import { archivedKey, rejectionUnlockProblem } from "./rejectionUnlock";

export type ReopenResult =
  | { reopened: true; remesaNumber?: string; documentNumber?: string; businessKey: string }
  | { reopened: false; problem: string };

export async function reopenRejectedDocument(
  ctx: MutationCtx,
  operation: Doc<"rndcOperations">,
  actor: { type: "user"; id: Id<"users"> } | { type: "service" }
): Promise<ReopenResult> {
  const remesa = operation.expedienteRemesaId ? await ctx.db.get("expedienteRemesas", operation.expedienteRemesaId) : null;
  const document = operation.documentId ? await ctx.db.get("documents", operation.documentId) : null;
  const problem = rejectionUnlockProblem(operation, remesa, document);
  if (problem || !document) return { reopened: false, problem: problem ?? "No se encontró el documento" };
  if (operation.operationType === "emit_manifest") {
    const expediente = operation.expedienteId ? await ctx.db.get("expedientes", operation.expedienteId) : null;
    if (!expediente || expediente.manifestDocumentId !== document._id) return { reopened: false, problem: "El documento no es el manifiesto del despacho" };
  }
  const now = Date.now();
  const businessKey = archivedKey(operation.businessKey, operation._id);
  const requestKey = archivedKey(operation.requestKey, operation._id);
  await ctx.db.patch("rndcOperations", operation._id, { businessKey, requestKey, updatedAt: now });
  const keys = await ctx.db
    .query("rndcRequestKeys")
    .withIndex("by_organization_and_request_key", (q) => q.eq("organizationId", operation.organizationId).eq("requestKey", operation.requestKey))
    .collect();
  for (const key of keys) {
    if (key.operationId === operation._id) await ctx.db.patch("rndcRequestKeys", key._id, { requestKey });
  }
  if (remesa) {
    await ctx.db.patch("expedienteRemesas", remesa._id, {
      officialState: "draft",
      updatedBy: actor.type === "user" ? actor.id : remesa.updatedBy,
      updatedAt: now
    });
  }
  await ctx.db.patch("documents", document._id, { officialState: "draft", status: "draft", updatedAt: now });
  await appendAudit(ctx, {
    organizationId: operation.organizationId,
    actorType: actor.type,
    actorId: actor.type === "user" ? actor.id : undefined,
    action: "rndc_operation.rejection_unlocked",
    entityType: remesa ? "expediente_remesa" : "document",
    entityId: remesa ? remesa._id : document._id,
    reason: remesa ? "Rechazo del RNDC: se reabre la remesa para corregir y reenviar" : "Rechazo del RNDC: se reabre el manifiesto para corregir y reenviar",
    detailsJson: JSON.stringify({ operationId: operation._id, previousBusinessKey: operation.businessKey, businessKey, automatic: actor.type === "service" }),
    createdAt: now
  });
  return { reopened: true, remesaNumber: remesa?.number, documentNumber: document.number, businessKey };
}

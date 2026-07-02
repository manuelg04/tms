import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";

const operationValidator = v.union(
  v.literal("loading-order"),
  v.literal("remesa"),
  v.literal("manifest"),
  v.literal("driver-vehicle")
);

const modeValidator = v.union(v.literal("dry-run"), v.literal("live"));

const documentKindValidator = v.union(
  v.literal("orden_cargue"),
  v.literal("remesa"),
  v.literal("manifiesto"),
  v.literal("cumplido"),
  v.literal("anulacion")
);

const stepValidator = v.object({
  name: v.string(),
  title: v.string(),
  procesoId: v.number(),
  accepted: v.boolean(),
  radicado: v.optional(v.string()),
  errorText: v.optional(v.string()),
  requestPath: v.optional(v.string()),
  responsePath: v.optional(v.string())
});

const documentInputValidator = v.object({
  kind: documentKindValidator,
  number: v.string(),
  urlPath: v.optional(v.string()),
  radicado: v.optional(v.string())
});

const tripInputValidator = v.object({
  code: v.string(),
  originCity: v.optional(v.string()),
  destinationCity: v.optional(v.string()),
  vehiclePlate: v.optional(v.string()),
  driverName: v.optional(v.string())
});

const okTripStatus: Record<string, string> = {
  "loading-order": "orden_emitida",
  remesa: "remesa_emitida",
  manifest: "manifiesto_emitido",
  "driver-vehicle": "maestros_actualizados"
};

export const recordOperation = mutation({
  args: {
    ingestKey: v.string(),
    operation: operationValidator,
    mode: modeValidator,
    ok: v.boolean(),
    trip: tripInputValidator,
    documents: v.array(documentInputValidator),
    steps: v.array(stepValidator),
    errorText: v.optional(v.string()),
    evidencePath: v.optional(v.string()),
    startedAt: v.string(),
    finishedAt: v.string()
  },
  returns: v.object({
    tripId: v.id("trips"),
    documentIds: v.array(v.id("documents"))
  }),
  handler: async (ctx, args) => {
    if (args.ingestKey !== process.env.RNDC_INGEST_KEY) {
      throw new ConvexError({ code: "UNAUTHORIZED", message: "Invalid ingest key" });
    }

    const now = Date.now();
    const tripStatus = args.ok ? okTripStatus[args.operation] ?? "actualizado" : "revision";
    const existingTrip = await ctx.db
      .query("trips")
      .withIndex("by_code", (q) => q.eq("code", args.trip.code))
      .first();

    let tripId;

    if (existingTrip) {
      await ctx.db.patch(existingTrip._id, {
        status: tripStatus,
        originCity: args.trip.originCity ?? existingTrip.originCity,
        destinationCity: args.trip.destinationCity ?? existingTrip.destinationCity,
        vehiclePlate: args.trip.vehiclePlate ?? existingTrip.vehiclePlate,
        driverName: args.trip.driverName ?? existingTrip.driverName,
        updatedAt: now
      });
      tripId = existingTrip._id;
    } else {
      tripId = await ctx.db.insert("trips", {
        code: args.trip.code,
        status: tripStatus,
        originCity: args.trip.originCity,
        destinationCity: args.trip.destinationCity,
        vehiclePlate: args.trip.vehiclePlate,
        driverName: args.trip.driverName,
        createdAt: now,
        updatedAt: now
      });
    }

    const documentStatus = args.ok ? ("authorized" as const) : ("rejected" as const);
    const documentIds = [];

    for (const document of args.documents) {
      const existing = await ctx.db
        .query("documents")
        .withIndex("by_kind_and_number", (q) => q.eq("kind", document.kind).eq("number", document.number))
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          tripId,
          status: documentStatus,
          rndcRadicado: document.radicado ?? existing.rndcRadicado,
          mode: args.mode,
          pdfUrlPath: document.urlPath ?? existing.pdfUrlPath,
          errorText: args.ok ? undefined : args.errorText,
          updatedAt: now
        });
        documentIds.push(existing._id);
      } else {
        documentIds.push(
          await ctx.db.insert("documents", {
            tripId,
            kind: document.kind,
            status: documentStatus,
            number: document.number,
            rndcRadicado: document.radicado,
            mode: args.mode,
            pdfUrlPath: document.urlPath,
            errorText: args.ok ? undefined : args.errorText,
            createdAt: now,
            updatedAt: now
          })
        );
      }
    }

    const primaryDocumentId = documentIds[0];

    for (const step of args.steps) {
      await ctx.db.insert("rndcAttempts", {
        documentId: primaryDocumentId,
        tripId,
        operation: args.operation,
        action: step.name,
        title: step.title,
        procesoId: step.procesoId,
        status: step.accepted ? "accepted" : "rejected",
        mode: args.mode,
        radicado: step.radicado,
        requestPath: step.requestPath,
        responsePath: step.responsePath,
        errorText: step.errorText,
        createdAt: now,
        finishedAt: now
      });
    }

    await ctx.db.insert("notifications", {
      title: args.ok ? `Operacion ${args.operation} aceptada` : `Operacion ${args.operation} rechazada`,
      body: buildNotificationBody(args),
      status: "unread",
      relatedTripId: tripId,
      relatedDocumentId: primaryDocumentId,
      createdAt: now
    });

    return { tripId, documentIds };
  }
});

function buildNotificationBody(args: {
  operation: string;
  mode: string;
  ok: boolean;
  trip: { code: string; vehiclePlate?: string };
  documents: { kind: string; number: string; radicado?: string }[];
  errorText?: string;
}): string {
  const parts = [`Viaje ${args.trip.code}`, `modo ${args.mode}`];

  if (args.trip.vehiclePlate) {
    parts.push(`placa ${args.trip.vehiclePlate}`);
  }

  for (const document of args.documents) {
    parts.push(document.radicado ? `${document.kind} ${document.number} radicado ${document.radicado}` : `${document.kind} ${document.number}`);
  }

  if (!args.ok && args.errorText) {
    parts.push(`Error: ${args.errorText}`);
  }

  return parts.join(" · ");
}

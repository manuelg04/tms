import { v } from "convex/values";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { requireActor, requireSameOrganization } from "./model/access";
import { dashboardStatus } from "./model/dashboardStatus";
import { bogotaDate } from "./model/dispatchWorkflow";
import { selectDocumentPdfArtifact } from "./model/documentPdf";
import {
  filterRegistryRows,
  paginateRegistryRows,
  registryCreatedAtLabel,
  registryStatusLabel,
  type RegistryKind,
  type RegistryRow,
} from "./model/documentRegistry";

const kindValidator = v.union(
  v.literal("orden_cargue"),
  v.literal("remesa"),
  v.literal("manifiesto"),
);
const rowValidator = v.object({
  key: v.string(),
  kind: kindValidator,
  number: v.string(),
  date: v.string(),
  plate: v.string(),
  customer: v.string(),
  agency: v.string(),
  origin: v.string(),
  destination: v.string(),
  status: v.string(),
  statusLabel: v.string(),
  createdBy: v.string(),
  createdAt: v.number(),
  createdAtLabel: v.string(),
  expedienteId: v.optional(v.id("expedientes")),
  remesaId: v.optional(v.id("expedienteRemesas")),
  documentId: v.optional(v.id("documents")),
  pdfUrl: v.optional(v.string()),
  pdfArtifactId: v.optional(v.id("evidenceArtifacts")),
});

export const list = query({
  args: {
    actorToken: v.optional(v.string()),
    organizationId: v.optional(v.id("organizations")),
    kind: kindValidator,
    filters: v.optional(
      v.object({
        number: v.optional(v.string()),
        numberExact: v.optional(v.boolean()),
        date: v.optional(v.string()),
        dateFrom: v.optional(v.string()),
        dateTo: v.optional(v.string()),
        plate: v.optional(v.string()),
        customer: v.optional(v.string()),
        agency: v.optional(v.string()),
        origin: v.optional(v.string()),
        destination: v.optional(v.string()),
        status: v.optional(v.string()),
        createdBy: v.optional(v.string()),
        createdAtLabel: v.optional(v.string()),
      }),
    ),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  returns: v.object({
    rows: v.array(rowValidator),
    total: v.number(),
    page: v.number(),
    pageSize: v.number(),
    pageCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorToken);
    if (args.organizationId)
      requireSameOrganization(actor, args.organizationId);
    const organizationId = actor.organizationId;
    const [expedientes, scopedDocuments, trips] = await Promise.all([
      ctx.db
        .query("expedientes")
        .withIndex("by_organization_and_updated_at", (q) =>
          q.eq("organizationId", organizationId),
        )
        .collect(),
      ctx.db
        .query("documents")
        .withIndex("by_organization_and_kind", (q) =>
          q.eq("organizationId", organizationId).eq("kind", args.kind),
        )
        .collect(),
      ctx.db
        .query("trips")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", organizationId),
        )
        .collect(),
    ]);
    const legacyDocuments = (
      await Promise.all(
        trips.map((trip) =>
          ctx.db
            .query("documents")
            .withIndex("by_trip", (q) => q.eq("tripId", trip._id))
            .collect(),
        ),
      )
    )
      .flat()
      .filter(
        (document) => !document.organizationId && document.kind === args.kind,
      );
    const documents = [...scopedDocuments, ...legacyDocuments];
    const get = cachedGet(ctx);
    const associated = new Map<string, Doc<"documents">[]>();
    const orphans: Doc<"documents">[] = [];
    const expedienteIds = new Set(
      expedientes.map((expediente) => expediente._id),
    );
    for (const document of documents) {
      const trip = await get("trips", document.tripId);
      const expedienteId =
        document.expedienteId ??
        (trip?.organizationId === organizationId
          ? trip.expedienteId
          : undefined);
      if (expedienteId && expedienteIds.has(expedienteId)) {
        associated.set(expedienteId, [
          ...(associated.get(expedienteId) ?? []),
          document,
        ]);
      } else {
        orphans.push(document);
      }
    }
    const rows: RegistryRow[] = [];
    for (const expediente of expedientes) {
      const [order, vehicle, trip] = await Promise.all([
        get("serviceOrders", expediente.serviceOrderId),
        expediente.vehicleId ? get("vehicles", expediente.vehicleId) : null,
        expediente.tripId ? get("trips", expediente.tripId) : null,
      ]);
      const scopedOrder =
        order?.organizationId === organizationId ? order : null;
      const [customer, origin, destination] = await Promise.all([
        scopedOrder
          ? get(
              "customers",
              expediente.loadingOrderDraft?.customerId ??
                scopedOrder.customerId,
            )
          : null,
        scopedOrder
          ? get("customerLocations", scopedOrder.loadingLocationId)
          : null,
        scopedOrder
          ? get("customerLocations", scopedOrder.unloadingLocationId)
          : null,
      ]);
      const base = {
        kind: args.kind,
        expedienteId: expediente._id,
        plate:
          (vehicle?.organizationId === organizationId
            ? vehicle.plate
            : undefined) ??
          (trip?.organizationId === organizationId
            ? trip.vehiclePlate
            : undefined) ??
          "",
        customer:
          customer?.organizationId === organizationId ? customer.name : "",
        origin: origin?.organizationId === organizationId ? origin.city : "",
        destination:
          destination?.organizationId === organizationId
            ? destination.city
            : "",
      };
      const matches = associated.get(expediente._id) ?? [];
      if (args.kind === "remesa") {
        const remesas = await ctx.db
          .query("expedienteRemesas")
          .withIndex("by_expediente_and_sequence", (q) =>
            q.eq("expedienteId", expediente._id),
          )
          .collect();
        const consumed = new Set<string>();
        for (const remesa of remesas.filter(
          (candidate) => candidate.organizationId === organizationId,
        )) {
          const linked = matches.filter(
            (document) =>
              document._id === remesa.documentId ||
              document.expedienteRemesaId === remesa._id ||
              Boolean(remesa.number && document.number === remesa.number),
          );
          for (const document of linked) consumed.add(document._id);
          for (const document of linked.length ? linked : [undefined]) {
            rows.push(
              await makeRow(
                {
                  ...base,
                  remesaId: remesa._id,
                  number: document?.number ?? remesa.number ?? "",
                  date: remesa.draft?.expeditionDate,
                  agency:
                    remesa.draft?.agencyCode ?? expediente.agencyCode ?? "",
                  origin: remesa.draft?.loading?.cityName ?? base.origin,
                  destination:
                    remesa.draft?.unloading?.cityName ?? base.destination,
                  status: remesa.officialState,
                  createdById: remesa.createdBy,
                  createdAt: remesa.createdAt,
                  key: `remesa:${remesa._id}`,
                },
                document,
                get,
                organizationId,
              ),
            );
          }
        }
        for (const document of matches.filter(
          (candidate) => !consumed.has(candidate._id),
        )) {
          rows.push(
            await makeRow(
              {
                ...base,
                number: document.number ?? "",
                agency: expediente.agencyCode ?? "",
                status: "draft",
                createdById: expediente.createdBy,
                createdAt: document.createdAt,
                key: document._id,
              },
              document,
              get,
              organizationId,
            ),
          );
        }
      } else {
        const draft =
          args.kind === "orden_cargue"
            ? expediente.loadingOrderDraft
            : expediente.manifestDraft;
        const number =
          args.kind === "orden_cargue"
            ? (expediente.loadingOrderDraft?.orderNumber ??
              expediente.cargoNumber)
            : (expediente.manifestDraft?.manifestNumber ??
              expediente.manifestNumber);
        if (!draft && !number && !matches.length) continue;
        for (const document of matches.length ? matches : [undefined]) {
          rows.push(
            await makeRow(
              {
                ...base,
                number: document?.number ?? number ?? "",
                date:
                  args.kind === "orden_cargue"
                    ? expediente.loadingOrderDraft?.expeditionDate
                    : expediente.manifestDraft?.issueDate,
                agency: draft?.agencyCode ?? expediente.agencyCode ?? "",
                origin:
                  args.kind === "orden_cargue"
                    ? (expediente.loadingOrderDraft?.loading?.cityName ??
                      base.origin)
                    : (expediente.manifestDraft?.originCityName ?? base.origin),
                destination:
                  args.kind === "orden_cargue"
                    ? (expediente.loadingOrderDraft?.unloading?.cityName ??
                      base.destination)
                    : (expediente.manifestDraft?.destinationCityName ??
                      base.destination),
                status:
                  expediente.status === "cancelled" ? "cancelled" : "draft",
                createdById: expediente.createdBy,
                createdAt: expediente.createdAt,
                key: `${args.kind}:${expediente._id}`,
              },
              document,
              get,
              organizationId,
            ),
          );
        }
      }
    }
    for (const document of orphans) {
      const trip = await get("trips", document.tripId);
      const scopedTrip = trip?.organizationId === organizationId ? trip : null;
      rows.push(
        await makeRow(
          {
            kind: args.kind,
            key: document._id,
            number: document.number ?? "",
            plate: scopedTrip?.vehiclePlate ?? "",
            customer: "",
            agency: "",
            origin: scopedTrip?.originCity ?? "",
            destination: scopedTrip?.destinationCity ?? "",
            status: document.status,
            createdAt: document.createdAt,
          },
          document,
          get,
          organizationId,
        ),
      );
    }
    const result = paginateRegistryRows(
      filterRegistryRows(rows, args.filters),
      args.page,
      args.pageSize,
    );
    return {
      ...result,
      rows: await Promise.all(
        result.rows.map(async (row) => {
          if (!row.documentId) return row;
          const artifacts = await ctx.db
            .query("evidenceArtifacts")
            .withIndex("by_document", (q) => q.eq("documentId", row.documentId))
            .collect();
          const pdf = selectDocumentPdfArtifact(
            artifacts.filter(
              (artifact) => artifact.organizationId === organizationId,
            ),
            row.documentId,
          );
          return pdf
            ? {
                ...row,
                pdfArtifactId: pdf._id,
                pdfUrl: `/api/evidence/${pdf._id}`,
              }
            : row;
        }),
      ),
    };
  },
});

function cachedGet(ctx: QueryCtx) {
  const cache = new Map<string, Promise<unknown>>();
  return <T extends TableNames>(
    table: T,
    id: Id<T>,
  ): Promise<Doc<T> | null> => {
    const key = `${table}:${id}`;
    if (!cache.has(key)) cache.set(key, ctx.db.get(table, id));
    return cache.get(key) as Promise<Doc<T> | null>;
  };
}

type RowInput = Omit<
  RegistryRow,
  "date" | "createdBy" | "createdAtLabel" | "statusLabel"
> & { date?: string; createdById?: Id<"users"> };

async function makeRow(
  input: RowInput,
  document: Doc<"documents"> | undefined,
  get: ReturnType<typeof cachedGet>,
  organizationId: Id<"organizations">,
): Promise<RegistryRow> {
  const { createdById, ...fields } = input;
  const author = createdById ? await get("users", createdById) : null;
  const status = document ? dashboardStatus(document) : input.status;
  const createdAt = document?.createdAt ?? input.createdAt;
  return {
    ...fields,
    key: document?._id ?? input.key,
    kind: input.kind as RegistryKind,
    date: input.date || bogotaDate(createdAt),
    status,
    statusLabel: registryStatusLabel(status),
    createdBy: author?.organizationId === organizationId ? author.name : "",
    createdAt,
    createdAtLabel: registryCreatedAtLabel(createdAt),
    ...(document
      ? { documentId: document._id, pdfUrl: document.pdfUrlPath }
      : {}),
  };
}

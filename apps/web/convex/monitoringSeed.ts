import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { describeReport, formatTripCode, nextDueAt } from "./model/monitoring";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

type SeedReport = {
  offsetMinutes: number;
  kind: "inicio" | "control" | "novedad" | "entrega_parcial" | "entrega";
  location: string;
  channel: "llamada" | "whatsapp" | "presencial" | "otro";
  contacted?: boolean;
  noveltyType?: string;
  observation: string;
  operator: string;
  receivedBy?: string;
  deliveredWeightKg?: number;
  cargoCondition?: "conforme" | "con_novedad";
  documents?: string[];
};

type SeedTrip = {
  manifest: string;
  origin: string;
  destination: string;
  waypoints: string[];
  deliveryWaypoints?: string[];
  plate: string;
  trailerPlate?: string;
  driverName: string;
  driverDocument: string;
  driverPhone: string;
  customer: string;
  cargo: string;
  departureOffsetHours: number;
  expectedHours: number;
  intervalMinutes: number;
  observations?: string;
  reports: SeedReport[];
};

const trips: SeedTrip[] = [
  {
    manifest: "MC-2026-018447",
    origin: "Bucaramanga, Santander",
    destination: "Bogotá D.C.",
    waypoints: ["Piedecuesta", "San Gil", "Socorro", "Barbosa", "Tunja"],
    plate: "TKX582",
    trailerPlate: "R81264",
    driverName: "Jorge Andrés Villamizar Rueda",
    driverDocument: "91.276.540",
    driverPhone: "310 452 7781",
    customer: "Cementos del Oriente S.A.S.",
    cargo: "Cemento gris en sacos · 34.000 kg",
    departureOffsetHours: -33.5,
    expectedHours: 12,
    intervalMinutes: 150,
    observations: "Cliente exige entrega en planta antes de las 17:00. Conductor con celular corporativo.",
    reports: [
      { offsetMinutes: 0, kind: "inicio", location: "Bucaramanga, Santander", channel: "presencial", observation: "Vehículo cargado en planta Girón. Precintos 4471-4472 verificados. Sale con documentación completa.", operator: "Laura Cárdenas" },
      { offsetMinutes: 95, kind: "control", location: "Piedecuesta", channel: "llamada", observation: "Conductor reporta paso por Piedecuesta. Vía en buen estado, carga sin novedad. Se le recuerda reportar en San Gil.", operator: "Laura Cárdenas" },
      { offsetMinutes: 250, kind: "control", location: "San Gil", channel: "llamada", observation: "Parada de 20 min para desayuno en estación Terpel San Gil. Vehículo a la vista del conductor. Todo en orden.", operator: "Laura Cárdenas" },
      { offsetMinutes: 400, kind: "novedad", location: "Socorro", channel: "llamada", noveltyType: "Retraso en ruta", observation: "Paso restringido por obra en la vía Socorro–Oiba. Fila de aprox. 40 min. Conductor tranquilo, carga sin novedad. Se ajusta hora estimada de llegada.", operator: "Andrés Pinilla" },
      { offsetMinutes: 560, kind: "control", location: "Barbosa", channel: "whatsapp", observation: "Confirma por WhatsApp ubicación en Barbosa con foto del tablero. Retoma marcha tras la obra. Sin novedad.", operator: "Andrés Pinilla" },
      { offsetMinutes: 690, kind: "control", location: "Tunja", channel: "llamada", observation: "Reporte en Tunja. Combustible suficiente, sin paradas adicionales. Estima llegada a planta Bogotá en 2 h 30 min.", operator: "Andrés Pinilla" },
      { offsetMinutes: 845, kind: "control", location: "Peaje Andes, Bogotá", channel: "llamada", observation: "Ingresando a Bogotá por autopista Norte. Se avisa al cliente para preparar el descargue.", operator: "Andrés Pinilla" },
      { offsetMinutes: 935, kind: "entrega", location: "Planta Bogotá · Cementos del Oriente", channel: "presencial", observation: "Descargue completo. El cliente verificó el estado de los sacos y firmó la remesa. Ticket de báscula anexo.", operator: "Andrés Pinilla", receivedBy: "Pedro Pérez · Supervisor de recibo", deliveredWeightKg: 34000, cargoCondition: "conforme", documents: ["Remesa firmada por el cliente", "Ticket de báscula", "Acta / planilla de descargue"] },
    ],
  },
  {
    manifest: "MC-2026-018502",
    origin: "Cúcuta, Norte de Santander",
    destination: "Barranquilla, Atlántico",
    waypoints: ["Pamplona", "Bucaramanga", "San Alberto", "Aguachica", "Bosconia", "Fundación"],
    deliveryWaypoints: ["Aguachica"],
    plate: "WGN437",
    trailerPlate: "S27719",
    driverName: "Luis Fernando Contreras Ortiz",
    driverDocument: "88.204.113",
    driverPhone: "301 887 2210",
    customer: "Distribuidora Caribe Ltda.",
    cargo: "Calzado en cajas · 12.400 kg (entrega parcial en Aguachica)",
    departureOffsetHours: -9.6,
    expectedHours: 18,
    intervalMinutes: 180,
    reports: [
      { offsetMinutes: 0, kind: "inicio", location: "Cúcuta, Norte de Santander", channel: "presencial", observation: "Cargue en bodega zona industrial. 640 cajas contadas contra remesa. Conductor confirma botiquín y kit de carretera.", operator: "Laura Cárdenas" },
      { offsetMinutes: 165, kind: "control", location: "Pamplona", channel: "llamada", observation: "Subiendo el páramo con neblina ligera. Velocidad moderada. Carga sin novedad.", operator: "Laura Cárdenas" },
      { offsetMinutes: 340, kind: "control", location: "Bucaramanga, Santander", channel: "llamada", observation: "Reporte desde la variante de Bucaramanga. Tanqueó en Girón. Sin novedad, continúa hacia San Alberto.", operator: "Laura Cárdenas" },
      { offsetMinutes: 515, kind: "control", location: "San Alberto", channel: "whatsapp", observation: "Confirma paso por San Alberto. Pide autorización de parada para almuerzo en Aguachica; se autoriza máximo 30 min.", operator: "Andrés Pinilla" },
    ],
  },
  {
    manifest: "MC-2026-018515",
    origin: "Medellín, Antioquia",
    destination: "Valledupar, Cesar",
    waypoints: ["Puerto Berrío", "Barrancabermeja", "San Alberto", "Curumaní"],
    plate: "LBD903",
    driverName: "Óscar Iván Mejía Restrepo",
    driverDocument: "71.398.622",
    driverPhone: "314 209 6634",
    customer: "Agroinsumos del Cesar S.A.",
    cargo: "Fertilizante en bultos · 28.500 kg",
    departureOffsetHours: -16,
    expectedHours: 16,
    intervalMinutes: 180,
    observations: "Mercancía sensible a humedad. Carpa verificada en cargue.",
    reports: [
      { offsetMinutes: 0, kind: "inicio", location: "Medellín, Antioquia", channel: "presencial", observation: "Cargue en bodega Guayabal. Carpa y amarres verificados. Sale con guía de transporte del cliente.", operator: "Andrés Pinilla" },
      { offsetMinutes: 190, kind: "control", location: "Puerto Berrío", channel: "llamada", observation: "Reporte en Puerto Berrío. Lluvia moderada, carpa en buen estado. Sin novedad.", operator: "Andrés Pinilla" },
      { offsetMinutes: 370, kind: "control", location: "Barrancabermeja", channel: "llamada", observation: "Paso por Barrancabermeja. Parada breve por control de la Policía de Carreteras, documentos en regla.", operator: "Laura Cárdenas" },
      { offsetMinutes: 560, kind: "novedad", location: "San Alberto", channel: "llamada", noveltyType: "Vía cerrada / clima", observation: "Cierre temporal de la Ruta del Sol por derrumbe a la altura de La Mata. Conductor detenido en zona segura (estación de servicio). Se informa al cliente y se mantiene contacto cada hora.", operator: "Laura Cárdenas" },
      { offsetMinutes: 700, kind: "novedad", location: "Ocaña, Norte de Santander", channel: "llamada", noveltyType: "Desvío de ruta", observation: "Autorizado por el jefe de seguridad tomar la vía alterna por Ocaña mientras habilitan la Ruta del Sol. Conductor confirma paso por Ocaña, carga y carpa sin novedad. Se recalcula llegada.", operator: "Laura Cárdenas" },
    ],
  },
];

async function insertSeedTrip(ctx: MutationCtx, organizationId: Id<"organizations">, seed: SeedTrip, sequence: number, now: number): Promise<Id<"monitoringTrips">> {
  const departureAt = now + seed.departureOffsetHours * HOUR;
  const reports = seed.reports.map((r) => ({ ...r, at: departureAt + r.offsetMinutes * MINUTE }));
  const last = reports[reports.length - 1];
  const delivered = last.kind === "entrega";
  const tripId = await ctx.db.insert("monitoringTrips", {
    organizationId,
    code: formatTripCode(sequence),
    manifest: seed.manifest,
    origin: seed.origin,
    destination: seed.destination,
    waypoints: seed.waypoints,
    deliveryWaypoints: seed.deliveryWaypoints,
    plate: seed.plate,
    trailerPlate: seed.trailerPlate,
    driverName: seed.driverName,
    driverDocument: seed.driverDocument,
    driverPhone: seed.driverPhone,
    customer: seed.customer,
    cargo: seed.cargo,
    departureAt,
    expectedArrivalAt: departureAt + seed.expectedHours * HOUR,
    intervalMinutes: seed.intervalMinutes,
    status: delivered ? "entregado" : "en_ruta",
    observations: seed.observations,
    reportCount: reports.length,
    lastReportAt: last.at,
    lastReportSummary: describeReport({ ...last, hasNovelty: last.kind === "novedad" }),
    lastReportHasNovelty: last.kind === "novedad",
    nextDueAt: delivered ? undefined : nextDueAt(last.at, seed.intervalMinutes),
    deliveredAt: delivered ? last.at : undefined,
    createdByName: "Laura Cárdenas",
    createdAt: departureAt - 25 * MINUTE,
    updatedAt: last.at,
  });
  for (const [index, report] of reports.entries()) {
    await ctx.db.insert("monitoringReports", {
      organizationId,
      tripId,
      requestKey: `seed:${seed.manifest}:${index}`,
      kind: report.kind,
      at: report.at,
      location: report.location,
      channel: report.channel,
      contacted: report.contacted ?? true,
      hasNovelty: report.kind === "novedad" || report.cargoCondition === "con_novedad",
      noveltyType: report.noveltyType,
      observation: report.observation,
      receivedBy: report.receivedBy,
      deliveredWeightKg: report.deliveredWeightKg,
      cargoCondition: report.cargoCondition,
      documents: report.documents,
      operatorName: report.operator,
      createdAt: report.at + 90 * 1000,
    });
  }
  return tripId;
}

export const seedDemo = internalMutation({
  args: { organizationId: v.id("organizations"), replace: v.optional(v.boolean()) },
  returns: v.object({ trips: v.number(), removed: v.number() }),
  handler: async (ctx, args) => {
    const organization = await ctx.db.get("organizations", args.organizationId);
    if (!organization || organization.status !== "active") throw new ConvexError("La organización no está activa.");
    const existing = await ctx.db
      .query("monitoringTrips")
      .withIndex("by_org_code", (q) => q.eq("organizationId", args.organizationId))
      .collect();
    let removed = 0;
    if (args.replace) {
      for (const trip of existing) {
        if (!trips.some((seed) => seed.manifest === trip.manifest)) continue;
        const reports = await ctx.db.query("monitoringReports").withIndex("by_trip", (q) => q.eq("tripId", trip._id)).collect();
        for (const report of reports) await ctx.db.delete("monitoringReports", report._id);
        await ctx.db.delete("monitoringTrips", trip._id);
        removed++;
      }
    }
    const remaining = existing.filter((trip) => !args.replace || !trips.some((seed) => seed.manifest === trip.manifest));
    let sequence = remaining.reduce((max, trip) => Math.max(max, Number(trip.code.replace(/\D/g, "")) || 0), 0);
    const now = Date.now();
    let created = 0;
    for (const seed of trips) {
      if (remaining.some((trip) => trip.manifest === seed.manifest)) continue;
      sequence++;
      await insertSeedTrip(ctx, args.organizationId, seed, sequence, now);
      created++;
    }
    return { trips: created, removed };
  },
});

import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

export async function trackingFixture() {
  const t = convexTest(schema, {
    "./_generated/server.ts": () => import("../convex/_generated/server"),
    "./tracking.ts": () => import("../convex/tracking"),
    "./trackingImport.ts": () => import("../convex/trackingImport"),
  });
  const organizationId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("organizations", {
      name: "Transportes de prueba",
      slug: "tracking-test",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    for (const role of ["admin", "operator", "auditor"] as const)
      await ctx.db.insert("users", {
        organizationId: id,
        actorToken: `test-${role}`,
        authSubject: `tracking-${role}`,
        name: `${role} de prueba`,
        email: `${role}@test.invalid`,
        roles: [role],
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
    return id;
  });
  await t.mutation(internal.trackingImport.installReferenceCatalogues, {
    organizationId,
  });
  const ids: Id<"trackingDispatches">[] = [];
  for (const [index, externalCode] of ["70001", "70002", "70003"].entries()) {
    ids.push(
      await t.mutation(internal.trackingImport.importDispatch, {
        organizationId,
        sourceKey: `test-${externalCode}`,
        externalCode,
        queue: index === 2 ? "pending_arrival" : "en_route",
        summary: {
          nem: "",
          manifest: `00000${index + 1}`,
          manifestType: "Generales",
          origin: index === 1 ? "BOGOTA, D.C." : "SANTA MARTA",
          destination: index === 1 ? "CUCUTA" : "GIRON",
          plate: `TST00${index + 1}`,
          cargo: index === 1 ? "GASEOSA" : "MAIZ",
          affiliation: "TERCEROS",
          bodyType: "ESTACAS",
          departureDate: "2026-09-04",
          driver: `Conductor de prueba ${index + 1}`,
          rating: "Sin Calificar",
          customer: `Cliente de prueba ${index + 1}`,
          phone: "",
          lastReportedAt: "2026-09-04 17:00",
          lastCheckpoint: index === 2 ? "Lugar Entrega" : "CIENAGA",
          incident: index === 2 ? "Ok" : "Retrasado",
          time: index === 0 ? "-1,200" : index === 1 ? "8" : undefined,
          alarmCode: index === 1 ? "1" : undefined,
        },
        information: [
          { label: "Agencia", value: "Agencia de prueba" },
          { label: "Fecha Salida", value: "2026-09-04 08:00" },
          { label: "Fecha Planeada Llegada", value: "2026-09-05 08:00" },
          { label: "Ruta", value: "Ruta de prueba vía Ciénaga" },
          { label: "Configuración", value: "3 Ejes Semiremolque 3 Ejes" },
          { label: "Operador GPS", value: "Operador de prueba" },
        ],
        observations: "Información de prueba para seguimiento.",
        communications: "Teléfono",
        protections: "",
        checkpoints: [
          {
            key: "checkpoint-1",
            code: "48",
            label: "CIENAGA",
            kind: "physical",
            scheduledAt: "2026-09-04 10:00",
            order: 1,
            completed: false,
          },
          {
            key: "checkpoint-2",
            code: "49",
            label: "FUNDACION",
            kind: "virtual",
            scheduledAt: "2026-09-04 11:00",
            order: 2,
            completed: false,
          },
          {
            key: "checkpoint-3",
            code: "48",
            label: "CIENAGA",
            kind: "physical",
            scheduledAt: "2026-09-04 12:00",
            order: 3,
            completed: false,
          },
          {
            key: "checkpoint-4",
            code: "9999",
            label: "Lugar Entrega",
            kind: "delivery",
            scheduledAt: "2026-09-05 08:00",
            order: 4,
            completed: false,
          },
        ],
        reports: [
          {
            key: "report-1",
            source: "tracking",
            site: "CIENAGA",
            incidentCode: "3",
            incidentLabel: "Retrasado",
            special: false,
            controlAt: "2026-09-04 09:00",
            recordedAt: "2026-09-04 09:01",
            scheduledAt: "",
            timeText: "-8Min(s)",
            controller: "Controlador de prueba",
            observation: "Reporte anterior",
            createdAt: 1,
          },
          {
            key: "report-2",
            source: "tracking",
            site: "REPORTE GPS",
            incidentCode: "26",
            incidentLabel: "GPS",
            special: false,
            controlAt: "2026-09-04 09:30",
            recordedAt: "2026-09-04 09:31",
            scheduledAt: "",
            timeText: "",
            controller: "Integración de prueba",
            observation: "",
            createdAt: 2,
          },
        ],
        notes: [
          {
            key: "note-1",
            site: "CIENAGA",
            incident: "Retrasado",
            special: false,
            observation: "Reporte anterior\nContinúa en ruta",
            recordedAt: "2026-09-04 09:01",
            controller: "Controlador de prueba",
          },
        ],
        positions: [
          {
            key: "position-1",
            latitude: 4.813,
            longitude: -75.696,
            event: "Novedad 26",
            recordedAt: "2026-09-04 09:30",
            location: "Pereira, Risaralda",
            speed: 0.3,
          },
        ],
        locations: [
          { key: "place-1", name: " CIENAGA ", order: 1 },
          { key: "place-2", name: "A DELANTE DE CIENAGA", order: 2 },
          { key: "place-3", name: " CIENAGA ", order: 3 },
        ],
      }),
    );
  }
  return {
    t,
    organizationId,
    ids,
    admin: t.withIdentity({ subject: "tracking-admin" }),
    operator: t.withIdentity({ subject: "tracking-operator" }),
    auditor: t.withIdentity({ subject: "tracking-auditor" }),
    api,
    internal,
  };
}

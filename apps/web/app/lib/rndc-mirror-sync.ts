import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  mirrorDate,
  mirrorWindow,
  mirrorProcesses,
  type MirrorProcess,
} from "@tms/rndc-core/mirror";
import type { ConvexHttpClient } from "convex/browser";
import { forwardRndcRequest } from "./rndc-gateway";

export function mirrorNumber(value: string) {
  return /^\d+$/.test(value) ? value.replace(/^0+(?=\d)/, "") : value.trim();
}
export async function syncRndcMirror(
  client: Pick<ConvexHttpClient, "query" | "mutation">,
  serviceKey: string,
  input: { process: number; from: string; to: string },
  forward = forwardRndcRequest,
  uploadFetch: typeof fetch = fetch,
) {
  mirrorWindow(input.from, input.to);
  if (!mirrorProcesses.includes(input.process as MirrorProcess))
    throw new Error("Proceso no permitido.");
  const organizationId = await client.query(api.mirror.scope, {});
  const params = new URLSearchParams({
    process: String(input.process),
    from: input.from,
    to: input.to,
  });
  const response = await forward(`/rndc/mirror?${params}`, {
    headers: { "X-TMS-Organization-Id": organizationId },
  });
  const data = await response.json();
  if (!response.ok || !data.ok)
    throw new Error(
      data.error ?? "La consulta RNDC falló; se conserva el espejo anterior.",
    );
  if (
    data.process !== input.process ||
    data.from !== input.from ||
    data.to !== input.to ||
    !Array.isArray(data.records) ||
    typeof data.companyRndcNit !== "string" ||
    typeof data.id !== "string" ||
    !data.evidence
  )
    throw new Error("Respuesta del espejo inválida.");
  const records = data.records.map((fields: Record<string, string>) => ({
    radicado: fields.INGRESOID,
    date: mirrorDate(fields.FECHAING ?? ""),
    documentDate: mirrorDate(fields.FECHAEXPEDICIONMANIFIESTO ?? ""),
    manifest: mirrorNumber(fields.NUMMANIFIESTOCARGA ?? ""),
    remesa: mirrorNumber(fields.CONSECUTIVOREMESA ?? ""),
    plate: fields.NUMPLACA ?? "",
    fields,
  }));
  if (records.length > 2000)
    throw new Error(
      "La consulta supera 2000 registros. Reduce el período para actualizar el espejo.",
    );
  if (
    records.some(
      (r: { radicado: string; date: string }) =>
        !r.radicado || !r.date || r.date < input.from || r.date > input.to,
    )
  )
    throw new Error("Hay registros fuera del período consultado.");
  const url = await client.mutation(api.mirror.uploadEvidence, { serviceKey });
  const upload = await uploadFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: data.id,
      process: data.process,
      from: data.from,
      to: data.to,
      companyRndcNit: data.companyRndcNit,
      startedAt: data.startedAt,
      finishedAt: data.finishedAt,
      httpStatus: data.httpStatus,
      ok: data.ok,
      tipo: 3,
      mode: "live",
      operation: "query",
      ...data.evidence,
    }),
  });
  if (!upload.ok)
    throw new Error(
      "No se pudo guardar la evidencia; el espejo anterior se conserva.",
    );
  const { storageId } = await upload.json();
  const runId = await client.mutation(api.mirror.startRun, {
    serviceKey,
    companyRndcNit: data.companyRndcNit,
    process: input.process,
    from: input.from,
    to: input.to,
    externalId: data.id,
    startedAt: data.startedAt,
    finishedAt: data.finishedAt,
    evidenceId: storageId as Id<"_storage">,
  });
  for (let i = 0; i < records.length; i += 200)
    await client.mutation(api.mirror.ingest, {
      serviceKey,
      runId,
      records: records.slice(i, i + 200),
    });
  await client.mutation(api.mirror.finishRun, {
    serviceKey,
    runId,
    count: records.length,
  });
  return { count: records.length, runId };
}

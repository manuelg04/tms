import type { RndcFulfillmentFinding, RndcRemesaFulfillment } from "../../convex/model/advancedWorkflow";

export type FulfillmentLookupTarget = { documentId: string; number?: string };

export type FulfillmentFetcher = (path: string) => Promise<Response>;

export function readFinding(ok: boolean, body: unknown): RndcFulfillmentFinding {
  if (!ok || !isRecord(body) || !Array.isArray(body.records)) return "unknown";
  if (isRecord(body.response) && typeof body.response.errorText === "string" && body.response.errorText.trim() && !/RNDC11|no encontrado/i.test(body.response.errorText)) {
    return "unknown";
  }
  return body.records.some((record) => isRecord(record) && typeof record.id === "string" && record.id.trim() !== "") ? "found" : "none";
}

async function query(fetcher: FulfillmentFetcher, path: string): Promise<RndcFulfillmentFinding> {
  try {
    const response = await fetcher(path);
    return readFinding(response.ok, await response.json().catch(() => null));
  } catch {
    return "unknown";
  }
}

export async function lookupRemesaFulfillment(
  targets: ReadonlyArray<FulfillmentLookupTarget>,
  fetcher: FulfillmentFetcher
): Promise<Record<string, RndcRemesaFulfillment>> {
  const entries = await Promise.all(
    targets.map(async (target): Promise<[string, RndcRemesaFulfillment]> => {
      if (!target.number) return [target.documentId, { initial: "none", final: "none" }];
      const number = encodeURIComponent(target.number);
      const [initial, final] = await Promise.all([
        query(fetcher, `/rndc/initial-compliance/${number}`),
        query(fetcher, `/rndc/remesa-compliance/${number}`)
      ]);
      return [target.documentId, { initial, final }];
    })
  );
  return Object.fromEntries(entries);
}

export function fulfillmentNotes(
  targets: ReadonlyArray<FulfillmentLookupTarget>,
  findings: Record<string, RndcRemesaFulfillment>,
  knownFulfilled: ReadonlySet<string>
): string[] {
  return targets.flatMap((target) => {
    const finding = findings[target.documentId] ?? {};
    const name = `la remesa ${target.number ?? ""}`.trim();
    if (knownFulfilled.has(target.documentId)) return [];
    if (finding.final === "found") return [`El RNDC tiene un cumplido de ${name} que no se registró desde el TMS; hay que anularlo donde se registró antes de continuar.`];
    if (finding.initial === "found") return [`El RNDC tiene un cumplido inicial de ${name} (tiempos de cargue reportados por la empresa de monitoreo GPS); se anula antes del manifiesto.`];
    if (finding.initial === "unknown") return [`No fue posible consultar en el RNDC si ${name} tiene cumplido inicial; se intentará anularlo y, si no existe, se continúa.`];
    return [];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

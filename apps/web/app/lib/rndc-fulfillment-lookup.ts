import type { RndcFulfillmentFinding, RndcRemesaFulfillment } from "../../convex/model/advancedWorkflow";

export type FulfillmentLookupTarget = { documentId: string; number?: string };

export type FulfillmentFetcher = (path: string) => Promise<Response>;

const NOT_FOUND = /RNDC11|no\s+(se\s+)?encontr|no\s+existe|no\s+hay\s+(registros|datos|informaci)|sin\s+(registros|resultados|datos)|0\s+registros/i;

export type FulfillmentQuery = "initial" | "final";

export type FulfillmentEvidence = {
  documentId: string;
  number: string;
  query: FulfillmentQuery;
  path: string;
  finding: RndcFulfillmentFinding;
  checkedAt: number;
  cached: boolean;
  httpStatus?: number;
  mode?: string;
  startedAt?: string;
  finishedAt?: string;
  requestId?: string;
  rndcStatus?: number;
  errorText?: string;
  records?: unknown;
  requestXml?: string;
  responseXml?: string;
  failure?: string;
};

export type FulfillmentCache = Map<string, { at: number; evidence: FulfillmentEvidence }>;

export function readFinding(ok: boolean, body: unknown): RndcFulfillmentFinding {
  if (!ok || !isRecord(body) || !Array.isArray(body.records)) return "unknown";
  if (isRecord(body.response) && typeof body.response.errorText === "string" && body.response.errorText.trim() && !NOT_FOUND.test(body.response.errorText)) {
    return "unknown";
  }
  return body.records.some((record) => isRecord(record) && typeof record.id === "string" && record.id.trim() !== "") ? "found" : "none";
}

async function query(fetcher: FulfillmentFetcher, path: string, base: Pick<FulfillmentEvidence, "documentId" | "number" | "query">, now: number): Promise<FulfillmentEvidence> {
  try {
    const response = await fetcher(path);
    const body = await response.json().catch(() => null);
    const record = isRecord(body) ? body : {};
    const rndc = isRecord(record.response) ? record.response : {};
    const xml = isRecord(record.xml) ? record.xml : {};
    return {
      ...base,
      path,
      finding: readFinding(response.ok, body),
      checkedAt: now,
      cached: false,
      httpStatus: response.status,
      mode: text(record.mode),
      startedAt: text(record.startedAt),
      finishedAt: text(record.finishedAt),
      requestId: text(record.requestId),
      rndcStatus: typeof rndc.status === "number" ? rndc.status : undefined,
      errorText: text(rndc.errorText),
      records: record.records,
      requestXml: text(xml.request),
      responseXml: text(xml.response)
    };
  } catch (error) {
    return { ...base, path, finding: "unknown", checkedAt: now, cached: false, failure: error instanceof Error ? error.message : "Fallo de red" };
  }
}

export async function lookupRemesaFulfillmentDetailed(
  targets: ReadonlyArray<FulfillmentLookupTarget>,
  fetcher: FulfillmentFetcher,
  options: { cache?: FulfillmentCache; ttlMs?: number; now?: () => number } = {}
): Promise<{ findings: Record<string, RndcRemesaFulfillment>; evidence: FulfillmentEvidence[] }> {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? 120_000;
  const evidence: FulfillmentEvidence[] = [];
  const lookup = async (target: FulfillmentLookupTarget & { number: string }, kind: FulfillmentQuery): Promise<RndcFulfillmentFinding> => {
    const path = `/rndc/${kind === "initial" ? "initial-compliance" : "remesa-compliance"}/${encodeURIComponent(target.number)}`;
    const hit = options.cache?.get(path);
    if (hit && now() - hit.at < ttlMs) {
      evidence.push({ ...hit.evidence, documentId: target.documentId, cached: true });
      return hit.evidence.finding;
    }
    const result = await query(fetcher, path, { documentId: target.documentId, number: target.number, query: kind }, now());
    if (options.cache && result.finding !== "unknown") options.cache.set(path, { at: result.checkedAt, evidence: result });
    evidence.push(result);
    return result.finding;
  };
  const entries = await Promise.all(
    targets.map(async (target): Promise<[string, RndcRemesaFulfillment]> => {
      if (!target.number) return [target.documentId, { initial: "none", final: "none" }];
      const numbered = { ...target, number: target.number };
      const [initial, final] = await Promise.all([lookup(numbered, "initial"), lookup(numbered, "final")]);
      return [target.documentId, { initial, final }];
    })
  );
  return { findings: Object.fromEntries(entries), evidence };
}

export async function lookupRemesaFulfillment(
  targets: ReadonlyArray<FulfillmentLookupTarget>,
  fetcher: FulfillmentFetcher
): Promise<Record<string, RndcRemesaFulfillment>> {
  return (await lookupRemesaFulfillmentDetailed(targets, fetcher)).findings;
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
    const notes: string[] = [];
    if (finding.initial === "found") notes.push(`El RNDC tiene un cumplido inicial de ${name} (tiempos de cargue reportados por la empresa de monitoreo GPS); se anula antes del manifiesto.`);
    if (finding.initial === "unknown") notes.push(`No fue posible consultar en el RNDC si ${name} tiene cumplido inicial; se intentará anularlo y, si no existe, se continúa.`);
    if (finding.final === "unknown") notes.push(`No fue posible consultar en el RNDC si ${name} tiene cumplido final. Si alguien lo registró por fuera del TMS, el RNDC rechazará la anulación de la remesa y habrá que anular ese cumplido primero.`);
    return notes;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

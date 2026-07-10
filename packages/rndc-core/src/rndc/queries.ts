import { extractRndcDocuments } from "./masterData.js";
import type { RndcManifestAcceptance, RndcMessageRequest, RndcScalar, RndcXmlRecord } from "./types.js";

export type RndcDocumentQueryInput = {
  companyRndcNit: string;
  processId: number;
  variables: string[];
  filters?: Record<string, string | number | boolean | null>;
  range?: {
    field: string;
    from: string;
    to: string;
  };
};

export type AcceptanceQueryInput = {
  companyRndcNit: string;
  manifestRadicado?: string;
  from?: string;
  to?: string;
};

export type PendingAcceptanceQueryInput = {
  companyRndcNit: string;
  from: string;
  to: string;
};

const acceptanceVariables = [
  "INGRESOID",
  "FECHAING",
  "INGRESOIDMANIFIESTO",
  "TIPO",
  "CODIDCONDUCTOR",
  "NUMIDCONDUCTOR",
  "OBSERVACION"
];

const pendingAcceptanceVariables = [
  "INGRESOID",
  "FECHAING",
  "NUMMANIFIESTOCARGA",
  "NUMIDTITULARMANIFIESTO",
  "NUMPLACA",
  "NUMIDCONDUCTOR"
];

export function buildRndcDocumentQuery(input: RndcDocumentQueryInput): RndcMessageRequest {
  const documento: RndcXmlRecord = {
    NUMNITEMPRESATRANSPORTE: input.companyRndcNit
  };

  for (const [name, value] of Object.entries(input.filters ?? {})) {
    documento[name] = queryValue(value);
  }

  const request: RndcMessageRequest = {
    tipo: 3,
    procesoId: input.processId,
    variables: input.variables.join(","),
    documento
  };

  if (input.range) {
    request.documentorango = rangeDocument(input.range.field, input.range.from, input.range.to);
  }

  return request;
}

export function buildAcceptanceQuery(input: AcceptanceQueryInput): RndcMessageRequest {
  const request: RndcMessageRequest = {
    tipo: 3,
    procesoId: 73,
    variables: acceptanceVariables.join(","),
    documento: {
      NUMNITEMPRESATRANSPORTE: input.companyRndcNit,
      INGRESOIDMANIFIESTO: input.manifestRadicado
    }
  };

  if (input.from && input.to) {
    request.documentorango = rangeDocument("FECHAING", input.from, input.to);
  }

  return request;
}

export function buildPendingAcceptanceQuery(input: PendingAcceptanceQueryInput): RndcMessageRequest {
  return {
    tipo: 3,
    procesoId: 4,
    variables: pendingAcceptanceVariables.join(","),
    documento: {
      NUMNITEMPRESATRANSPORTE: input.companyRndcNit,
      ACEPTACIONELECTRONICA: "NULL"
    },
    documentorango: rangeDocument("FECHAING", input.from, input.to)
  };
}

export function normalizeRndcQueryRecords(parsed: unknown): Record<string, string>[] {
  return extractRndcDocuments(parsed).map((document) => {
    const record: Record<string, string> = {};

    for (const [name, value] of Object.entries(document)) {
      if (isScalar(value)) {
        record[name.toUpperCase()] = String(value).trim();
      }
    }

    return record;
  });
}

export function normalizeManifestAcceptances(parsed: unknown): RndcManifestAcceptance[] {
  return normalizeRndcQueryRecords(parsed).flatMap((record) => {
    const type = record.TIPO;
    const id = record.INGRESOID;
    const manifestRadicado = record.INGRESOIDMANIFIESTO;
    const acceptedAt = record.FECHAING;

    if ((type !== "C" && type !== "T") || !id || !manifestRadicado || !acceptedAt) {
      return [];
    }

    return [{
      id,
      manifestRadicado,
      type,
      acceptedAt,
      actorIdType: record.CODIDCONDUCTOR || undefined,
      actorId: record.NUMIDCONDUCTOR || undefined,
      observation: record.OBSERVACION || undefined
    }];
  });
}

function rangeDocument(field: string, from: string, to: string): RndcXmlRecord {
  return {
    [`ini${field}`]: queryText(from),
    [`fin${field}`]: queryText(to)
  };
}

function queryValue(value: string | number | boolean | null): RndcScalar {
  if (value === null) {
    return "NULL";
  }

  return typeof value === "string" ? queryText(value) : value;
}

function queryText(value: string): string {
  return `'${value.replaceAll("'", "").trim()}'`;
}

function isScalar(value: unknown): value is RndcScalar {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

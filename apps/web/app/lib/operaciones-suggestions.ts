import { parseMoney, parseTons, requestObservations, type OperacionesRequest } from "./operaciones-request";

export type OperacionesSuggestions = {
  policy?: string;
  observations?: string;
  advance?: string;
  freight?: string;
  weightTons?: string;
  ticketApproved: boolean;
};

export function suggestionsFromRequest(request: OperacionesRequest): OperacionesSuggestions {
  const advance = request.advanceValue ?? parseMoney(request.advanceText);
  const freight = request.freightValue ?? parseMoney(request.freightText);
  return {
    policy: request.policy?.trim() || undefined,
    observations: requestObservations(request),
    advance: advance ? String(advance) : undefined,
    freight: freight ? String(freight) : undefined,
    weightTons: request.freightTons !== undefined ? String(request.freightTons) : parseTons(request.weightText),
    ticketApproved: request.ticketApproved
  };
}

export function withConsignmentSuggestions<Draft extends { policyNumber?: string; generalObservations?: string }>(
  draft: Draft | undefined,
  suggestions: OperacionesSuggestions | null | undefined
): Draft | undefined {
  if (!suggestions) return draft;
  const base = (draft ?? {}) as Draft;
  return {
    ...base,
    policyNumber: present(base.policyNumber) ? base.policyNumber : suggestions.policy,
    generalObservations: present(base.generalObservations) ? base.generalObservations : suggestions.observations
  };
}

export function withManifestSuggestions<Draft extends { freightTotal?: string; advance?: string }>(
  draft: Draft,
  suggestions: OperacionesSuggestions | null | undefined
): Draft {
  if (!suggestions) return draft;
  return {
    ...draft,
    freightTotal: present(draft.freightTotal) ? draft.freightTotal : suggestions.freight,
    advance: present(draft.advance) && draft.advance !== "0" ? draft.advance : suggestions.advance ?? draft.advance
  };
}

export function suggestionSummary(stage: "remesas" | "manifiesto", suggestions: OperacionesSuggestions): string[] {
  const money = (value: string) => `$ ${Number(value).toLocaleString("es-CO")}`;
  if (stage === "remesas") {
    return [
      suggestions.policy ? `póliza ${suggestions.policy}` : null,
      suggestions.observations ? "observaciones de la planilla" : null
    ].filter((item): item is string => Boolean(item));
  }
  return [
    suggestions.freight ? `flete ${money(suggestions.freight)}` : null,
    suggestions.advance ? `anticipo ${money(suggestions.advance)}` : null
  ].filter((item): item is string => Boolean(item));
}

function present(value: string | undefined): boolean {
  return Boolean(value && value.trim());
}

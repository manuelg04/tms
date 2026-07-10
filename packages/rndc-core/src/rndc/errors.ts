export type RndcErrorCategory = "fopat" | "correction" | "acceptance" | "unknown";
export type RndcErrorAction = "correct-request" | "reconcile" | "contact-rndc" | "manual-review";

export type OfficialRndcError = {
  code: string;
  processId: number;
  category: Exclude<RndcErrorCategory, "unknown">;
  variable: string;
  action: RndcErrorAction;
};

export type RndcErrorClassification =
  | (OfficialRndcError & { known: true })
  | {
    code?: string;
    known: false;
    category: "unknown";
    action: "manual-review";
  };

export const OFFICIAL_RNDC_ERROR_FIXTURES: Readonly<Record<string, OfficialRndcError>> = Object.freeze({
  MAN061: officialError("MAN061", 4, "fopat", "RETENCIONFOPAT", "contact-rndc"),
  MAN271: officialError("MAN271", 4, "fopat", "RETENCIONFOPAT", "correct-request"),
  MAN272: officialError("MAN272", 4, "fopat", "RETENCIONFOPAT", "correct-request"),
  MAN273: officialError("MAN273", 4, "fopat", "RETENCIONFOPAT", "correct-request"),
  MAN274: officialError("MAN274", 4, "fopat", "RETENCIONFOPAT", "correct-request"),
  MAN275: officialError("MAN275", 4, "fopat", "RETENCIONFOPAT", "correct-request"),
  MAN276: officialError("MAN276", 4, "fopat", "RETENCIONFOPAT", "correct-request"),
  CMA271: officialError("CMA271", 6, "fopat", "RETENCIONFOPAT", "correct-request"),
  CMA272: officialError("CMA272", 6, "fopat", "RETENCIONFOPAT", "correct-request"),
  CMA273: officialError("CMA273", 6, "fopat", "RETENCIONFOPAT", "correct-request"),
  REC022: officialError("REC022", 38, "correction", "CONSECUTIVOREMESA", "correct-request"),
  REC023: officialError("REC023", 38, "correction", "CODIGOCAMBIO", "correct-request"),
  REC024: officialError("REC024", 38, "correction", "MOTIVOCAMBIO", "correct-request"),
  REC040: officialError("REC040", 38, "correction", "CODIGOCAMBIO", "correct-request"),
  REC136: officialError("REC136", 38, "correction", "NUMIDPROPIETARIO", "correct-request"),
  REC139: officialError("REC139", 38, "correction", "NUMIDPROPIETARIO", "correct-request"),
  REC152: officialError("REC152", 38, "correction", "FECHACITAPACTADADESCARGUE", "correct-request"),
  REC201: officialError("REC201", 38, "correction", "CODSEDEDESTINATARIO", "correct-request"),
  REC202: officialError("REC202", 38, "correction", "CODSEDEDESTINATARIO", "correct-request"),
  ACE003: officialError("ACE003", 73, "acceptance", "NUMIDCONDUCTOR", "manual-review"),
  ACE005: officialError("ACE005", 73, "acceptance", "INGRESOIDMANIFIESTO", "reconcile"),
  ACE010: officialError("ACE010", 73, "acceptance", "CODIGOEMPRESA", "manual-review"),
  ACE020: officialError("ACE020", 73, "acceptance", "TIPO", "correct-request"),
  ACE025: officialError("ACE025", 73, "acceptance", "OBSERVACION", "correct-request"),
  ACE040: officialError("ACE040", 73, "acceptance", "INGRESOIDMANIFIESTO", "correct-request"),
  ACE045: officialError("ACE045", 73, "acceptance", "INGRESOIDMANIFIESTO", "correct-request"),
  ACE050: officialError("ACE050", 73, "acceptance", "NUMIDCONDUCTOR", "correct-request")
});

export function getOfficialRndcError(code: string): OfficialRndcError | undefined {
  return OFFICIAL_RNDC_ERROR_FIXTURES[code.trim().toUpperCase()];
}

export function classifyRndcError(value: string): RndcErrorClassification {
  const code = value.match(/\b[A-Z]{3,8}\d{3}\b/i)?.[0].toUpperCase();
  const official = code ? getOfficialRndcError(code) : undefined;

  if (official) {
    return { ...official, known: true };
  }

  return {
    ...(code ? { code } : {}),
    known: false,
    category: "unknown",
    action: "manual-review"
  };
}

function officialError(
  code: string,
  processId: number,
  category: OfficialRndcError["category"],
  variable: string,
  action: OfficialRndcError["action"]
): OfficialRndcError {
  return { code, processId, category, variable, action };
}

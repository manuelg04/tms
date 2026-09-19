export const STUDY_STATUSES = ["pendiente", "en_estudio", "aprobado", "rechazado"] as const;
export type StudyStatus = (typeof STUDY_STATUSES)[number];

export const STUDY_STATUS_LABELS: Record<StudyStatus, string> = {
  pendiente: "Pendiente",
  en_estudio: "En estudio",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
};

export const DOSSIER_DOCUMENT_KINDS = [
  "Hoja de vida",
  "Cédula de ciudadanía",
  "Licencia de conducción",
  "Certificado de EPS",
  "Certificado de ARL",
  "Certificado de pensión",
  "Póliza / SOAT del vehículo",
  "Tarjeta de propiedad",
  "Referencias laborales",
  "Certificado de residencia",
  "Otro documento",
] as const;

export const REQUIRED_DOCUMENT_KINDS = ["Hoja de vida", "Cédula de ciudadanía", "Licencia de conducción"] as const;

export const SECURITY_CHECK_KINDS = [
  { kind: "Antecedentes judiciales (Policía Nacional)", hint: "antecedentes.policia.gov.co" },
  { kind: "Procuraduría (antecedentes disciplinarios)", hint: "procuraduria.gov.co" },
  { kind: "Contraloría (responsabilidad fiscal)", hint: "contraloria.gov.co" },
  { kind: "Medidas correctivas (RNMC)", hint: "srvcnpc.policia.gov.co" },
  { kind: "Multas e infracciones de tránsito (SIMIT)", hint: "fcm.org.co/simit" },
  { kind: "Licencia vigente y categoría (RUNT)", hint: "runt.gov.co" },
  { kind: "Listas restrictivas (OFAC, ONU)", hint: "sanctionssearch.ofac.treas.gov" },
  { kind: "Verificación de referencias laborales", hint: "llamada a empleadores anteriores" },
] as const;

export const CHECK_RESULT_LABELS = {
  sin_consultar: "Sin consultar",
  sin_novedad: "Sin novedad",
  con_hallazgo: "Con hallazgo",
} as const;

export type CheckResult = keyof typeof CHECK_RESULT_LABELS;

export function formatStudyCode(sequence: number): string {
  return `ES-${String(sequence).padStart(5, "0")}`;
}

export function normalizeDocument(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

export function buildDossierSearchText(input: { document: string; name: string; phone?: string; licenseNumber?: string }): string {
  return [input.document, normalizeDocument(input.document), input.name, input.phone, input.licenseNumber]
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("es");
}

export function initialChecks(): Array<{ kind: string; result: CheckResult }> {
  return SECURITY_CHECK_KINDS.map((item) => ({ kind: item.kind, result: "sin_consultar" }));
}

export function validateDossierInput(input: { document: string; name: string; phone?: string }): void {
  if (normalizeDocument(input.document).length < 5) throw new Error("El documento del conductor debe tener al menos 5 caracteres.");
  if (input.name.trim().length < 5) throw new Error("Escribe el nombre completo del conductor.");
  if (input.phone && input.phone.replace(/\D/g, "").length < 7) throw new Error("El celular del conductor no es válido.");
}

export function validateDecision(input: { outcome: "aprobado" | "rechazado"; reason: string; checks: Array<{ result: CheckResult }> }): void {
  if (input.outcome === "rechazado" && input.reason.trim().length < 10)
    throw new Error("Explica el motivo del rechazo (mínimo 10 caracteres). Es lo que verá la empresa.");
  if (input.reason.length > 1000) throw new Error("El motivo no puede superar 1000 caracteres.");
  const pending = input.checks.filter((c) => c.result === "sin_consultar").length;
  if (input.outcome === "aprobado" && pending > 0)
    throw new Error(`Faltan ${pending} consulta${pending === 1 ? "" : "s"} por registrar antes de aprobar.`);
}

export function missingRequiredDocuments(documents: Array<{ kind: string }>): string[] {
  const present = new Set(documents.map((d) => d.kind));
  return REQUIRED_DOCUMENT_KINDS.filter((kind) => !present.has(kind));
}

export function studyProgress(study: { checks: Array<{ result: CheckResult }> }): { done: number; total: number; findings: number } {
  const total = study.checks.length;
  const done = study.checks.filter((c) => c.result !== "sin_consultar").length;
  const findings = study.checks.filter((c) => c.result === "con_hallazgo").length;
  return { done, total, findings };
}

export function summarizeStudyForDriver(studies: Array<{ status: StudyStatus; customer: string; decidedAt?: number; validUntil?: number; decisionReason?: string }>, now: number) {
  const decided = studies.filter((s) => s.status === "aprobado" || s.status === "rechazado");
  const approved = decided.filter((s) => s.status === "aprobado" && (!s.validUntil || s.validUntil > now));
  const rejected = decided.filter((s) => s.status === "rechazado");
  const open = studies.filter((s) => s.status === "pendiente" || s.status === "en_estudio");
  return { approved, rejected, open };
}

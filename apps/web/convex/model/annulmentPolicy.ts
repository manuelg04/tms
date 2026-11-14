export type AnnulmentActor = { roles: readonly string[]; jobTitle?: string | null };

export const ANNULMENT_POLICY: { roles: readonly string[]; jobTitles: readonly string[] } = {
  roles: ["admin"],
  jobTitles: []
};

export const ANNULMENT_DENIED_REASON = "Tu cargo no permite anular documentos oficiales. Pídele la anulación a un administrador.";

export const ANNULMENT_QUOTA_SCOPE = "Este conteo solo incluye los manifiestos expedidos desde el TMS. Los que la empresa expide por Avansat u otro sistema no se cuentan aquí, así que el tope real del RNDC puede estar más cerca.";

export function canAnnulOfficialDocuments(actor: AnnulmentActor | null | undefined, policy = ANNULMENT_POLICY): boolean {
  if (!actor) return false;
  return actor.roles.some((role) => policy.roles.includes(role)) || Boolean(actor.jobTitle && policy.jobTitles.includes(actor.jobTitle));
}

export type CargoPolicyDefaults = { insurerNit: string; number: string; expiresOn: string };

export function cargoPolicyDefaults(
  raw: { insurerNit?: string; number?: string; expiresOn?: string },
  today: string
): CargoPolicyDefaults {
  const insurerNit = (raw.insurerNit ?? "").replace(/\D/g, "");
  const number = (raw.number ?? "").trim();
  const expiresOn = (raw.expiresOn ?? "").trim();
  if (!insurerNit || !number || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) || expiresOn < today) {
    return { insurerNit: "", number: "", expiresOn: "" };
  }
  return { insurerNit, number, expiresOn };
}

export function companyCargoPolicy(today: string): CargoPolicyDefaults {
  return cargoPolicyDefaults(
    {
      insurerNit: process.env.NEXT_PUBLIC_CARGO_POLICY_INSURER_NIT,
      number: process.env.NEXT_PUBLIC_CARGO_POLICY_NUMBER,
      expiresOn: process.env.NEXT_PUBLIC_CARGO_POLICY_EXPIRES_ON
    },
    today
  );
}

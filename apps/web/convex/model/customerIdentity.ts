import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const NIT_TYPES = new Set(["N", "NIT"]);
const NIT_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

export function isNitType(type: string | undefined): boolean {
  return NIT_TYPES.has((type ?? "").trim().toUpperCase());
}

export function nitCheckDigit(base: string): string {
  const digits = base.split("").reverse();
  const sum = digits.reduce((total, digit, index) => total + Number(digit) * (NIT_WEIGHTS[index] ?? 0), 0);
  const remainder = sum % 11;
  return String(remainder < 2 ? remainder : 11 - remainder);
}

export function customerIdentityCandidates(type: string | undefined, number: string | undefined): { exact: string[]; nitVariants: string[] } {
  const raw = (number ?? "").trim();
  if (!raw) return { exact: [], nitVariants: [] };
  const digits = raw.replace(/\D/g, "");
  const exact = digits && digits !== raw ? [raw, digits] : [raw];
  if (!isNitType(type) || !digits) return { exact, nitVariants: [] };
  if (digits.length === 9) return { exact, nitVariants: [`${digits}${nitCheckDigit(digits)}`] };
  if (digits.length === 10 && nitCheckDigit(digits.slice(0, 9)) === digits[9]) return { exact, nitVariants: [digits.slice(0, 9)] };
  return { exact, nitVariants: [] };
}

export async function findCustomerByIdentity(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  type: string | undefined,
  number: string | undefined
): Promise<Doc<"customers"> | null> {
  const { exact, nitVariants } = customerIdentityCandidates(type, number);
  for (const candidate of exact) {
    const row = await ctx.db
      .query("customers")
      .withIndex("by_organization_and_identification", (q) => q.eq("organizationId", organizationId).eq("identificationNumber", candidate))
      .first();
    if (row) return row;
  }
  for (const candidate of nitVariants) {
    const rows = await ctx.db
      .query("customers")
      .withIndex("by_organization_and_identification", (q) => q.eq("organizationId", organizationId).eq("identificationNumber", candidate))
      .take(5);
    const row = rows.find((item) => !item.identificationType || isNitType(item.identificationType));
    if (row) return row;
  }
  return null;
}

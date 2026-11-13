import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import productCodes from "./rndcProductCodes.json";
import { isMerchandiseCode } from "./merchandiseProducts";
import { resolveMerchandise, searchMerchandise, type MerchandiseCandidate, type MerchandiseMatch } from "./merchandiseSearch";

const OWN_PRODUCT_LIMIT = 600;

const SEARCH_KEYWORDS: Record<string, string> = {
  "000201": "res",
  "000207": "pollo gallina",
  "000407": "huevos",
  "000701": "papa",
  "001905": "pan galletas",
  "002201": "agua botella",
  "002202": "gaseosa refresco bebida jugo",
  "002309": "concentrado purina mascotas",
  "002505": "arena",
  "002517": "grava gravilla triturado balasto recebo",
  "002523": "cemento gris",
  "002710": "acpm diesel gasolina combustible lubricante",
  "002711": "glp propano",
  "003402": "detergente",
  "003917": "pvc manguera",
  "004011": "llanta",
  "006907": "porcelanato enchape",
  "007213": "alambron",
  "007308": "estructura metalica",
  "008703": "carro automovil camioneta",
  "008711": "moto motocicleta",
  "009403": "mueble",
  "009880": "paqueteo paquete",
  "009980": "mercancia varia general surtido"
};

export const rndcProductCandidates: readonly MerchandiseCandidate[] = (productCodes as string[][]).map(([code, name]) => ({ code, name, source: "rndc", keywords: SEARCH_KEYWORDS[code] }));

const rndcProductNames = new Map(rndcProductCandidates.map((candidate) => [candidate.code, candidate.name]));

export function rndcProductName(code: string | undefined): string | undefined {
  return code ? rndcProductNames.get(code.trim()) : undefined;
}

async function merchandiseCandidates(ctx: QueryCtx, organizationId: Id<"organizations">): Promise<MerchandiseCandidate[]> {
  const rows = await ctx.db
    .query("merchandiseProducts")
    .withIndex("by_organization_and_search", (q) => q.eq("organizationId", organizationId))
    .take(OWN_PRODUCT_LIMIT);
  const own: MerchandiseCandidate[] = rows.map((row) => ({
    name: row.name,
    code: row.code,
    source: "own",
    natureCode: row.natureCode,
    packagingCode: row.packagingCode,
    uses: row.uses
  }));
  return [...own, ...rndcProductCandidates];
}

export async function searchMerchandiseCatalog(ctx: QueryCtx, organizationId: Id<"organizations">, term: string, limit?: number): Promise<MerchandiseMatch[]> {
  return searchMerchandise(await merchandiseCandidates(ctx, organizationId), term, limit);
}

export async function resolveMerchandiseCode(ctx: QueryCtx, organizationId: Id<"organizations">, name: string | undefined): Promise<MerchandiseMatch | undefined> {
  if (!name?.trim()) return undefined;
  return resolveMerchandise(await merchandiseCandidates(ctx, organizationId), name);
}

export type CargoClassification = {
  cargoDescription?: string;
  merchandiseCode?: string;
  natureOfCargo?: string;
  packagingCode?: string;
};

export async function completeCargoClassification<T extends CargoClassification>(ctx: QueryCtx, organizationId: Id<"organizations">, draft: T, productName = draft.cargoDescription): Promise<T> {
  if (isMerchandiseCode(draft.merchandiseCode) && draft.natureOfCargo?.trim()) return draft;
  const match = isMerchandiseCode(draft.merchandiseCode) ? undefined : await resolveMerchandiseCode(ctx, organizationId, productName);
  const merchandiseCode = isMerchandiseCode(draft.merchandiseCode) ? draft.merchandiseCode : match?.code;
  if (!merchandiseCode) return draft;
  return {
    ...draft,
    merchandiseCode,
    natureOfCargo: draft.natureOfCargo?.trim() || match?.natureCode || "1",
    packagingCode: draft.packagingCode?.trim() || match?.packagingCode || draft.packagingCode
  };
}

import { normalizeSearchText } from "./searchText";

export type MerchandiseCandidate = {
  name: string;
  code: string;
  source: "own" | "rndc";
  natureCode?: string;
  packagingCode?: string;
  uses?: number;
  keywords?: string;
};

export type MerchandiseMatch = MerchandiseCandidate & { score: number };

const STOP_WORDS = new Set([
  "a", "al", "con", "de", "del", "demas", "el", "en", "excepto", "incluidas", "incluidos", "incluso", "la", "las", "los", "o", "otra", "otras", "otro", "otros", "para", "por", "que", "sin", "su", "sus", "u", "un", "una", "y"
]);

const AUTO_RESOLVE_QUALITY = 0.8;
const HEAD_TOKEN_QUALITY = 0.9;

function stem(token: string): string {
  let value = token;
  if (value.length > 3 && value.endsWith("s")) value = value.slice(0, -1);
  if (value.length > 4 && value.endsWith("e")) value = value.slice(0, -1);
  return value;
}

export function merchandiseTokens(value: string | undefined): string[] {
  return normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .map(stem);
}

function withinDistance(left: string, right: string, limit: number): boolean {
  if (Math.abs(left.length - right.length) > limit) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let best = row;
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      const value = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + cost);
      current.push(value);
      if (value < best) best = value;
    }
    if (best > limit) return false;
    previous = current;
  }
  return previous[right.length] <= limit;
}

function tokenScore(wanted: string, candidate: string): number {
  if (wanted === candidate) return 1;
  if (wanted.length >= 4 && candidate.startsWith(wanted)) return 0.9;
  if (candidate.length >= 5 && wanted.startsWith(candidate)) return 0.8;
  const limit = wanted.length >= 8 ? 2 : wanted.length >= 5 ? 1 : 0;
  if (limit > 0 && withinDistance(wanted, candidate, limit)) return 0.7;
  return 0;
}

type Scored = { quality: number; rank: number; headLeads: boolean; coverage: number };

function scoreCandidate(wanted: string[], wantedText: string, candidate: MerchandiseCandidate): Scored | undefined {
  const ownBonus = candidate.source === "own" ? 0.03 : 0;
  if (normalizeSearchText(candidate.name) === wantedText) {
    return { quality: 2, rank: 2 + ownBonus, headLeads: true, coverage: 1 };
  }
  const nameTokens = merchandiseTokens(candidate.name);
  const tokens = candidate.keywords ? [...nameTokens, ...merchandiseTokens(candidate.keywords)] : nameTokens;
  if (tokens.length === 0) return undefined;
  let total = 0;
  let matched = 0;
  let headLeads = false;
  let firstPosition = tokens.length;
  for (let wantedIndex = 0; wantedIndex < wanted.length; wantedIndex += 1) {
    let best = 0;
    let position = tokens.length;
    for (let index = 0; index < tokens.length; index += 1) {
      const score = tokenScore(wanted[wantedIndex], tokens[index]);
      if (score > best) {
        best = score;
        position = index;
      }
    }
    if (wantedIndex === 0) headLeads = best >= HEAD_TOKEN_QUALITY && position === 0;
    if (best === 0) continue;
    total += best;
    matched += 1;
    if (position < firstPosition) firstPosition = position;
  }
  const coverage = matched / wanted.length;
  if (matched === 0 || (coverage < 0.5 && !headLeads)) return undefined;
  const quality = total / wanted.length;
  const rank = quality + 0.1 / (1 + firstPosition) + 0.02 / Math.max(nameTokens.length, 1) + ownBonus;
  return { quality, rank, headLeads, coverage };
}

function rankMerchandise(candidates: readonly MerchandiseCandidate[], term: string | undefined): Array<{ candidate: MerchandiseCandidate; scored: Scored }> {
  const wantedText = normalizeSearchText(term);
  if (/^\d{3,6}$/.test(wantedText)) {
    return candidates
      .filter((candidate) => candidate.code.includes(wantedText))
      .map((candidate) => {
        const exact = candidate.code === wantedText.padStart(6, "0");
        return { candidate, scored: { quality: exact ? 2 : 0.5, rank: exact ? 2 : 0.5, headLeads: exact, coverage: 1 } };
      })
      .sort((left, right) => right.scored.rank - left.scored.rank);
  }
  const wanted = merchandiseTokens(term);
  if (wanted.length === 0) return [];
  const ranked: Array<{ candidate: MerchandiseCandidate; scored: Scored }> = [];
  for (const candidate of candidates) {
    const scored = scoreCandidate(wanted, wantedText, candidate);
    if (scored) ranked.push({ candidate, scored });
  }
  return ranked.sort((left, right) =>
    right.scored.rank - left.scored.rank ||
    (right.candidate.uses ?? 0) - (left.candidate.uses ?? 0) ||
    left.candidate.name.length - right.candidate.name.length
  );
}

export function searchMerchandise(candidates: readonly MerchandiseCandidate[], term: string | undefined, limit = 12): MerchandiseMatch[] {
  return rankMerchandise(candidates, term).slice(0, limit).map(({ candidate, scored }) => ({ ...candidate, score: scored.rank }));
}

export function resolveMerchandise(candidates: readonly MerchandiseCandidate[], name: string | undefined): MerchandiseMatch | undefined {
  const [best] = rankMerchandise(candidates, name);
  if (!best) return undefined;
  const { quality, headLeads, coverage } = best.scored;
  const confident = (coverage === 1 && quality >= AUTO_RESOLVE_QUALITY) || headLeads;
  return confident ? { ...best.candidate, score: best.scored.rank } : undefined;
}

export function merchandiseShortName(value: string): string {
  const cut = value.split(/[;(,:]/)[0].trim() || value.trim();
  return cut.replace(/\s+/g, " ").toUpperCase().slice(0, 60);
}

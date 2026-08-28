export function normalizeSearchText(...parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

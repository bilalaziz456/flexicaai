/** Shared pagination helpers for the list screens. */

/** Selectable "N per page" sizes; the first is the default. */
export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = PAGE_SIZE_OPTIONS[0];

/** Parses a `?page=` value into a 1-based page number (defaults to 1). */
export function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Parses a `?size=` value into one of `options` (default 20 / 50 / 100); else the first. */
export function parsePageSize(
  raw: string | undefined,
  options: readonly number[] = PAGE_SIZE_OPTIONS,
): number {
  const n = Number(raw);
  return options.includes(n) ? n : options[0];
}

/** SQL OFFSET for a 1-based page. */
export function pageOffset(page: number, pageSize: number = DEFAULT_PAGE_SIZE): number {
  return (page - 1) * pageSize;
}

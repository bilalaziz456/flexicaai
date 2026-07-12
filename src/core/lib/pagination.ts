/** Shared pagination helpers for the list screens. */

/** Selectable "N per page" sizes; the first is the default. */
export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = PAGE_SIZE_OPTIONS[0];

/** Parses a `?page=` value into a 1-based page number (defaults to 1). */
export function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Parses a `?size=` value into an allowed page size (defaults to 20). */
export function parsePageSize(raw: string | undefined): number {
  const n = Number(raw);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n)
    ? n
    : DEFAULT_PAGE_SIZE;
}

/** SQL OFFSET for a 1-based page. */
export function pageOffset(page: number, pageSize: number = DEFAULT_PAGE_SIZE): number {
  return (page - 1) * pageSize;
}

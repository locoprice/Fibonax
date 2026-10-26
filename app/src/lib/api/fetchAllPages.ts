import { toApiError } from '@/lib/api/apiError';

/**
 * Rows asked for per request. The server stops a read at its row cap (1,000,
 * Supabase's default) without saying so, so a longer list must be read in
 * pages of at most that size. Same size as PAGE_ROWS in
 * extension/background/background.js.
 */
export const PAGE_ROWS = 1000;

/** What one page of a query answers: supabase-js query builders fit this shape. */
interface PageResult<T> {
  data: T[] | null;
  error: unknown;
}

/**
 * Every row a query matches, a page at a time. `page(from, to)` runs the query
 * for that inclusive range; order it on a unique key so pages never overlap or
 * skip a row. Stops at the first page shorter than PAGE_ROWS.
 */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await page(from, from + PAGE_ROWS - 1);
    if (error) throw toApiError(error);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_ROWS) return rows;
  }
}

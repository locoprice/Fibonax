import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages, PAGE_ROWS } from '@/lib/api/fetchAllPages';

// The server stops one read at 1,000 rows without a word. The Activity page
// read a year of uses in one request, and an account with 2,790 uses saw a
// third of them. fetchAllPages keeps asking until a page comes back short.

function table(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  return vi.fn(async (from: number, to: number) => ({
    data: rows.slice(from, Math.min(to + 1, from + PAGE_ROWS)),
    error: null,
  }));
}

describe('fetchAllPages', () => {
  it('reads every row past the server cap', async () => {
    const page = table(2790);
    const rows = await fetchAllPages(page);
    expect(rows).toHaveLength(2790);
    expect(rows[2789]).toEqual({ id: 2789 });
    expect(page.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('asks once when everything fits in one page', async () => {
    const page = table(187);
    await expect(fetchAllPages(page)).resolves.toHaveLength(187);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('asks one more time when the rows fill whole pages exactly', async () => {
    const page = table(2000);
    await expect(fetchAllPages(page)).resolves.toHaveLength(2000);
    expect(page).toHaveBeenCalledTimes(3);
  });

  it('treats no rows as an empty list', async () => {
    await expect(fetchAllPages(async () => ({ data: null, error: null }))).resolves.toEqual([]);
  });

  it('stops with a readable error when a page fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const page = vi.fn(async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }));
    await expect(fetchAllPages(page)).rejects.toThrow('That took too long. Try again.');
  });
});

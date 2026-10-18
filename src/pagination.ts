/**
 * Cursor pagination, as an async iterator.
 *
 * The API returns an opaque `nextCursor`; a caller should never loop on it by
 * hand or construct one. Lazy: a page is fetched only when the previous one has
 * been consumed.
 */

export interface Page<T> {
  items?: T[];
  nextCursor?: string | null;
  hasMore?: boolean;
}

export async function* paginate<T>(
  fetchPage: (cursor?: string) => Promise<Page<T>>,
  options: { maxItems?: number } = {},
): AsyncGenerator<T, void, undefined> {
  let cursor: string | undefined;
  let produced = 0;

  for (;;) {
    const page = await fetchPage(cursor);
    for (const item of page.items ?? []) {
      yield item;
      produced += 1;
      if (options.maxItems !== undefined && produced >= options.maxItems) return;
    }

    // `hasMore` alone is not enough: a page can claim more while giving no
    // cursor to reach it, and looping on that spins forever.
    if (!page.nextCursor) return;
    cursor = page.nextCursor;
  }
}

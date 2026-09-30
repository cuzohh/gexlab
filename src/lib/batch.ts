/**
 * Run an async job over a list a few at a time.
 *
 * The watchlist scan asked for every ticker's option chain at once. Each of
 * those responses is a delayed chain of several megabytes, so a twenty-name
 * list opened twenty simultaneous multi-megabyte reads and the origin throttled
 * most of them — which is why a scan so often came back with nothing.
 *
 * Results keep the order of the input regardless of the order they finish in,
 * so a caller can pair them back to what it asked for.
 */
export async function inBatches<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: width }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await work(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

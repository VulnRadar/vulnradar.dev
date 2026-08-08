import { vi } from "vitest";

/**
 * Generic mock pool for the scripts/_lib/_lib.check-*.mjs suites: each
 * check module issues several ad-hoc COUNT/SELECT queries built from
 * table/column names already known to the test (passed in via a
 * hand-built `ctx`, not introspected), so routing by a substring match
 * against the SQL text is simpler and clearer here than replicating each
 * module's exact query shape in a giant switch.
 *
 * Routes are tried in order; the first whose `match` returns true wins.
 * An unmatched query throws immediately with the SQL text, so a test
 * fixture gap fails loudly instead of silently returning `{rows: []}`
 * and masking a bug.
 */
export function makeQueryRouterPool(
  routes: Array<{
    match: (sql: string) => boolean;
    handler: (sql: string, params?: unknown[]) => unknown;
  }>,
) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    for (const route of routes) {
      if (route.match(sql)) return route.handler(sql, params);
    }
    throw new Error(`Unrouted query in test mock: ${sql}`);
  });
  return { query };
}

export const contains = (needle: string) => (sql: string) =>
  sql.includes(needle);
export const containsAll =
  (...needles: string[]) =>
  (sql: string) =>
    needles.every((n) => sql.includes(n));

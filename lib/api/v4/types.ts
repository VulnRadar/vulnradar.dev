/**
 * Every operation API v4 serves. A closed list on purpose: the error registry,
 * the OpenAPI document and the migration notes are all keyed by these names,
 * so an operation that is not here has no contract. V4_ROUTES in
 * lib/api/route-registry.ts carries the same names per method, and
 * tests/lib/api/v4/types.test.ts keeps the two identical.
 */
export const OP_NAMES = [
  "auth.me",
  "demoScan.create",
  "findingTypes.list",
  "openapi.get",
  "history.list",
  "history.clear",
  "history.get",
  "history.update",
  "history.delete",
  "history.report",
  "history.summarize",
  "scan.create",
  "scan.createAuthenticated",
  "scan.createBulk",
  "scan.createCrawl",
  "scan.discoverCrawl",
  "scan.discover",
  "scan.discoverProgress",
  "scan.reputation",
  "scan.status",
  "scan.cancel",
  "scan.verify",
  "scan.verifyBatch",
] as const;

export type OpName = (typeof OP_NAMES)[number];

export interface V4AdapterContext {
  op: OpName;
  /** The status the handler answered with. */
  status: number;
  requestId: string;
}

export interface V4AdapterResult {
  /** Replaces the handler's status (a create answers 202). */
  status?: number;
  /** Added to the handler's headers (a create adds Location). */
  headers?: Record<string, string>;
  body: unknown;
}

/**
 * Turns the handler's JSON body, which is the v3 superset, into the v4
 * contract. Allow-list only: a key an adapter does not name is not sent.
 */
export type V4Adapter = (
  body: unknown,
  context: V4AdapterContext,
) => V4AdapterResult;

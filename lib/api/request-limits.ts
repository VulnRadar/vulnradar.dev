/**
 * Request-shape limits that have to be enforced in two places at once.
 *
 * These live in their own module, with no imports, specifically so
 * `middleware.ts` can use them: it runs on the edge runtime, and
 * lib/api/api-utils.ts (where the body cap used to be a private const) pulls
 * in the database pool and the session helpers, neither of which can be
 * loaded there.
 */

/**
 * Hard cap on request bodies. Without one, a client can send a multi-GB JSON
 * body that the server buffers before rejecting. 1 MiB is more than enough for
 * every route shape in this app (the largest legitimate payload is a few KB).
 *
 * Enforced in middleware for every /api/ request that carries a body, and
 * again inside `parseBody`. The middleware check is the real guarantee: the
 * cap was documented as a property of the API but only 19 of the 73
 * body-reading routes went through parseBody, so the other 54 (the whole scan
 * surface, teams, support tickets, both contact forms) had no cap at all and
 * a new route could opt out simply by forgetting to call it.
 * ref: AUDIT-013#dup-04
 */
export const MAX_REQUEST_BODY_BYTES = 1 * 1024 * 1024;

/** HTTP methods that may carry a request body. */
export const BODY_CARRYING_METHODS = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

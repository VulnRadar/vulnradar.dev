/**
 * Shared finding-diff primitive.
 *
 * `app/api/v3/compare/route.ts` (manual, user-triggered "compare two scans")
 * and the automatic regression-alert check in execute-scan.ts /
 * execute-crawl-scan.ts (lib/scanner/regression-alert.ts) both need the same
 * operation: given two finding lists, which entries are new, which
 * disappeared, and which are present in both. This is that one
 * implementation, parameterized by how callers identify "the same finding"
 * so each call site can pick the key that fits its own data:
 *
 * - The compare route only has `{title, severity}` once it has stripped a
 *   stored scan's findings down for the response, so it keys on `title`.
 * - The regression-alert check has full `Vulnerability` objects and keys on
 *   `id`, which (see lib/scanner/_helpers.ts's `generateId`) is a stable
 *   `<checkId>--<urlHash>` string: the same check firing against the same
 *   URL always produces the same id across scans, which is what makes
 *   diffing two scans of the same site meaningful in the first place.
 */

export interface FindingDiff<T> {
  /** Present in `after` but not `before`. */
  added: T[];
  /** Present in `before` but not `after`. */
  removed: T[];
  /** Present in both. */
  unchanged: T[];
}

export function diffFindingsByKey<T>(
  before: readonly T[],
  after: readonly T[],
  keyFn: (item: T) => string,
): FindingDiff<T> {
  const beforeKeys = new Set(before.map(keyFn));
  const afterKeys = new Set(after.map(keyFn));

  return {
    added: after.filter((f) => !beforeKeys.has(keyFn(f))),
    removed: before.filter((f) => !afterKeys.has(keyFn(f))),
    unchanged: after.filter((f) => beforeKeys.has(keyFn(f))),
  };
}

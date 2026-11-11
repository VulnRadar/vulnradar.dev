/**
 * Everything before the LAST "--" in a stable finding id
 * (`<checkId>--<hash>`, see lib/scanner/_helpers.ts's generateId). Using
 * the last occurrence, not the first, is defensive rather than load-
 * bearing today -- no check id in lib/scanner/checks-data/*.json currently
 * contains a literal "--" -- but it is what the id format actually
 * guarantees: the hash is everything after the final separator.
 *
 * A module of its own because check-accuracy.ts opens the database pool at
 * import, and the finding page, the SARIF export and the check-page link all
 * need this one rule without dragging a pool into a browser bundle.
 */
export function extractCheckId(findingId: string): string {
  const idx = findingId.lastIndexOf("--");
  return idx === -1 ? findingId : findingId.slice(0, idx);
}

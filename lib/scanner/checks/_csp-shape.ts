/**
 * What a Content-Security-Policy value is made of, read by directive name.
 *
 * Shared by the legacy header detectors and the PageCheck half of the CSP
 * family, so the two cannot disagree about whether a policy has a directive.
 * The value may be several policies: `Headers.get` joins repeated headers with
 * ", ", and every policy in the list is enforced, so a directive in any of
 * them counts. A source expression cannot hold a literal comma, so splitting
 * on one is safe.
 */

function directiveNames(csp: string): string[] {
  return csp
    .split(/[;,]/)
    .map((part) => part.trim().split(/\s+/)[0]?.toLowerCase() ?? "")
    .filter(Boolean);
}

/**
 * True when one of `names` is a directive of the policy. A search of the raw
 * text also matches the name inside another directive's value, so
 * `report-uri /x/frame-ancestors-report` read as a framing policy.
 */
export function cspHasDirective(csp: string, ...names: string[]): boolean {
  return directiveNames(csp).some((name) => names.includes(name));
}

/**
 * True when the policy restricts what the page may load at all. A policy of
 * only `frame-ancestors 'none'` is the modern X-Frame-Options and says nothing
 * about content, so telling its author that frame-src and object-src are
 * missing grades it against a job it never took on. csp-no-default-src already
 * gives such a policy the one honest finding.
 */
export function cspRestrictsContent(csp: string): boolean {
  // Every fetch directive is named *-src, or *-src-elem / *-src-attr.
  return directiveNames(csp).some((name) => /-src(?:-elem|-attr)?$/.test(name));
}

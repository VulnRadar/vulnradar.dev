/**
 * The nine opt-in active probes, modeled as an independent selection group
 * (id / label / description) the same way service probes are, rather than as
 * nine new `Category` taxonomy values. Every probe still emits findings under
 * the single `active-probes` category and stays behind the same opt-in +
 * verified-domain-ownership gate -- this module only splits the SELECTION so
 * a caller can ask for one probe without triggering the other eight.
 *
 * Pure data + string helpers, no server imports, so both the scan form
 * (client) and the scan engine / API routes (server) share one source of
 * truth for the probe ids, their descriptions, and how a selection is encoded
 * inside the `scanners` array.
 *
 * Wire format: each selected probe rides in the existing `scanners` array as
 * `active-probes:<id>` (e.g. "active-probes:xss"). The bare, un-suffixed
 * `active-probes` is retained as a LEGACY umbrella meaning "all nine" so that
 * scans, bookmarked URLs, and API clients created before this split -- which
 * only ever sent `active-probes` -- keep running all nine probes unchanged.
 */

/** The category id every active-probe finding is filed under, and the legacy
 *  umbrella selector that means "run all nine". */
export const ACTIVE_PROBES_CATEGORY = "active-probes";

export type ActiveProbeId =
  | "xss"
  | "sqli"
  | "ssti"
  | "command-injection"
  | "open-redirect"
  | "graphql"
  | "cors"
  | "http-methods"
  | "x-forwarded-host";

export interface ActiveProbeOption {
  id: ActiveProbeId;
  /** Short name for the toggle row. */
  label: string;
  /** One line, factual, describing what the probe sends and what it flags. */
  description: string;
}

/** Rendered in the scan-options panel, in run order. Descriptions say what
 *  each probe actually submits to the target and what it looks for. */
export const ACTIVE_PROBE_OPTIONS: readonly ActiveProbeOption[] = [
  {
    id: "xss",
    label: "Reflected XSS canary",
    description:
      "Submits a unique canary through discovered form fields and flags any that reflect it unescaped into the HTML.",
  },
  {
    id: "sqli",
    label: "Error-based SQL injection",
    description:
      "Submits an unescaped quote through form fields and flags database error messages that surface in the response.",
  },
  {
    id: "ssti",
    label: "Template injection (SSTI)",
    description:
      "Submits a tagged arithmetic expression in common template syntax and flags responses that return the computed result.",
  },
  {
    id: "command-injection",
    label: "OS command injection",
    description:
      "Submits a shell metacharacter plus a tagged expression and flags responses that return the shell-computed result.",
  },
  {
    id: "open-redirect",
    label: "Confirmed open redirect",
    description:
      "Sets a page's own redirect parameter to an external canary URL and flags a 3xx that forwards to it.",
  },
  {
    id: "graphql",
    label: "GraphQL introspection",
    description:
      "Sends an introspection query to common GraphQL endpoints and flags any that return the full schema.",
  },
  {
    id: "cors",
    label: "Active CORS reflection",
    description:
      "Sends a spoofed Origin header and flags an endpoint that reflects it into Access-Control-Allow-Origin, worse still with credentials.",
  },
  {
    id: "http-methods",
    label: "Dangerous HTTP methods",
    description:
      "Sends OPTIONS and TRACE requests and flags risky HTTP methods the server still accepts.",
  },
  {
    id: "x-forwarded-host",
    label: "X-Forwarded-Host injection",
    description:
      "Sends a spoofed X-Forwarded-Host header and flags responses that reflect it into links or redirects.",
  },
];

export const ACTIVE_PROBE_IDS: readonly ActiveProbeId[] =
  ACTIVE_PROBE_OPTIONS.map((o) => o.id);

const ACTIVE_PROBE_ID_SET: ReadonlySet<string> = new Set(ACTIVE_PROBE_IDS);

/** The token this probe rides in the `scanners` array as, e.g.
 *  "active-probes:xss". */
export function activeProbeScanner(id: ActiveProbeId): string {
  return `${ACTIVE_PROBES_CATEGORY}:${id}`;
}

/** True for either the legacy umbrella `active-probes` or any per-probe
 *  `active-probes:<id>` selector. Used by the domain-ownership gate so a
 *  request naming any active probe is held to the same verified-domain rule. */
export function isActiveProbeSelector(scanner: string): boolean {
  if (scanner === ACTIVE_PROBES_CATEGORY) return true;
  if (!scanner.startsWith(`${ACTIVE_PROBES_CATEGORY}:`)) return false;
  return ACTIVE_PROBE_ID_SET.has(
    scanner.slice(ACTIVE_PROBES_CATEGORY.length + 1),
  );
}

/** True when a `scanners` array requests active probing in any form: the
 *  legacy umbrella, or one or more per-probe selectors. */
export function requestsActiveProbing(
  scanners: readonly string[] | null | undefined,
): boolean {
  return !!scanners?.some(isActiveProbeSelector);
}

/**
 * Which of the nine probes a `scanners` array asks for, in canonical run
 * order. The legacy bare `active-probes` selector (old persisted scans, old
 * bookmarked URLs, older API/extension clients) expands to all nine; a
 * caller that lists explicit `active-probes:<id>` selectors gets exactly
 * those. Returns an empty array when nothing active was requested.
 */
export function resolveSelectedActiveProbes(
  scanners: readonly string[] | null | undefined,
): ActiveProbeId[] {
  if (!scanners || scanners.length === 0) return [];
  if (scanners.includes(ACTIVE_PROBES_CATEGORY)) return [...ACTIVE_PROBE_IDS];
  const selected = new Set(scanners);
  return ACTIVE_PROBE_IDS.filter((id) => selected.has(activeProbeScanner(id)));
}

/** Parse a comma-separated `active_probes=` URL param into valid ids. */
export function parseActiveProbeIds(
  raw: string | null | undefined,
): ActiveProbeId[] {
  if (!raw) return [];
  const present = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return ACTIVE_PROBE_IDS.filter((id) => present.has(id));
}

/** Serialize selected ids back to a `active_probes=` URL param value, in
 *  canonical order, or null when none are selected. */
export function serializeActiveProbeIds(
  ids: Iterable<ActiveProbeId>,
): string | null {
  const set = new Set(ids);
  const ordered = ACTIVE_PROBE_IDS.filter((id) => set.has(id));
  return ordered.length > 0 ? ordered.join(",") : null;
}

// Pure, side-effect-free helpers for the VulnRadar CLI. Kept apart from the
// executable so they can be unit-tested with node:test without spawning a
// process or hitting the network.

export const DEFAULTS = {
  apiBase: "https://vulnradar.dev/api/v3",
  crawl: false,
  maxCritical: 0,
  maxHigh: 0,
  maxMedium: -1, // -1 disables the medium check
  // Matches the server's single-scan budget (CONFIG_SCAN_TIMEOUT_SECONDS).
  timeout: 300,
  // A crawl runs under a much larger server-side budget
  // (CONFIG_CRAWL_SCAN_TIMEOUT_SECONDS), enforced by the crawl watchdog. The
  // CLI used to keep waiting only 300s with --crawl, so `vulnradar scan
  // --crawl` in CI printed "Timed out" and exited 1 on a crawl the server
  // still had ten minutes left to finish, and the scan itself completed fine
  // a minute later. An explicit --timeout still wins over both.
  crawlTimeout: 900,
  pollInterval: 5,
  json: false,
};

/**
 * Parse `vulnradar scan <url> [flags]` argv (already sliced past `node script`).
 * Returns { command, url, apiKey, apiBase, crawl, maxCritical, maxHigh,
 * maxMedium, timeout, pollInterval, json, help, error }. `error` is set for a
 * malformed flag; the caller prints usage and exits.
 */
export function parseArgs(argv) {
  const out = {
    command: undefined,
    url: undefined,
    help: false,
    ...DEFAULTS,
    // Env forms sit after the spread so they override the shipped defaults
    // and are still beaten by an explicit flag below. VULNRADAR_API_BASE is
    // the sibling of VULNRADAR_TOKEN: the docs tell CI users to prefer the
    // environment over flags, and until now only the token had that form,
    // so a self-hosted CI had to repeat --api-base on every invocation.
    apiKey: process.env.VULNRADAR_TOKEN || undefined,
    apiBase: process.env.VULNRADAR_API_BASE || DEFAULTS.apiBase,
  };

  // Whether --timeout was given explicitly. Without this the crawl default
  // below could not tell "user asked for 300" from "nobody said".
  let timeoutExplicit = false;

  const takeNumber = (name, raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      out.error = `${name} expects a number, got "${raw}".`;
      return null;
    }
    return n;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        out.help = true;
        break;
      case "--crawl":
        out.crawl = true;
        break;
      case "--json":
        out.json = true;
        break;
      case "--api-key":
        out.apiKey = argv[++i];
        break;
      case "--api-base":
        out.apiBase = argv[++i];
        break;
      case "--max-critical":
        out.maxCritical = takeNumber(arg, argv[++i]) ?? out.maxCritical;
        break;
      case "--max-high":
        out.maxHigh = takeNumber(arg, argv[++i]) ?? out.maxHigh;
        break;
      case "--max-medium":
        out.maxMedium = takeNumber(arg, argv[++i]) ?? out.maxMedium;
        break;
      case "--timeout": {
        const t = takeNumber(arg, argv[++i]);
        if (t !== null) {
          out.timeout = t;
          timeoutExplicit = true;
        }
        break;
      }
      case "--poll-interval":
        out.pollInterval = takeNumber(arg, argv[++i]) ?? out.pollInterval;
        break;
      default:
        if (arg.startsWith("-")) {
          out.error = `Unknown flag: ${arg}`;
        } else if (out.command === undefined) {
          out.command = arg;
        } else if (out.url === undefined) {
          out.url = arg;
        } else {
          out.error = `Unexpected argument: ${arg}`;
        }
    }
  }

  // Resolved after the loop, not inside the --crawl case: the flags can
  // arrive in either order, so `--timeout 60 --crawl` must still mean 60.
  if (out.crawl && !timeoutExplicit) out.timeout = DEFAULTS.crawlTimeout;

  return out;
}

/**
 * Decide whether the scan's severity counts breach the configured thresholds.
 * Mirrors the GitHub Action / GitLab template: critical and high always gate,
 * medium only when maxMedium >= 0. Returns { failed, reasons }.
 */
export function evaluateGate(counts, thresholds) {
  const reasons = [];
  const c = Number(counts.critical || 0);
  const h = Number(counts.high || 0);
  const m = Number(counts.medium || 0);

  if (c > thresholds.maxCritical) {
    reasons.push(
      `${c} critical finding(s) exceed the max of ${thresholds.maxCritical}`,
    );
  }
  if (h > thresholds.maxHigh) {
    reasons.push(
      `${h} high finding(s) exceed the max of ${thresholds.maxHigh}`,
    );
  }
  if (thresholds.maxMedium >= 0 && m > thresholds.maxMedium) {
    reasons.push(
      `${m} medium finding(s) exceed the max of ${thresholds.maxMedium}`,
    );
  }
  return { failed: reasons.length > 0, reasons };
}

export const USAGE = `vulnradar - run a VulnRadar scan from the command line and gate on findings.

Usage:
  vulnradar scan <url> [options]

Options:
  --api-key <key>        API token (or set VULNRADAR_TOKEN).
  --api-base <url>       API base URL, for a self-hosted instance
                         (or set VULNRADAR_API_BASE; default ${DEFAULTS.apiBase}).
  --crawl                Crawl and scan a whole site instead of one URL.
                         The page cap comes from your plan, not the CLI.
  --max-critical <n>     Fail if criticals exceed this (default ${DEFAULTS.maxCritical}).
  --max-high <n>         Fail if highs exceed this (default ${DEFAULTS.maxHigh}).
  --max-medium <n>       Fail if mediums exceed this; -1 disables (default ${DEFAULTS.maxMedium}).
  --timeout <seconds>    Give up waiting for the scan (default ${DEFAULTS.timeout},
                         or ${DEFAULTS.crawlTimeout} with --crawl, matching the server's budget).
  --poll-interval <s>    Seconds between status polls (default ${DEFAULTS.pollInterval}).
  --json                 Print the raw completed result as JSON.
  -h, --help             Show this help.

Exit code is 0 when findings are under the thresholds, 1 otherwise (or on error).
`;

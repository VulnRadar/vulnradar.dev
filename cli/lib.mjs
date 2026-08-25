// Pure, side-effect-free helpers for the VulnRadar CLI. Kept apart from the
// executable so they can be unit-tested with node:test without spawning a
// process or hitting the network.

export const DEFAULTS = {
  apiBase: "https://vulnradar.dev/api/v3",
  crawl: false,
  maxCritical: 0,
  maxHigh: 0,
  maxMedium: -1, // -1 disables the medium check
  timeout: 300,
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
    apiKey: process.env.VULNRADAR_TOKEN || undefined,
    help: false,
    ...DEFAULTS,
  };

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
      case "--timeout":
        out.timeout = takeNumber(arg, argv[++i]) ?? out.timeout;
        break;
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
  --api-base <url>       API base URL (default ${DEFAULTS.apiBase}).
  --crawl                Crawl and scan up to 15 pages instead of one URL.
  --max-critical <n>     Fail if criticals exceed this (default ${DEFAULTS.maxCritical}).
  --max-high <n>         Fail if highs exceed this (default ${DEFAULTS.maxHigh}).
  --max-medium <n>       Fail if mediums exceed this; -1 disables (default ${DEFAULTS.maxMedium}).
  --timeout <seconds>    Give up waiting for the scan (default ${DEFAULTS.timeout}).
  --poll-interval <s>    Seconds between status polls (default ${DEFAULTS.pollInterval}).
  --json                 Print the raw completed result as JSON.
  -h, --help             Show this help.

Exit code is 0 when findings are under the thresholds, 1 otherwise (or on error).
`;

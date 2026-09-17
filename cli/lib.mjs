// Pure, side-effect-free helpers for the VulnRadar CLI. Kept apart from the
// executable so they can be unit-tested with node:test without spawning a
// process or hitting the network.

/**
 * Exit codes.
 *
 * The CLI's entire reason to exist in CI is its exit code, and it had two:
 * 0 for a clean gate and 1 for everything else. "Everything else" covered a
 * real threshold breach, an expired API key, a network timeout, a 5xx from the
 * API, a malformed response, and a typo in a flag - so a pipeline that treats
 * a non-zero exit as "block the merge, we found a vulnerability" could not
 * tell that apart from "VulnRadar was briefly unreachable". The only way to
 * distinguish them was to parse stdout for an `ok:false` key that nothing
 * documented and that --json mode alone produced.
 *
 * Splitting them is a behaviour change, and a deliberate one for a major
 * release: a script testing for non-zero is unaffected, and a script that
 * wants "the gate failed, specifically" can now ask for it.
 */
export const EXIT = {
  /** Every finding count is at or under its threshold. */
  OK: 0,
  /** The scan ran and a threshold was exceeded. This is a real result. */
  GATE_FAILED: 1,
  /** The tool could not produce a result: auth, network, API, bad arguments. */
  ERROR: 2,
};

/**
 * What `--report <format>` accepts, mapped to the extension a saved file gets.
 *
 * The same list the server has in app/api/v3/history/[id]/report/route.ts,
 * which has served SARIF, Markdown, CSV, the compliance crosswalk, PDF and
 * JSON since v3: the CLI was the one client that could not ask for any of
 * them, so a pipeline that wanted the SARIF it uploads to GitHub Code
 * Scanning had to curl the API itself with a second copy of the token.
 *
 * `binary` marks the format that is not text and so cannot go to stdout.
 */
export const REPORT_FORMATS = {
  json: { ext: "json" },
  sarif: { ext: "sarif" },
  md: { ext: "md" },
  markdown: { ext: "md" },
  compliance: { ext: "md" },
  csv: { ext: "csv" },
  pdf: { ext: "pdf", binary: true },
};

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
  /** Scanner categories to run, or null for the server's default set. */
  scanners: null,
  /** true/false sets visibility explicitly; undefined leaves the server default. */
  isPublic: undefined,
  /** Teams to share the scan with. Empty means a personal scan. */
  teamIds: [],
  /** A format from REPORT_FORMATS to download after the scan, or null. */
  report: null,
  /** Where to write the report. Null prints a text report to stdout. */
  out: null,
  /** Mark accepted-risk and won't-fix findings suppressed in the report. */
  applyTriage: false,
  /** Keep findings the owner marked a false positive in the report. */
  includeSuppressed: false,
};

/**
 * The report URL for a finished scan. The two triage flags are sent only when
 * asked for, because the server's defaults are the ones the dashboard shows,
 * and an export that quietly disagrees with the dashboard is the bug this
 * endpoint's own comment was written about.
 */
export function reportRequestUrl(apiBase, scanId, opts) {
  const params = new URLSearchParams({ format: opts.report });
  if (opts.includeSuppressed) params.set("includeSuppressed", "true");
  if (opts.applyTriage) params.set("applyTriage", "true");
  return `${apiBase}/history/${scanId}/report?${params}`;
}

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
    version: false,
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

  // A flag's value has to exist and must not be the next flag. Without this,
  // `--api-key --json` set apiKey to "--json", swallowed --json, and sent
  // "Authorization: Bearer --json" for a 401 the user could not explain; and
  // a trailing `--api-key` set it to undefined and then reported "no API
  // key, pass --api-key" to someone who just had.
  // A leading "-" means a flag, EXCEPT when the whole token parses as a
  // number: "-5" is a value someone typed, and rejecting it as a flag would
  // report "expects a value" for an argument that was supplied.
  const looksLikeFlag = (raw) =>
    raw.startsWith("-") && !Number.isFinite(Number(raw));

  const takeValue = (name, raw) => {
    if (raw === undefined || looksLikeFlag(raw)) {
      out.error = `${name} expects a value.`;
      return null;
    }
    return raw;
  };

  const takeNumber = (name, raw) => {
    if (takeValue(name, raw) === null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      out.error = `${name} expects a number, got "${raw}".`;
      return null;
    }
    return n;
  };

  // Zero and negative are both finite, so takeNumber accepts them, and they
  // are not equally wrong.
  //
  // --timeout 0 (or negative) is always wrong: `while (Date.now() < deadline)`
  // never runs its body, so the CLI reports "Timed out after 0s" without
  // polling once, on a scan the server has already started and will finish.
  // The user is told it failed when it did not.
  //
  // --poll-interval 0 is legitimate. GET /scan/status deliberately does not
  // charge quota (see the comment in app/api/v3/scan/status/[id]/route.ts,
  // which explains that charging per poll could exhaust a key's daily limit
  // before one deep scan finished), so a fast poll costs nothing but
  // requests, and the test suite uses 0 to keep runs quick. Only negative is
  // meaningless.
  const takeAtLeast = (name, raw, min) => {
    const n = takeNumber(name, raw);
    if (n === null) return null;
    if (n < min) {
      out.error = `${name} must be at least ${min}, got ${n}.`;
      return null;
    }
    return n;
  };

  const takePositive = (name, raw) => {
    const n = takeNumber(name, raw);
    if (n === null) return null;
    if (n <= 0) {
      out.error = `${name} must be greater than 0, got ${n}.`;
      return null;
    }
    return n;
  };

  // Fresh per call: DEFAULTS.teamIds is a shared array.
  out.teamIds = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        out.help = true;
        break;
      case "-v":
      case "--version":
        out.version = true;
        break;
      case "--scanners": {
        const raw = takeValue(arg, argv[++i]);
        if (raw === null) break;
        const list = raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (list.length === 0) {
          out.error = `${arg} expects a comma-separated list of categories.`;
        } else {
          out.scanners = list;
        }
        break;
      }
      case "--public":
      case "--private": {
        const wanted = arg === "--public";
        if (out.isPublic !== undefined && out.isPublic !== wanted) {
          out.error = "--public and --private cannot be used together.";
        } else {
          out.isPublic = wanted;
        }
        break;
      }
      case "--team-id": {
        const n = takeNumber(arg, argv[++i]);
        if (n === null) break;
        if (!Number.isInteger(n) || n <= 0) {
          out.error = `${arg} expects a positive integer team id, got ${n}.`;
        } else if (!out.teamIds.includes(n)) {
          out.teamIds.push(n);
        }
        break;
      }
      case "--report": {
        const raw = takeValue(arg, argv[++i]);
        if (raw === null) break;
        const fmt = raw.toLowerCase();
        if (!Object.hasOwn(REPORT_FORMATS, fmt)) {
          out.error ??= `${arg} expects one of: ${Object.keys(REPORT_FORMATS).join(", ")}. Got "${raw}".`;
        } else {
          out.report = fmt;
        }
        break;
      }
      case "--out":
        out.out = takeValue(arg, argv[++i]) ?? out.out;
        break;
      case "--apply-triage":
        out.applyTriage = true;
        break;
      case "--include-suppressed":
        out.includeSuppressed = true;
        break;
      case "--crawl":
        out.crawl = true;
        break;
      case "--json":
        out.json = true;
        break;
      case "--api-key":
        out.apiKey = takeValue(arg, argv[++i]) ?? out.apiKey;
        break;
      case "--api-base":
        out.apiBase = takeValue(arg, argv[++i]) ?? out.apiBase;
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
        const t = takePositive(arg, argv[++i]);
        if (t !== null) {
          out.timeout = t;
          timeoutExplicit = true;
        }
        break;
      }
      case "--poll-interval":
        out.pollInterval = takeAtLeast(arg, argv[++i], 0) ?? out.pollInterval;
        break;
      default:
        if (arg.startsWith("-")) {
          out.error ??= `Unknown flag: ${arg}`;
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

  // The report flags check each other here rather than at the call site, so a
  // combination that cannot work is refused before a scan is started and
  // charged against the account's daily limit. A flag that silently does
  // nothing is worse than a flag that says why it cannot.
  if (!out.report) {
    const orphan = out.out
      ? "--out"
      : out.applyTriage
        ? "--apply-triage"
        : out.includeSuppressed
          ? "--include-suppressed"
          : null;
    if (orphan) out.error ??= `${orphan} needs --report <format>.`;
  } else if (REPORT_FORMATS[out.report].binary && !out.out) {
    out.error ??= `--report ${out.report} writes binary, so it needs --out <path>.`;
  } else if (out.json && !out.out) {
    out.error ??=
      "--report with --json needs --out <path>, so the JSON result stays the only thing on stdout.";
  }

  return out;
}

/**
 * The JSON body POSTed to start a scan. Only the fields the caller set are
 * sent, so the server's own defaults apply to everything else exactly as they
 * do for a request from the web app. It used to be `{ url }` whatever flags
 * existed, so a CI run could not narrow the scanners, keep a scan out of the
 * public directory, or put the result in front of its team.
 */
export function buildScanBody(opts) {
  const body = { url: opts.url };
  if (opts.scanners && opts.scanners.length > 0) body.scanners = opts.scanners;
  if (typeof opts.isPublic === "boolean") body.isPublic = opts.isPublic;
  if (opts.teamIds && opts.teamIds.length > 0) body.teamIds = opts.teamIds;
  return body;
}

/**
 * Seconds to wait before retrying after a 429, from its Retry-After header:
 * either a number of seconds or an HTTP date. null when absent or unusable.
 */
export function retryAfterSeconds(header, now = Date.now()) {
  if (!header) return null;
  const trimmed = String(header).trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now) / 1000));
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
  --scanners <list>      Comma-separated categories to run, e.g. headers,ssl,content
                         (default: the server's standard set).
  --public | --private   List the scan in the public directory, or keep it out.
                         Omitted, your account's default applies.
  --team-id <id>         Share the scan with a team you manage. Repeat for several.
  --report <format>      Download a report once the scan finishes:
                         ${Object.keys(REPORT_FORMATS).join(", ")}.
                         Printed to stdout unless --out is given.
  --out <path>           Write the --report file here. Required for pdf, and
                         with --json.
  --apply-triage         In the report, mark accepted-risk and won't-fix
                         findings as suppressed (GitHub reads SARIF
                         suppressions as "dismissed").
  --include-suppressed   In the report, keep findings marked a false positive.
                         Off by default, matching the dashboard.
  --json                 Print the raw completed result as JSON.
  -v, --version          Print the CLI version.
  -h, --help             Show this help.

Exit codes:
  0  every finding count is at or under its threshold
  1  the scan ran and a threshold was exceeded
  2  the scan could not run: auth, network, API, or bad arguments

A --report is downloaded before the thresholds are judged, so a run that exits
1 still leaves the file for the step that uploads it.
`;

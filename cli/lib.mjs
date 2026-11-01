// Pure, side-effect-free helpers for the VulnRadar CLI. Kept apart from the
// executable so they can be unit-tested with node:test without spawning a
// process or hitting the network.

/**
 * Exit codes.
 *
 * The CLI's entire reason to exist in CI is its exit code, so each outcome a
 * pipeline might want to treat differently gets its own: a real finding, a
 * tool that could not run, and a scan that ran but never looked at the target.
 * A script that tests for "non-zero" is unaffected by how many there are, and
 * one that wants the gate result, or wants to retry only on a tool failure,
 * can ask for exactly that.
 *
 * 130 and 143 are the shell convention for "killed by SIGINT" and "killed by
 * SIGTERM" (128 plus the signal number), used when an interrupted run has
 * cancelled the scan it started.
 */
export const EXIT = {
  /** Every finding count is at or under its threshold. */
  OK: 0,
  /** The scan ran and a threshold was exceeded. This is a real result. */
  GATE_FAILED: 1,
  /** The tool could not produce a result: auth, network, API, bad arguments. */
  ERROR: 2,
  /**
   * The scan ran, but the target was not checked: the site showed the scanner
   * a bot challenge, or the page could not be fetched. Zero findings from such
   * a scan means nothing, so a gate that passed it would be a false negative.
   */
  INCOMPLETE: 3,
  /** Interrupted by SIGINT (Ctrl-C). */
  SIGINT: 130,
  /** Interrupted by SIGTERM (a CI runner cancelling the job). */
  SIGTERM: 143,
};

/**
 * What `--report <format>` accepts.
 *
 * The same list the server has in app/api/v3/history/[id]/report/route.ts,
 * which serves SARIF, Markdown, CSV, the compliance crosswalk, PDF and JSON.
 * `binary` marks the format that is not text and so cannot go to stdout.
 */
export const REPORT_FORMATS = {
  json: {},
  sarif: {},
  md: {},
  markdown: {},
  compliance: {},
  csv: {},
  pdf: { binary: true },
};

/**
 * The areas `result.incomplete` can list, in the words the dashboard uses.
 *
 * The CLI ships alone (no dependencies, nothing imported from the app), so the
 * map is a copy of lib/scanner/incomplete-labels.ts. tests/repo/
 * scan-gate-parity.test.ts holds its slugs equal to the app's, so a new area
 * cannot start appearing here as a raw slug. An unknown slug is still printed
 * as itself rather than dropped: a shorter list would read as a more complete
 * scan than it was.
 */
export const INCOMPLETE_LABELS = {
  dns: "DNS records",
  tls: "TLS and certificate checks",
  "live-fetch": "Live page fetch",
  reputation: "Domain reputation lookups",
  "osv-libraries": "The live vulnerable-library lookup",
  "active-probes": "Active probes",
  "crawl-time-limit": "Some crawled pages (the crawl ran out of time)",
  "crawl-quota-limit": "Some crawled pages (your daily scan limit ran out)",
  "crawl-pages-challenged":
    "Some crawled pages (the site showed the scanner a bot challenge on them)",
  "authenticated-session": "The signed-in view of this page",
  "page-checks": "Some page checks",
  "bot-challenge":
    "The page, its headers and its files: the site showed the scanner a bot challenge instead",
  "page-unreachable":
    "The page itself: the scanner could not fetch it, so only the checks that never read a page ran",
};

/**
 * The two areas whose absence means the target was never looked at. Every
 * other area is a part of a scan that did run, so it is reported but does not
 * fail the build unless `--fail-on-incomplete` asks for that.
 */
export const BLOCKING_INCOMPLETE = ["bot-challenge", "page-unreachable"];

/** The `statusCode` the API puts on a 429 for "you already have a scan running". */
export const CONCURRENT_SCAN_LIMIT = "CONCURRENT_SCAN_LIMIT";

/**
 * How long to wait for a scan slot when the 429 carries no Retry-After, which
 * is the usual case: the server does not know when the running scan will end.
 * The last step repeats until the cap below is spent.
 */
export const SLOT_BACKOFF_SECONDS = [5, 10, 20];

/**
 * The most time, in total, that waiting for a scan slot may take. It has its
 * own budget so a pipeline queued behind another run does not spend the
 * `--timeout` it set for the scan itself.
 */
export const SLOT_WAIT_CAP_SECONDS = 120;

/** How many times a 429 that is neither a spent quota nor a busy slot is retried. */
export const MAX_RETRY_AFTER_RETRIES = 3;

/** How long a cancel request may take. A CI runner gives a cancelled job seconds. */
export const CANCEL_TIMEOUT_MS = 3000;

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
  /** Count findings the owner marked a false positive, in the gate and the report. */
  includeSuppressed: false,
  /** Do not exit 3 for a scan that was blocked or could not reach the page. */
  allowIncomplete: false,
  /** Exit 3 for any area that was not checked, not only the two blocking ones. */
  failOnIncomplete: false,
  /** Cancel the scan on the server when --timeout runs out. */
  cancelOnTimeout: false,
  /** Allow a plain http:// API base to a host that is not this machine. */
  allowInsecure: false,
};

/**
 * The report URL for a finished scan. The two triage flags are sent only when
 * asked for, because the server's defaults are the ones the dashboard shows,
 * and an export that quietly disagrees with the dashboard is the bug this
 * endpoint's own comment was written about.
 *
 * The scan id is the API's reply, encoded as one path segment: read raw, an id
 * like "../../keys/5" was resolved as a path and the request carried the
 * Bearer key somewhere other than the scan endpoints.
 */
export function reportRequestUrl(apiBase, scanId, opts) {
  const params = new URLSearchParams({ format: opts.report });
  if (opts.includeSuppressed) params.set("includeSuppressed", "true");
  if (opts.applyTriage) params.set("applyTriage", "true");
  return `${apiBase}/history/${encodeURIComponent(scanId)}/report?${params}`;
}

/** Whether a URL hostname is this machine, where plain http is not a leak. */
function isLoopbackHost(hostname) {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    /^127(\.\d{1,3}){3}$/.test(host)
  );
}

/**
 * The host of an API base that would send the Bearer key over plain http to
 * somewhere other than this machine, or null when the base is fine.
 *
 * The key is a long-lived credential, so a base typed or exported with
 * `http://` (an easy slip for a self-hosted instance behind a proxy) must not
 * quietly carry it across a network. A base that is not a URL at all is left
 * for fetch to reject: it cannot send anything.
 */
export function insecureApiBase(apiBase) {
  let url;
  try {
    url = new URL(apiBase);
  } catch {
    return null;
  }
  if (url.protocol !== "http:") return null;
  return isLoopbackHost(url.hostname) ? null : url.host;
}

/**
 * Parse `vulnradar scan <url> [flags]` argv (already sliced past `node script`).
 * Returns { command, url, apiKey, apiBase, crawl, maxCritical, maxHigh,
 * maxMedium, timeout, pollInterval, json, help, error, ... }. `error` is set
 * for a malformed flag; the caller prints usage and exits.
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
  //
  // --max-critical and --max-high are at least 0 for the same reason: a
  // negative max means "every run fails", and -1 only means "disabled" for
  // --max-medium, so extrapolating it gave permanently red builds that had no
  // finding behind them.
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
      case "--allow-incomplete":
        out.allowIncomplete = true;
        break;
      case "--fail-on-incomplete":
        out.failOnIncomplete = true;
        break;
      case "--cancel-on-timeout":
        out.cancelOnTimeout = true;
        break;
      case "--allow-insecure":
        out.allowInsecure = true;
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
        out.maxCritical = takeAtLeast(arg, argv[++i], 0) ?? out.maxCritical;
        break;
      case "--max-high":
        out.maxHigh = takeAtLeast(arg, argv[++i], 0) ?? out.maxHigh;
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

  if (out.allowIncomplete && out.failOnIncomplete) {
    out.error ??=
      "--allow-incomplete and --fail-on-incomplete cannot be used together.";
  }

  // Asking for help or the version sends nothing, so an API base in the
  // environment must not turn `vulnradar --help` into an error.
  if (!out.help && !out.version && !out.allowInsecure) {
    const host = insecureApiBase(out.apiBase);
    if (host) {
      out.error ??= `--api-base uses plain http:// to ${host}, which would send your API key unencrypted. Use https://, or pass --allow-insecure if you accept that.`;
    }
  }

  // The report flags check each other here rather than at the call site, so a
  // combination that cannot work is refused before a scan is started and
  // charged against the account's daily limit. A flag that silently does
  // nothing is worse than a flag that says why it cannot.
  // --include-suppressed is not one of them: it decides what the gate counts,
  // with or without a report.
  if (!out.report) {
    const orphan = out.out
      ? "--out"
      : out.applyTriage
        ? "--apply-triage"
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
 * Which 429 this is, because the three want opposite treatment.
 *
 * "concurrent": the account already has a scan running. It clears when that
 * scan ends, so waiting is the right response.
 * "daily": the API key's 24 hour quota is spent. The wait is hours, so
 * retrying inside a CI job only burns the job's time.
 * "other": a short rate limit, retried after its Retry-After if there is one.
 *
 * `headers` is anything with a `get(name)`, which a fetch Response has.
 */
export function classifyRateLimit(headers, body) {
  if (body && body.statusCode === CONCURRENT_SCAN_LIMIT) return "concurrent";
  const policy = String(headers?.get?.("x-ratelimit-policy") ?? "");
  if (policy.toLowerCase() === "daily") return "daily";
  if (body && typeof body.resets_at === "string") return "daily";
  return "other";
}

/**
 * Whether, and for how long, to wait before starting the scan again after a 429.
 *
 * `retryAfter` is seconds from the header or null. `concurrentRetries` and
 * `otherRetries` count the waits already taken, `slotWaitedSeconds` the total
 * spent waiting for a slot, `secondsLeft` what is left of the scan's own
 * timeout. Returns `{ retry: true, wait, extendsBudget }` or
 * `{ retry: false, note }`, where `note` is a sentence to add to the error.
 *
 * Waiting for a slot honours Retry-After when the server sends one and
 * otherwise steps through SLOT_BACKOFF_SECONDS, inside SLOT_WAIT_CAP_SECONDS.
 * The server does not send one for this 429 today, so without the backoff the
 * retry never fired for the case a CI user actually hits: two pipelines
 * starting together, or a re-run of a job whose scan is still holding the
 * slot. The wait is at least a second so a Retry-After of 0 cannot spin.
 */
export function createRetryPlan({
  kind,
  retryAfter,
  concurrentRetries,
  otherRetries,
  slotWaitedSeconds,
  secondsLeft,
}) {
  if (kind === "daily") {
    return {
      retry: false,
      note: " Your daily scan quota is spent, which a retry cannot fix, so the CLI does not retry it.",
    };
  }
  if (kind === "concurrent") {
    const step =
      SLOT_BACKOFF_SECONDS[
        Math.min(concurrentRetries, SLOT_BACKOFF_SECONDS.length - 1)
      ];
    const wait = Math.max(1, retryAfter ?? step);
    if (slotWaitedSeconds + wait > SLOT_WAIT_CAP_SECONDS) {
      return {
        retry: false,
        note: ` Still no free scan slot after waiting ${slotWaitedSeconds}s. Wait for the running scan to finish or cancel it, then run again.`,
      };
    }
    return { retry: true, wait, extendsBudget: true };
  }
  if (
    retryAfter === null ||
    otherRetries >= MAX_RETRY_AFTER_RETRIES ||
    retryAfter >= secondsLeft
  ) {
    return { retry: false, note: "" };
  }
  return { retry: true, wait: retryAfter, extendsBudget: false };
}

/**
 * Cancel a scan on the server, best effort, and say what happened in words.
 *
 * It is called from a signal handler and from a timeout, where the caller has
 * seconds at most (GitHub Actions leaves about 7 between SIGINT and SIGTERM,
 * GitLab about 5 before SIGKILL), so it is bounded by `timeoutMs` and never
 * throws. A 404 or a 409 means the scan is already finished or gone, which is
 * the state the caller wanted, so they are not failures.
 */
export async function cancelScan(
  apiBase,
  scanId,
  headers,
  timeoutMs = CANCEL_TIMEOUT_MS,
) {
  try {
    // Encoded for the reason reportRequestUrl gives: this one is a DELETE.
    const res = await fetch(
      `${apiBase}/scan/status/${encodeURIComponent(scanId)}`,
      {
        method: "DELETE",
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (res.ok) {
      return { settled: true, message: `Cancelled scan ${scanId}.` };
    }
    if (res.status === 404 || res.status === 409) {
      return {
        settled: true,
        message: `Scan ${scanId} had already finished, so there was nothing to cancel.`,
      };
    }
    return {
      settled: false,
      message: `Could not cancel scan ${scanId} (HTTP ${res.status}).`,
    };
  } catch (err) {
    const why =
      err?.name === "TimeoutError" || err?.name === "AbortError"
        ? "the request timed out"
        : err?.message || String(err);
    return {
      settled: false,
      message: `Could not cancel scan ${scanId}: ${why}.`,
    };
  }
}

/**
 * Whether a completed scan's `result` carries a `summary` object.
 *
 * A gate that read a missing summary as zeros would pass a response it did not
 * understand. The v3 API always sends the field, so this only fires when the
 * CLI is pointed at something shaped differently, which is exactly when a
 * security gate should refuse rather than guess.
 */
export function hasSummary(result) {
  return (
    result !== null &&
    typeof result === "object" &&
    result.summary !== null &&
    typeof result.summary === "object" &&
    !Array.isArray(result.summary)
  );
}

/**
 * The severity counts the gate judges.
 *
 * Counted from `result.findings`, leaving out the ones the owner marked a false
 * positive (`suppressed: true`) unless `includeSuppressed`. `result.summary`
 * counts them, so gating on it made the next run fail on a finding the
 * dashboard and every report from the same scan had hidden, with nothing
 * visible to fix. `summary` is only the fallback for a result with no findings
 * array. `suppressed` is how many findings were left out, so the caller can
 * say so.
 */
export function gateCounts(result, { includeSuppressed = false } = {}) {
  const findings = result?.findings;
  if (Array.isArray(findings)) {
    // Objects only, like the `objects` filter in the Action and the template's
    // jq: an array or a string in the list is not a finding in any of the three.
    const all = findings.filter(
      (f) => f && typeof f === "object" && !Array.isArray(f),
    );
    const kept = includeSuppressed
      ? all
      : all.filter((f) => f.suppressed !== true);
    const count = (severity) =>
      kept.filter((f) => f.severity === severity).length;
    return {
      critical: count("critical"),
      high: count("high"),
      medium: count("medium"),
      low: count("low"),
      total: kept.length,
      suppressed: all.length - kept.length,
    };
  }
  const summary = result?.summary ?? {};
  const n = (value) => Number(value) || 0;
  return {
    critical: n(summary.critical),
    high: n(summary.high),
    medium: n(summary.medium),
    low: n(summary.low),
    total: n(summary.total),
    suppressed: 0,
  };
}

/**
 * What a scan did not check, and whether that should fail the run.
 *
 * `areas` is everything `result.incomplete` lists, with its plain-language
 * label. `blocking` is true when the run should exit EXIT.INCOMPLETE: the scan
 * was blocked or could not fetch the page (or, with `failOnIncomplete`, any
 * area was skipped), and `allowIncomplete` has not opted out.
 */
export function incompleteOutcome(
  result,
  { allowIncomplete = false, failOnIncomplete = false } = {},
) {
  const listed = Array.isArray(result?.incomplete) ? result.incomplete : [];
  const slugs = [
    ...new Set(listed.filter((s) => typeof s === "string" && s !== "")),
  ];
  const areas = slugs.map((slug) => ({
    slug,
    label: INCOMPLETE_LABELS[slug] ?? slug,
  }));
  const blockingAreas = failOnIncomplete
    ? areas
    : areas.filter((a) => BLOCKING_INCOMPLETE.includes(a.slug));

  const raw = result?.pageUnreachable;
  const pageUnreachable =
    raw && typeof raw === "object"
      ? {
          message: typeof raw.message === "string" ? raw.message : "",
          redirectHost:
            typeof raw.redirectHost === "string" ? raw.redirectHost : "",
        }
      : null;

  return {
    areas,
    pageUnreachable,
    blockingAreas,
    blocking: !allowIncomplete && blockingAreas.length > 0,
  };
}

/**
 * The lines that tell a reader what was not checked. Empty when nothing was
 * skipped. Printed whether or not the run fails on it: a passing gate that
 * skipped DNS should say so.
 */
export function describeNotChecked(outcome) {
  if (outcome.areas.length === 0) return [];
  const lines = [
    `Not checked: ${outcome.areas.map((a) => a.label).join("; ")}`,
  ];
  const unreachable = outcome.pageUnreachable;
  if (unreachable?.message)
    lines.push(`Page unreachable: ${unreachable.message}`);
  if (unreachable?.redirectHost) {
    lines.push(`It redirects to another host: ${unreachable.redirectHost}`);
  }
  return lines;
}

/**
 * One line for a status poll that moved, or null when it carries no progress.
 * The caller prints it only when it differs from the last one, so a slow
 * category does not repeat itself every five seconds.
 */
export function describeProgress(body) {
  const category =
    typeof body?.currentCategory === "string" ? body.currentCategory : "";
  if (!category) return null;
  const done = Number.isFinite(body.categoriesCompleted)
    ? body.categoriesCompleted
    : null;
  const total =
    Number.isFinite(body.categoriesTotal) && body.categoriesTotal > 0
      ? body.categoriesTotal
      : null;
  if (done === null) return `Scanning: ${category}`;
  return total === null
    ? `Scanning: ${category} (${done} done)`
    : `Scanning: ${category} (${done}/${total})`;
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
  --api-key <key>        API token (or set VULNRADAR_TOKEN). Create one under
                         Profile > Developer > API Keys.
  --api-base <url>       API base URL, for a self-hosted instance
                         (or set VULNRADAR_API_BASE; default ${DEFAULTS.apiBase}).
  --allow-insecure       Allow a plain http:// --api-base to a host that is not
                         this machine. The key is sent unencrypted.
  --crawl                Crawl and scan a whole site instead of one URL.
                         The page cap comes from your plan, not the CLI.
  --max-critical <n>     Fail if criticals exceed this, 0 or more (default ${DEFAULTS.maxCritical}).
  --max-high <n>         Fail if highs exceed this, 0 or more (default ${DEFAULTS.maxHigh}).
  --max-medium <n>       Fail if mediums exceed this; -1 disables (default ${DEFAULTS.maxMedium}).
  --include-suppressed   Count findings you marked a false positive, in the
                         thresholds and in a --report. Off by default, matching
                         the dashboard.
  --allow-incomplete     Do not exit 3 when the scan was blocked by a bot
                         challenge or could not fetch the page. What was not
                         checked is still printed.
  --fail-on-incomplete   Exit 3 when any area was not checked, not only those two.
  --timeout <seconds>    Give up waiting for the scan (default ${DEFAULTS.timeout},
                         or ${DEFAULTS.crawlTimeout} with --crawl, matching the server's budget).
  --cancel-on-timeout    Cancel the scan on the server when the timeout runs
                         out. Default: leave it running.
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
  --json                 Print the raw completed result as JSON. A failure
                         prints {"ok":false,"error":...} instead.
  -v, --version          Print the CLI version.
  -h, --help             Show this help.

Exit codes:
  0    every finding count is at or under its threshold
  1    the scan ran and a threshold was exceeded
  2    the scan could not run: auth, network, API, or bad arguments
  3    the scan ran but did not check the target: a bot challenge, or the
       page could not be fetched
  130  interrupted by SIGINT, 143 by SIGTERM; a scan already started is cancelled

A --report is downloaded before the thresholds are judged, so a run that exits
1 still leaves the file for the step that uploads it. A report that cannot be
fetched or written fails the run with 2 but never hides a failed gate: that
still exits 1.
`;

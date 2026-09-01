/**
 * One list of every scan-initiating entry point and the meter each one is
 * required to charge.
 *
 * The gap this closes: the suite had eighteen files exercising
 * lib/rate-limiting/daily-limits, and every one of them tested that the quota
 * FUNCTION works. Not one tested that a given entry point CALLS it. That is
 * why four separate unmetered paths (the two recon endpoints, API-key crawls,
 * and the scheduled-scans worker) each shipped past a fully green run: their
 * route suites mocked six or nine modules apiece and neither of the quota
 * modules was among them, so the absence of a charge was invisible by
 * construction.
 *
 * Why this is a source-level check rather than eight booted routes. The
 * behaviour of each route under a denied quota is already covered by its own
 * suite, which can mock that route's particular nine dependencies. What was
 * missing is upstream of behaviour: whether the call exists in the module at
 * all, and whether a NEW route under app/api/v3/scan/ has been given a meter
 * before it ships. Both of those are properties of the module list and the
 * module text, and answering them by booting every route would build a mock
 * harness rather than a test. The completeness assertion below is the part
 * that actually prevents the next occurrence: a new route.ts under
 * app/api/v3/scan/ fails this suite until somebody classifies it here.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const SCAN_API_DIR = path.join(REPO_ROOT, "app/api/v3/scan");

type Meter =
  /** Charges the per-user daily scan quota in lib/rate-limiting/daily-limits. */
  | "daily-scan-quota"
  /** Charges the separate GitHub code-review credit pool. */
  | "github-review-quota"
  /** No signed-in user to charge, so the meter is the per-IP request limit. */
  | "ip-rate-limit"
  /** Starts no scanning work of its own; the request limit is the whole gate. */
  | "request-rate-limit-only"
  /** Reads stored results. Must not reach any scan execution entry point. */
  | "not-a-scan-initiator"
  /**
   * Known unmetered scan work. See the entry's `why`. This classification
   * asserts the gap is STILL open, so closing it fails this suite with a
   * message telling you to reclassify. A quarantine that cannot go stale.
   */
  | "daily-scan-quota-gap";

interface EntryPoint {
  file: string;
  meter: Meter;
  why?: string;
}

/** Any call that charges the daily scan quota. */
const DAILY_QUOTA_CALLS = [
  "canMakeRequest(",
  "checkAndRecordRequest(",
  "incrementDailyCount(",
  "incrementDailyCountCapped(",
];

/** Anything that reaches out and scans, as opposed to reading stored rows. */
const SCAN_EXECUTION_CALLS = [
  "executeScan(",
  "executeCrawlScan(",
  "discoverPages(",
  "runSyncChecks(",
  "runAsyncChecks(",
];

const ENTRY_POINTS: EntryPoint[] = [
  // ── Scans that charge the daily quota ────────────────────────────────────
  { file: "app/api/v3/scan/route.ts", meter: "daily-scan-quota" },
  { file: "app/api/v3/scan/bulk/route.ts", meter: "daily-scan-quota" },
  { file: "app/api/v3/scan/crawl/route.ts", meter: "daily-scan-quota" },
  { file: "app/api/v3/scan/authenticated/route.ts", meter: "daily-scan-quota" },
  { file: "app/api/v3/scan/discover/route.ts", meter: "daily-scan-quota" },
  { file: "lib/scanner/scheduled-scans-worker.ts", meter: "daily-scan-quota" },

  // ── Scan work on a different meter ───────────────────────────────────────
  {
    file: "app/api/v3/demo-scan/route.ts",
    meter: "ip-rate-limit",
    why: "Unauthenticated by design, so there is no account to charge. The per-IP request limit is the only meter available and must stay.",
  },
  {
    file: "app/api/v3/scan/github/route.ts",
    meter: "github-review-quota",
    why: "Reviews repository source through the AI provider rather than fetching a site, and is metered by its own credit pool in lib/billing/github-review-usage.",
  },

  // ── Known gap ────────────────────────────────────────────────────────────
  {
    file: "app/api/v3/scan/crawl/discover/route.ts",
    meter: "daily-scan-quota-gap",
    why: "Calls discoverPages, which fetches robots.txt, the sitemaps it names and every page it walks, all against a caller-supplied host. Its sibling app/api/v3/scan/discover/route.ts charges incrementDailyCountCapped for exactly that work; this one is bounded only by the per-request rate limit, so the crawl half of recon is outside the scan quota. Closing it means charging the quota here the way the sibling does.",
  },

  // ── Scan-adjacent, rate-limited, no scan of their own ────────────────────
  {
    file: "app/api/v3/scan/reputation/route.ts",
    meter: "request-rate-limit-only",
    why: "Looks a host up against reputation feeds; issues no scan against the target.",
  },
  {
    file: "app/api/v3/scan/tags/route.ts",
    meter: "request-rate-limit-only",
    why: "Edits tags on a stored scan.",
  },
  {
    file: "app/api/v3/scan/verify/route.ts",
    meter: "request-rate-limit-only",
    why: "AI verification of findings from a scan already charged; metered by the AI quota in its own suite.",
  },
  {
    file: "app/api/v3/scan/verify-batch/route.ts",
    meter: "request-rate-limit-only",
    why: "Batch form of scan/verify, same reasoning.",
  },

  // ── Read-only / bookkeeping ──────────────────────────────────────────────
  {
    file: "app/api/v3/scan/discover/progress/[requestId]/route.ts",
    meter: "not-a-scan-initiator",
    why: "Reads the progress record of a discovery run that was charged when it started.",
  },
  {
    file: "app/api/v3/scan/status/[id]/route.ts",
    meter: "not-a-scan-initiator",
    why: "Reads the stored status of a scan already charged at start time. Its own header explains why it deliberately skips checkRateLimit: that call atomically CONSUMES an API-key quota unit, and a client polls this endpoint every few seconds for the life of one scan, so rate limiting it would spend a key's whole daily allowance on status checks.",
  },
  {
    file: "app/api/v3/scan/feedback/route.ts",
    meter: "not-a-scan-initiator",
    why: "Records a true/false-positive verdict against a stored finding.",
  },
  {
    file: "app/api/v3/scan/github-issue/route.ts",
    meter: "not-a-scan-initiator",
    why: "Opens a GitHub issue from a stored finding.",
  },
  {
    file: "app/api/v3/scan/github/history/route.ts",
    meter: "not-a-scan-initiator",
    why: "Lists past repository reviews.",
  },
  {
    file: "app/api/v3/scan/import-spec/route.ts",
    meter: "not-a-scan-initiator",
    why: "Parses an uploaded OpenAPI document into endpoints; the scan of them is a separate, metered request.",
  },
  {
    file: "app/api/v3/scan/remediation/route.ts",
    meter: "not-a-scan-initiator",
    why: "Tracks remediation state on stored findings.",
  },
  {
    file: "app/api/v3/scan/remediation/bulk/route.ts",
    meter: "not-a-scan-initiator",
    why: "Bulk form of scan/remediation.",
  },
  {
    file: "app/api/v3/scan/screenshot/[id]/route.ts",
    meter: "not-a-scan-initiator",
    why: "Serves the screenshot captured during an already-charged scan.",
  },
];

function source(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function containsAny(text: string, needles: string[]): boolean {
  return needles.some((n) => text.includes(n));
}

/**
 * The local name a module imported `checkRateLimit` under, or null if it did
 * not import it at all. Resolving the alias matters: scan/reputation imports
 * it as `checkGlobalRL`, so a check for the literal string "checkRateLimit("
 * would call a correctly limited route unlimited.
 */
function rateLimiterLocalName(text: string): string | null {
  const importBlock = text.match(
    /import\s*\{([\s\S]*?)\}\s*from\s*["']@\/lib\/rate-limiting\/rate-limit["']/,
  );
  if (!importBlock) return null;
  const named = importBlock[1].match(/\bcheckRateLimit\b(?:\s+as\s+(\w+))?/);
  if (!named) return null;
  return named[1] ?? "checkRateLimit";
}

/** Every route.ts under app/api/v3/scan, repo-relative, posix separators. */
function scanRouteFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.ts") {
        out.push(path.relative(REPO_ROOT, full).split(path.sep).join("/"));
      }
    }
  };
  walk(SCAN_API_DIR);
  return out.sort();
}

describe("scan entry-point metering table", () => {
  it("lists every route under app/api/v3/scan, so a new one cannot ship unclassified", () => {
    const listed = ENTRY_POINTS.map((e) => e.file)
      .filter((f) => f.startsWith("app/api/v3/scan/"))
      .sort();

    expect(
      scanRouteFiles(),
      "A route under app/api/v3/scan/ is missing from ENTRY_POINTS. Add it with the meter it charges. This assertion is the whole point of the file: four unmetered scan paths shipped because nothing forced that decision.",
    ).toEqual(listed);
  });

  it("names a reason for every entry that does not charge the daily scan quota", () => {
    const missingWhy = ENTRY_POINTS.filter(
      (e) => e.meter !== "daily-scan-quota" && !e.why,
    ).map((e) => e.file);
    expect(missingWhy).toEqual([]);
  });
});

describe("each entry point charges the meter its table row claims", () => {
  for (const entry of ENTRY_POINTS.filter(
    (e) => e.meter === "daily-scan-quota",
  )) {
    it(`${entry.file} charges the daily scan quota`, () => {
      const text = source(entry.file);
      expect(
        text.includes("@/lib/rate-limiting/daily-limits"),
        `${entry.file} no longer imports the daily-limits module, so it cannot be charging the scan quota.`,
      ).toBe(true);
      expect(
        containsAny(text, DAILY_QUOTA_CALLS),
        `${entry.file} imports daily-limits but calls none of ${DAILY_QUOTA_CALLS.join(", ")}. Deleting the charge is exactly the mutation this file exists to catch.`,
      ).toBe(true);
    });
  }

  for (const entry of ENTRY_POINTS.filter(
    (e) => e.meter === "ip-rate-limit" || e.meter === "request-rate-limit-only",
  )) {
    it(`${entry.file} is bounded by the request rate limiter`, () => {
      const text = source(entry.file);
      const local = rateLimiterLocalName(text);
      expect(
        local,
        `${entry.file} is classified "${entry.meter}", which makes the rate limiter its only meter, and it does not import checkRateLimit from @/lib/rate-limiting/rate-limit.`,
      ).not.toBeNull();
      expect(
        new RegExp(`\\b${local}\\s*\\(`).test(text),
        `${entry.file} imports the rate limiter as \`${local}\` but never calls it.`,
      ).toBe(true);
    });
  }

  for (const entry of ENTRY_POINTS.filter(
    (e) => e.meter === "github-review-quota",
  )) {
    it(`${entry.file} charges the GitHub review credit pool`, () => {
      const text = source(entry.file);
      expect(text.includes("@/lib/billing/github-review-usage")).toBe(true);
    });
  }

  for (const entry of ENTRY_POINTS.filter(
    (e) => e.meter === "not-a-scan-initiator",
  )) {
    it(`${entry.file} starts no scan of its own`, () => {
      const text = source(entry.file);
      const reached = SCAN_EXECUTION_CALLS.filter((c) => text.includes(c));
      expect(
        reached,
        `${entry.file} is classified as not initiating a scan but reaches ${reached.join(", ")}. If it now scans, it needs a meter: move it to "daily-scan-quota" and charge one.`,
      ).toEqual([]);
    });
  }

  for (const entry of ENTRY_POINTS.filter(
    (e) => e.meter === "daily-scan-quota-gap",
  )) {
    it(`${entry.file} is still the known unmetered path (fails once fixed, on purpose)`, () => {
      const text = source(entry.file);
      expect(
        containsAny(text, DAILY_QUOTA_CALLS),
        `${entry.file} now charges the daily scan quota. The gap is closed: change its meter in ENTRY_POINTS from "daily-scan-quota-gap" to "daily-scan-quota" so the guard tightens instead of staying a documented hole.`,
      ).toBe(false);
      // It does at least still have the request limiter it was relying on.
      expect(text.includes("checkRateLimit(")).toBe(true);
    });
  }
});

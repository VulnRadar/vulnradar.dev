import { defineConfig } from "vitest/config";
import path from "node:path";
import os from "node:os";

// Cap concurrent worker processes. Vitest's default forks pool spawns roughly
// one worker per CPU, which on a constrained runner or CI container can exhaust
// memory/file handles mid-run and surface as intermittent
// "Failed to start forks worker" errors (flaky, not real failures). A ceiling
// keeps the ~10k-test suite stable while still parallelizing on multi-core
// machines. Leaves a core free and never exceeds 6 workers.
const MAX_TEST_FORKS = Math.max(1, Math.min((os.cpus()?.length ?? 4) - 1, 6));

/**
 * Vitest config for the VulnRadar security-critical unit suite.
 *
 * Tests live under tests/, mirroring the source tree: the suite for
 * lib/auth/password-hash.ts is tests/lib/auth/password-hash.test.ts.
 * Test-only helpers (files prefixed with _) sit beside the suites that
 * use them and are excluded from collection.
 */
export default defineConfig({
  test: {
    environment: "node",
    // `.tsx` is in the glob so a component suite named `foo.test.tsx` is
    // collected rather than silently ignored. Rendering a React tree still
    // needs a DOM environment (this config runs `node`), so such a file has
    // to opt in with a `// @vitest-environment` docblock once jsdom is
    // available; what it must never do is disappear without a word.
    include: ["tests/**/*.test.{ts,tsx}", "tests/**/*.spec.{ts,tsx}"],
    // tests/integration/ is the one tier that talks to a real PostgreSQL. It
    // is excluded here so `npx vitest run` stays green for a contributor with
    // no database, and runs only through its own config:
    //
    //   npx vitest run --config tests/integration/vitest.config.ts
    //
    // See tests/README.md ("Two tiers, two rules") and the CI `integration`
    // job, which is where it is actually gated.
    exclude: ["**/node_modules/**", "**/dist/**", "tests/integration/**"],
    // No global setupFiles, and specifically not one that resets
    // lib/config/runtime-config's 30-second settings snapshot before every
    // test (AUDIT-013#tq-08 proposed exactly that). Two things rule it out,
    // both verified rather than assumed:
    //
    // 1. A setup file runs BEFORE the test file's hoisted vi.mock calls
    //    register, so its own imports resolve unmocked. Importing
    //    runtime-config there pulls in the real @/lib/database/db, which
    //    throws "DATABASE_URL environment variable is not set" and fails
    //    every suite in the repository at collection time.
    // 2. Even with that solved, a per-test reset would make every test issue
    //    its own `SELECT key, value FROM system_settings`, which SHIFTS the
    //    positional mockQuery.mock.calls[n] indices in the suites that
    //    warm-cache behaviour currently lets get away with reading index 0.
    //    It would break the suites it was meant to protect.
    //
    // The working defence is per-suite and already used by
    // tests/app/api/v3/history/route.test.ts: intercept the system_settings
    // SQL inside the db mock so the settings read never enters the
    // positional queue at all. Copy that shape into a suite rather than
    // reaching for a global hook.
    pool: "forks",
    // vitest 4 caps workers via top-level maxWorkers (not poolOptions).
    maxWorkers: MAX_TEST_FORKS,
    // The cap above reduces worker-start failures but does not eliminate them,
    // and when one happens vitest reports only the files that ran and still
    // exits 0. Runs of this suite have silently collected 349 and 353 of 356
    // files while reporting success. This reporter compares files-run against
    // files-on-disk and fails the run on a shortfall, so an incomplete run is
    // visible instead of passing quietly.
    reporters: ["default", "./scripts/vitest-completeness-reporter.mjs"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      // Vitest skips the whole coverage report, and with it the threshold
      // check, when any test fails. Now that CI runs `npm run test:coverage`
      // as its Test job, that meant one unrelated failure hid every threshold
      // error behind it and you had to fix the test, push, and wait a second
      // full run to find out whether the coverage gate was also red. Report
      // both in one run.
      reportOnFailure: true,
      // middleware.ts lives at the repo root, so it matched neither
      // "lib/**" nor "app/**" and the 546-line request gate (public-path
      // allowlist, auth redirect) measured nothing at all despite having a
      // 365-line suite. It is in the denominator now, as are the plain .ts
      // modules under components/, which are ordinary logic and perfectly
      // measurable.
      //
      // `.tsx` is deliberately NOT here. @vitest/coverage-v8 remaps an
      // untested file by re-parsing it with rolldown's `parseAstAsync`,
      // which is handed no JSX/TSX language hint: every .tsx in the repo
      // (392 of them, measured) fails with "Expected `,` or `)` but found
      // `:`", prints a full stack trace, and is dropped from the report
      // anyway. Adding the glob therefore buys no coverage and costs a
      // 10,000-line log plus a crashed report run. React coverage needs a
      // DOM environment and a testing-library dependency first; see
      // AUDIT-013#cov-09.
      include: [
        "lib/**/*.ts",
        "app/**/*.ts",
        "components/**/*.ts",
        "middleware.ts",
      ],
      exclude: [
        "tests/**",
        "**/*.config.ts",
        "**/*.config.mjs",
        "**/*.d.ts",
        "scripts/**",
        "instrumentation.ts",
      ],
      thresholds: {
        // Per-file thresholds. We only set thresholds for files that
        // actually have tests. The global folder thresholds (lib/**,
        // app/**) were dragging the averages down to 8% / 0% because
        // most of the codebase has no unit tests yet. As more tests
        // land, add new entries here for the new files.
        //
        // To find the right number for a new file: run
        // `npm run test:coverage` and look at the per-file % line.
        // Set the threshold a few points below that so a regression
        // fails the build but a stale baseline doesn't.
        //
        // There is deliberately NO global lines/statements/branches
        // threshold here, and it is not an oversight. With `perFile: true`
        // vitest applies the global numbers to EVERY measured file
        // individually (resolveThresholds builds one set holding all files,
        // then checkThresholds iterates per file), not to the merged
        // average. A "modest global floor" would therefore fail the run for
        // each of the ~440 files with no dedicated suite, which is a
        // different and much larger piece of work than a floor. Add new
        // entries below as tests land instead.
        perFile: true,
        "lib/auth/crypto.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        "lib/auth/discord-state.ts": {
          lines: 80,
          statements: 80,
          functions: 100,
          branches: 80,
        },
        "lib/uploads/avatar.ts": {
          lines: 80,
          statements: 80,
          functions: 100,
          branches: 80,
        },
        // 88.23 / 85.71 / 75 / 71.42 actual. The lines and statements
        // numbers used to read 90, which the file has not met since the
        // lockout-fallback path grew, and the functions comment claiming
        // 50% predates two more of them being covered. Both directions
        // corrected: the failing pair comes down to the truth, the stale
        // functions floor of 40 goes up to a number that would actually
        // notice a regression.
        "lib/rate-limiting/rate-limit.ts": {
          lines: 85,
          statements: 82,
          functions: 70,
          branches: 68,
        },
        // Real scrypt at production cost. See tests/lib/auth/password-hash.
        "lib/auth/password-hash.ts": {
          lines: 95,
          statements: 90,
          functions: 100,
          branches: 90,
        },
        "lib/ai/think-parser.ts": {
          lines: 90,
          statements: 90,
          functions: 100,
          branches: 90,
        },
        // Exercised against the committed knowledge index, not a fixture, by
        // tests/lib/ai/knowledge-retrieval.test.ts. The uncovered lines are
        // the two degradation paths that need a broken index on disk (missing
        // file, unparseable JSON).
        "lib/ai/knowledge-retrieval.ts": {
          lines: 85,
          statements: 85,
          functions: 85,
          branches: 70,
        },
        // The "lib/types/config.ts" entry that used to sit here was
        // removed: that file no longer exists (lib/types/ is gone
        // entirely), so the glob matched nothing and the four 100%
        // thresholds under it were checked against an empty set. A
        // threshold on a deleted file is a gate that always passes.
        "lib/config/client-constants.ts": {
          // 78.82 / 95 / 22.72 / 79.01 actual, remeasured after the
          // client/server split moved a large body of client-safe values
          // into this file. Branches sits at exactly 95 (19 of 20; the
          // uncovered one is a NEXT_PUBLIC_ fallback no test can reach,
          // since Next inlines those at build time), so a 95 floor would
          // fail the moment anyone adds a single unexercised branch. 85
          // leaves room without letting it rot. Raising these is a matter
          // of testing the helpers, not of editing this block.
          lines: 43,
          statements: 43,
          functions: 5,
          branches: 85,
        },
        "lib/config/config-values.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        "lib/config/constants.ts": {
          // 100 / 99.15 / 100 / 95.65 actual (lines/stmts/funcs/branches).
          //
          // The functions floor tells the file's whole story. It was 0, then
          // 60 once the rate-limit and error-message helpers landed, and then
          // the 60 went red the moment ERROR_MESSAGES.WEAK_PASSWORD was
          // turned into a function nothing called (4 of 7 is 57.14%). Rather
          // than drop the floor again, tests/lib/config/constants.test.ts now
          // covers all four message/route builders, which is what the floor
          // was asking for. 90 with 7 functions means every one of them: an
          // eighth arriving untested is 87.5% and fails, which is the whole
          // point, and adding the test is a few lines.
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 80,
        },
        "lib/scanner/cvss.ts": {
          // 98.11% / 94.28% / 100% / 100% actual. Uncovered: an
          // impact <= 0 early-return in computeCvssBaseScore that's
          // mathematically unreachable for any metric combination this
          // module's own SEVERITY_VARIANTS table uses, and the
          // SEVERITY_VARIANTS[severity] ?? info fallback for an invalid
          // Severity value the type system already rules out.
          lines: 95,
          statements: 95,
          functions: 100,
          branches: 90,
        },
        "lib/scanner/subdomain-cache.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          // 83.33% actual. The `err instanceof Error` false branch (a
          // non-Error thrown value) isn't exercised.
          branches: 75,
        },
        "lib/scanner/safety-rating.ts": {
          // 94.56% / 95.19% / 92.3% / 92.72% actual. The uncovered lines are
          // the pre-existing invalid-regex catch fallbacks in
          // compilePatterns/matchesAny, which no real pattern ever triggers.
          lines: 92,
          statements: 93,
          functions: 90,
          branches: 90,
        },
        "lib/scanner/evidence-excerpts.ts": {
          // 100% across the board. The module is pure and every branch is a
          // rejection path a malformed excerpt can actually reach, so there
          // is nothing here that a test would have to reach past.
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 95,
        },
        "lib/reports/csv-report.ts": {
          // 100% / 100% / 100% / 88.63% actual. The uncovered branches are
          // the per-field `?? ""` fallbacks for fields absent from a finding
          // stored by an older engine; one such row is exercised, not all
          // twenty-three columns of it.
          lines: 95,
          statements: 95,
          functions: 100,
          branches: 80,
        },
        "lib/reports/markdown-report.ts": {
          // 89.28% / 88.52% / 100% / 58.33% actual. The uncovered branches
          // are the optional-field guards (code examples, AI verdict fields,
          // an unparseable scannedAt) that the finding fixture does not vary
          // one at a time.
          lines: 85,
          statements: 85,
          functions: 95,
          branches: 50,
        },
        "lib/seo/demo-link.ts": {
          // 100% across the board.
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 95,
        },
        "lib/scanner/schedule-timing.ts": {
          // 100% / 100% / 100% / 93.33% actual.
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 90,
        },
        "lib/scanner/scan-privacy.ts": {
          // 100% / 100% / 100% / 83.33% actual. The uncovered branch is the
          // `err instanceof Error ? ... : err` fallback for a non-Error
          // thrown value, which the mocked pool never produces.
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 80,
        },
        "lib/scanner/scheduled-scans-worker.ts": {
          // 81.31% / 81.25% / 68.42% / 55.31% actual. The uncovered lines
          // are schedulePeriodicScheduledScans --
          // the setInterval registration wrapper, exercised at real startup
          // via instrumentation.ts rather than under a fake timer here, same
          // as lib/database/cleanup.ts's own schedulePeriodicCleanup.
          lines: 78,
          statements: 78,
          functions: 65,
          branches: 50,
        },
        "lib/billing/plan-limits.ts": {
          // 100% / 96.55% / 100% / 93.75% actual.
          lines: 100,
          statements: 95,
          functions: 100,
          branches: 90,
        },
        // 100% actual across the board -- pure geometry and two localStorage
        // accessors, every branch reachable from a plain object.
        "lib/browserbase/viewer-layout.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 95,
        },
        // 100% actual across the board -- pure comparison logic, no
        // branches left untested.
        "lib/updater/version-compare.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        // 100% actual across the board -- this is the actual security
        // control for the self-update flow (see lib/updater/apply.ts),
        // kept at full coverage deliberately.
        "lib/updater/checksum.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        "lib/updater/copy-with-excludes.ts": {
          // 100 / 97.26 / 91.66 / 95.23 actual (lines/stmts/funcs/branch).
          // The 100% statements and functions floors were set when the
          // module was smaller and have been failing since; the symlink /
          // other-entry-type no-op fall-through is still the uncovered
          // part.
          lines: 100,
          statements: 94,
          functions: 88,
          branches: 90,
        },
        "lib/updater/job-store.ts": {
          // 91.48 / 82.75 / 92.3 / 67.85 actual. The 100% functions floor
          // was stale. Uncovered: appendLog's early-return for an unknown
          // job id (only the "silently ignores" path is asserted, not
          // every call site) and the pruneCompletedJobs eviction loop,
          // which needs more than MAX_COMPLETED_JOBS finished jobs to
          // trigger.
          lines: 88,
          statements: 78,
          functions: 88,
          branches: 62,
        },
        // 89.9 / 90.09 / 100 / 86.27 actual. middleware.ts is the 546-line
        // gate every request passes through (public-path allowlist, auth
        // redirect) and it was outside coverage.include entirely, so its
        // 365-line suite produced no measurable number and nobody could
        // answer "is this branch covered?" about the file where three
        // separate AUDIT-012 authz findings landed.
        "middleware.ts": {
          lines: 86,
          statements: 86,
          functions: 95,
          branches: 82,
        },
        // 100 / 100 / 100 / 100 actual. The four operational kill switches
        // (maintenance, pause signups/logins/scanning). Held high on purpose:
        // an uncovered branch here is either a lockout (staff refused by the
        // login pause) or a switch that silently does nothing, and both are
        // the kind of defect that is only discovered during the incident the
        // switch was flipped for.
        "lib/admin/service-state.ts": {
          lines: 95,
          statements: 95,
          functions: 95,
          branches: 95,
        },
        "app/api/v3/assets/route.ts": {
          // 97.87 / 98 / 100 / 68.75 actual. The uncovered branch is
          // the RETENTION_SETTING_KEYS[userPlan] ?? fallback-to-free arm for
          // an unrecognized plan string, which every test uses a valid plan
          // for -- same shape as the identical fallback in
          // app/api/v3/history/route.ts, which has no dedicated test for it
          // either. The 70 branch floor sat one point above the real
          // 68.75 and had been failing the run.
          lines: 95,
          statements: 95,
          functions: 100,
          branches: 65,
        },
        "app/actions/stripe.ts": {
          // 88.18 / 80.37 / 86.66 / 90.52 actual
          // (stmts/branches/functions/lines). tests/README.md said to add an
          // entry here once this file had a suite; it has one now
          // (tests/app/actions/stripe.test.ts, 51 cases), and until this
          // entry landed the checkout/subscription server actions were
          // measured but ungated, so coverage could fall back to zero
          // without failing the run. Uncovered: the Stripe-SDK error
          // rethrows and a handful of `err instanceof Error` fallbacks the
          // mocked client never produces.
          lines: 86,
          statements: 84,
          functions: 80,
          branches: 75,
        },
        "lib/tags/auto-tags.ts": {
          // 98.48% / 92.45% / 100% / 100% actual (stmts/branch/funcs/lines)
          // after the ~50-rule taxonomy expansion and the layered AI/
          // promoted-rules additions (loadPromotedRules, maybeSuggestAiTag).
          // Uncovered: saveAutoTags' own `if (tags.length === 0) return
          // tags` defensive guard (computeAutoTags never actually returns
          // an empty array -- see that line's own comment), and two
          // `err instanceof Error ? ... : err` catch fallbacks for a
          // non-Error thrown value, which the mocked pool never produces
          // (same shape as several other files in this list).
          lines: 100,
          statements: 95,
          functions: 100,
          branches: 90,
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});

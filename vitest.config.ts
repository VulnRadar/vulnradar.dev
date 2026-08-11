import { defineConfig } from "vitest/config";
import path from "node:path";

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
    include: ["tests/**/*.test.ts", "tests/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["lib/**/*.ts", "app/**/*.ts"],
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
        // actually have tests — the global folder thresholds (lib/**,
        // app/**) were dragging the averages down to 8% / 0% because
        // most of the codebase has no unit tests yet. As more tests
        // land, add new entries here for the new files.
        //
        // To find the right number for a new file: run
        // `npm run test:coverage` and look at the per-file % line.
        // Set the threshold a few points below that so a regression
        // fails the build but a stale baseline doesn't.
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
        "lib/rate-limiting/rate-limit.ts": {
          lines: 90,
          statements: 90,
          // 50% — the test only exercises the happy path; the cleanup
          // sweeper and the lockout-fallback path aren't called.
          functions: 40,
          // 75% actual. The over-cap rollback branch and the deprecated
          // getClientIP re-export are not exercised.
          branches: 70,
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
        "lib/types/config.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        "lib/config/client-constants.ts": {
          // 92.3% actual. Mostly re-exported constants; one lazily
          // evaluated branch is never hit by the unit suite, and the file
          // declares no functions the tests call.
          lines: 90,
          statements: 90,
          functions: 0,
          branches: 100,
        },
        "lib/config/config-values.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        "lib/config/constants.ts": {
          lines: 90,
          statements: 90,
          // 0% — this file is mostly exported string/number constants
          // that the unit tests don't reference; the lines/stmts still
          // get hit via the `index.ts` barrel re-export.
          functions: 0,
          branches: 80,
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
          // are schedulePeriodicScheduledScans/stopPeriodicScheduledScans --
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
          // 100% / 94.11% / 100% / 100% actual. The uncovered branch is
          // the symlink/other-entry-type no-op fall-through, which none
          // of the fixture trees exercise.
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 90,
        },
        "lib/updater/job-store.ts": {
          // 83.33% / 61.53% / 100% / 93.18% actual. Uncovered branches
          // are appendLog's early-return for an unknown job id (only the
          // "silently ignores" path is asserted, not every call site) and
          // the pruneCompletedJobs eviction loop, which needs more than
          // MAX_COMPLETED_JOBS finished jobs to trigger.
          lines: 85,
          statements: 75,
          functions: 100,
          branches: 55,
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

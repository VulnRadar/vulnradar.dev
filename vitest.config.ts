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
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});

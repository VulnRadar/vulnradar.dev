import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config for the VulnRadar security-critical unit suite.
 *
 * Phase 8C Commit 1 (C-4): adds the test runner and coverage
 * thresholds. The initial suite covers the auth/crypto primitives;
 * the route-handler tests are added in Phase 8D Commit 10.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "lib/**/*.test.ts",
      "app/**/*.test.ts",
      "lib/**/*.spec.ts",
      "app/**/*.spec.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["lib/**/*.ts", "app/**/*.ts"],
      exclude: [
        "lib/**/*.test.ts",
        "app/**/*.test.ts",
        "**/*.config.ts",
        "**/*.config.mjs",
        "**/*.d.ts",
        "scripts/**",
        "instrumentation.ts",
      ],
      thresholds: {
        // Per-folder thresholds (lines, statements, functions, branches).
        // Soft target for the first cut; tighten as we add more tests.
        "lib/auth/**": {
          lines: 80,
          statements: 80,
          functions: 80,
          branches: 70,
        },
        "lib/rate-limiting/**": {
          lines: 70,
          statements: 70,
          functions: 70,
          branches: 60,
        },
        "lib/scanner/safe-fetch.ts": {
          lines: 60,
          statements: 60,
          functions: 60,
        },
        // Global minimums.
        "lib/**": { lines: 50, statements: 50, functions: 50 },
        "app/**": { lines: 30, statements: 30, functions: 30 },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});

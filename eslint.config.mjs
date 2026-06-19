// ============================================================================
// ESLint Flat Config (wraps Next.js's legacy eslint-config-next)
// ============================================================================
// Uses @eslint/eslintrc's FlatCompat shim because eslint-config-next 15.x
// only ships legacy (.eslintrc) config. When Next.js ships native flat
// config (planned for 16+), this shim can be removed.
//
// `next build`'s internal linter is disabled in next.config.mjs
// (eslint.ignoreDuringBuilds: true) because its plugin-detection
// heuristic doesn't recognize the FlatCompat-wrapped Next.js plugin.
// We run `npm run lint` (which uses `eslint .` directly) in CI instead.
// ============================================================================

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "build/**",
      "dist/**",
      "coverage/**",
      "public/**",
      "*.config.{js,mjs,cjs,ts}",
      "scripts/**",
      ".idea/**",
      "tsconfig.tsbuildinfo",
    ],
  },
  ...compat.extends("next/core-web-vitals"),
  {
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    languageOptions: {
      parser: tsParser,
    },
    rules: {
      // Pre-existing project conventions
      // We disable args checking for component props because the tab
      // interfaces (ProfileTabProps) require all props, even when a
      // specific tab doesn't use them. Prefixing with _ for every
      // unused prop would be noisy across 5+ tab files.
      // - `vars`: still checked (prefix with _ to silence)
      // - `caughtErrors`: "none" — catch (error) is allowed even if
      //   the body doesn't reference the error (e.g., console.error
      //   is conditional, or the error is logged but not consumed)
      // - `args`: disabled because props are dictated by parent interface
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          args: "none",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "react/no-unescaped-entities": "off",
      "@next/next/no-html-link-for-pages": "off",
    },
  },
];

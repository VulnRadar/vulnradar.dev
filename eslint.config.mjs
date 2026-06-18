// ============================================================================
// ESLint Flat Config (wraps Next.js's legacy eslint-config-next)
// ============================================================================
// Uses @eslint/eslintrc's FlatCompat shim because eslint-config-next 15.x
// only ships legacy (.eslintrc) config. When Next.js ships native flat
// config, this shim can be removed.
// ============================================================================

import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { FlatCompat } from "@eslint/eslintrc"
import tsPlugin from "@typescript-eslint/eslint-plugin"
import tsParser from "@typescript-eslint/parser"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

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
    rules: {
      // Pre-existing project conventions
      // We disable args/argsIgnorePattern checks for component props because
      // the tab interfaces (ProfileTabProps) require all props, even when
      // a specific tab doesn't use them. Prefixing with _ for every
      // unused prop would be extremely noisy across 5+ tab files.
      // - `vars` and `caughtErrors`: still checked (prefix with _ to silence)
      // - `args`: disabled because props are dictated by parent interface
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          args: "none",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "react/no-unescaped-entities": "off",
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]

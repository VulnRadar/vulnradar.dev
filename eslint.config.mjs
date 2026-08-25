// ESLint Flat Config (built on Next.js's native flat config)

// eslint-config-next 16+ ships native flat config, so this consumes
// `eslint-config-next/core-web-vitals` directly instead of going through
// the @eslint/eslintrc FlatCompat shim that older eslint-config-next
// releases needed.
//
// `next build`'s internal linter is disabled in next.config.mjs
// (eslint.ignoreDuringBuilds: true). We run `npm run lint` (which uses
// `eslint .` directly) in CI instead.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import coreWebVitals from "eslint-config-next/core-web-vitals";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
      // Standalone Node CLI package with its own runtime + node:test suite.
      "cli/**",
      ".idea/**",
      "tsconfig.tsbuildinfo",
    ],
  },
  ...coreWebVitals,
  {
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    languageOptions: {
      parser: tsParser,
    },
    // eslint-config-next sets settings.react.version to "detect", which
    // makes eslint-plugin-react probe the filesystem via context.getFilename().
    // ESLint 10 removed that legacy context method, so detection crashes the
    // whole run. Pinning the version we actually depend on skips detection
    // entirely and is what eslint-plugin-react itself recommends over
    // "detect" for reliability.
    settings: {
      react: {
        version: "19.2.8",
      },
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
      // eslint-config-next 16 pulls in eslint-plugin-react-hooks 7, which
      // adds the React Compiler readiness rules to core-web-vitals as
      // errors. They flag ~60 pre-existing call sites across the codebase
      // (setState-in-effect, impure render, ref mutation during render)
      // that predate compiler adoption. Downgraded to warn, matching the
      // other pre-existing-convention rules above, until the codebase is
      // deliberately migrated to be compiler-compatible.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/refs": "warn",
    },
  },
  {
    // Type-aware linting, scoped to the auth surface.
    //
    // hashPassword and verifyPassword are async. A forgotten `await` on
    // `verifyPassword` yields a Promise, which is always truthy, so
    // `if (!verifyPassword(pw, hash))` silently becomes `if (false)` and the
    // credential check passes for everyone. Plain tsc does not flag this,
    // because `!` is legal on any type.
    //
    // no-misused-promises with checksConditionals catches exactly that shape.
    // Type-aware rules need a full program per file, so this is limited to the
    // routes where the failure mode is an authentication bypass rather than
    // applied repo-wide, where it would make `npm run lint` far slower.
    files: [
      "lib/auth/**/*.ts",
      "app/api/v3/auth/**/*.ts",
      "app/api/v3/account/**/*.ts",
      "app/api/v3/admin/**/*.ts",
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksConditionals: true, checksVoidReturn: false },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
    },
  },
];

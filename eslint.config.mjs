// ESLint Flat Config (built on Next.js's native flat config)

// eslint-config-next 16+ ships native flat config, so this consumes
// `eslint-config-next/core-web-vitals` directly instead of going through
// the @eslint/eslintrc FlatCompat shim that older eslint-config-next
// releases needed.
//
// `next build`'s internal linter is disabled in next.config.mjs
// (eslint.ignoreDuringBuilds: true). We run `npm run lint` (which uses
// `eslint .` directly) in CI instead.
//
// TWO DELIBERATE VERSION MISMATCHES, recorded here rather than in
// package.json (which is JSON and cannot carry a comment), because both look
// like mistakes to anyone reading the manifest and "fixing" either one breaks
// this file.
//
// 1. eslint-config-next is 16.x while next is 15.x (AUDIT-013#deps-13).
//    eslint-config-next 16 is the first release with native flat config,
//    which is what let this file drop the @eslint/eslintrc FlatCompat shim.
//    The cost is that the @next/eslint-plugin-next rule set being enforced
//    targets Next 16 conventions against a Next 15 codebase: a rule added
//    for 16 may flag an idiom the app cannot adopt yet, and a rule dropped
//    in 16 no longer catches the Next 15 anti-pattern it was written for.
//    Accepted, not overlooked. Realign when the Next 16 upgrade lands, and
//    note that .github/dependabot.yml ignores `next` majors, so the two do
//    not move as a unit on their own.
//
// 2. The root package.json `overrides` block forces `eslint: $eslint`
//    (currently ^10) into eslint-plugin-import, eslint-plugin-jsx-a11y and
//    eslint-plugin-react, whose own peer ranges all stop at ESLint 9
//    (AUDIT-013#deps-04). Without those three nested overrides `npm ci`
//    fails with ERESOLVE. With them, the plugins run on a major upstream
//    does not claim to support, and the failure mode is a crash rather than
//    a finding: the `settings.react.version` workaround further down this
//    file exists because exactly that happened once already. Two known
//    unguarded uses of removed ESLint 10 context APIs remain in
//    eslint-plugin-react (forward-ref-uses-ref, jsx-filename-extension);
//    both rules are off in core-web-vitals today, so they are latent. If a
//    future ESLint 10 patch aborts the lint run again, the two ways out are
//    dropping `eslint` back to ^9 (and deleting the three nested overrides)
//    or replacing eslint-config-next/core-web-vitals below with
//    @next/eslint-plugin-next plus eslint-plugin-react-hooks, which is the
//    one plugin in the set that already declares ESLint 10 support.

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
      // `scripts/**` and `cli/**` used to be ignored wholesale, which meant
      // the 51 .mjs files under scripts/ (migrations, db repair, backup and
      // restore: the code in this repo with the largest blast radius) were
      // covered by neither `npm run lint` nor `npx tsc --noEmit`. A migration
      // script importing a symbol from a path that does not resolve failed on
      // an operator's populated database instead of in CI. They are linted
      // now; see the scripts/cli block near the bottom of this file for the
      // rule set that applies to them.
      //
      // Two exceptions stay ignored: generated/data-only schema modules and
      // the FP-audit scratch output directory (see .gitignore).
      "scripts/create-fresh-db/schemas/**",
      "scripts/storage/**",
      // Standalone Remotion asset project. It is gitignored, so CI never sees
      // it, but on a maintainer's machine `eslint .` walked into it and died
      // with "scopeManager.addGlobals is not a function" (its own eslint 9 /
      // parser tree is not the one this config is written against), which
      // made `npm run lint` unrunnable locally for a reason that had nothing
      // to do with the product.
      "marketing/**",
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
      // - `caughtErrors`: "none", so catch (error) is allowed even if
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
      // A bare `catch {}` is indistinguishable from a deliberate one, which
      // is how several swallowed-error findings reached production: nothing
      // separated "this failure genuinely means nothing" from "this failure
      // was dropped". ESLint's no-empty already exempts a block carrying a
      // comment, so satisfying this costs one line and, more to the point,
      // forces the author to say which of the two it is.
      //
      // "warn" rather than "error" for the same reason as the react-hooks
      // rules above: six pre-existing bare catches (app/api/v3/auth/me,
      // components/ai-chat/chat-widget, components/profile/tabs/
      // profile-social-tab, components/providers/auth-provider,
      // components/shared/public-page-shell) predate the rule. Promote it to
      // "error" once those six carry a comment; it is a one-line change each.
      "no-empty": ["warn", { allowEmptyCatch: false }],
    },
  },
  {
    // lib/config/client-constants.ts declares API_VERSION as "the" switch for
    // the versioned API path and builds every entry of the API route map from
    // it. 62 fetch call sites across 28 files spell `/api/v3/...` out instead,
    // so bumping that one constant would move about three quarters of the
    // client and leave the rest asking a version the server no longer serves,
    // with no type error and no failing test to say so (AUDIT-014#hc-10).
    //
    // "warn", not "error", for the same reason as the react-hooks and
    // import/no-unresolved rules above: all 62 predate the rule. `npm run
    // lint` now names every one of them, which is the worklist for migrating
    // them onto the API map; promote this to "error" once that list is empty,
    // otherwise the 63rd lands as silently as the first 62 did.
    //
    // Deliberately scoped to the argument of a `fetch()` call. A version
    // string in prose, in a docs code sample, in an OpenAPI path or in an
    // href is not the defect this is about, and flagging those would bury
    // the real ones.
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.ts"],
    ignores: ["app/docs/**", "app/api/**"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "CallExpression[callee.name='fetch'] > Literal[value=/^\\u002fapi\\u002fv[0-9]/]",
          message:
            "Hardcoded /api/v<n> path. Use the API map from @/lib/config/constants (or client-constants), which builds every route from API_VERSION.",
        },
        {
          selector:
            "CallExpression[callee.name='fetch'] TemplateElement[value.raw=/^\\u002fapi\\u002fv[0-9]/]",
          message:
            "Hardcoded /api/v<n> path. Use the API map from @/lib/config/constants (or client-constants), which builds every route from API_VERSION.",
        },
      ],
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
    //
    // The list below started as the four auth globs only. The swallowed-error
    // findings that later audits filed (a dropped scan-engine rejection, a
    // quota refund whose promise nothing awaited) all sat in directories the
    // rule did not reach, so the orchestration files for billing, webhooks,
    // email and the scanner are in scope too. `lib/scanner/*.ts` is
    // deliberately single-level: it covers the orchestrators that await
    // things, not the thousands of lines of pure detector bodies under
    // lib/scanner/checks/, which would multiply lint time for no benefit.
    files: [
      "lib/auth/**/*.ts",
      "app/api/v3/auth/**/*.ts",
      "app/api/v3/account/**/*.ts",
      "app/api/v3/admin/**/*.ts",
      "lib/billing/**/*.ts",
      "lib/webhooks/**/*.ts",
      "lib/email/**/*.ts",
      "lib/scanner/*.ts",
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
  {
    // Plain Node ESM: the migration/backup/repair scripts and the standalone
    // CLI package. These run outside Next.js entirely, so the React, Next and
    // browser-oriented rules that the shared blocks above turn on do not
    // apply and are switched off here rather than left to produce noise on
    // files they were never written for.
    //
    // What stays on is the correctness set: an unresolvable import, an
    // undefined identifier, an unreachable branch or a duplicated else-if is
    // a real defect in a script that runs against a live database, and until
    // now nothing in the repository would have reported one.
    files: ["scripts/**/*.mjs", "cli/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        fetch: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        structuredClone: "readonly",
        crypto: "readonly",
        performance: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "@next/next/no-img-element": "off",
      "import/no-anonymous-default-export": "off",
      "react-hooks/rules-of-hooks": "off",
      "no-undef": "error",
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      "no-dupe-else-if": "error",
      "no-dupe-args": "error",
      "no-const-assign": "error",
      "no-self-assign": "error",
      "no-unsafe-negation": "error",
      "no-unsafe-optional-chaining": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
      // The exact defect this whole block exists for: a migration script
      // importing a symbol from a path that does not resolve, which fails at
      // runtime on an operator's populated database. It is "warn" rather than
      // "error" only because there is already one standing violation
      // (scripts/migrate/versions/_legacy-original.mjs imports "./_lib.mjs",
      // which does not exist) filed separately against a file this change
      // does not own. Promote it to "error" the moment that one is resolved,
      // otherwise this reports a class of bug without preventing it.
      "import/no-unresolved": "warn",
      // Only a truly empty block is reported: ESLint's no-empty already
      // exempts a block that carries a comment, which is how the deliberate
      // no-op catches in this tree are written.
      "no-empty": ["error", { allowEmptyCatch: false }],
    },
  },
];

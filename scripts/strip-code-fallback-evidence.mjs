#!/usr/bin/env node
/**
 * Strips generic fallback evidence messages from code.ts detectors.
 *
 * Some code detectors have a pattern like:
 *
 *   if (/strict-pattern/.test(body)) return "Real evidence string.";
 *   if (/loose-pattern/.test(body)) return "X usage - confirm Y."; // stub
 *   return null;
 *
 * The loose-pattern fallback fires on every Next.js / React page because the
 * framework bundles contain the keyword (e.g. `dangerouslySetInnerHTML`,
 * `localStorage`). We change the fallback to `return null` so the detector
 * only fires when the strict evidence pattern matches.
 *
 * Run with: node scripts/strip-code-fallback-evidence.mjs
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET = resolve(__dirname, "..", "lib", "scanner", "checks", "code.ts");

const before = await readFile(TARGET, "utf8");
let after = before;
let totalRemoved = 0;

// Each entry: { id, fallbackReturnLine, detectorMarker } — replaces the
// fallback `if (...)` block + its `return null;` with a single `return null;`.
// We anchor on the unique fallback evidence string then match the surrounding
// `if (...)` shape that introduces it.

const FALLBACKS = [
  {
    id: "code-dangerously-setinnerhtml",
    evidence:
      'return "dangerouslySetInnerHTML usage - confirm __html is sanitized.";',
  },
  {
    id: "code-xss-dangerouslysetinnerhtml-dynamic",
    evidence:
      'return "dangerouslySetInnerHTML in source - audit computed __html values.";',
  },
  {
    id: "local-storage-sensitive",
    evidence:
      'return "localStorage usage - ensure no sensitive identifiers are stored.";',
  },
  {
    id: "code-auth-localstorage-tokens",
    evidence:
      'return "localStorage in source - confirm no auth tokens are stored here.";',
  },
  {
    id: "code-local-storage-pii",
    evidence: 'return "localStorage usage - confirm no PII is stored.";',
  },
  {
    id: "sessionstorage-tokens",
    evidence:
      'return "sessionStorage usage - confirm no auth tokens are kept in tab scope.";',
  },
  {
    id: "code-auth-sessionstorage-passwords",
    evidence:
      'return "sessionStorage in source - confirm no passwords are stored here.";',
  },
];

for (const { id, evidence } of FALLBACKS) {
  // The pattern is:
  //   \n    if (/<regex>/.test(body)) {\n      <evidence>\n    }\n    return null;
  // We replace it with:
  //   \n    return null;
  // anchored on the unique evidence line.
  const re = new RegExp(
    String.raw`\n([ \t]+)if \([^)]*\.test\(body\)[^)]*\) \{\n` +
      `[ \t]+${evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\n` +
      `[ \t]+\}\n` +
      `[ \t]+return null;`,
    "g",
  );
  const matches = after.match(re) ?? [];
  if (matches.length > 0) {
    after = after.replace(re, "\n$1return null;");
    console.log(`[strip-code-fallbacks] ${id}: removed ${matches.length}`);
    totalRemoved += matches.length;
  } else {
    console.log(`[strip-code-fallbacks] ${id}: no match`);
  }
}

if (after !== before) {
  await writeFile(TARGET, after, "utf8");
  console.log(`[strip-code-fallbacks] total removed: ${totalRemoved}`);
} else {
  console.log(`[strip-code-fallbacks] no changes`);
}

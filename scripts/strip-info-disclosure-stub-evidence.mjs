#!/usr/bin/env node
/**
 * Strips HTML-body-fallback stub-evidence branches from scanner detectors.
 *
 * The pattern is:
 *
 *   if (/<html/i.test(body)) {
 *     return "HTML page served — verify X.";
 *   }
 *   return null;
 *
 * These branches fire on EVERY HTML page even when the actual detection
 * (a missing header, a missing file, etc.) didn't occur. They produce
 * noisy "verify..." findings with no real evidence.
 *
 * After stripping, the detector only fires on the real detection path,
 * returning null when neither the primary nor secondary checks match.
 *
 * Run with: node scripts/strip-info-disclosure-stub-evidence.mjs
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGETS = [
  resolve(
    __dirname,
    "..",
    "lib",
    "scanner",
    "checks",
    "information-disclosure.ts",
  ),
  resolve(__dirname, "..", "lib", "scanner", "checks", "configuration.ts"),
];

// Match the HTML-body-fallback stub-evidence branches. They take three forms:
//
//   1. `if (/<html/i.test(body)) { return "..."; }`  (most common)
//   2. `const ct = h(headers, "content-type") || "";
//       if (/text\/html/i.test(ct)) { return "..."; }`
//
// In both cases the detector fires on every HTML page even when the actual
// detection (missing header, missing file, etc.) didn't occur.
const STUB_EVIDENCE_RES = [
  /\n[ \t]*if \(\/<html\/i\.test\(body\)\) \{\n[ \t]*return "[^"]*";\n[ \t]*\}\n/g,
  /\n[ \t]*const ct = h\(headers, "content-type"\) \|\| "";\n[ \t]*if \(\/text\/html\/i\.test\(ct\)\) \{\n[ \t]*return "[^"]*";\n[ \t]*\}\n/g,
];

let totalRemoved = 0;

for (const file of TARGETS) {
  const before = await readFile(file, "utf8");
  let after = before;
  let removed = 0;
  for (const re of STUB_EVIDENCE_RES) {
    const matches = after.match(re) ?? [];
    removed += matches.length;
    after = after.replace(re, "\n");
  }
  if (removed > 0) {
    await writeFile(file, after, "utf8");
    console.log(
      `[strip-stubs] ${file}: removed ${removed} stub-evidence branches`,
    );
    totalRemoved += removed;
  } else {
    console.log(`[strip-stubs] ${file}: no stubs found`);
  }
}

console.log(`[strip-stubs] total removed: ${totalRemoved}`);

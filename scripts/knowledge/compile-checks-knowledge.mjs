#!/usr/bin/env node
// Compile every scanner check metadata into a single knowledge file
// the AI can use to answer questions about specific detections
// ("what does hsts-missing do?", "how do I fix x-frame-options
// missing?", "what's the severity of xss-via-prototype-pollution?").

// Reads lib/scanner/checks-data/<category>.json (12 category files
// covering 700+ checks) and emits lib/ai/checks-knowledge.md.
//
// Run: `node scripts/knowledge/compile-checks-knowledge.mjs`
// Auto-run: hooked as prebuild + predev in package.json.

import {
  readFileSync,
  readdirSync,
  writeFileSync,
  statSync,
  existsSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = pathResolve(__dirname, "..", "..");
const CHECKS_DIR = join(ROOT, "lib", "scanner", "checks-data");
const PAGE_CHECKS_DIR = join(ROOT, "lib", "scanner", "checks", "page-checks");
const OUTPUT = join(ROOT, "lib", "ai", "checks-knowledge.md");
const INDEX_OUTPUT = join(ROOT, "lib", "ai", "checks-index.md");
const STATS_OUTPUT = join(ROOT, "lib", "config", "check-stats.generated.ts");

// Floor assertions. A checks-data category that stops parsing, gets renamed or
// is deleted used to shrink the compiled knowledge silently: the build stayed
// green and the assistant simply stopped knowing an entire check category
// existed. These turn that into a failed build. The category floor is exact
// because losing a whole file is the failure being guarded against; the check
// floor sits a little under the current total so removing an individual check
// stays routine. Raise both when the real numbers grow.
const MIN_CHECK_CATEGORIES = 18;
const MIN_TOTAL_CHECKS = 740;

// Rounds an exact check count down to a clean, never-overclaiming marketing
// number -- 795 -> 795 (already a multiple of 5), 793 -> 790. Used for the
// "N+ CHECKS" label baked into config, so a check added or removed can never
// leave it claiming more than the build actually has.
function roundDownForLabel(n) {
  return Math.floor(n / 5) * 5;
}

// Counts `id: "..."` occurrences across the page-checks/*.ts source files --
// that architecture declares its metadata inline instead of a JSON file, so
// there's no array to Array.length here, just a grep-style count.
function countPageChecks() {
  if (!existsSync(PAGE_CHECKS_DIR)) return 0;
  const files = readdirSync(PAGE_CHECKS_DIR, { withFileTypes: true }).filter(
    (d) => d.isFile() && d.name.endsWith(".ts") && d.name !== "index.ts",
  );
  let count = 0;
  const idPattern = /\bid:\s*["']/g;
  for (const f of files) {
    const src = readFileSync(join(PAGE_CHECKS_DIR, f.name), "utf8");
    const matches = src.match(idPattern);
    if (matches) count += matches.length;
  }
  return count;
}

// ── Sitemap <lastmod> source dates ────────────────────────────────────────
//
// app/sitemap.ts used to stamp one build timestamp on all ~820 URLs, so every
// deploy told crawlers that the whole site changed at the same instant.
// Google only uses lastmod when it is consistently accurate and ignores the
// field site-wide otherwise, so the field was worse than absent. The real
// modification date of a per-check page is the last commit that touched its
// category JSON, which is what these two functions read.
//
// Two environments cannot produce that date and must NOT overwrite it:
//
//  - A shallow clone. actions/checkout defaults to fetch-depth 1, where
//    `git log` sees a single commit and reports the checkout date for every
//    file, which would reintroduce the exact "everything changed at once"
//    problem AND fail CI's regenerate-and-diff drift gate on every run.
//  - The Docker build, which copies the source without .git (and whose
//    builder image has no git binary at all).
//
// Both keep whatever dates are already committed in check-stats.generated.ts.
function gitHistoryAvailable() {
  try {
    const shallow = execFileSync(
      "git",
      ["rev-parse", "--is-shallow-repository"],
      {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    return shallow === "false";
  } catch {
    return false;
  }
}

/** The `{ category: "YYYY-MM-DD" }` map already committed to the stats file. */
function committedCategoryDates() {
  if (!existsSync(STATS_OUTPUT)) return {};
  const src = readFileSync(STATS_OUTPUT, "utf8");
  const block = src.match(
    /CHECK_CATEGORY_LAST_MODIFIED[^=]*=\s*\{([\s\S]*?)\n\};/,
  );
  if (!block) return {};
  const out = {};
  // Keys are emitted quoted only where they have to be (see quoteKey below),
  // so both forms have to parse back out.
  for (const [, quoted, bare, date] of block[1].matchAll(
    /(?:"([^"]+)"|([A-Za-z_$][\w$]*)):\s*"(\d{4}-\d{2}-\d{2})"/g,
  )) {
    out[quoted ?? bare] = date;
  }
  return out;
}

// Prettier's default quoteProps is "as-needed" and CI runs `format:check`, so
// the emitted object literal has to already be in the shape Prettier would
// produce: bare keys where they are valid identifiers, quoted where they are
// not ("client-side", "vibe-code"). Emitting them all quoted made the
// generated file fail formatting the moment it was regenerated.
function quoteKey(key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : `"${key}"`;
}

function categoryLastModified(categories) {
  const committed = committedCategoryDates();
  if (!gitHistoryAvailable()) return committed;

  const out = {};
  for (const cat of categories) {
    const relative = `lib/scanner/checks-data/${cat}.json`;
    let dirty = false;
    let committedDate = "";
    try {
      // A category edited but not yet committed would otherwise be stamped
      // with its PREVIOUS commit date, which is wrong the moment the edit
      // lands. Today's date is what that commit will carry.
      dirty =
        execFileSync("git", ["status", "--porcelain", "--", relative], {
          cwd: ROOT,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim().length > 0;
      committedDate = execFileSync(
        "git",
        ["log", "-1", "--format=%cI", "--", relative],
        { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      )
        .trim()
        .slice(0, 10);
    } catch {
      // Leave both at their defaults; the fallbacks below cover it.
    }

    const date = dirty
      ? new Date().toISOString().slice(0, 10)
      : committedDate || committed[cat];
    // A category with no commit and no previously recorded date is left out
    // rather than given an invented one: lib/seo/routes.ts falls back to the
    // build timestamp for any route with no source date.
    if (date) out[cat] = date;
  }
  return out;
}

// Returns { data } or { error }. It used to swallow the parse error and hand
// back null, which the caller turned into a console.warn and a `continue`: an
// entire check category could stop parsing and the build would still succeed
// with that category missing from the AI's knowledge.
function readJson(path) {
  try {
    return { data: JSON.parse(readFileSync(path, "utf8")) };
  } catch (err) {
    return { error: err.message };
  }
}

function renderFix(check) {
  const lines = [];
  if (Array.isArray(check.fixSteps) && check.fixSteps.length) {
    for (const step of check.fixSteps) {
      lines.push(`- ${String(step).replace(/`/g, "")}`);
    }
  }
  if (Array.isArray(check.codeExamples) && check.codeExamples.length) {
    for (const ex of check.codeExamples) {
      const label = ex.label || "Example";
      const lang = ex.language || "text";
      const code = String(ex.code || "").replace(/\$\{[^}]+\}/g, "<value>");
      lines.push(`- **${label}** (${lang}):`);
      lines.push("```" + lang);
      lines.push(code);
      lines.push("```");
    }
  }
  return lines.join("\n");
}

function renderCheck(check, category) {
  const lines = [];
  const sev = check.severity || "info";
  const type = check.type || "";
  lines.push(
    `### \`${check.id}\` [${category} / ${sev}${type ? " / " + type : ""}]`,
  );
  lines.push(`**${check.title || check.id}**`);
  lines.push("");
  if (check.description) {
    lines.push(String(check.description));
    lines.push("");
  }
  if (check.riskImpact && check.riskImpact !== check.description) {
    lines.push(`**Risk:** ${String(check.riskImpact).replace(/`/g, "")}`);
    lines.push("");
  }
  if (check.explanation && check.explanation !== check.description) {
    lines.push(
      `**Why it matters:** ${String(check.explanation).replace(/`/g, "")}`,
    );
    lines.push("");
  }
  if (Array.isArray(check.references) && check.references.length) {
    lines.push("**References:**");
    for (const r of check.references) lines.push(`- ${r}`);
    lines.push("");
  }
  if (
    (Array.isArray(check.fixSteps) && check.fixSteps.length) ||
    (Array.isArray(check.codeExamples) && check.codeExamples.length)
  ) {
    lines.push("**Fix:**");
    lines.push(renderFix(check));
    lines.push("");
  }
  return lines.join("\n");
}

async function build() {
  if (!existsSync(CHECKS_DIR)) {
    console.error("[compile-checks-knowledge] not found:", CHECKS_DIR);
    process.exit(1);
  }
  const files = readdirSync(CHECKS_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".json"))
    .map((d) => d.name.replace(/\.json$/, ""))
    .filter((name) => name !== "_schema")
    .sort();

  if (files.length < MIN_CHECK_CATEGORIES) {
    console.error(
      `[compile-checks-knowledge] found only ${files.length} check categories, expected at least ${MIN_CHECK_CATEGORIES}. A checks-data file was renamed or deleted; fix it or lower MIN_CHECK_CATEGORIES deliberately.`,
    );
    process.exit(1);
  }

  const byCategory = {};
  let totalChecks = 0;
  const bySeverity = {};
  const byType = {};

  for (const cat of files) {
    const read = readJson(join(CHECKS_DIR, `${cat}.json`));
    if (read.error) {
      console.error(
        `[compile-checks-knowledge] ${cat}.json failed to parse: ${read.error}`,
      );
      process.exit(1);
    }
    const arr = read.data;
    if (!Array.isArray(arr)) {
      console.error(
        `[compile-checks-knowledge] ${cat}.json is not an array. Every checks-data file must be a JSON array of checks.`,
      );
      process.exit(1);
    }
    byCategory[cat] = arr;
    totalChecks += arr.length;
    for (const c of arr) {
      const s = c.severity || "info";
      bySeverity[s] = (bySeverity[s] || 0) + 1;
      const t = c.type || "unknown";
      byType[t] = (byType[t] || 0) + 1;
    }
  }

  if (totalChecks < MIN_TOTAL_CHECKS) {
    console.error(
      `[compile-checks-knowledge] compiled only ${totalChecks} checks, expected at least ${MIN_TOTAL_CHECKS}. A category shrank unexpectedly; fix it or lower MIN_TOTAL_CHECKS deliberately.`,
    );
    process.exit(1);
  }

  // Captured before the writes below. The staleness comparison used to stat
  // OUTPUT after overwriting it, so the "knowledge file" mtime was always the
  // current time, daysStale was always negative and the warning was
  // unreachable. It is a working-tree signal only: git does not record mtimes,
  // so on a fresh clone (CI, the Docker build) every file carries the checkout
  // time and this stays quiet.
  const previousOutputMtime = existsSync(OUTPUT)
    ? statSync(OUTPUT).mtimeMs
    : null;

  const now = new Date();
  const out = [
    "# VulnRadar Scanner Checks: AI Knowledge",
    "",
    `_Auto-compiled from \`lib/scanner/checks-data/*.json\` on ${now.toISOString().slice(0, 10)}._`,
    "",
    "This file is consumed by the AI system prompt at runtime so the",
    "assistant can answer questions about specific scanner checks:",
    "what a check does, why it matters, how to fix it, and what code",
    "examples the project ships. Treat this as authoritative for",
    "detection behavior.",
    "",
    "Severity levels: critical, high, medium, low, info.",
    "Types: header, content, body-pattern, status-based, combined,",
    "protocol-specific, async, port, banner, email-dns, etc.",
    "When the user asks about a check ID (e.g. 'hsts-missing'), find it",
    "in this file and quote the title, description, and fix steps.",
    "",
    "---",
    "",
    "## Summary",
    "",
    `- **Total checks:** ${totalChecks}`,
    `- **Categories:** ${files.length} (${files.join(", ")})`,
    "- **By severity:**",
    ...Object.entries(bySeverity)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  - ${k}: ${v}`),
    "- **By type:**",
    ...Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  - ${k}: ${v}`),
    "",
    "---",
    "",
  ];

  for (const cat of files) {
    const arr = byCategory[cat] || [];
    out.push(`## Category: ${cat} (${arr.length} checks)`);
    out.push("");
    for (const check of arr) {
      out.push(renderCheck(check, cat));
    }
    out.push("---");
    out.push("");
  }

  writeFileSync(OUTPUT, out.join("\n"), "utf8");
  console.log(
    `[compile-checks-knowledge] wrote ${OUTPUT.replace(ROOT + "\\", "")} (${totalChecks} checks across ${files.length} categories)`,
  );

  const indexLines = [
    "# VulnRadar Scanner Checks: AI Index (compact)",
    "",
    `_Compact index auto-compiled from \`lib/scanner/checks-data/*.json\` on ${now.toISOString().slice(0, 10)}._`,
    "",
    "One line per check. Format: `[severity] check-id - title`.",
    "Full details (fix steps, code examples, references) live in",
    "`lib/ai/checks-knowledge.md` and `lib/scanner/checks-data/<category>.json`.",
    "",
    "Use this index to know which checks exist. When the user asks about",
    "a specific check ID, quote the title + severity + the category, and",
    "direct them to the matching JSON file or the `hsts-missing`-style",
    "remediation documentation in the docs.",
    "",
    "---",
    "",
    "## All checks (by category)",
    "",
  ];

  for (const cat of files) {
    const arr = byCategory[cat] || [];
    indexLines.push(`### ${cat} (${arr.length})`);
    for (const c of arr) {
      const sev = (c.severity || "info").padEnd(8);
      const id = c.id || "?";
      // Escape backslashes before pipes so a title already containing "\|"
      // doesn't get double-escaped into "\\|" (CWE-116 double-escaping).
      const title = (c.title || "")
        .replace(/\\/g, "\\\\")
        .replace(/\|/g, "\\|");
      const type = c.type ? ` [${c.type}]` : "";
      indexLines.push(`- [${sev}] \`${id}\`${type} - ${title}`);
    }
    indexLines.push("");
  }
  indexLines.push("---");
  indexLines.push("");
  indexLines.push(`## Totals`);
  indexLines.push("");
  indexLines.push(`- Total checks: **${totalChecks}**`);
  indexLines.push(`- Categories: **${files.length}** (${files.join(", ")})`);
  indexLines.push("- By severity:");
  for (const [k, v] of Object.entries(bySeverity).sort((a, b) => b[1] - a[1])) {
    indexLines.push(`  - ${k}: ${v}`);
  }
  indexLines.push("- By type:");
  for (const [k, v] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    indexLines.push(`  - ${k}: ${v}`);
  }
  indexLines.push("");

  writeFileSync(INDEX_OUTPUT, indexLines.join("\n"), "utf8");
  console.log(
    `[compile-checks-knowledge] wrote ${INDEX_OUTPUT.replace(ROOT + "\\", "")} (compact index)`,
  );

  // ── Exact-count constants for docs pages ──────────────────────────────
  // Regenerated on every build/dev start (see package.json's prebuild/predev
  // hooks) so a page importing these never needs a manual edit when a check
  // is added, removed, or a category changes. The marketing "N+" label is
  // ALSO regenerated here (see roundDownForLabel above) -- config-values.ts's
  // CONFIG_TOTAL_CHECKS_LABEL defaults to it, so it can't silently go stale
  // relative to the real check count the way a hand-typed "750+" eventually did.
  const pageCheckCount = countPageChecks();
  const exactCheckCount = totalChecks + pageCheckCount;
  const roundedLabel = roundDownForLabel(exactCheckCount);
  const lastModified = categoryLastModified(files);
  const statsLines = [
    "// AUTO-GENERATED by scripts/knowledge/compile-checks-knowledge.mjs -- do not hand-edit.",
    "// Regenerated on every `npm run build` / `npm run dev` (prebuild/predev hooks).",
    "",
    `export const EXACT_LEGACY_CHECK_COUNT = ${totalChecks};`,
    `export const EXACT_PAGE_CHECK_COUNT = ${pageCheckCount};`,
    `export const EXACT_CHECK_COUNT = ${exactCheckCount};`,
    `export const EXACT_CHECK_CATEGORY_COUNT = ${files.length};`,
    `export const GENERATED_CHECKS_LABEL = "${roundedLabel}+";`,
    "",
    "/**",
    " * Last commit date of each `lib/scanner/checks-data/<category>.json`, used",
    " * as the sitemap <lastmod> for that category's per-check pages. A category",
    " * missing here has no recorded source date and falls back to the build",
    " * timestamp in lib/seo/routes.ts.",
    " */",
    "export const CHECK_CATEGORY_LAST_MODIFIED: Record<string, string> = {",
    ...Object.keys(lastModified)
      .sort()
      .map((cat) => `  ${quoteKey(cat)}: "${lastModified[cat]}",`),
    "};",
    "",
  ];
  writeFileSync(STATS_OUTPUT, statsLines.join("\n"), "utf8");
  console.log(
    `[compile-checks-knowledge] wrote ${STATS_OUTPUT.replace(ROOT + "\\", "")} (EXACT_CHECK_COUNT=${exactCheckCount}, label=${roundedLabel}+)`,
  );

  if (previousOutputMtime !== null) {
    const newestSource = Math.max(
      ...files.map((f) => statSync(join(CHECKS_DIR, `${f}.json`)).mtimeMs),
    );
    const daysStale = (newestSource - previousOutputMtime) / 86400000;
    if (daysStale > 30) {
      console.warn(
        `[compile-checks-knowledge] NOTE: checks-data had been edited ${Math.round(daysStale)} days after the previous knowledge file. This run refreshed it.`,
      );
    }
  }
}

await build();

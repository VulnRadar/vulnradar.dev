#!/usr/bin/env node
// Compile every scanner check metadata into a single knowledge file
// the AI can use to answer questions about specific detections
// ("what does hsts-missing do?", "how do I fix x-frame-options
// missing?", "what's the severity of xss-via-prototype-pollution?").

// Reads lib/scanner/checks-data/<category>.json (12 category files
// covering 700+ checks) and emits lib/ai/checks-knowledge.md.
//
// Run: `node scripts/compile-checks-knowledge.mjs`
// Auto-run: hooked as prebuild + predev in package.json.

import {
  readFileSync,
  readdirSync,
  writeFileSync,
  statSync,
  existsSync,
} from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = pathResolve(__dirname, "..");
const CHECKS_DIR = join(ROOT, "lib", "scanner", "checks-data");
const OUTPUT = join(ROOT, "lib", "ai", "checks-knowledge.md");
const INDEX_OUTPUT = join(ROOT, "lib", "ai", "checks-index.md");

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
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

function build() {
  if (!existsSync(CHECKS_DIR)) {
    console.error("[compile-checks-knowledge] not found:", CHECKS_DIR);
    process.exit(1);
  }
  const files = readdirSync(CHECKS_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".json"))
    .map((d) => d.name.replace(/\.json$/, ""))
    .filter((name) => name !== "_schema")
    .sort();

  const byCategory = {};
  let totalChecks = 0;
  const bySeverity = {};
  const byType = {};

  for (const cat of files) {
    const arr = readJsonSafe(join(CHECKS_DIR, `${cat}.json`));
    if (!Array.isArray(arr)) {
      console.warn(
        `[compile-checks-knowledge] skipping ${cat}.json (not an array)`,
      );
      continue;
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

  const now = new Date();
  const out = [
    "# VulnRadar Scanner Checks — AI Knowledge",
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
    "# VulnRadar Scanner Checks — AI Index (compact)",
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
      const title = (c.title || "").replace(/\|/g, "\\|");
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

  if (existsSync(OUTPUT)) {
    const newestSource = Math.max(
      ...files.map((f) => statSync(join(CHECKS_DIR, `${f}.json`)).mtimeMs),
    );
    const outMtime = statSync(OUTPUT).mtimeMs;
    const daysStale = (newestSource - outMtime) / 86400000;
    if (daysStale > 30) {
      console.warn(
        `[compile-checks-knowledge] WARNING: checks-data was edited ${Math.round(daysStale)} days after this knowledge file.`,
      );
    }
  }
}

build();

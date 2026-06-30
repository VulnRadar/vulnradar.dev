#!/usr/bin/env node
// Compile the changelog data into a knowledge file the AI can use to
// answer questions about specific versions, dates, and shipped features.
//
// Reads app/changelog/page.tsx (which contains the CHANGELOG array) and
// extracts the textual fields: version, date, title, summary, and each
// change's label + description. Icon names are captured as [icon: Name]
// markers so the AI can reference them but we don't import the icon lib.
//
// Run: `node scripts/compile-changelog-knowledge.mjs`
// Auto-run: hooked as prebuild + predev in package.json.

import { readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = pathResolve(__dirname, "..");
const CHANGELOG_SRC = join(ROOT, "app", "changelog", "page.tsx");
const OUTPUT = join(ROOT, "lib", "ai", "changelog-knowledge.md");

function extractChangelog(source) {
  const startMatch = source.match(/^const CHANGELOG:\s*Release\[\]\s*=\s*\[/m);
  if (!startMatch) {
    throw new Error("CHANGELOG array not found in " + CHANGELOG_SRC);
  }
  const start = startMatch.index + startMatch[0].length;
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    if (depth === 0) break;
    i++;
  }
  if (depth !== 0) {
    throw new Error("Unterminated CHANGELOG array");
  }
  const arraySource = source.slice(start, i);

  const releases = [];
  let releaseDepth = 0;
  let releaseStart = -1;
  for (let j = 0; j < arraySource.length; j++) {
    const c = arraySource[j];
    if (c === "{") {
      if (releaseDepth === 0) releaseStart = j;
      releaseDepth++;
    } else if (c === "}") {
      releaseDepth--;
      if (releaseDepth === 0 && releaseStart !== -1) {
        const obj = arraySource.slice(releaseStart, j + 1);
        const release = parseRelease(obj);
        if (release) releases.push(release);
        releaseStart = -1;
      }
    }
  }
  return releases;
}

function parseRelease(objSource) {
  const fields = parseObjectLiteral(objSource);
  if (!fields.version) return null;
  return {
    version: String(fields.version),
    date: String(fields.date || ""),
    title: String(fields.title || ""),
    summary: fields.summary ? String(fields.summary) : "",
    highlights: !!fields.highlights,
    changes: Array.isArray(fields.changes) ? fields.changes : [],
  };
}

function parseObjectLiteral(objSource) {
  const out = {};
  const propRe =
    /(\w+):\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`|\[[\s\S]*?\]|\{[\s\S]*?\}|true|false|null|-?\d+(\.\d+)?)/g;
  let m;
  while ((m = propRe.exec(objSource)) !== null) {
    const key = m[1];
    let value = m[2];
    if (value.startsWith('"') || value.startsWith("'")) {
      value = value.slice(1, -1);
    } else if (value.startsWith("`") && value.endsWith("`")) {
      value = value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
    } else if (value.startsWith("[")) {
      value = parseArray(value);
    } else if (value.startsWith("{")) {
      value = parseObjectLiteral(value);
    } else if (value === "true") value = true;
    else if (value === "false") value = false;
    else if (value === "null") value = null;
    else if (!isNaN(Number(value))) value = Number(value);
    out[key] = value;
  }
  return out;
}

function parseArray(arrSource) {
  const out = [];
  let depth = 0;
  let itemStart = -1;
  for (let j = 0; j < arrSource.length; j++) {
    const c = arrSource[j];
    if (c === "{" || c === "[") {
      if (depth === 0) itemStart = j;
      depth++;
    } else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0 && itemStart !== -1) {
        const item = arrSource.slice(itemStart, j + 1);
        if (item.startsWith("{")) {
          out.push(parseObjectLiteral(item));
        } else {
          out.push(item.slice(1, -1));
        }
        itemStart = -1;
      }
    } else if (c === "," && depth === 0) {
      const item = arrSource.slice(itemStart, j);
      out.push(item.trim());
      itemStart = j + 1;
    }
  }
  return out;
}

function changeIconName(change) {
  if (change.icon && typeof change.icon === "string") {
    return change.icon;
  }
  return "icon";
}

function renderChange(change) {
  const lines = [];
  const icon = changeIconName(change);
  const cat = change.category ? ` [${change.category.toUpperCase()}]` : "";
  const label = change.label || "(unlabelled)";
  lines.push(`- [${icon}]${cat} **${label}**`);
  if (change.desc) {
    lines.push(`  ${String(change.desc).replace(/\s+/g, " ").trim()}`);
  }
  return lines.join("\n");
}

function renderRelease(release) {
  const lines = [];
  const tag = release.highlights ? " **(highlights)**" : "";
  lines.push(`## v${release.version} — ${release.date}${tag}`);
  lines.push(`**${release.title}**`);
  lines.push("");
  if (release.summary) {
    lines.push(release.summary);
    lines.push("");
  }
  if (release.changes.length) {
    lines.push("### Changes");
    for (const c of release.changes) {
      lines.push(renderChange(c));
    }
    lines.push("");
  }
  return lines.join("\n");
}

function build() {
  if (!existsSync(CHANGELOG_SRC)) {
    console.error("[compile-changelog-knowledge] not found:", CHANGELOG_SRC);
    process.exit(1);
  }
  const source = readFileSync(CHANGELOG_SRC, "utf8");
  const releases = extractChangelog(source);
  if (releases.length === 0) {
    console.error("[compile-changelog-knowledge] no releases extracted");
    process.exit(1);
  }

  const now = new Date();
  const out = [
    "# VulnRadar Changelog — AI Knowledge",
    "",
    `_Auto-compiled from \`app/changelog/page.tsx\` on ${now.toISOString().slice(0, 10)}._`,
    "",
    "This file is consumed by the AI system prompt at runtime so the",
    "assistant can answer questions about specific versions, release",
    'dates, and shipped features. When a user asks "what changed in',
    'v2.3.0?" or "when was the API keys feature added?", answer from',
    "this file. The current/latest version is always the first entry.",
    "",
    "Versioning: major.minor.patch. The engine version (scanner rules)",
    "and the app version (UI/backend) are tracked separately in the",
    "config (see `lib/config/config-values.ts`).",
    "",
    "---",
    "",
  ];

  for (const r of releases) {
    out.push(renderRelease(r));
  }

  out.push("---");
  out.push("");
  out.push("## Quick reference");
  out.push("");
  out.push(`- **Total releases:** ${releases.length}`);
  const first = releases[0];
  const last = releases[releases.length - 1];
  out.push(`- **Latest:** v${first.version} (${first.date}) — ${first.title}`);
  out.push(
    `- **Earliest in file:** v${last.version} (${last.date}) — ${last.title}`,
  );
  out.push("");

  writeFileSync(OUTPUT, out.join("\n"), "utf8");
  console.log(
    `[compile-changelog-knowledge] wrote ${OUTPUT.replace(ROOT + "\\", "")} (${releases.length} releases)`,
  );

  if (existsSync(OUTPUT)) {
    const srcMtime = statSync(CHANGELOG_SRC).mtimeMs;
    const outMtime = statSync(OUTPUT).mtimeMs;
    const daysStale = (srcMtime - outMtime) / 86400000;
    if (daysStale > 30) {
      console.warn(
        `[compile-changelog-knowledge] WARNING: changelog was edited ${Math.round(daysStale)} days after this knowledge file.`,
      );
    }
  }
}

build();

#!/usr/bin/env node
// Compile the changelog data into a knowledge file the AI can use to
// answer questions about specific versions, dates, and shipped features.
//
// Reads app/changelog/page.tsx (which contains the CHANGELOG array) and
// extracts every release with its changes (label, desc, category).
//
// Implementation note: this used a regex-based parser that broke on
// versions whose summary field contained a `]` (e.g. "API: send
// probes: [\"ssh:22\", \"smtp:587\"]") because the lazy `[\s\S]*?\]`
// matched the inner `]`. The new parser is a hand-rolled tokenizer
// that tracks depth, quote state, and template-literal braces so it
// never gets confused by `]` inside string values.
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

class Parser {
  constructor(source) {
    this.source = source;
    this.pos = 0;
  }

  peek() {
    return this.source[this.pos];
  }

  skipWhitespace() {
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        this.pos++;
        continue;
      }
      if (
        ch === "/" &&
        (this.source[this.pos + 1] === "/" || this.source[this.pos + 1] === "*")
      ) {
        if (this.source[this.pos + 1] === "/") {
          while (
            this.pos < this.source.length &&
            this.source[this.pos] !== "\n"
          ) {
            this.pos++;
          }
        } else {
          this.pos += 2;
          while (
            this.pos < this.source.length - 1 &&
            !(
              this.source[this.pos] === "*" && this.source[this.pos + 1] === "/"
            )
          ) {
            this.pos++;
          }
          this.pos += 2;
        }
        continue;
      }
      break;
    }
  }

  expect(str) {
    if (this.source.slice(this.pos, this.pos + str.length) !== str) {
      const around = this.source.slice(
        Math.max(0, this.pos - 20),
        this.pos + 30,
      );
      throw new Error(
        `Expected ${JSON.stringify(str)} at position ${this.pos}, got ${JSON.stringify(around)}`,
      );
    }
    this.pos += str.length;
  }

  parseValue() {
    this.skipWhitespace();
    if (this.pos >= this.source.length) return undefined;
    const ch = this.source[this.pos];
    if (ch === '"' || ch === "'") return this.parseString(ch);
    if (ch === "`") return this.parseTemplateLiteral();
    if (ch === "[" || ch === "{") return this.parseArrayOrObject(ch);
    if (ch === "-" || (ch >= "0" && ch <= "9")) return this.parseNumber();
    if (this.source.startsWith("true", this.pos)) {
      this.pos += 4;
      return true;
    }
    if (this.source.startsWith("false", this.pos)) {
      this.pos += 5;
      return false;
    }
    if (this.source.startsWith("null", this.pos)) {
      this.pos += 4;
      return null;
    }
    return this.parseIdentifier();
  }

  parseString(quote) {
    this.pos++;
    let result = "";
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (ch === "\\") {
        this.pos++;
        if (this.pos >= this.source.length) break;
        const next = this.source[this.pos];
        if (next === "n") result += "\n";
        else if (next === "t") result += "\t";
        else if (next === "r") result += "\r";
        else if (next === "\\") result += "\\";
        else if (next === quote) result += quote;
        else if (next === "$") result += "$";
        else result += next;
        this.pos++;
      } else if (ch === quote) {
        this.pos++;
        return result;
      } else {
        result += ch;
        this.pos++;
      }
    }
    throw new Error(
      "Unterminated string starting near position " + (this.pos - 50),
    );
  }

  parseTemplateLiteral() {
    this.pos++;
    let result = "";
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (ch === "\\") {
        this.pos++;
        if (this.pos >= this.source.length) break;
        const next = this.source[this.pos];
        if (next === "n") result += "\n";
        else if (next === "t") result += "\t";
        else if (next === "r") result += "\r";
        else if (next === "\\") result += "\\";
        else if (next === "`") result += "`";
        else if (next === "$") result += "$";
        else result += next;
        this.pos++;
      } else if (ch === "$" && this.source[this.pos + 1] === "{") {
        this.pos += 2;
        let depth = 1;
        while (this.pos < this.source.length && depth > 0) {
          if (this.source[this.pos] === "{") depth++;
          else if (this.source[this.pos] === "}") depth--;
          this.pos++;
        }
      } else if (ch === "`") {
        this.pos++;
        return result;
      } else {
        result += ch;
        this.pos++;
      }
    }
    throw new Error("Unterminated template literal");
  }

  parseNumber() {
    const start = this.pos;
    if (this.source[this.pos] === "-") this.pos++;
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if ((ch >= "0" && ch <= "9") || ch === ".") {
        this.pos++;
      } else {
        break;
      }
    }
    return Number(this.source.slice(start, this.pos));
  }

  parseIdentifier() {
    const start = this.pos;
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (
        (ch >= "a" && ch <= "z") ||
        (ch >= "A" && ch <= "Z") ||
        (ch >= "0" && ch <= "9") ||
        ch === "_" ||
        ch === "$"
      ) {
        this.pos++;
      } else {
        break;
      }
    }
    return this.source.slice(start, this.pos);
  }

  parseArrayOrObject(openChar) {
    this.pos++;
    const closeChar = openChar === "[" ? "]" : "}";
    const isArray = openChar === "[";
    const result = isArray ? [] : {};

    while (true) {
      this.skipWhitespace();
      if (this.pos >= this.source.length) {
        throw new Error(`Unterminated ${isArray ? "array" : "object"}`);
      }
      if (this.source[this.pos] === closeChar) {
        this.pos++;
        return result;
      }
      if (isArray) {
        const v = this.parseValue();
        result.push(v);
      } else {
        const key = this.parseIdentifier();
        this.skipWhitespace();
        if (this.source[this.pos] !== ":") {
          const around = this.source.slice(
            Math.max(0, this.pos - 30),
            this.pos + 30,
          );
          throw new Error(
            `Expected ":" after key "${key}" at position ${this.pos}, got ${JSON.stringify(around)}`,
          );
        }
        this.pos++;
        const v = this.parseValue();
        result[key] = v;
      }
      this.skipWhitespace();
      if (this.source[this.pos] === ",") {
        this.pos++;
        continue;
      }
      if (this.source[this.pos] === closeChar) {
        this.pos++;
        return result;
      }
      const around = this.source.slice(
        Math.max(0, this.pos - 20),
        this.pos + 30,
      );
      throw new Error(
        `Expected "," or "${closeChar}" at position ${this.pos}, got ${JSON.stringify(around)}`,
      );
    }
  }
}

function parseChangelog(source) {
  const startMatch = source.match(/^const CHANGELOG:\s*Release\[\]\s*=\s*\[/m);
  if (!startMatch) {
    throw new Error("CHANGELOG array not found");
  }
  const p = new Parser(source);
  p.pos = startMatch.index + startMatch[0].length - 1;
  return p.parseArrayOrObject("[");
}

function releaseToObject(r) {
  return {
    version: String(r.version || "?"),
    date: String(r.date || ""),
    title: String(r.title || ""),
    summary: typeof r.summary === "string" ? r.summary : "",
    highlights: !!r.highlights,
    changes: Array.isArray(r.changes)
      ? r.changes.map((c) => ({
          icon: typeof c.icon === "string" ? c.icon : "",
          label: typeof c.label === "string" ? c.label : "",
          desc: typeof c.desc === "string" ? c.desc : "",
          category: typeof c.category === "string" ? c.category : "",
        }))
      : [],
  };
}

function renderChange(change) {
  const parts = [];
  const icon = change.icon || "icon";
  const cat = change.category ? ` **[${change.category.toUpperCase()}]**` : "";
  parts.push(`- [${icon}]${cat} **${change.label}**`);
  if (change.desc) {
    const cleaned = change.desc.replace(/\s+/g, " ").trim();
    parts.push(`  ${cleaned}`);
  }
  return parts.join("\n");
}

function renderRelease(release) {
  const tag = release.highlights ? " **(highlights)**" : "";
  const lines = [
    `## v${release.version} - ${release.date}${tag}`,
    `**${release.title}**`,
  ];
  if (release.summary) lines.push("", release.summary);
  if (release.changes.length) {
    lines.push("", "### Changes");
    for (const c of release.changes) {
      lines.push(renderChange(c));
    }
  }
  return lines.join("\n");
}

function build() {
  if (!existsSync(CHANGELOG_SRC)) {
    console.error("[compile-changelog-knowledge] not found:", CHANGELOG_SRC);
    process.exit(1);
  }
  const source = readFileSync(CHANGELOG_SRC, "utf8");
  let raw;
  try {
    raw = parseChangelog(source);
  } catch (err) {
    console.error("[compile-changelog-knowledge] parse failed:", err.message);
    process.exit(1);
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    console.error(
      "[compile-changelog-knowledge] no releases extracted (got " +
        (Array.isArray(raw) ? raw.length : "non-array") +
        ")",
    );
    process.exit(1);
  }
  const releases = raw.map(releaseToObject);
  const totalChanges = releases.reduce((n, r) => n + r.changes.length, 0);

  const now = new Date();
  const out = [
    "# VulnRadar Changelog - AI Knowledge",
    "",
    `_Auto-compiled from \`app/changelog/page.tsx\` on ${now.toISOString().slice(0, 10)}._`,
    "",
    "This file is consumed by the AI system prompt at runtime so the",
    "assistant can answer questions about specific versions, release",
    'dates, and shipped features. When a user asks "what changed in',
    'v2.3.0?" or "when was the API keys feature added?", answer from',
    "this file. The latest release is always the first entry.",
    "",
    "Versioning: major.minor.patch. The engine version (scanner rules)",
    "and the app version (UI/backend) are tracked separately in the",
    "config (see `lib/config/config-values.ts`).",
    "",
    "Each release entry shows: version, date, title, summary, and every",
    "change with its category tag (added/changed/fixed/security/performance)",
    "and full description.",
    "",
    "---",
    "",
  ];

  for (const r of releases) {
    out.push(renderRelease(r));
    out.push("");
    out.push("---");
    out.push("");
  }

  out.push("## Quick reference");
  out.push("");
  out.push(`- **Total releases:** ${releases.length}`);
  out.push(`- **Total changes documented:** ${totalChanges}`);
  const first = releases[0];
  const last = releases[releases.length - 1];
  out.push(`- **Latest:** v${first.version} (${first.date}) - ${first.title}`);
  out.push(
    `- **Earliest in file:** v${last.version} (${last.date}) - ${last.title}`,
  );
  out.push("");

  writeFileSync(OUTPUT, out.join("\n"), "utf8");
  console.log(
    `[compile-changelog-knowledge] wrote ${OUTPUT.replace(ROOT + "\\", "")} (${releases.length} releases, ${totalChanges} changes)`,
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

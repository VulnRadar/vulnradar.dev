#!/usr/bin/env node
// Compile the changelog data into a knowledge file the AI can use to
// answer questions about specific versions, dates, and shipped features.
//
// Reads lib/changelog/data.ts (which contains the CHANGELOG array, split
// out of app/changelog/page.tsx so the changelog page can lazy-load
// releases client-side) and extracts every release with its changes
// (label, desc, category).
//
// Implementation note: this used a regex-based parser that broke on
// versions whose summary field contained a `]` (e.g. "API: send
// probes: [\"ssh:22\", \"smtp:587\"]") because the lazy `[\s\S]*?\]`
// matched the inner `]`. The new parser is a hand-rolled tokenizer
// that tracks depth, quote state, and template-literal braces so it
// never gets confused by `]` inside string values.
//
// Run: `node scripts/knowledge/compile-changelog-knowledge.mjs`
// Auto-run: hooked as prebuild + predev in package.json.

import { readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = pathResolve(__dirname, "..", "..");
const CHANGELOG_SRC = join(ROOT, "lib", "changelog", "data.ts");
const OUTPUT = join(ROOT, "lib", "ai", "changelog-knowledge.md");
const OUTPUT_INDEX = join(ROOT, "lib", "ai", "changelog-index.md");

// The full file is the retrieval corpus (lib/ai/knowledge-retrieval.ts indexes
// it section by section, so a question about v2.3.0 still gets the whole v2.3.0
// entry). The index is what /changelog HANDS the model in one go, and that is a
// different job with a hard constraint: it has to stay a sane fraction of a
// context window forever, while the full file grows by every release we ship.
//
// It had reached 506 KB, about 107k tokens measured against the provider, for a
// single slash command. Nothing rejected it outright, which is why it went
// unnoticed: it just crowded out everything else, and one more loaded command
// pushed a block past the route's context budget and got it dropped.
//
// So: newest releases in full until FULL_BUDGET, then labels without
// descriptions until LABEL_BUDGET, then one line per release. Every release
// the app has ever shipped still appears, so the model always knows what
// exists and can say so; the detail thins out with age, which is the same
// order anyone actually asks about them in.
const FULL_BUDGET = 110_000;
const LABEL_BUDGET = 45_000;
// A single release with 98 changes is 90 KB on its own, so a budget alone
// could spend everything on one entry. At least this many always render in
// full, and the budget only decides how many MORE than this we can afford.
const MIN_FULL_RELEASES = 2;

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

/** Same heading, change labels only: the "what" without the "why". */
function renderReleaseLabels(release) {
  const tag = release.highlights ? " **(highlights)**" : "";
  const lines = [
    `## v${release.version} - ${release.date}${tag}`,
    `**${release.title}**`,
  ];
  if (release.changes.length) {
    lines.push("");
    for (const c of release.changes) {
      const cat = c.category ? `[${c.category.toUpperCase()}] ` : "";
      lines.push(`- ${cat}${c.label}`);
    }
  }
  return lines.join("\n");
}

function countByCategory(changes) {
  const counts = new Map();
  for (const c of changes) {
    const key = c.category || "other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => `${n} ${cat}`)
    .join(", ");
}

function buildIndex(releases) {
  const out = [
    "# VulnRadar Changelog: AI Index",
    "",
    // No build date in this line, in any of the six compilers. CI regenerates
    // every knowledge file and fails on `git diff --exit-code`, so anything in
    // the output that is not derived from the input is a scheduled failure:
    // a new Date() stamp in UTC means every commit made near midnight is one
    // CI run away from a diff nobody introduced. The date was decoration
    // anyway; the newest release is named in Quick reference below.
    `_Auto-compiled from \`lib/changelog/data.ts\`._`,
    "",
    "Every release VulnRadar has shipped is listed here, newest first. Recent",
    "releases carry every change with its full description; older ones thin out",
    "to change titles and then to a single line, because the whole history with",
    "full descriptions is far too large to hand over at once.",
    "",
    "If someone asks about a release that only appears as a title or a line,",
    "say what you can see and answer from the detail that gets retrieved",
    "alongside their question: the complete entry for every release is indexed",
    "in `lib/ai/changelog-knowledge.md` and pulled in automatically when a",
    "question matches it. Never say a release does not exist because its",
    "detail is not in front of you.",
    "",
    "Versioning: major.minor.patch. The engine version (scanner rules) and the",
    "app version (UI/backend) are tracked separately in the config (see",
    "`lib/config/config-values.ts`).",
    "",
    "---",
    "",
  ];

  let spent = 0;
  let mode = "full";
  const tallies = { full: 0, labels: 0, line: 0 };
  let labelsHeaderWritten = false;
  let lineHeaderWritten = false;

  releases.forEach((r, i) => {
    if (mode === "full") {
      const body = renderRelease(r);
      if (i < MIN_FULL_RELEASES || spent + body.length <= FULL_BUDGET) {
        out.push(body, "", "---", "");
        spent += body.length;
        tallies.full++;
        return;
      }
      mode = "labels";
      spent = 0;
    }
    if (mode === "labels") {
      const body = renderReleaseLabels(r);
      if (spent + body.length <= LABEL_BUDGET) {
        if (!labelsHeaderWritten) {
          out.push(
            "## Earlier releases: change titles",
            "",
            "Descriptions omitted. Ask about any of these by version and the full",
            "entry is retrieved.",
            "",
            "---",
            "",
          );
          labelsHeaderWritten = true;
        }
        out.push(body, "", "---", "");
        spent += body.length;
        tallies.labels++;
        return;
      }
      mode = "line";
    }
    if (!lineHeaderWritten) {
      out.push("## Earlier releases: one line each", "");
      lineHeaderWritten = true;
    }
    const counts = countByCategory(r.changes);
    out.push(
      `- **v${r.version}** (${r.date}) ${r.title}: ${r.changes.length} changes${
        counts ? ` (${counts})` : ""
      }`,
    );
    tallies.line++;
  });

  const totalChanges = releases.reduce((n, r) => n + r.changes.length, 0);
  const first = releases[0];
  const last = releases[releases.length - 1];
  out.push("");
  out.push("---");
  out.push("");
  out.push("## Quick reference");
  out.push("");
  out.push(`- **Total releases:** ${releases.length}`);
  out.push(`- **Total changes documented:** ${totalChanges}`);
  out.push(`- **Latest:** v${first.version} (${first.date}) - ${first.title}`);
  out.push(`- **Earliest:** v${last.version} (${last.date}) - ${last.title}`);
  out.push("");

  return { text: out.join("\n"), tallies };
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

  const out = [
    "# VulnRadar Changelog - AI Knowledge",
    "",
    `_Auto-compiled from \`lib/changelog/data.ts\`._`,
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

  const { text: indexText, tallies } = buildIndex(releases);
  writeFileSync(OUTPUT_INDEX, indexText, "utf8");
  console.log(
    `[compile-changelog-knowledge] wrote ${OUTPUT_INDEX.replace(ROOT + "\\", "")} (${Math.round(indexText.length / 1024)} KB: ${tallies.full} full, ${tallies.labels} titles-only, ${tallies.line} one-line)`,
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

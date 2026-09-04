#!/usr/bin/env node
// Build a section-level search index over every compiled AI knowledge file, so
// the assistant can pull the right few paragraphs on any message instead of
// waiting for the user to type the right slash command.
//
// Why: the knowledge was only ever reachable by command. Someone who asked
// "can we do GitHub repo scanning?" without typing /features got an answer
// built from no knowledge at all, and the model said no about a shipped
// feature. Loading everything instead is not an option either: these files
// total well over 1.5 MB, and lib/ai/checks-knowledge.md alone is ~1 MB.
//
// So: chunk each file at its markdown headings, record where each chunk lives
// in bytes, and index its terms. At runtime lib/ai/knowledge-retrieval.ts
// scores the user's message against this index and reads back only the winning
// chunks, by byte range, never the whole file.
//
// Output: lib/ai/knowledge-index.json
//   files     [{ file, cmd, label }]           the sources, in priority order
//   sections  [[fileIdx, byteOffset, byteLen, headingPath, termCount]]
//   postings  { term: [[sectionIdx, termFreq], ...] }
//
// Run: `node scripts/knowledge/compile-knowledge-index.mjs`
// Auto-run: hooked as prebuild + predev in package.json, and it must run LAST:
// it indexes what the other compilers write.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

import { termFrequencies, tokenize } from "../../lib/ai/knowledge-tokens.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = pathResolve(__dirname, "..", "..");
const AI_DIR = join(ROOT, "lib", "ai");
const OUTPUT = join(AI_DIR, "knowledge-index.json");

/**
 * The indexed corpus, and the slash command that loads each file whole.
 *
 * Order is the tie-break order at query time (see knowledge-retrieval.ts):
 * features first because "what can this product do" is the question that was
 * failing, then the docs, then the rest.
 *
 * checks-index.md is in and checks-knowledge.md is not. The index carries one
 * line per check (id, severity, title) for all ~750, which is what makes a
 * check findable; the full file is ~1 MB of remediation prose whose sections
 * are already reachable by exact id through /finding, and indexing it would
 * multiply the index size for chunks that only ever win when the user already
 * knew the id.
 */
const SOURCES = [
  {
    file: "features-knowledge.md",
    cmd: "features",
    label: "Product features",
  },
  { file: "docs-knowledge.md", cmd: "docs", label: "Documentation" },
  { file: "checks-index.md", cmd: "checks", label: "Scanner checks" },
  { file: "changelog-knowledge.md", cmd: "changelog", label: "Changelog" },
  { file: "legal-knowledge.md", cmd: "legal", label: "Legal pages" },
];

/**
 * Ceiling on one indexed chunk, in bytes.
 *
 * The retrieval budget drops whole sections and never cuts one in half, which
 * is only a safe rule if no single section can be larger than the budget. A
 * changelog release or a long docs section can be, so anything over this is
 * split at a paragraph boundary here, at build time, where the split is
 * visible and stable, rather than at request time under budget pressure.
 */
const MAX_SECTION_BYTES = 5000;

/** Terms kept per section. Enough to cover a section's real vocabulary,
 *  capped so the index stays a file the server parses once rather than a
 *  second megabyte of knowledge. */
const MAX_TERMS_PER_SECTION = 64;

/**
 * Split markdown into { path, start, end } chunks, one per heading.
 *
 * A section runs from its own heading to the next heading of any level, and
 * carries the full heading path above it ("Product features > Repos"), because
 * a chunk read in isolation has to say what it is about: "Repos" alone tells a
 * reader nothing about which product it belongs to.
 *
 * Fenced code blocks are skipped, and that is not a nicety. The docs and
 * changelog files are full of shell snippets, and a bash comment
 * ("# Generate a 32-byte API encryption key") is a level-1 markdown heading as
 * far as a regex is concerned. Reading those as headings cut sections in the
 * middle of a code block AND reset the heading stack, so the Self-Hosting
 * section's chunks came out labelled "Force a regenerate instead of the cached
 * summary > cli". Every path downstream of a snippet was wrong.
 *
 * The other correction is for a heading that outranks the file's own title.
 * compile-docs-knowledge.mjs emits "## Setup" for the page and then the page's
 * own hero "# VulnRadar documentation" underneath it, so a naive stack lets
 * the hero evict the page it belongs to and every following page inherits the
 * wrong ancestor ("Webhooks > cli > Sections" for a section under Setup).
 * Any heading at or above the first heading's level is treated as sitting one
 * level below it instead: these files have exactly one document title, and
 * anything later that claims the same rank is body content.
 */
function splitSections(content) {
  const lines = content.split("\n");
  const sections = [];
  const stack = [];
  let current = null;
  let offset = 0;
  let fence = null;
  let rootLevel = null;

  const close = (end) => {
    if (current && end > current.start) {
      current.end = end;
      sections.push(current);
    }
    current = null;
  };

  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, "utf8") + 1; // + "\n"
    const fenceMark = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMark) {
      // Only a fence of the same character closes one, so a ``` inside a ~~~
      // block stays content.
      if (fence === null) fence = fenceMark[1][0];
      else if (fenceMark[1][0] === fence) fence = null;
      offset += lineBytes;
      continue;
    }
    const heading = fence === null ? /^(#{1,6})\s+(.+?)\s*$/.exec(line) : null;
    if (heading) {
      close(offset);
      const declared = heading[1].length;
      if (rootLevel === null) rootLevel = declared;
      const level = declared <= rootLevel ? rootLevel + 1 : declared;
      stack.length = Math.min(stack.length, level - 1);
      stack[level - 1] = heading[2].replace(/[`_*]/g, "").trim();
      // The document title is dropped from the path: every section of a file
      // shares it, so it is pure noise in the path AND in the heading terms
      // that get a scoring boost. The file's own label already says which
      // corpus a section came from.
      const path = stack.slice(rootLevel).filter(Boolean).join(" > ");
      current = {
        path: path || stack.filter(Boolean).join(" > "),
        start: offset,
      };
    }
    offset += lineBytes;
  }
  close(offset);
  return sections;
}

/**
 * Break a section that exceeds MAX_SECTION_BYTES into parts.
 *
 * Blank lines first, then single lines. The second pass is not theoretical:
 * checks-index.md lists ~750 checks as one unbroken run of "- [severity] `id`
 * - title" lines, so the whole `headers` category is a single 13 KB
 * "paragraph". Left whole it is nearly three times the ceiling, which breaks
 * the promise the retriever's budget relies on (no section is larger than the
 * budget), and it spends a quarter of a message's context on 138 checks to
 * answer a question about one.
 *
 * Every part keeps the heading path, with a part number appended so a reader
 * (and a test) can tell it is one piece of a larger section.
 */
function enforceSizeLimit(section, buffer) {
  if (section.end - section.start <= MAX_SECTION_BYTES) return [section];

  const text = buffer.toString("utf8", section.start, section.end);
  const cut = (separatorRe, joinBytes) => {
    const bounds = [];
    let partStart = section.start;
    let cursor = section.start;
    for (const piece of text.split(separatorRe)) {
      const pieceBytes = Buffer.byteLength(piece, "utf8") + joinBytes;
      if (
        cursor > partStart &&
        cursor + pieceBytes - partStart > MAX_SECTION_BYTES
      ) {
        bounds.push({ path: section.path, start: partStart, end: cursor });
        partStart = cursor;
      }
      cursor += pieceBytes;
    }
    bounds.push({ path: section.path, start: partStart, end: section.end });
    // The running byte total can drift past the real end when a separator run
    // was longer than the bytes assumed for it (three newlines counted as
    // two). Clamping keeps every part inside the section it came from.
    bounds[bounds.length - 1].end = section.end;
    return bounds;
  };

  let parts = cut(/\n{2,}/, 2);
  if (parts.some((p) => p.end - p.start > MAX_SECTION_BYTES)) {
    parts = cut(/\n/, 1);
  }
  // If even a single line is over the ceiling there is no boundary left to cut
  // on, and splitting mid-sentence would produce exactly the truncated chunk
  // this whole design refuses to emit. Such a part stays whole and is simply
  // never selected when there is not room for it.
  return parts.length > 1
    ? parts.map((p, i) => ({
        ...p,
        path: `${p.path} (part ${i + 1} of ${parts.length})`,
      }))
    : parts;
}

function build() {
  const files = [];
  const sections = [];
  const postings = new Map();
  let totalTerms = 0;

  for (const source of SOURCES) {
    const path = join(AI_DIR, source.file);
    if (!existsSync(path)) {
      console.error(
        `[compile-knowledge-index] missing ${relative(ROOT, path)}. Every entry in SOURCES must exist; run the other knowledge compilers first.`,
      );
      process.exit(1);
    }
    const buffer = readFileSync(path);
    const content = buffer.toString("utf8");
    const raw = splitSections(content);
    if (raw.length === 0) {
      console.error(
        `[compile-knowledge-index] ${source.file} produced 0 sections. It has no markdown headings, which means the compiler that writes it changed shape.`,
      );
      process.exit(1);
    }

    const fileIdx = files.length;
    files.push({ file: source.file, cmd: source.cmd, label: source.label });

    for (const section of raw) {
      for (const part of enforceSizeLimit(section, buffer)) {
        const text = buffer.toString("utf8", part.start, part.end);
        const tf = termFrequencies(text);
        // The heading path counts a second time. It is the most compressed
        // statement of what the section is about, and without the boost a
        // section named "Repos" loses to one that merely mentions repos a
        // dozen times in passing.
        for (const term of tokenize(part.path))
          tf.set(term, (tf.get(term) ?? 0) + 3);
        if (tf.size === 0) continue;

        const kept = [...tf.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, MAX_TERMS_PER_SECTION);

        const sectionIdx = sections.length;
        const termCount = kept.reduce((sum, [, n]) => sum + n, 0);
        sections.push([
          fileIdx,
          part.start,
          part.end - part.start,
          part.path,
          termCount,
        ]);
        totalTerms += termCount;

        for (const [term, n] of kept) {
          let list = postings.get(term);
          if (!list) postings.set(term, (list = []));
          list.push([sectionIdx, n]);
        }
      }
    }
  }

  if (sections.length === 0) {
    console.error(
      "[compile-knowledge-index] indexed 0 sections across every source file.",
    );
    process.exit(1);
  }

  // No build date in here, unlike the .md files above it. This is one long
  // JSON line, so a date field could not be excluded by the CI drift gate's
  // --ignore-matching-lines the way "_Auto-compiled ... on <date>_" is, and
  // the gate would fail on every run made on a different day. Nothing needs
  // the date: the index is a pure function of the files it indexes.
  const index = {
    version: 1,
    // BM25's length normalisation needs the mean document length; storing it
    // here keeps the retriever from having to sum 1000+ sections on boot.
    avgTermCount: totalTerms / sections.length,
    files,
    sections,
    // Sorted so the file is diffable: an unchanged corpus produces a
    // byte-identical index, which is what makes the CI drift gate meaningful.
    postings: Object.fromEntries(
      [...postings.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    ),
  };

  writeFileSync(OUTPUT, JSON.stringify(index), "utf8");
  console.log(
    `[compile-knowledge-index] wrote ${relative(ROOT, OUTPUT)} (${files.length} files, ${sections.length} sections, ${postings.size} terms)`,
  );
}

build();

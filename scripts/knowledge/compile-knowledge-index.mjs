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
 */
function splitSections(content) {
  const lines = content.split("\n");
  const sections = [];
  const stack = [];
  let current = null;
  let offset = 0;

  const close = (end) => {
    if (current && end > current.start) {
      current.end = end;
      sections.push(current);
    }
    current = null;
  };

  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, "utf8") + 1; // + "\n"
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      close(offset);
      const level = heading[1].length;
      stack.length = Math.min(stack.length, level - 1);
      stack[level - 1] = heading[2].replace(/[`_*]/g, "").trim();
      current = {
        path: stack.filter(Boolean).join(" > "),
        start: offset,
      };
    }
    offset += lineBytes;
  }
  close(offset);
  return sections;
}

/**
 * Break a section that exceeds MAX_SECTION_BYTES into parts at blank lines.
 * Every part keeps the heading path, with a part number appended so a reader
 * (and a test) can tell it is one piece of a larger section.
 */
function enforceSizeLimit(section, buffer) {
  const length = section.end - section.start;
  if (length <= MAX_SECTION_BYTES) return [section];

  const text = buffer.toString("utf8", section.start, section.end);
  const parts = [];
  let partStart = section.start;
  let cursor = section.start;
  // Paragraph boundaries in byte terms: walk the text, tracking how many
  // bytes each paragraph occupies, and cut once adding the next one would
  // cross the ceiling.
  for (const para of text.split(/\n{2,}/)) {
    const paraBytes = Buffer.byteLength(para, "utf8") + 2;
    if (
      cursor > partStart &&
      cursor + paraBytes - partStart > MAX_SECTION_BYTES
    ) {
      parts.push({ path: section.path, start: partStart, end: cursor });
      partStart = cursor;
    }
    cursor += paraBytes;
  }
  parts.push({ path: section.path, start: partStart, end: section.end });

  // A single paragraph longer than the ceiling cannot be split at a boundary
  // that does not exist. Keeping it whole is the lesser evil: it stays
  // readable, and the retriever's budget check simply never selects it when
  // there is not room. Clamp the last part's end so no byte is lost either
  // way.
  parts[parts.length - 1].end = section.end;
  return parts.map((p, i) =>
    parts.length > 1
      ? { ...p, path: `${p.path} (part ${i + 1} of ${parts.length})` }
      : p,
  );
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

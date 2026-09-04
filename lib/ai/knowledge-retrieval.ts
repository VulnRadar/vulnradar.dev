import { closeSync, existsSync, openSync, readFileSync, readSync } from "fs";
import { join } from "path";

import { tokenize } from "@/lib/ai/knowledge-tokens.mjs";

/**
 * Server-side retrieval over the compiled AI knowledge files.
 *
 * The assistant used to know only what the user had loaded by slash command.
 * Someone who asked "can we do GitHub repo scanning?" without typing anything
 * else got an answer built from no product knowledge, and the model said no
 * about a feature that has shipped. The slash commands stay, as an explicit
 * "load all of X"; this is what runs on every message so a bare question works
 * on its own.
 *
 * Why keyword scoring and not embeddings: the chat is provider-agnostic on
 * purpose (lib/ai/provider.ts: Anthropic, any OpenAI-compatible endpoint,
 * Ollama on a self-hoster's own box). An embedding step would add a second
 * provider, a network call and a per-message cost to a path that is free and
 * unmetered, and it would fail closed for exactly the self-hosted deployments
 * that have no embedding endpoint. BM25 over a build-time index needs neither.
 *
 * The index is scripts/knowledge/compile-knowledge-index.mjs's output. Nothing
 * here loads a knowledge file whole: a section is read back by the byte range
 * the index recorded, which is what keeps the ~1 MB corpus off the heap.
 */

interface KnowledgeIndex {
  version: number;
  avgTermCount: number;
  files: { file: string; cmd: string; label: string }[];
  /** [fileIndex, byteOffset, byteLength, headingPath, termCount] */
  sections: [number, number, number, string, number][];
  postings: Record<string, [number, number][]>;
}

export interface RetrievedSection {
  /** The slash command that loads this section's whole file, for the model to
   *  suggest when the user wants everything rather than the excerpt. */
  cmd: string;
  label: string;
  heading: string;
  text: string;
  score: number;
}

/** Standard BM25 constants. k1 controls term-frequency saturation, b how
 *  strongly a long section is penalised for its length. */
const K1 = 1.2;
const B = 0.75;

/**
 * A section has to clear this to be injected at all.
 *
 * Without a floor, "hi" retrieves whichever three sections happen to contain
 * the most obscure word in it, and every message pays for context that answers
 * nothing. Tuned against tests/lib/ai/knowledge-retrieval.test.ts: real
 * product questions score well above it, greetings and off-topic messages
 * score nothing.
 */
const MIN_SCORE = 1.5;

/** Defaults for one message's retrieval. ~24k characters is roughly 6k tokens:
 *  large enough for several full sections, small enough to sit alongside the
 *  system prompt and a conversation on every single request. */
export const DEFAULT_MAX_CHARS = 24_000;
export const DEFAULT_MAX_SECTIONS = 8;

let cached: KnowledgeIndex | null | undefined;

function loadIndex(): KnowledgeIndex | null {
  if (cached !== undefined) return cached;
  const path = join(process.cwd(), "lib", "ai", "knowledge-index.json");
  if (!existsSync(path)) {
    cached = null;
    return cached;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as KnowledgeIndex;
    cached = parsed.version === 1 ? parsed : null;
  } catch {
    // A corrupt index must degrade to "no retrieval", never to a 500 on the
    // chat route. The slash commands still work.
    cached = null;
  }
  return cached;
}

/** Test-only: clears the parsed index between cases. */
export function __resetKnowledgeIndexForTests(): void {
  cached = undefined;
}

/**
 * Read one section back out of its source file, by byte range.
 *
 * Opening and closing per section rather than holding descriptors: a request
 * reads a handful of sections, and a long-lived fd cache in a serverless
 * runtime is a leak waiting to happen for no measurable gain.
 */
function readSection(file: string, offset: number, length: number): string {
  const path = join(process.cwd(), "lib", "ai", file);
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const buffer = Buffer.allocUnsafe(length);
    const read = readSync(fd, buffer, 0, length, offset);
    return buffer.toString("utf8", 0, read);
  } catch {
    return "";
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * Score the query against every indexed section and return the best ones that
 * fit the budget.
 *
 * Budget behaviour is the part worth being careful about. A section is
 * atomic: it is either injected whole or not at all. Over budget, the
 * lowest-scoring sections are the ones that go, and a section too large for
 * the room that is left is skipped so a smaller one behind it can still be
 * used. Nothing is ever cut in half, and no source file is ever dropped
 * wholesale for being large: this file exists because a character-budget trim
 * once discarded an entire loaded context block and the assistant "forgot" a
 * page it had just been handed.
 */
export function retrieveKnowledge(
  query: string,
  options: { maxChars?: number; maxSections?: number } = {},
): RetrievedSection[] {
  const index = loadIndex();
  if (!index) return [];

  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxSections = options.maxSections ?? DEFAULT_MAX_SECTIONS;
  if (maxChars <= 0 || maxSections <= 0) return [];

  const queryTerms = new Map<string, number>();
  for (const term of tokenize(query))
    queryTerms.set(term, (queryTerms.get(term) ?? 0) + 1);
  if (queryTerms.size === 0) return [];

  const total = index.sections.length;
  const scores = new Map<number, number>();

  for (const term of queryTerms.keys()) {
    const postings = index.postings[term];
    if (!postings) continue;
    const df = postings.length;
    // A term in nearly every section says nothing about which one to pick.
    // Standard BM25 idf goes negative there; clamping at zero drops it
    // instead of letting it subtract from otherwise good matches.
    const idf = Math.max(0, Math.log(1 + (total - df + 0.5) / (df + 0.5)));
    if (idf === 0) continue;
    for (const [sectionIdx, tf] of postings) {
      const length = index.sections[sectionIdx][4] || 1;
      const norm = tf + K1 * (1 - B + (B * length) / index.avgTermCount);
      scores.set(
        sectionIdx,
        (scores.get(sectionIdx) ?? 0) + (idf * (tf * (K1 + 1))) / norm,
      );
    }
  }

  const ranked = [...scores.entries()]
    .filter(([, score]) => score >= MIN_SCORE)
    // Tie-break on the section's own order, which is SOURCES order in the
    // index builder: features before docs before checks before changelog
    // before legal. Two equally-scoring sections then resolve the same way on
    // every request rather than by Map iteration accident.
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]);

  const out: RetrievedSection[] = [];
  let used = 0;
  for (const [sectionIdx, score] of ranked) {
    if (out.length >= maxSections) break;
    const [fileIdx, offset, length, heading] = index.sections[sectionIdx];
    // Byte length is an upper bound on character length, so this can only ever
    // be conservative, never let the budget be exceeded.
    if (used + length > maxChars) continue;
    const source = index.files[fileIdx];
    const text = readSection(source.file, offset, length).trim();
    if (!text) continue;
    used += text.length;
    out.push({
      cmd: source.cmd,
      label: source.label,
      heading,
      text,
      score,
    });
  }
  return out;
}

/**
 * The retrieved sections as one message the model can read, or null when
 * nothing scored well enough to be worth the tokens.
 *
 * Shaped like the `<context cmd="...">` blocks the widget's slash commands
 * already produce, because the system prompt teaches the model to use those.
 * The `auto` name is deliberately not a real slash command: the chat route's
 * per-message budget only widens for a block naming one of those, and a name
 * only the server can emit must not open that door.
 */
export function buildRetrievedContextBlock(
  query: string,
  options: { maxChars?: number; maxSections?: number } = {},
): string | null {
  const sections = retrieveKnowledge(query, options);
  if (sections.length === 0) return null;

  const commands = [...new Set(sections.map((s) => s.cmd))];
  const body = sections
    .map((s) => `--- ${s.label} :: ${s.heading} ---\n${s.text}`)
    .join("\n\n");

  return `<context cmd="auto">
These excerpts were selected automatically from VulnRadar's own compiled
knowledge files because they look relevant to the message below. They are
current product facts, not a guess. Use them to answer.

If they do not cover the question, say so and suggest the command that loads
the whole file (${commands.map((c) => `/${c}`).join(", ")}) rather than
inventing an answer.

${body}
</context>`;
}

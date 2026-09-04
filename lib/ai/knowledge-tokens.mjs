// The tokenizer shared by the knowledge index builder
// (scripts/knowledge/compile-knowledge-index.mjs) and the runtime retriever
// (lib/ai/knowledge-retrieval.ts).
//
// It is one file, in .mjs, precisely so there is only one of it. The build
// script runs under bare `node` and cannot import TypeScript; the retriever is
// a TypeScript module in the Next app. A second copy would be free to drift,
// and the failure mode of a drifted tokenizer is silent: query terms stop
// matching the postings that were built from the same words, retrieval quietly
// returns less, and nothing errors.

/**
 * Words carrying no retrieval signal. Deliberately short: an aggressive stop
 * list would strip terms that are load-bearing in this corpus ("no" in "no
 * agent to install", "not" in "not a URL problem"). These are the words that
 * appear in nearly every section of every file, so their IDF would be ~0
 * anyway; dropping them at build time is a size win, not a scoring change.
 */
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "so",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "they",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "which",
  "who",
  "will",
  "with",
  "you",
  "your",
]);

/**
 * Split text into retrieval terms.
 *
 * Hyphenated identifiers are kept whole AND split, so `csp-missing` is findable
 * both by someone who typed the finding ID exactly and by someone who typed
 * "csp missing". That matters here more than in a general corpus: roughly 750
 * of the indexed sections are named by a hyphenated check ID.
 *
 * @param {string} text
 * @returns {string[]} terms, in order, with duplicates kept (callers count them)
 */
export function tokenize(text) {
  const terms = [];
  const matches = String(text)
    .toLowerCase()
    .match(/[a-z0-9]+(?:[-_/.][a-z0-9]+)*/g);
  if (!matches) return terms;
  for (const raw of matches) {
    if (raw.length > 40) continue;
    if (!STOPWORDS.has(raw)) terms.push(raw);
    if (!/[-_/.]/.test(raw)) continue;
    for (const part of raw.split(/[-_/.]/)) {
      // Single characters are noise once an identifier is split apart
      // ("v3.8.0" would otherwise contribute "v"), and a stopword is a
      // stopword whichever side of a hyphen it arrived on.
      if (part.length < 2 || STOPWORDS.has(part)) continue;
      terms.push(part);
    }
  }
  return terms;
}

/** Term -> occurrence count, for one document. */
export function termFrequencies(text) {
  const tf = new Map();
  for (const term of tokenize(text)) tf.set(term, (tf.get(term) ?? 0) + 1);
  return tf;
}

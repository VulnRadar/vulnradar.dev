import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Cached reader for the compiled AI knowledge files (lib/ai/*-knowledge.md,
 * lib/ai/checks-index.md).
 *
 * These are BUILD ARTIFACTS produced by scripts/knowledge/compile-*-knowledge.mjs and
 * they never change while the process is running, but GET /api/v3/ai/context
 * used to readFileSync them on every request. checks-knowledge.md alone is
 * close to 1 MB, and a synchronous read of that size blocks the event loop for
 * the whole process, not just the request that asked for it, on a route any
 * signed-in user can hit in a loop.
 *
 * Reading once into module scope is safe here precisely because the files are
 * build output: a new build means a new process, so the cache can never be
 * stale. A miss (file absent, e.g. a deployment that never ran
 * `npm run build:knowledge`) is cached as "" too, so the same missing path is
 * not re-stat'd on every request either.
 *
 * Lives here rather than inline in the route because a Next.js route module may
 * only export its handlers, and the cache needs a reset hook for tests.
 */
const cache = new Map<string, string>();

export function readKnowledgeFile(...segments: string[]): string {
  const p = join(process.cwd(), ...segments);
  const cached = cache.get(p);
  if (cached !== undefined) return cached;
  let content = "";
  if (existsSync(p)) {
    try {
      content = readFileSync(p, "utf8");
    } catch {
      content = "";
    }
  }
  cache.set(p, content);
  return content;
}

/** Test-only: clears the in-memory cache between cases. */
export function __resetKnowledgeCacheForTests(): void {
  cache.clear();
}

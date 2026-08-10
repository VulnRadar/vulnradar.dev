/**
 * Pattern-based secret/credential scanning for GitHub repo source files.
 *
 * Reuses the existing secrets-extended detectors and metadata verbatim —
 * lib/scanner/checks/secrets-extended.ts's detectors already operate on
 * nothing but the raw body text (every one of them ignores the `url` and
 * `headers` parameters), so they run unmodified against a file's content
 * the same way they run against an HTTP response body. Nothing in this
 * file changes secrets-extended.ts's behavior for the live-URL scan path.
 */

import secretsExtendedDefs from "./checks-data/secrets-extended.json";
import { detectors as secretsExtendedDetectors } from "./checks/secrets-extended";
import { generateId } from "./_helpers";
import type { CheckDef } from "./registry";
import type { Severity, Vulnerability } from "./types";
import { getBlobContent, type GithubTreeEntry } from "@/lib/github/github-api";

export interface RepoFile {
  path: string;
  content: string;
}

/**
 * Rough chars-per-token estimate for AI budgeting (lib/ai/review-source.ts,
 * the per-run token ceiling). English prose and most source code average
 * roughly 4 characters per token for the model families this app talks
 * to; this doesn't need to be exact, only good enough to reject a
 * genuinely oversized request before spending an API call finding out.
 */
const CHARS_PER_TOKEN_ESTIMATE = 4;

export function estimateTokens(totalChars: number): number {
  return Math.ceil(totalChars / CHARS_PER_TOKEN_ESTIMATE);
}

/**
 * Fetches blob content for every selected tree entry. A single file
 * failing to fetch or decode does not fail the whole scan — it is
 * skipped and logged, the same tolerance the rest of the scanner gives
 * individual check failures.
 */
export async function fetchSelectedFiles(
  token: string,
  owner: string,
  repo: string,
  entries: GithubTreeEntry[],
): Promise<RepoFile[]> {
  const files: RepoFile[] = [];
  for (const entry of entries) {
    try {
      const content = await getBlobContent(token, owner, repo, entry.sha);
      if (content === null) continue; // undecodable (e.g. still binary despite passing the extension filter)
      files.push({ path: entry.path, content });
    } catch (err) {
      console.error(
        `[github-repo-scan] Failed to fetch ${owner}/${repo}:${entry.path}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return files;
}

const secretsDefs = secretsExtendedDefs as CheckDef[];
const defById = new Map(secretsDefs.map((d) => [d.id, d]));

/** Matches .env, .env.local, .env.production, .env.example, etc. -- any
 *  file in the well-known dotenv naming family, regardless of directory. */
const ENV_FILE_RE = /(^|\/)\.env(\.[\w.-]+)?$/i;

/** Substrings that only ever show up in placeholder filler, never in a
 *  real high-entropy credential -- safe to match anywhere in the value. */
const PLACEHOLDER_MARKERS = [
  "changeme",
  "change_me",
  "change-me",
  "your_",
  "your-",
  "<",
  "[",
  "example",
  "placeholder",
  "replaceme",
  "replace_me",
  "replace-me",
  "insert_",
  "insert-",
  "xxxx",
  "dummy",
  "todo",
  "fake",
];

/** Whole-value-only tokens: common enough as substrings of real secrets
 *  (e.g. a real key containing "test") that they're only safe to treat
 *  as placeholders on an exact match, not a substring match. */
const PLACEHOLDER_EXACT = new Set([
  "secret",
  "password",
  "123456",
  "foo",
  "bar",
  "baz",
  "test",
  "n/a",
]);

/** A connection string using textbook-generic credentials against a
 *  local/example host -- the shape every ORM's docs use for `DATABASE_URL`
 *  in a template, not a real deployment's connection string. */
const PLACEHOLDER_CONNECTION_STRING_RE =
  /^[a-z][a-z0-9+.-]*:\/\/(user|username|admin|root|dbuser):(pass|password|changeme|secret)@(localhost|127\.0\.0\.1|example\.com|db|host)/i;

function looksLikePlaceholderValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === "") return true;
  if (PLACEHOLDER_EXACT.has(v)) return true;
  if (PLACEHOLDER_MARKERS.some((marker) => v.includes(marker))) return true;
  if (PLACEHOLDER_CONNECTION_STRING_RE.test(v)) return true;
  return false;
}

/**
 * Redacts obviously-placeholder values on KEY=VALUE lines in a .env-family
 * file before it reaches the secret detectors. This is what lets a
 * committed .env.example with `AWS_SECRET_ACCESS_KEY=your_key_here` or
 * `DATABASE_URL=postgres://user:password@localhost/db` scan clean while a
 * real-looking value on the same line still fires -- detection follows the
 * shape of the value, not the filename alone (a bare .env with only
 * placeholder values is just as safe to skip as an .env.example, and
 * either file could genuinely contain a real leaked credential).
 */
function redactEnvPlaceholders(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      const m = line.match(
        /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*)(.*)$/,
      );
      if (!m) return line;
      const [, prefix, rawValue] = m;
      const value = rawValue.trim().replace(/^["']|["']$/g, "");
      if (looksLikePlaceholderValue(value)) {
        return `${prefix}REDACTED_PLACEHOLDER_VALUE`;
      }
      return line;
    })
    .join("\n");
}

/**
 * Runs every secrets-extended detector against every file's content.
 * Produces Vulnerability objects shaped exactly like the live-scan
 * engine's (lib/scanner/registry.ts's buildCheck), with an added
 * `location.file` instead of a URL-based id/evidence context. `line` is
 * not populated: the detectors return only an evidence string, not a
 * match position, so adding accurate line numbers would require changing
 * every detector's return type — out of scope for reusing them as-is.
 */
export function runPatternSecretsScan(files: RepoFile[]): Vulnerability[] {
  const findings: Vulnerability[] = [];
  const emptyHeaders = new Headers();

  for (const file of files) {
    const content = ENV_FILE_RE.test(file.path)
      ? redactEnvPlaceholders(file.content)
      : file.content;

    for (const def of secretsDefs) {
      const detect = secretsExtendedDetectors[def.id];
      if (!detect) continue;
      const pseudoUrl = `${file.path}`;
      let evidence: string | null;
      try {
        evidence = detect(pseudoUrl, emptyHeaders, content);
      } catch (err) {
        console.error(
          `[github-repo-scan] Detector "${def.id}" threw on ${file.path}:`,
          err instanceof Error ? err.message : err,
        );
        continue;
      }
      if (!evidence) continue;

      findings.push({
        id: generateId(def.id, `${file.path}`),
        title: def.title,
        severity: (def.severity as string).toLowerCase() as Severity,
        category: def.category,
        description: def.description,
        evidence,
        riskImpact: def.riskImpact,
        explanation: def.explanation,
        fixSteps: def.fixSteps,
        codeExamples: def.codeExamples,
        references: def.references ?? [],
        confidence: 70,
        detectionMethod: "Source file pattern matching",
        location: { file: file.path },
      });
    }
  }

  return findings;
}

export function getSecretsCheckDef(id: string): CheckDef | undefined {
  return defById.get(id);
}

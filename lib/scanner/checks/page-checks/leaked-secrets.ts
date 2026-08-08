/**
 * Entropy-scored secret detection in inline JavaScript.
 *
 * `checks/secrets-extended.ts` already carries roughly 50 fixed patterns
 * (one per vendor token format: AWS, Stripe, GitHub, and so on). Those stay
 * useful for the formats they know. This check instead looks at the
 * *shape* of an assignment: an identifier that reads like a secret, assigned
 * a string literal that is long and high-entropy. It catches vendor formats
 * nobody has written a pattern for yet, at the cost of being a heuristic, so
 * its confidence is deliberately capped well below a fixed-format match.
 *
 * Scope: inline <script> content only (`ctx.inlineScript`). Linked scripts
 * are not fetched here; that would require the network layer this module
 * does not own. This is a passive check: it reads text already present in
 * the response, nothing is executed or requested.
 */

import type { PageCheck } from "../../check-types";
import { excerpt, lineAt } from "../../check-types";
import { redactSecret } from "../../_helpers";

const ASSIGNMENT =
  /\b([a-zA-Z_$][a-zA-Z0-9_$]{0,40})\s*[:=]\s*["']([A-Za-z0-9_\-+/=]{20,120})["']/g;

const SECRET_NAME =
  /(?:api|secret|private|access|auth|client)[_-]?(?:key|token|secret)|password|passwd|token$/i;

// Real placeholders are usually phrases ("your_api_key_goes_here",
// "REPLACE_WITH_YOUR_KEY"), not single words, so this matches on the
// telltale substring rather than requiring the whole value to be one.
const PLACEHOLDER =
  /your[_-]?(?:api[_-]?)?key|insert[_-]?(?:your[_-]?)?key|key[_-]?(?:goes[_-]?)?here|replace[_-]?(?:with|me)\b|change[_-]?me|^(?:x+|0+|1+)$|^(?:test|demo|sample|example|placeholder|dummy|fake|mock)(?:[_-][a-z]+)?$/i;

function shannonEntropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** True when the string is mostly one repeated character or a short cycle. */
function looksLikePlaceholder(value: string): boolean {
  if (PLACEHOLDER.test(value)) return true;
  const unique = new Set(value.toLowerCase()).size;
  return unique <= 3;
}

export const leakedSecretChecks: PageCheck[] = [
  {
    id: "page-inline-script-high-entropy-secret",
    title:
      "High-entropy value assigned to a secret-shaped variable in inline script",
    category: "secrets-extended",
    severity: "high",
    method: "script-analysis",
    confidence: 55,
    description:
      "An inline script assigns a long, high-entropy string literal to a variable whose name looks like it holds an API key, token, or password.",
    riskImpact:
      "If this value is a real credential, anyone who views the page source has it. Client-side JavaScript cannot keep a secret: it is delivered in full to every visitor's browser.",
    explanation:
      "This is a shape-and-entropy heuristic, not a match against a known vendor token format: it flags identifiers matching /key|secret|token|password/ assigned a 20+ character value with high character diversity. It will miss low-entropy secrets and can flag high-entropy non-secrets (hashes, generated IDs). Verify the actual value before treating this as confirmed.",
    fixSteps: [
      "Move the credential to a server-side environment variable and proxy the API call through your own backend.",
      "If the value is meant to be public (a publishable key, a public client ID), rename the variable so it does not read as a secret, or add it to an allowlist.",
      "Rotate the credential if it is real and was actually exposed.",
    ],
    codeExamples: [],
    needs: ["scripts"],
    run(ctx) {
      if (!ctx.inlineScript) return null;
      const seen = new Set<string>();
      const excerpts: ReturnType<typeof excerpt>[] = [];
      const names: string[] = [];
      let m: RegExpExecArray | null;
      ASSIGNMENT.lastIndex = 0;
      while ((m = ASSIGNMENT.exec(ctx.inlineScript))) {
        const [full, name, value] = m;
        if (!SECRET_NAME.test(name)) continue;
        if (looksLikePlaceholder(value)) continue;
        if (shannonEntropy(value) < 3.5) continue;
        const key = `${name}:${value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        names.push(name);
        excerpts.push(
          excerpt(
            name,
            `${name} = "${redactSecret(value)}"`,
            lineAt(ctx.body, ctx.body.indexOf(full)),
          ),
        );
        if (excerpts.length >= 10) break;
      }
      if (excerpts.length === 0) return null;
      return {
        evidence: `${excerpts.length} secret-shaped, high-entropy value(s) assigned in inline script: ${names.join(", ")}.`,
        excerpts,
      };
    },
  },
];

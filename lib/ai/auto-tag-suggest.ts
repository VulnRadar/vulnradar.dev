/**
 * AI-generated auto-tag suggestions: the "AI generates a tag immediately
 * per-scan for cases the static rules miss" half of the layered auto-tag
 * design (the other half -- promoting a recurring AI tag into a permanent,
 * free, deterministic rule -- lives in the `promoted_auto_tag_rules` table
 * and Admin > Engine Feedback's "AI Tag Candidates" panel).
 *
 * Triggered from exactly one place: lib/tags/auto-tags.ts's
 * maybeSuggestAiTag, which only calls generateAutoTagSuggestions when
 * computeAutoTags' result for a scan was EXACTLY ["Needs Hardening"] -- a
 * scan with real findings that matched none of the ~50 hardcoded rules
 * (see that file's own header comment for why "Needs Hardening" exists at
 * all). Every caller of that trigger is fire-and-forget, kicked off only
 * after the scan's own completion has already committed and is visible to
 * a polling client -- this module's own call is never on any critical
 * path, so it can be as slow or as unavailable as the configured AI
 * provider happens to be without affecting scan completion at all.
 *
 * Provider resolution is identical to lib/ai/scan-summary.ts and
 * lib/ai/verify-findings.ts on purpose (same resolveUserEndpoint/
 * resolveServerEndpoint precedence: a user's own AI key first, VulnRadar's
 * server default otherwise), reused directly rather than reimplemented.
 * Degrades to a silent no-op (empty array, never a thrown error) at every
 * failure point: no AI endpoint configured anywhere (common on a
 * self-hosted instance with no AI_BASE_URL/AI_API_KEY set), the user has
 * disabled AI in their own settings, the provider call errors or times
 * out, or the response doesn't parse into anything usable. The caller
 * already has "Needs Hardening" saved as a real tag by the time this runs,
 * so there is nothing for a user to lose if this never produces anything.
 *
 * Token/cost accounting: FREE, same bucket as AI chat (app/api/v3/ai/chat)
 * and AI scan summaries (lib/ai/scan-summary.ts) -- NOT metered against
 * checkAiUsageQuota's aiTokensPerWindow cap, unlike AI finding verification
 * (lib/ai/verify-findings.ts) or GitHub repo AI code review, which stay
 * metered because their input is a whole finding's evidence or a whole
 * repository and their per-call cost varies widely. This call's prompt is
 * fixed-shape and small by construction (a capped list of finding
 * titles/categories/severities, never full evidence -- see buildPrompt
 * below) and its output is capped to two short tag names, putting its real
 * cost well below a single AI chat turn, the precedent scan-summary.ts's
 * own "free" classification already set for a call this cheap. Usage is
 * still recorded via recordAiTokens (skipped for a bring-your-own-key user,
 * same as every other AI feature) purely for admin cost visibility -- it
 * never gates or blocks this call.
 */

import pool from "@/lib/database/db";
import type { Vulnerability, Severity } from "@/lib/scanner/types";
import {
  resolveServerEndpoint,
  resolveUserEndpoint,
  type AiEndpoint,
} from "./verify-findings";
import { isAnthropicProvider } from "@/lib/ai/provider";
import { callAnthropicMessages } from "@/lib/ai/anthropic";
import { resolveAnthropicThinkingBudget } from "@/lib/ai/reasoning";
import { APP_NAME, APP_URL } from "@/lib/config/constants";
import { getSettings } from "@/lib/config/runtime-config";
import { checkAiUsageQuota, recordAiTokens } from "@/lib/billing/ai-usage";

const MIN_TAG_LENGTH = 3;
const MAX_TAG_LENGTH = 40;
const MAX_TAG_WORDS = 6;

/** Letters, digits, spaces, and a narrow set of punctuation a real tag name might legitimately contain (e.g. "DNS/Email Hygiene Gaps"). Nothing else survives into a scan_tags row. */
const VALID_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 /&-]*$/;

/**
 * Auxiliary/copula verbs. A real short tag name ("Weak TLS Cipher Suite",
 * "Sensitive Data in URL") is a noun phrase and essentially never contains a
 * finite verb; a model that ignores the "no explanation" instruction and
 * writes a genuine sentence fragment instead ("One is about weak TLS", "The
 * security posture is fine", "Two are about modern CSP/COEP directives")
 * almost always uses one. Checked ANYWHERE in the line (not just word 1),
 * since the fragment's subject varies ("One is", "Overall this has weak
 * headers"). Every other check in sanitizeAiTagSuggestions (length,
 * character set, word count) still passes a fragment like that, since none
 * of these words are banned punctuation -- this is the check that actually
 * catches "is this a tag or a sentence". Deliberately excludes plain
 * articles/pronouns/number-words: those alone are common in legitimate noun
 * phrases too ("A Reasonable Tag Name"), so banning them anywhere would
 * reject far more real tags than fragments.
 */
const AUXILIARY_VERBS = new Set([
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "has",
  "have",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "can",
  "could",
  "should",
  "must",
  "may",
  "might",
]);

/**
 * Articles/pronouns/number-words that are fine inside a multi-word tag
 * ("A Reasonable Tag Name") but are themselves a whole sentence fragment's
 * subject when they're the ENTIRE tag on their own (a bare "The" reaching
 * scan_tags, the other real production example alongside "One is").
 */
const BARE_FRAGMENT_WORDS = new Set([
  "the",
  "a",
  "an",
  "it",
  "this",
  "that",
  "these",
  "those",
  "they",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
]);

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const SYSTEM_PROMPT = `You are ${APP_NAME}'s auto-tag suggester. You are given one completed vulnerability scan's findings that did NOT match any of the product's ~50 built-in tagging rules -- only each finding's title, category, and severity, never full evidence.

Produce 1 to 2 short tag names that name the SPECIFIC security concept these findings share, in the same style as tags this product already uses: "Weak TLS Cipher Suite", "Cookie Missing SameSite", "Missing Rate Limiting", "Sensitive Data in URL". Rules for each tag name:
- 2 to 4 words, Title Case.
- Name the concept, not the fix and not the severity ("DNS Email Hygiene Gaps" is good; "Fix Your DNS" and "Medium Risk Issue" are not).
- No generic filler word alone as the whole tag ("Security Issue", "Risk Found").
- Only letters, digits, spaces, hyphens, ampersands, and slashes -- no quotes, no punctuation like periods or colons, no markdown.
- Do not repeat a tag this product already has reserved -- avoid these exact phrases: "Clean", "Critical Exposure", "Needs Hardening".

If the findings given to you don't share any coherent, nameable concept, return fewer tags (even zero) rather than inventing a weak one.

Return ONLY the tag names, one per line, nothing else -- no numbering, no bullets, no preamble, no explanation.`;

function severityRank(s: Severity): number {
  return SEVERITY_RANK[s] ?? 5;
}

function buildPrompt(
  findings: Vulnerability[],
  topFindingsLimit: number,
): string {
  const lines = [...findings]
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .slice(0, topFindingsLimit)
    .map((f) => `- [${f.severity}] ${f.category}: ${f.title}`)
    .join("\n");

  const omitted = findings.length - Math.min(findings.length, topFindingsLimit);

  return `findings${omitted > 0 ? ` (top ${topFindingsLimit} of ${findings.length} total, ${omitted} more not shown)` : ""}:
${lines || "(none)"}`;
}

/** Strips a leading list marker ("- ", "1. ", "* ") a model sometimes adds despite being told not to number its output. */
function stripListMarker(line: string): string {
  return line.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "");
}

const RESERVED_TAGS = new Set([
  "clean",
  "critical exposure",
  "needs hardening",
]);

/**
 * Turns raw model output into a validated, deduplicated list of at most
 * `maxSuggestions` tag strings. This is the one place untrusted model text
 * becomes a value that renders as a UI chip, so every line is checked for
 * length, character set, and word count before it survives -- a line that
 * fails any check is dropped, never truncated-and-kept (a truncated tag
 * reads as a bug, not a feature).
 */
export function sanitizeAiTagSuggestions(
  text: string,
  maxSuggestions: number = 2,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    if (out.length >= maxSuggestions) break;

    const clean = stripListMarker(rawLine).replace(/["'`]/g, "").trim();
    if (clean.length < MIN_TAG_LENGTH || clean.length > MAX_TAG_LENGTH)
      continue;
    if (!VALID_TAG_PATTERN.test(clean)) continue;
    const words = clean.split(/\s+/);
    if (words.length > MAX_TAG_WORDS) continue;
    if (words.some((w) => AUXILIARY_VERBS.has(w.toLowerCase()))) continue;
    if (words.length === 1 && BARE_FRAGMENT_WORDS.has(words[0].toLowerCase()))
      continue;

    const key = clean.toLowerCase();
    if (RESERVED_TAGS.has(key) || seen.has(key)) continue;

    seen.add(key);
    out.push(clean);
  }

  return out;
}

async function isAiDisabledForUser(userId: number): Promise<boolean> {
  try {
    const result = await pool.query<{ ai_disabled: boolean }>(
      `SELECT ai_disabled FROM user_ai_configs WHERE user_id = $1`,
      [userId],
    );
    return result.rows[0]?.ai_disabled ?? false;
  } catch {
    return false; // no row = AI enabled by default, matching every other AI route's own catch branch
  }
}

interface CallResult {
  suggestions: string[];
  tokensUsed: number;
}

async function callSuggestionModel(
  endpoint: AiEndpoint,
  prompt: string,
  maxOutputTokens: number,
  maxSuggestions: number,
  signal: AbortSignal,
): Promise<CallResult> {
  if (isAnthropicProvider(endpoint.baseUrl)) {
    const { text, usage } = await callAnthropicMessages(
      {
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        model: endpoint.model,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
        maxTokens: maxOutputTokens,
        thinkingBudgetTokens: resolveAnthropicThinkingBudget(maxOutputTokens),
      },
      signal,
    );
    return {
      suggestions: sanitizeAiTagSuggestions(text, maxSuggestions),
      tokensUsed: usage.inputTokens + usage.outputTokens,
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (endpoint.apiKey) headers["Authorization"] = `Bearer ${endpoint.apiKey}`;
  try {
    const host = new URL(endpoint.baseUrl).hostname.toLowerCase();
    if (host === "openrouter.ai") {
      // Identify THIS deployment to OpenRouter, not the SaaS: APP_URL already
      // resolves NEXT_PUBLIC_APP_URL first, so a self-hoster's AI spend is no
      // longer attributed to vulnradar.dev by a hardcoded fallback.
      headers["HTTP-Referer"] = APP_URL;
      headers["X-Title"] = APP_NAME;
    }
  } catch {
    /* ignore */
  }

  const res = await fetch(`${endpoint.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: endpoint.model,
      max_tokens: maxOutputTokens,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    }),
    signal,
  });

  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      /* ignore */
    }
    console.error(
      `[AI-AUTO-TAG-SUGGEST] HTTP ${res.status} from ${endpoint.baseUrl}: ${body.slice(0, 300)}`,
    );
    return { suggestions: [], tokensUsed: 0 };
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  const text = data?.choices?.[0]?.message?.content;
  const usage = data?.usage;
  const tokensUsed =
    typeof usage?.total_tokens === "number"
      ? usage.total_tokens
      : (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0);
  if (typeof text !== "string") return { suggestions: [], tokensUsed };

  return {
    suggestions: sanitizeAiTagSuggestions(text, maxSuggestions),
    tokensUsed,
  };
}

/**
 * Generates 0-2 specific tag names for a scan whose findings matched none
 * of lib/tags/auto-tags.ts's hardcoded rules. Never throws: every failure
 * path (AI disabled for this user, no endpoint configured, provider error,
 * timeout, unparseable response) resolves to an empty array instead.
 */
export async function generateAutoTagSuggestions(
  findings: Vulnerability[],
  userId: number,
): Promise<string[]> {
  if (findings.length === 0) return [];

  try {
    if (await isAiDisabledForUser(userId)) return [];

    const endpoint =
      (await resolveUserEndpoint(userId)) ?? resolveServerEndpoint();
    if (!endpoint) return [];

    // Reused only for its usingOwnAi resolution (same account-level "does
    // this user have their own AI key" fact every AI feature in this app
    // resolves through) -- .allowed is never checked, matching
    // generateScanSummary's own "free" call: this never blocks on quota.
    const { usingOwnAi } = await checkAiUsageQuota(userId);
    const {
      AI_AUTOTAG_CALL_TIMEOUT_MS: callTimeoutMs,
      AI_AUTOTAG_MAX_TOKENS: maxOutputTokens,
      AI_AUTOTAG_TOP_FINDINGS_LIMIT: topFindingsLimit,
      AI_AUTOTAG_MAX_SUGGESTIONS: maxSuggestions,
    } = await getSettings([
      "AI_AUTOTAG_CALL_TIMEOUT_MS",
      "AI_AUTOTAG_MAX_TOKENS",
      "AI_AUTOTAG_TOP_FINDINGS_LIMIT",
      "AI_AUTOTAG_MAX_SUGGESTIONS",
    ] as const);
    const prompt = buildPrompt(findings, topFindingsLimit);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), callTimeoutMs);

    try {
      const { suggestions, tokensUsed } = await callSuggestionModel(
        endpoint,
        prompt,
        maxOutputTokens,
        maxSuggestions,
        controller.signal,
      );
      if (tokensUsed > 0 && !usingOwnAi) {
        try {
          await recordAiTokens(userId, tokensUsed);
        } catch (err) {
          console.error(
            "[AI-AUTO-TAG-SUGGEST] Failed to record token usage (non-fatal):",
            err instanceof Error ? err.message : err,
          );
        }
      }
      return suggestions;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error(
      "[AI-AUTO-TAG-SUGGEST] generateAutoTagSuggestions failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

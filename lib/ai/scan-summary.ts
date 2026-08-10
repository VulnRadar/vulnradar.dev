/**
 * Scan-level AI executive summary.
 *
 * Every existing AI feature in this codebase judges one finding at a time
 * (lib/ai/verify-findings.ts: confirmed/possible_fp/uncertain per finding;
 * lib/ai/review-source.ts: new findings per source file). Neither produces
 * a short, plain-English readout of a *scan* as a whole -- the kind of
 * paragraph you'd paste into a report for a non-technical stakeholder. This
 * module is that: one short call that turns a scan's severity counts, danger
 * score, and highest-severity finding titles into 3-5 sentences of prose.
 *
 * Provider resolution is identical to verify-findings.ts on purpose (same
 * resolveUserEndpoint/resolveServerEndpoint precedence: a user's own AI key
 * first, VulnRadar's server default otherwise) -- reused directly from that
 * module rather than reimplemented, so the two features can never drift on
 * "which endpoint does this account's AI calls actually use".
 *
 * Token/cost accounting: deliberately NOT metered against a monthly counter
 * the way lib/billing/github-review-usage.ts meters GitHub repo AI review.
 * That feature needs a counter because its input is unbounded -- a review
 * run sends arbitrary amounts of real repository source code, so cost per
 * run varies wildly and a cap protects VulnRadar's shared server budget.
 * This module's prompt is fixed-shape and small by construction (severity
 * counts plus up to TOP_FINDINGS_LIMIT finding titles, see buildPrompt
 * below -- never full finding evidence/descriptions, regardless of how many
 * findings the scan has), and MAX_OUTPUT_TOKENS caps the response too. That
 * puts its per-call cost in the same small, bounded range as a single
 * lib/ai/verify-findings.ts call, which has never been metered either. If
 * usage patterns later show this needs a cap (e.g. a user mashing
 * "Regenerate" in a loop against VulnRadar's shared server endpoint), the
 * natural extension point is a sibling table to github_review_usage, keyed
 * the same way -- not a change to this module's shape.
 */

import type { ScanResult, Severity } from "@/lib/scanner/types";
import {
  resolveServerEndpoint,
  resolveUserEndpoint,
  type AiEndpoint,
} from "./verify-findings";
import { isAnthropicProvider } from "@/lib/ai/provider";
import { callAnthropicMessages } from "@/lib/ai/anthropic";
import { resolveAnthropicThinkingBudget } from "@/lib/ai/reasoning";
import { getSafetyRating } from "@/lib/scanner/safety-rating";
import { APP_NAME } from "@/lib/config/constants";

/** Short and cheap by design: this should feel fast, not become the slowest part of viewing a scan result. */
const CALL_TIMEOUT_MS = 12_000;

/** ~3-5 sentences of prose plus a little headroom; keeps the call cheap regardless of provider. */
const MAX_OUTPUT_TOKENS = 400;

/** Highest-severity findings only, capped, so a scan with hundreds of findings still produces a small prompt. */
const TOP_FINDINGS_LIMIT = 6;

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const SUMMARY_SYSTEM_PROMPT = `You are ${APP_NAME}'s scan summarizer. You are given the results of one completed vulnerability scan: a safety rating, a 1-10 danger score, severity counts, and the titles of its highest-severity findings (not the full finding list).

Write a 3 to 5 sentence plain-English summary a non-technical stakeholder could paste directly into a report. Cover, in prose (no headings, no bullet points):
1. The overall risk posture, stated plainly (e.g. what a critical/high finding actually means for the site, not just "there are N findings").
2. The single most important thing to fix first.
3. Any pattern worth naming across the findings you were given -- for example, if several titles point at the same root cause (a missing CSP, several missing security headers, repeated hardcoded secrets), say that once instead of treating them as unrelated. If there is no such pattern, skip this rather than inventing one.

Do not list every finding individually. Do not invent findings, counts, or details you were not given. Be specific and direct: say what happens, not that the posture is "strong" or "robust" -- those words are meaningless without a reason attached. No em dashes. No markdown formatting of any kind.

Return only the summary text itself, nothing else -- no preamble like "Here is the summary:".`;

function severityRank(s: Severity): number {
  return SEVERITY_RANK[s] ?? 5;
}

function buildPrompt(result: ScanResult): string {
  const { summary, findings } = result;
  const rating = getSafetyRating(findings);

  const topFindings = [...findings]
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .slice(0, TOP_FINDINGS_LIMIT)
    .map((f) => `- [${f.severity}] ${f.title} (${f.category})`)
    .join("\n");

  const omittedCount =
    findings.length - Math.min(findings.length, TOP_FINDINGS_LIMIT);

  return `url: ${result.url}
safety_rating: ${rating}
danger_score: ${result.dangerScore ?? "n/a"}/10
finding_counts: critical=${summary.critical} high=${summary.high} medium=${summary.medium} low=${summary.low} info=${summary.info} total=${summary.total}

highest-severity findings${omittedCount > 0 ? ` (top ${TOP_FINDINGS_LIMIT} of ${findings.length} total, ${omittedCount} more not shown)` : ""}:
${topFindings || "(none -- zero findings on this scan)"}`;
}

function cleanSummaryText(text: string): string | null {
  const noThink = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const clean = noThink
    .replace(/```(?:\w+)?\s*/g, "")
    .replace(/```/g, "")
    .trim();
  return clean.length > 0 ? clean.slice(0, 2000) : null;
}

async function callSummaryModel(
  endpoint: AiEndpoint,
  prompt: string,
  signal: AbortSignal,
): Promise<string | null> {
  if (isAnthropicProvider(endpoint.baseUrl)) {
    const { text } = await callAnthropicMessages(
      {
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        model: endpoint.model,
        system: SUMMARY_SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
        maxTokens: MAX_OUTPUT_TOKENS,
        thinkingBudgetTokens: resolveAnthropicThinkingBudget(MAX_OUTPUT_TOKENS),
      },
      signal,
    );
    return cleanSummaryText(text);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (endpoint.apiKey) headers["Authorization"] = `Bearer ${endpoint.apiKey}`;
  try {
    const host = new URL(endpoint.baseUrl).hostname.toLowerCase();
    if (host === "openrouter.ai") {
      headers["HTTP-Referer"] =
        process.env.NEXT_PUBLIC_APP_URL ?? "https://vulnradar.dev";
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
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
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
      `[AI-SCAN-SUMMARY] HTTP ${res.status} from ${endpoint.baseUrl}: ${body.slice(0, 300)}`,
    );
    return null;
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") return null;

  return cleanSummaryText(text);
}

/**
 * Generates a short scan-level summary, or null when it can't: no AI
 * endpoint configured (server or user), the call errors, or it times out.
 * Never throws -- a scan's overall success (and viewing its results) never
 * depends on this succeeding, matching how verify-findings.ts fails open.
 */
export async function generateScanSummary(
  result: ScanResult,
  userId: number,
): Promise<string | null> {
  const endpoint =
    (await resolveUserEndpoint(userId)) ?? resolveServerEndpoint();
  if (!endpoint) return null;

  const prompt = buildPrompt(result);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);

  try {
    return await callSummaryModel(endpoint, prompt, controller.signal);
  } catch (err) {
    console.error(
      "[AI-SCAN-SUMMARY] generateScanSummary failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

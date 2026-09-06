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
 * Token/cost accounting: metered against the same fixed-window counter as
 * AI chat and AI finding verification (lib/billing/ai-usage.ts), unlike
 * GitHub repo AI review's separate monthly counter
 * (lib/billing/github-review-usage.ts) -- that feature needs its own,
 * larger-scoped counter because its input is unbounded (a review run
 * sends arbitrary amounts of real repository source code, so cost per run
 * varies wildly), while this module's prompt is fixed-shape and small by
 * construction (severity counts plus up to TOP_FINDINGS_LIMIT finding
 * titles, see buildPrompt below -- never full finding evidence/
 * descriptions, regardless of how many findings the scan has), putting it
 * in the same small, bounded range as a single lib/ai/verify-findings.ts
 * call -- which is exactly why it shares that same shared-window counter
 * rather than getting one of its own.
 */

import type { ScanResult, Severity } from "@/lib/scanner/types";
import {
  resolveServerEndpoint,
  resolveUserEndpoint,
  type AiEndpoint,
} from "./verify-findings";
import { isAnthropicProvider } from "@/lib/ai/provider";
import { callAnthropicMessages } from "@/lib/ai/anthropic";
import {
  resolveAnthropicThinkingBudget,
  resolveOpenAiCompatReasoningExtras,
} from "@/lib/ai/reasoning";
import { getSafetyRating } from "@/lib/scanner/safety-rating";
import { APP_NAME, APP_URL, SEVERITY_PRIORITY } from "@/lib/config/constants";
import { getSettings } from "@/lib/config/runtime-config";
import { recordAiTokens } from "@/lib/billing/ai-usage";

const SUMMARY_SYSTEM_PROMPT = `You are ${APP_NAME}'s scan summarizer. You are given the results of one completed vulnerability scan: a safety rating, a 1-10 danger score, an SSL/TLS letter grade (A+ to F, or n/a for HTTP-only targets), severity counts, and the titles of its highest-severity findings (not the full finding list).

Write a 3 to 5 sentence plain-English summary a non-technical stakeholder could paste directly into a report. Cover, in prose (no headings, no bullet points):
1. The overall risk posture, stated plainly (e.g. what a critical/high finding actually means for the site, not just "there are N findings").
2. The single most important thing to fix first.
3. Any pattern worth naming across the findings you were given -- for example, if several titles point at the same root cause (a missing CSP, several missing security headers, repeated hardcoded secrets), say that once instead of treating them as unrelated. If there is no such pattern, skip this rather than inventing one.

When ssl_grade is a letter (not n/a), you may cite it, especially a weak grade of C or below. The same scan also captures the domain's full DNS record set and auto-discovers subdomains, so never imply it only checks headers; but those specifics are not in this input, so do not invent DNS records or subdomain names.

Do not list every finding individually. Do not invent findings, counts, or details you were not given. Be specific and direct: say what happens, not that the posture is "strong" or "robust" -- those words are meaningless without a reason attached. No em dashes. No markdown formatting of any kind.

Return only the summary text itself, nothing else -- no preamble like "Here is the summary:".`;

/** Worst first, so the prompt spends its finding budget on what matters. An
 *  unrecognised severity ranks below info rather than above critical, which is
 *  what the local table this replaced achieved with its own inverted
 *  convention and a `?? 5` fallback. ref: AUDIT-013#dup-02 */
function severityRank(s: Severity): number {
  return SEVERITY_PRIORITY[s] ?? 0;
}

function buildPrompt(result: ScanResult, topFindingsLimit: number): string {
  const { summary, findings } = result;
  const rating = getSafetyRating(findings);

  const topFindings = [...findings]
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, topFindingsLimit)
    .map((f) => `- [${f.severity}] ${f.title} (${f.category})`)
    .join("\n");

  const omittedCount =
    findings.length - Math.min(findings.length, topFindingsLimit);

  return `url: ${result.url}
safety_rating: ${rating}
danger_score: ${result.dangerScore ?? "n/a"}/10
ssl_grade: ${result.sslGrade ?? "n/a"}
finding_counts: critical=${summary.critical} high=${summary.high} medium=${summary.medium} low=${summary.low} info=${summary.info} total=${summary.total}

highest-severity findings${omittedCount > 0 ? ` (top ${topFindingsLimit} of ${findings.length} total, ${omittedCount} more not shown)` : ""}:
${topFindings || "(none -- zero findings on this scan)"}`;
}

function cleanSummaryText(text: string, maxOutputChars: number): string | null {
  const noThink = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const clean = noThink
    .replace(/```(?:\w+)?\s*/g, "")
    .replace(/```/g, "")
    .trim();
  return clean.length > 0 ? clean.slice(0, maxOutputChars) : null;
}

interface CallSummaryResult {
  text: string | null;
  /** Real tokens the provider reported for this call (0 if the call never reached a provider, or the provider omitted usage). */
  tokensUsed: number;
}

async function callSummaryModel(
  endpoint: AiEndpoint,
  prompt: string,
  maxTokens: number,
  maxOutputChars: number,
  signal: AbortSignal,
): Promise<CallSummaryResult> {
  if (isAnthropicProvider(endpoint.baseUrl)) {
    const { text, usage } = await callAnthropicMessages(
      {
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        model: endpoint.model,
        system: SUMMARY_SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
        maxTokens,
        thinkingBudgetTokens: resolveAnthropicThinkingBudget(maxTokens),
      },
      signal,
    );
    return {
      text: cleanSummaryText(text, maxOutputChars),
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

  // Low effort rather than high: a summary restates findings that have
  // already been decided, and its latency is visible on every completed scan.
  const extras = resolveOpenAiCompatReasoningExtras(
    endpoint.baseUrl,
    endpoint.model,
    "summary",
  );
  const askedToReason = Object.keys(extras).length > 0;
  const baseBody: Record<string, unknown> = {
    model: endpoint.model,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: SUMMARY_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
  };
  const post = (body: Record<string, unknown>) =>
    fetch(`${endpoint.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

  let res = await post({ ...baseBody, ...extras });
  // Same fallback as the verifier: an endpoint that refuses the field should
  // cost us the reasoning, not the summary.
  if (!res.ok && res.status === 400 && askedToReason) {
    let refusal = "";
    try {
      refusal = await res.clone().text();
    } catch {
      /* ignore */
    }
    if (/reasoning/i.test(refusal)) {
      console.error(
        `[AI-SCAN-SUMMARY] ${endpoint.model} refused reasoning_effort; retrying without it.`,
      );
      res = await post(baseBody);
    }
  }

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
    return { text: null, tokensUsed: 0 };
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
  if (typeof text !== "string") return { text: null, tokensUsed };

  return { text: cleanSummaryText(text, maxOutputChars), tokensUsed };
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
  usingOwnAi = false,
): Promise<string | null> {
  const endpoint =
    (await resolveUserEndpoint(userId)) ?? resolveServerEndpoint();
  if (!endpoint) return null;

  const settings = await getSettings([
    "AI_SUMMARY_MAX_TOKENS",
    "AI_SUMMARY_CALL_TIMEOUT_MS",
    "AI_SUMMARY_TOP_FINDINGS_LIMIT",
    "AI_SUMMARY_MAX_OUTPUT_CHARS",
  ] as const);
  const maxTokens = settings.AI_SUMMARY_MAX_TOKENS;
  const callTimeoutMs = settings.AI_SUMMARY_CALL_TIMEOUT_MS;
  const maxOutputChars = settings.AI_SUMMARY_MAX_OUTPUT_CHARS;
  const prompt = buildPrompt(result, settings.AI_SUMMARY_TOP_FINDINGS_LIMIT);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), callTimeoutMs);

  try {
    const { text, tokensUsed } = await callSummaryModel(
      endpoint,
      prompt,
      maxTokens,
      maxOutputChars,
      controller.signal,
    );
    if (tokensUsed > 0 && !usingOwnAi) {
      try {
        await recordAiTokens(userId, tokensUsed);
      } catch (err) {
        console.error(
          "[AI-SCAN-SUMMARY] Failed to record token usage (non-fatal):",
          err instanceof Error ? err.message : err,
        );
      }
    }
    return text;
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

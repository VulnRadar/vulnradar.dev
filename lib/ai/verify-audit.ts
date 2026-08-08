/**
 * DB-free AI verification — used only by scripts/fp-audit.ts.
 *
 * Identical logic to verify-findings.ts but without any database imports,
 * so it can be imported in a Node script without DATABASE_URL being set.
 * Only resolves the server-side AI endpoint (env vars); user config is skipped.
 *
 * Delete this file if the fp-audit script is removed.
 */

import type { Vulnerability } from "@/lib/scanner/types";
import { VERIFY_SYSTEM_PROMPT } from "./verify-context";
import {
  resolveAiBaseUrl,
  resolveAiDefaultModel,
  isAnthropicProvider,
} from "@/lib/ai/provider";
import { callAnthropicMessages } from "@/lib/ai/anthropic";
import { resolveAnthropicThinkingBudget } from "@/lib/ai/reasoning";
import {
  AI_VERIFY_MAX_TOKENS,
  AI_VERIFY_CALL_TIMEOUT_MS,
  AI_VERIFY_PROBE_TIMEOUT_MS,
  AI_VERIFY_TOTAL_TIMEOUT_MS,
  APP_NAME,
} from "@/lib/config/constants";

type AiVerdict = "confirmed" | "possible_fp" | "uncertain";

interface VerifyResult {
  id: string;
  verdict: AiVerdict;
  confidence: number;
  reason: string;
}

interface AiEndpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface ProbeData {
  status_code: number;
  final_url: string;
  response_headers: Record<string, string>;
  body_snippet: string;
  error?: string;
}

function resolveServerEndpoint(): AiEndpoint | null {
  const baseUrl = resolveAiBaseUrl();
  if (!baseUrl) return null;
  const model = process.env.AI_MODEL || resolveAiDefaultModel(baseUrl);
  return { baseUrl, apiKey: process.env.AI_API_KEY ?? "", model };
}

async function probeTarget(targetUrl: string): Promise<ProbeData> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    AI_VERIFY_PROBE_TIMEOUT_MS,
  );
  const ensuredUrl = /^https?:\/\//i.test(targetUrl)
    ? targetUrl
    : `https://${targetUrl}`;

  try {
    const res = await fetch(ensuredUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": `${APP_NAME}-AI/1.0 (security verification probe)`,
        Accept: "text/html,application/xhtml+xml,application/json,*/*",
      },
    });
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      responseHeaders[k.toLowerCase()] = v;
    });
    let bodySnippet = "";
    try {
      const text = await res.text();
      bodySnippet = text.slice(0, 8192);
    } catch {
      /* ignore */
    }
    return {
      status_code: res.status,
      final_url: res.url,
      response_headers: responseHeaders,
      body_snippet: bodySnippet,
    };
  } catch (err) {
    return {
      status_code: 0,
      final_url: ensuredUrl,
      response_headers: {},
      body_snippet: "",
      error: err instanceof Error ? err.message : "probe failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callVerify(
  url: string,
  finding: Vulnerability,
  endpoint: AiEndpoint,
  probe: ProbeData,
): Promise<VerifyResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_VERIFY_CALL_TIMEOUT_MS);

  const probeSection = probe.error
    ? `live_probe: { "error": "${probe.error}" }`
    : `live_probe: ${JSON.stringify({ status_code: probe.status_code, final_url: probe.final_url, response_headers: probe.response_headers, body_snippet: probe.body_snippet }, null, 2)}`;

  // See lib/ai/verify-findings.ts's buildVerifyPrompt for why: the detector's
  // own verbatim proof is smaller and more targeted than the generic 8KB
  // body_snippet, which may not contain the match at all for content deep in
  // a large document.
  const excerptsSection =
    finding.evidenceExcerpts && finding.evidenceExcerpts.length > 0
      ? `\nevidence_excerpts: ${JSON.stringify(finding.evidenceExcerpts)}`
      : "";

  const prompt = `Verify this ${APP_NAME} finding using the live probe data below.

finding_id: ${finding.id}
title: ${finding.title}
category: ${finding.category}
severity: ${finding.severity}
evidence: ${finding.evidence}${excerptsSection}

${probeSection}

Return only JSON: {"verdict":"confirmed|possible_fp|uncertain","confidence":60-97,"reason":"one sentence citing specific live evidence"}`;

  try {
    let text: string | undefined;

    if (isAnthropicProvider(endpoint.baseUrl)) {
      const result = await callAnthropicMessages(
        {
          baseUrl: endpoint.baseUrl,
          apiKey: endpoint.apiKey,
          model: endpoint.model,
          system: VERIFY_SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
          maxTokens: AI_VERIFY_MAX_TOKENS,
          thinkingBudgetTokens:
            resolveAnthropicThinkingBudget(AI_VERIFY_MAX_TOKENS),
        },
        controller.signal,
      );
      text = result.text;
    } else {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (endpoint.apiKey)
        headers["Authorization"] = `Bearer ${endpoint.apiKey}`;
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
          max_tokens: AI_VERIFY_MAX_TOKENS,
          messages: [
            { role: "system", content: VERIFY_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let body = "";
        try {
          body = await res.text();
        } catch {
          /* ignore */
        }
        console.error(
          `[AUDIT-AI] HTTP ${res.status} for "${finding.id}": ${body.slice(0, 200)}`,
        );
        return null;
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      text = data?.choices?.[0]?.message?.content;
    }

    if (typeof text !== "string") return null;

    const noThink = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    const clean = noThink
      .replace(/```(?:json)?\s*/g, "")
      .replace(/```/g, "")
      .trim();

    if (!clean) return null;

    // Strict parse first; fall back to extracting the first `{...}`
    // substring so a model that prefixes its JSON with a stray sentence
    // (despite the "return only JSON" instruction) doesn't fail outright.
    // See lib/ai/verify-findings.ts's tryParseVerdictJson/parseVerifyResponseText.
    let parsed: Record<string, unknown> | null;
    try {
      parsed = JSON.parse(clean) as Record<string, unknown>;
    } catch {
      const start = clean.indexOf("{");
      const end = clean.lastIndexOf("}");
      parsed =
        start !== -1 && end !== -1 && end > start
          ? (() => {
              try {
                return JSON.parse(clean.slice(start, end + 1)) as Record<
                  string,
                  unknown
                >;
              } catch {
                return null;
              }
            })()
          : null;
    }

    const verdict = parsed?.verdict;
    if (
      verdict === "confirmed" ||
      verdict === "possible_fp" ||
      verdict === "uncertain"
    ) {
      const confidence =
        typeof parsed!.confidence === "number"
          ? Math.min(97, Math.max(60, Math.round(parsed!.confidence as number)))
          : 70;
      const reason =
        typeof parsed!.reason === "string"
          ? (parsed!.reason as string).slice(0, 300)
          : "";
      return { id: finding.id, verdict, confidence, reason };
    }

    // The model responded but didn't produce a parseable verdict (usually
    // prose hedging instead of JSON). Report "uncertain" with its own text
    // as the reason instead of silently dropping the finding.
    return {
      id: finding.id,
      verdict: "uncertain",
      confidence: 60,
      reason: `AI response was not a parseable verdict: ${clean.slice(0, 200)}`.slice(
        0,
        300,
      ),
    };
  } catch (err) {
    console.error(
      `[AUDIT-AI] callVerify failed for "${finding.id}":`,
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function auditVerifyBatch(
  url: string,
  findings: Vulnerability[],
  logEndpoint = false,
): Promise<Vulnerability[]> {
  if (findings.length === 0) return findings;

  const endpoint = resolveServerEndpoint();
  if (!endpoint) {
    console.error(
      "[AUDIT-AI] No AI endpoint configured — set AI_BASE_URL or AI_PROVIDER in .env.local",
    );
    return findings;
  }

  if (logEndpoint) {
    console.log(
      `[AUDIT-AI] endpoint=${endpoint.baseUrl}  model=${endpoint.model}  key=${endpoint.apiKey ? `set (${endpoint.apiKey.length} chars)` : "MISSING"}`,
    );
  }

  const probe = await probeTarget(url);

  // Process findings sequentially with a small delay to avoid hitting
  // provider rate limits — the chatbot sends one request at a time.
  const results: VerifyResult[] = [];
  const deadline = Date.now() + AI_VERIFY_TOTAL_TIMEOUT_MS;

  for (const f of findings) {
    if (Date.now() > deadline) break;
    const result = await callVerify(url, f, endpoint, probe);
    if (result) results.push(result);
    // Small pause between calls — prevents request-rate 429s from providers
    // that bucket by requests-per-second rather than total tokens.
    if (Date.now() + 300 < deadline) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  const verdictMap = new Map<string, Omit<VerifyResult, "id">>();
  for (const r of results) {
    const { id, ...rest } = r;
    verdictMap.set(id, rest);
  }

  return findings.map((f) => {
    const v = verdictMap.get(f.id);
    if (!v) return f;
    return {
      ...f,
      aiVerdict: v.verdict,
      aiConfidence: v.confidence,
      aiReason: v.reason,
    };
  });
}

import pool from "@/lib/database/db";
import { decryptApiKey } from "@/lib/auth/crypto";
import type { Vulnerability } from "@/lib/scanner/types";
import { safeFetch } from "@/lib/scanner/safe-fetch";
import { VERIFY_SYSTEM_PROMPT } from "./verify-context";
import {
  resolveAiBaseUrl,
  resolveAiDefaultModel,
  isAnthropicProvider,
} from "@/lib/ai/provider";
import { callAnthropicMessages } from "@/lib/ai/anthropic";
import { resolveAnthropicThinkingBudget } from "@/lib/ai/reasoning";
import { getSettings } from "@/lib/config/runtime-config";
import { APP_NAME } from "@/lib/config/constants";

type AiVerdict = "confirmed" | "possible_fp" | "uncertain";

interface VerifyResult {
  id: string;
  verdict: AiVerdict;
  confidence: number;
  reason: string;
}

// Exported so lib/ai/review-source.ts (GitHub repo AI code review) can
// resolve the same server/user AI endpoint without duplicating this
// module's DB lookup and env-var resolution logic.
export interface AiEndpoint {
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

interface VerifySettings {
  maxTokens: number;
  chunkSize: number;
  callTimeoutMs: number;
  probeTimeoutMs: number;
  totalTimeoutMs: number;
}

/**
 * Resolves the admin-editable AI settings once per batch (not once per
 * finding), so a scan with hundreds of findings issues a single settings
 * lookup instead of one per AI call.
 */
async function resolveVerifySettings(): Promise<VerifySettings> {
  const settings = await getSettings([
    "AI_VERIFY_MAX_TOKENS",
    "AI_VERIFY_CHUNK_SIZE",
    "AI_VERIFY_CALL_TIMEOUT_MS",
    "AI_VERIFY_PROBE_TIMEOUT_MS",
    "AI_VERIFY_TOTAL_TIMEOUT_MS",
  ] as const);
  return {
    maxTokens: settings.AI_VERIFY_MAX_TOKENS,
    chunkSize: settings.AI_VERIFY_CHUNK_SIZE,
    callTimeoutMs: settings.AI_VERIFY_CALL_TIMEOUT_MS,
    probeTimeoutMs: settings.AI_VERIFY_PROBE_TIMEOUT_MS,
    totalTimeoutMs: settings.AI_VERIFY_TOTAL_TIMEOUT_MS,
  };
}

export function resolveServerEndpoint(): AiEndpoint | null {
  const baseUrl = resolveAiBaseUrl();
  if (!baseUrl) return null;
  const model = process.env.AI_MODEL || resolveAiDefaultModel(baseUrl);
  return { baseUrl, apiKey: process.env.AI_API_KEY ?? "", model };
}

export async function resolveUserEndpoint(
  userId: number,
): Promise<AiEndpoint | null> {
  try {
    const result = await pool.query(
      `SELECT use_vulnradar_ai, model_id, api_key_encrypted, base_url
       FROM user_ai_configs WHERE user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.use_vulnradar_ai ||
      !row.base_url ||
      !row.model_id ||
      !row.api_key_encrypted
    ) {
      return null;
    }
    let apiKey: string;
    try {
      apiKey = decryptApiKey(row.api_key_encrypted as string);
    } catch {
      return null;
    }
    return {
      baseUrl: (row.base_url as string).replace(/\/$/, ""),
      model: row.model_id as string,
      apiKey,
    };
  } catch {
    return null;
  }
}

async function probeTarget(
  targetUrl: string,
  probeTimeoutMs: number,
): Promise<ProbeData> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), probeTimeoutMs);

  const ensuredUrl = /^https?:\/\//i.test(targetUrl)
    ? targetUrl
    : `https://${targetUrl}`;

  try {
    // ensuredUrl is attacker-influenced: verify-batch/route.ts passes the raw
    // request-body `url` straight through with no upstream validation, and
    // even the scan_history-sourced `url` in verify/route.ts could have been
    // re-pointed at an internal host via DNS rebinding since the original
    // scan ran. safeFetch (lib/scanner/safe-fetch.ts) is the shared SSRF
    // guard: it rejects private/internal hosts, re-resolves DNS, and
    // re-validates every redirect hop rather than blindly following them.
    const res = await safeFetch(ensuredUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": `${APP_NAME}-AI/1.0 (security verification probe)`,
        Accept: "text/html,application/xhtml+xml,application/json,*/*",
      },
    });

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((v: string, k: string) => {
      responseHeaders[k.toLowerCase()] = v;
    });

    let bodySnippet = "";
    try {
      const text = await res.text();
      bodySnippet = text.slice(0, 8192);
    } catch {
      /* ignore body read failures */
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

/**
 * Parses a verdict object out of the model's raw text. Tries a strict parse
 * first, then falls back to extracting the first `{...}` substring — a model
 * that prefixes its JSON with a stray sentence (despite the "return only
 * JSON" instruction) would otherwise fail JSON.parse on the whole response
 * and lose the finding entirely.
 */
function tryParseVerdictJson(clean: string): Record<string, unknown> | null {
  try {
    return JSON.parse(clean) as Record<string, unknown>;
  } catch {
    /* fall through to substring extraction below */
  }
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(clean.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseVerifyResponseText(
  findingId: string,
  text: string,
): VerifyResult | null {
  const noThink = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const clean = noThink
    .replace(/```(?:json)?\s*/g, "")
    .replace(/```/g, "")
    .trim();

  if (!clean) return null;

  const parsed = tryParseVerdictJson(clean);
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
    return { id: findingId, verdict, confidence, reason };
  }

  // The model responded (HTTP 200, non-empty body) but didn't produce a
  // parseable verdict — most often it hedged in prose instead of returning
  // JSON, typically because it felt it lacked enough evidence to decide.
  // Dropping the finding here (returning null) is how a finding silently
  // never gets reported on even though the AI did reply. Report it instead:
  // "uncertain", carrying the model's own text as the reason, so every
  // finding sent to the AI comes back with SOME verdict.
  return {
    id: findingId,
    verdict: "uncertain",
    confidence: 60,
    reason:
      `AI response was not a parseable verdict: ${clean.slice(0, 200)}`.slice(
        0,
        300,
      ),
  };
}

function buildVerifyPrompt(finding: Vulnerability, probe: ProbeData): string {
  const probeSection = probe.error
    ? `live_probe: { "error": "${probe.error}" }`
    : `live_probe: ${JSON.stringify(
        {
          status_code: probe.status_code,
          final_url: probe.final_url,
          response_headers: probe.response_headers,
          body_snippet: probe.body_snippet,
        },
        null,
        2,
      )}`;

  // evidenceExcerpts are the verbatim proof strings the original detector
  // already extracted (e.g. the exact script src or matched pattern) — much
  // smaller and more targeted than body_snippet, which is only the first
  // 8KB of the page and may not contain the match at all for content deep
  // in a large document. Passing them directly lets the AI confirm against
  // the same text the detector matched instead of re-deriving it (or giving
  // up) from a generic, possibly-irrelevant snippet.
  const excerptsSection =
    finding.evidenceExcerpts && finding.evidenceExcerpts.length > 0
      ? `\nevidence_excerpts: ${JSON.stringify(finding.evidenceExcerpts)}`
      : "";

  return `Verify this ${APP_NAME} finding using the live probe data below.

finding_id: ${finding.id}
title: ${finding.title}
category: ${finding.category}
severity: ${finding.severity}
evidence: ${finding.evidence}${excerptsSection}

${probeSection}

Return only JSON: {"verdict":"confirmed|possible_fp|uncertain","confidence":60-97,"reason":"one sentence citing specific live evidence"}`;
}

async function callVerify(
  url: string,
  finding: Vulnerability,
  endpoint: AiEndpoint,
  probe: ProbeData,
  settings: VerifySettings,
): Promise<VerifyResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.callTimeoutMs);
  const prompt = buildVerifyPrompt(finding, probe);

  try {
    if (isAnthropicProvider(endpoint.baseUrl)) {
      const { text } = await callAnthropicMessages(
        {
          baseUrl: endpoint.baseUrl,
          apiKey: endpoint.apiKey,
          model: endpoint.model,
          system: VERIFY_SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
          maxTokens: settings.maxTokens,
          thinkingBudgetTokens: resolveAnthropicThinkingBudget(
            settings.maxTokens,
          ),
        },
        controller.signal,
      );
      return parseVerifyResponseText(finding.id, text);
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
        max_tokens: settings.maxTokens,
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
        `[AI-VERIFY] HTTP ${res.status} from ${endpoint.baseUrl} for "${finding.id}": ${body.slice(0, 300)}`,
      );
      return null;
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string") return null;

    return parseVerifyResponseText(finding.id, text);
  } catch (err) {
    console.error(
      '[AI-VERIFY] callVerify failed for "%s":',
      finding.id,
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function chunkFindings<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Verifies findings in fixed-size concurrent chunks instead of firing every
 * finding at once. Two problems this fixes versus one big Promise.race
 * over the whole batch: unbounded fan-out can trip provider rate limits on
 * large scans, and racing a single global timeout against the whole batch
 * discards every result — including ones that already finished — the
 * instant the deadline hits. Chunking means only the chunk in flight when
 * the deadline passes is at risk, and onChunkDone lets the caller persist
 * verdicts incrementally so a scan with hundreds of findings keeps whatever
 * got verified even if it runs out of time before covering all of them.
 */
async function verifyInChunks(
  url: string,
  findings: Vulnerability[],
  endpoint: AiEndpoint,
  probe: ProbeData,
  deadline: number,
  settings: VerifySettings,
  onChunkDone?: (
    verdicts: Map<string, Omit<VerifyResult, "id">>,
  ) => Promise<void> | void,
): Promise<Map<string, Omit<VerifyResult, "id">>> {
  const verdictMap = new Map<string, Omit<VerifyResult, "id">>();

  for (const group of chunkFindings(findings, settings.chunkSize)) {
    if (Date.now() >= deadline) break;

    const settled = await Promise.allSettled(
      group.map((f) => callVerify(url, f, endpoint, probe, settings)),
    );

    for (const r of settled) {
      if (r.status === "fulfilled" && r.value) {
        const { id, ...rest } = r.value;
        verdictMap.set(id, rest);
      }
    }

    // Awaited so a slow chunk's persistence can't land after (and clobber)
    // a later, more-complete chunk's write.
    await onChunkDone?.(verdictMap);
  }

  return verdictMap;
}

export async function verifyFindingsBatch(
  url: string,
  findings: Vulnerability[],
  userId?: number | null,
): Promise<Vulnerability[]> {
  if (findings.length === 0) return findings;

  const endpoint =
    (userId ? await resolveUserEndpoint(userId) : null) ??
    resolveServerEndpoint();

  if (!endpoint) return findings;

  const settings = await resolveVerifySettings();
  const probe = await probeTarget(url, settings.probeTimeoutMs);
  const deadline = Date.now() + settings.totalTimeoutMs;
  const verdictMap = await verifyInChunks(
    url,
    findings,
    endpoint,
    probe,
    deadline,
    settings,
  );

  return applyVerdicts(findings, verdictMap);
}

function applyVerdicts(
  findings: Vulnerability[],
  verdictMap: Map<string, Omit<VerifyResult, "id">>,
): Vulnerability[] {
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

export async function runAiVerification(
  url: string,
  findings: Vulnerability[],
  scanHistoryId: number,
  userId?: number | null,
): Promise<void> {
  if (findings.length === 0) return;

  const endpoint =
    (userId ? await resolveUserEndpoint(userId) : null) ??
    resolveServerEndpoint();

  if (!endpoint) {
    console.error(
      "[AI-VERIFY] No endpoint resolved — check AI_BASE_URL/AI_PROVIDER env vars or user AI config",
    );
    return;
  }

  const settings = await resolveVerifySettings();
  const probe = await probeTarget(url, settings.probeTimeoutMs);
  const deadline = Date.now() + settings.totalTimeoutMs;

  // Verdicts are written to scan_history after every chunk, not just once
  // at the end, so a scan with a lot of findings keeps whatever got
  // verified even if the process is cut off (by the deadline above, or by
  // the calling route's own request timeout) before covering all of them.
  const verdictMap = await verifyInChunks(
    url,
    findings,
    endpoint,
    probe,
    deadline,
    settings,
    async (partial) => {
      const enriched = applyVerdicts(findings, partial);
      try {
        await pool.query(
          "UPDATE scan_history SET findings = $1 WHERE id = $2",
          [JSON.stringify(enriched), scanHistoryId],
        );
      } catch (err) {
        console.error(
          "[AI-VERIFY] DB update failed:",
          err instanceof Error ? err.message : err,
        );
      }
    },
  );

  if (verdictMap.size === 0) {
    console.error(
      `[AI-VERIFY] All ${findings.length} findings returned null or timed out for ${url} — check the configured AI endpoint/model`,
    );
  }
}
